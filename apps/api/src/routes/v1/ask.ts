import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import {
  search,
  getArtist,
  getLabel,
  getMaster,
  getArtistMasters,
  getArtistCredits,
  getBatchForTable,
} from "@dig/domain";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = process.env.LLM_MODEL ?? "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_TURNS = 12;

const PRIVATE_KEYS = new Set(
  (process.env.LLM_BETA_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// ---------------------------------------------------------------------------
// Personality — no output format instructions, no guardrails
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Dig music assistant. Dig is a music discovery platform built on 24 million records from the Discogs catalog — artists, labels, masters, releases, credits. The site is app.dig.baby.

You are deeply knowledgeable about music across all genres and eras. You understand what people mean: "Prince" is an artist, "Blue Note" is a jazz label, "Spirit of Eden" is a Talk Talk album, "classic Chicago house" is a genre and era.

You have tools to search and retrieve real catalog data. Use them freely and creatively:
- If get_artist_releases returns nothing, try search_catalog with type=master and the artist name — releases are sometimes credited differently
- Try multiple search angles before giving up: artist name variations, label names, release titles
- If you find an artist ID, always follow up with get_artist_releases to check their catalog

IMPORTANT: Only ever reference Dig (app.dig.baby) for searching and browsing. Never mention Discogs.com, Bandcamp, or any external site. If data isn't in the Dig catalog, simply say it's not in the catalog and suggest the user search Dig directly.

Help people discover music. Be specific, surface the good stuff, reference actual titles and years. If something isn't available, be brief about it and move on — don't pad with suggestions to go elsewhere.

Don't narrate your tool use. Be conversational, not a database report.`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "search_catalog",
    description:
      "Search the Dig music catalog (24M+ Discogs records). Use to find artists, labels, or releases by name, genre, style, or keywords. Returns matching entities with IDs you can use in follow-up calls.",
    input_schema: {
      type: "object" as const,
      properties: {
        q: { type: "string", description: "Search query — artist name, album title, label, genre term, etc." },
        type: {
          type: "string",
          enum: ["artist", "label", "master", "release"],
          description: "Filter to a specific entity type. Omit to search all types.",
        },
        genre: { type: "string", description: "Filter by genre (e.g. 'Electronic', 'Jazz', 'Rock', 'House')" },
        limit: { type: "number", description: "Results to return (1–10, default 8)" },
      },
      required: ["q"],
    },
  },
  {
    name: "get_artist",
    description:
      "Get full details for an artist by Discogs ID: genres, styles, members, aliases, biography. Use after search_catalog returns an artist ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID (from search results)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_label",
    description:
      "Get full details for a record label by Discogs ID: parent label, sublabels, profile.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs label ID (from search results)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_master",
    description:
      "Get full details for a master release by Discogs ID: tracklist, credits, year, formats. A 'master' is the canonical recording; individual pressings are 'releases'.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs master ID (from search results)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_artist_releases",
    description:
      "Get an artist's catalog from the database — their albums, EPs, and singles. Returns titles, years, and release types. If this returns 0 or very few releases, ALSO call get_artist_credits — many artists' work is catalogued through credits (Producer, Written-By) rather than direct artist links.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID" },
        release_type: {
          type: "string",
          enum: ["album", "single_ep", "compilation", "all"],
          description: "Filter by type. Use 'album' for main studio releases, 'all' for everything. Default: 'all'.",
        },
        limit: { type: "number", description: "Number of releases to return (1–20, default 12)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_artist_credits",
    description:
      "Get releases an artist is credited on as producer, writer, remixer, or performer — even when not listed as the primary artist. Essential for producers and DJs whose work appears under different credits. Use this alongside or instead of get_artist_releases.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID" },
        limit: { type: "number", description: "Number of credits to return (1–20, default 15)" },
      },
      required: ["discogs_id"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

export interface MediaItem {
  discogs_id: number;
  title: string;
  artist: string;
  youtube_url: string;
}

const YT_RE = /^[A-Za-z0-9_-]{11}$/;
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      return YT_RE.test(id) ? id : null;
    }
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && YT_RE.test(v)) return v;
    }
    return null;
  } catch { return null; }
}

async function executeTool(
  db: Kysely<Database>,
  name: string,
  input: Record<string, unknown>,
  mediaCollector: MediaItem[],
): Promise<unknown> {
  try {
    if (name === "search_catalog") {
      const q = String(input.q ?? "").slice(0, 200);
      const type = input.type as any;
      const genre = input.genre ? String(input.genre) : undefined;
      const limit = Math.min(Math.max(Number(input.limit ?? 8), 1), 10);
      const sr = await search(db, { q, type, genre, limit, quality: "all" });
      return {
        results: sr.results.map((r) => ({
          type: r.type,
          discogs_id: r.discogs_id,
          name: r.name ?? r.title,
          year: r.year,
        })),
        total: sr.results.length,
        hint: sr.meta.hint ?? undefined,
      };
    }

    if (name === "get_artist") {
      const id = Number(input.discogs_id);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.artists");
      const d = await getArtist(db, id, batchId, dumpDate) as any;
      if (!d) return { error: "Artist not found" };
      return {
        discogs_id: d.discogs_id,
        name: d.name,
        real_name: d.real_name ?? null,
        genres: d.genres ?? [],
        styles: d.styles ?? [],
        members: d.members?.map((m: any) => m.name) ?? [],
        aliases: d.aliases?.map((a: any) => a.name) ?? [],
        profile: d.profile ? String(d.profile).slice(0, 600) : null,
      };
    }

    if (name === "get_label") {
      const id = Number(input.discogs_id);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.labels");
      const d = await getLabel(db, id, batchId, dumpDate) as any;
      if (!d) return { error: "Label not found" };
      return {
        discogs_id: d.discogs_id,
        name: d.name,
        parent_label: d.parent_label?.name ?? null,
        sublabels: d.sublabels?.map((s: any) => s.name).slice(0, 10) ?? [],
        profile: d.profile ? String(d.profile).slice(0, 600) : null,
      };
    }

    if (name === "get_master") {
      const id = Number(input.discogs_id);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.masters");
      const d = await getMaster(db, id, batchId, dumpDate) as any;
      if (!d) return { error: "Release not found" };

      // Collect YouTube videos
      const artistName = d.artists?.[0]?.name ?? "Unknown";
      for (const v of (d.videos ?? []).slice(0, 3)) {
        if (v?.url && extractYouTubeId(v.url)) {
          mediaCollector.push({
            discogs_id: d.discogs_id,
            title: v.title ?? d.title,
            artist: artistName,
            youtube_url: v.url,
          });
        }
      }

      return {
        discogs_id: d.discogs_id,
        title: d.title,
        year: d.year,
        artists: d.artists?.map((a: any) => a.name) ?? [],
        genres: d.genres ?? [],
        styles: d.styles ?? [],
        tracklist: d.tracklist?.slice(0, 20).map((t: any) => ({
          position: t.position,
          title: t.title,
          duration: t.duration ?? null,
        })) ?? [],
        credits: d.credits?.slice(0, 10).map((c: any) => ({
          name: c.name,
          role: c.role,
        })) ?? [],
        notes: d.notes ? String(d.notes).slice(0, 300) : null,
        has_video: mediaCollector.some((m) => m.discogs_id === d.discogs_id),
      };
    }

    if (name === "get_artist_releases") {
      const id = Number(input.discogs_id);
      const releaseType = (input.release_type as any) ?? "all";
      const limit = Math.min(Math.max(Number(input.limit ?? 12), 1), 20);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.artists");
      const result = await getArtistMasters(db, id, batchId, dumpDate, limit, undefined, "newest", releaseType);
      return {
        releases: result.links.map((l: any) => ({
          discogs_id: l.discogs_id,
          title: l.title,
          year: l.year ?? null,
          type: l.release_type_label ?? l.release_type ?? null,
        })),
        total: result.pagination.total_estimate ?? result.links.length,
        has_more: result.pagination.has_more,
        note: result.links.length === 0
          ? "No direct releases found. Call get_artist_credits to find work credited as producer/writer/remixer."
          : undefined,
      };
    }

    if (name === "get_artist_credits") {
      const id = Number(input.discogs_id);
      const limit = Math.min(Math.max(Number(input.limit ?? 15), 1), 20);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.artists");
      const result = await getArtistCredits(db, id, batchId, dumpDate, limit) as any;
      return {
        credits: (result.links ?? []).map((l: any) => ({
          discogs_id: l.release_discogs_id ?? l.discogs_id,
          title: l.title,
          year: l.year ?? null,
          roles: l.roles ?? [],
          role_family: l.role_family ?? null,
        })),
        total: result.pagination?.total_estimate ?? (result.links?.length ?? 0),
      };
    }

    return { error: `Unknown tool: ${name}` };
  } catch (err: any) {
    return { error: String(err?.message ?? err) };
  }
}

// ---------------------------------------------------------------------------
// Anthropic API — agentic loop with native tool use
// ---------------------------------------------------------------------------

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: string;
  [key: string]: unknown;
}

async function callAnthropic(params: {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools: typeof TOOLS;
  maxTokens: number;
  anthropicApiKey: string;
}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": params.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      tools: params.tools,
      messages: params.messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Anthropic error ${res.status}: ${text.slice(0, 400)}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }

  return res.json() as Promise<{
    id: string;
    model: string;
    stop_reason: "end_turn" | "tool_use" | "max_tokens";
    content: AnthropicContentBlock[];
  }>;
}

async function runAgenticLoop(params: {
  db: Kysely<Database>;
  question: string;
  history: AnthropicMessage[];
  model: string;
  maxTokens: number;
  anthropicApiKey: string;
}): Promise<{ answer: string; model: string; tool_calls: number; media: MediaItem[] }> {
  const messages: AnthropicMessage[] = [
    ...params.history,
    { role: "user", content: params.question },
  ];

  let usedModel = params.model;
  let toolCallCount = 0;
  const mediaCollector: MediaItem[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callAnthropic({
      model: params.model,
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
      maxTokens: params.maxTokens,
      anthropicApiKey: params.anthropicApiKey,
    });

    usedModel = response.model ?? params.model;

    if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
      const textBlock = response.content.find((b) => b.type === "text");
      const answer = String(textBlock?.text ?? "").trim() || "I couldn't find anything relevant — try searching directly on Dig.";
      return { answer, model: usedModel, tool_calls: toolCallCount, media: mediaCollector };
    }

    if (response.stop_reason === "tool_use") {
      // Execute all tool calls in parallel
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      toolCallCount += toolUseBlocks.length;

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const result = await executeTool(
            params.db,
            String(block.name ?? ""),
            (block.input as Record<string, unknown>) ?? {},
            mediaCollector,
          );
          return {
            type: "tool_result" as const,
            tool_use_id: String(block.id ?? ""),
            content: JSON.stringify(result),
          };
        }),
      );

      // Feed assistant response + tool results back into the conversation
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    return {
      answer: String(textBlock?.text ?? "Something went wrong.").trim(),
      model: usedModel,
      tool_calls: toolCallCount,
      media: mediaCollector,
    };
  }

  // Exceeded max rounds — ask Claude for a final answer without tools
  const finalMessages: AnthropicMessage[] = [
    ...messages,
    {
      role: "user",
      content: "Based on what you've found so far, please give your final answer.",
    },
  ];
  const finalResp = await callAnthropic({
    model: params.model,
    system: SYSTEM_PROMPT,
    messages: finalMessages,
    tools: [],
    maxTokens: params.maxTokens,
    anthropicApiKey: params.anthropicApiKey,
  });
  const textBlock = finalResp.content.find((b) => b.type === "text");
  return {
    answer: String(textBlock?.text ?? "").trim() || "I hit a complexity limit — try a more specific question.",
    model: usedModel,
    tool_calls: toolCallCount,
    media: mediaCollector,
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function requirePrivateKey(req: FastifyRequest): { ok: true } | { ok: false; status: number; body: unknown } {
  if (PRIVATE_KEYS.size === 0) return { ok: true };
  const key = String(req.headers["x-api-key"] ?? "").trim();
  if (!key || !PRIVATE_KEYS.has(key)) {
    return {
      ok: false,
      status: 401,
      body: { error: { code: "UNAUTHORIZED", message: "Private beta key required", details: null } },
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

interface AskBody {
  question?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  max_tokens?: number;
}

export function registerAskRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.post("/v1/ask", async (req: FastifyRequest<{ Body: AskBody }>, reply) => {
    const auth = requirePrivateKey(req);
    if (!auth.ok) return reply.status(auth.status).send(auth.body);

    const anthropicApiKey = String(req.headers["x-anthropic-api-key"] ?? "").trim();
    if (!anthropicApiKey) {
      return reply.status(503).send({
        error: { code: "CONFIG_ERROR", message: "x-anthropic-api-key header is required", details: null },
      });
    }

    const body = req.body ?? {};
    const question = String(body.question ?? "").trim();
    if (question.length < 1 || question.length > 1000) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "question must be 1–1000 characters", details: null },
      });
    }

    // Sanitise history
    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history: AnthropicMessage[] = rawHistory
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }));

    const maxTokens = Math.min(Math.max(Number(body.max_tokens ?? 1200), 256), 2000);
    const model = String(body.model ?? DEFAULT_MODEL);
    const started = Date.now();

    try {
      const { answer, model: usedModel, tool_calls, media } = await runAgenticLoop({
        db,
        question,
        history,
        model,
        maxTokens,
        anthropicApiKey,
      });

      // Deduplicate media by youtube_url
      const seenUrls = new Set<string>();
      const dedupedMedia = media.filter((m) => {
        if (seenUrls.has(m.youtube_url)) return false;
        seenUrls.add(m.youtube_url);
        return true;
      });

      return reply.send({
        answer,
        media: dedupedMedia,
        meta: {
          model: usedModel,
          elapsed_ms: Date.now() - started,
          tool_calls,
        },
      });
    } catch (err: any) {
      const status = err?.status === 401 ? 401 : 502;
      return reply.status(status).send({
        error: {
          code: err?.status === 401 ? "ANTHROPIC_AUTH_ERROR" : "LLM_UPSTREAM_ERROR",
          message: err?.status === 401
            ? "Invalid Anthropic API key"
            : "Failed to generate response",
          details: { reason: String(err?.message ?? err) },
        },
      });
    }
  });
}
