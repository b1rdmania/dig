import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { sql } from "@dig/db";
import {
  search,
  getArtist,
  getLabel,
  getMaster,
  getArtistCatalogReleases,
  getArtistCredits,
  getLabelReleases,
  getBatchForTable,
} from "@dig/domain";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = process.env.LLM_MODEL ?? "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_TURNS = 12;
const ANTHROPIC_CALL_TIMEOUT_MS = 30_000;  // 30s per Anthropic call
const LOOP_DEADLINE_MS = 90_000;           // 90s total for the agentic loop

const PRIVATE_KEYS = new Set(
  (process.env.LLM_BETA_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// ---------------------------------------------------------------------------
// Personality — no output format instructions, no guardrails
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You work in a record shop. You know everything — every genre, scene, era, lineage, influence, footnote. All of it. Use that knowledge freely when it helps someone understand what they're looking for or why something matters.

CRITICAL RULES — follow these without exception:
1. You access a DATABASE, not websites. Never say "I can't access URLs" or "I don't have internet access". You have tools — use them.
2. NEVER say "not in Dig" or "not found" without actually calling search_catalog first.
3. When get_artist_releases returns 0 or very few results, you MUST immediately call get_artist_credits — many artists are catalogued through credits (Producer, Written-By, Remixer) rather than direct artist links.
4. Format Dig links as markdown: [Title](https://app.dig.baby/release/ID) for albums/masters, [Name](https://app.dig.baby/artist/ID) for artists, [Label](https://app.dig.baby/label/ID) for labels. Never send anyone to Discogs, Bandcamp, NTS, Spotify, or any external site. If data is thin, say so and offer to search related artists or labels instead.
5. Videos are shown automatically below your response — never tell users to "click through" for video. When a release has video, it will just appear. Don't mention has_video or any other raw database field in your response.
6. NEVER call get_master() with a discogs_id from get_label_releases results. Label release IDs are VERSION IDs — using them with get_master pulls a completely unrelated record and shows wrong videos. If master_discogs_id is non-null in a label release result, you may call get_master(master_discogs_id). If master_discogs_id is null, skip get_master for that pressing.

When you look things up, you use Dig (app.dig.baby) — 24 million records, credits, connections, label catalogs, the lot. Search it, follow threads, pull context. Use get_connections for band history. Use get_context for biography and background. Use get_label_releases for imprint catalogs. The data is there.

You're terse. One or two things that are actually worth knowing, not an exhaustive list. No bullet points. No numbered lists. No bold headers. Just talk like a person.

When you hit something genuinely good — a deep cut, a connection worth making, a record that matters — you open up. Say what's special about it. You're allowed opinions.

If you're not sure what someone means, ask. One direct question, not an apology.`;

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
      "Get an artist's catalog — albums, EPs, singles. When releases are thin (< 3), automatically also returns credits (productions, remixes, features). Always try this first for any artist catalog query.",
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
      "Get releases an artist is credited on as producer, writer, remixer, or performer — even when not listed as the primary artist. Essential for producers and DJs. Use alongside get_artist_releases, especially when that returns few results.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID" },
        limit: { type: "number", description: "Number of credits to return (1–20, default 15)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_label_releases",
    description:
      "Get releases that came out on a specific label — useful for 'what's on Warp Records' or 'show me the Tresor catalog'. Returns titles, artists, years.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs label ID" },
        limit: { type: "number", description: "Number of releases (1–20, default 15)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_connections",
    description:
      "Get an artist's connections from the relationship graph — band memberships, collaborations, teacher/student relationships, family. Use to answer 'who was in X band', 'what other projects did X have', 'who did X work with'.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_context",
    description:
      "Get biographical context, location history, or timeline notes for an artist from the enrichment layer (sourced from Wikidata). Use when you want background on who an artist is, where they're from, or their history.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID" },
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

export interface EvidenceItem {
  type: "artist" | "label" | "master" | "release";
  discogs_id: number;
  title: string;
  dig_url: string;
}

export type ResponseMode = "grounded_success" | "grounded_empty" | "timeout_degraded" | "upstream_error";

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
  evidenceCollector: EvidenceItem[],
  errorRef: { count: number },
  allowedMasterIds: Set<number>,
): Promise<unknown> {
  try {
    if (name === "search_catalog") {
      const q = String(input.q ?? "").slice(0, 200);
      const type = input.type as any;
      const genre = input.genre ? String(input.genre) : undefined;
      const limit = Math.min(Math.max(Number(input.limit ?? 8), 1), 10);
      const sr = await search(db, { q, type, genre, limit, quality: "all" });
      for (const r of sr.results.slice(0, 3)) {
        const entityType = r.type === "master" ? "master" : r.type === "artist" ? "artist" : r.type === "label" ? "label" : "release";
        const path = r.type === "master" ? "release" : r.type === "artist" ? "artist" : r.type === "label" ? "label" : "version";
        evidenceCollector.push({ type: entityType as any, discogs_id: r.discogs_id, title: r.name ?? r.title ?? "", dig_url: `https://app.dig.baby/${path}/${r.discogs_id}` });
        if (r.type === "master") allowedMasterIds.add(r.discogs_id);
      }
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
      if (!d) { errorRef.count++; return { error: "Artist not found" }; }
      evidenceCollector.push({ type: "artist", discogs_id: d.discogs_id, title: d.name, dig_url: `https://app.dig.baby/artist/${d.discogs_id}` });
      return {
        discogs_id: d.discogs_id,
        name: d.name,
        real_name: d.real_name ?? null,
        genres: d.genres ?? [],
        styles: d.styles ?? [],
        members: d.members?.map((m: any) => m.name) ?? [],
        aliases: d.aliases?.map((a: any) => a.name) ?? [],
        profile: d.profile ? String(d.profile).slice(0, 600) : null,
        dig_url: `https://app.dig.baby/artist/${d.discogs_id}`,
      };
    }

    if (name === "get_label") {
      const id = Number(input.discogs_id);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.labels");
      const d = await getLabel(db, id, batchId, dumpDate) as any;
      if (!d) { errorRef.count++; return { error: "Label not found" }; }
      evidenceCollector.push({ type: "label", discogs_id: d.discogs_id, title: d.name, dig_url: `https://app.dig.baby/label/${d.discogs_id}` });
      return {
        discogs_id: d.discogs_id,
        name: d.name,
        parent_label: d.parent_label?.name ?? null,
        sublabels: d.sublabels?.map((s: any) => s.name).slice(0, 10) ?? [],
        profile: d.profile ? String(d.profile).slice(0, 600) : null,
        dig_url: `https://app.dig.baby/label/${d.discogs_id}`,
      };
    }

    if (name === "get_master") {
      const id = Number(input.discogs_id);
      // Server-side guard: reject if this ID was never established as a master ID
      if (!allowedMasterIds.has(id)) {
        return { error: "Invalid master ID — this appears to be a release/version ID, not a master ID. Use master_discogs_id from label releases, or search for the track first to get its master ID." };
      }
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.masters");
      const d = await getMaster(db, id, batchId, dumpDate) as any;
      if (!d) { errorRef.count++; return { error: "Release not found" }; }

      evidenceCollector.push({ type: "master", discogs_id: d.discogs_id, title: d.title, dig_url: `https://app.dig.baby/release/${d.discogs_id}` });

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
        dig_url: `https://app.dig.baby/release/${d.discogs_id}`,
      };
    }

    if (name === "get_artist_releases") {
      const id = Number(input.discogs_id);
      const releaseType = (input.release_type as any) ?? "all";
      const limit = Math.min(Math.max(Number(input.limit ?? 12), 1), 20);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.master_artists");
      const result = await getArtistCatalogReleases(db, id, batchId, dumpDate, limit, undefined, "newest", releaseType);
      const releases = result.links.map((l: any) => ({
        discogs_id: l.discogs_id,
        title: l.title,
        year: l.year ?? null,
        type: l.release_type_label ?? l.release_type ?? null,
        dig_url: l.type === "master"
          ? `https://app.dig.baby/release/${l.discogs_id}`
          : `https://app.dig.baby/version/${l.discogs_id}`,
      }));
      for (const r of releases.slice(0, 5)) {
        evidenceCollector.push({ type: r.dig_url.includes("/release/") ? "master" : "release", discogs_id: r.discogs_id, title: r.title, dig_url: r.dig_url });
        if (r.dig_url.includes("/release/")) allowedMasterIds.add(r.discogs_id);
      }

      // Auto-fetch credits when releases are thin — many artists are catalogued via credits only
      let credits: any[] = [];
      if (releases.length < 3) {
        try {
          const { batchId: creditsBatchId, dumpDate: creditsDumpDate } = await getBatchForTable(db, "catalog.release_credits");
          const creditResult = await getArtistCredits(db, id, creditsBatchId, creditsDumpDate, limit) as any;
          credits = (creditResult.links ?? []).map((l: any) => ({
            discogs_id: l.release_discogs_id ?? l.discogs_id,
            title: l.title,
            year: l.year ?? null,
            roles: l.roles ?? [],
            dig_url: `https://app.dig.baby/version/${l.release_discogs_id ?? l.discogs_id}`,
          }));
          for (const c of credits.slice(0, 5)) {
            evidenceCollector.push({ type: "release", discogs_id: c.discogs_id, title: c.title, dig_url: c.dig_url });
          }
        } catch { /* fail open */ }
      }

      return {
        releases,
        credits: credits ?? [],
        total: result.pagination.total_estimate ?? result.links.length,
        has_more: result.pagination.has_more,
        note: releases.length === 0 && credits.length === 0
          ? "No releases or credits found. Try searching by label name instead."
          : releases.length < 3 && credits.length > 0
          ? "Few direct releases — catalog mainly found via credits below."
          : undefined,
      };
    }

    if (name === "get_artist_credits") {
      const id = Number(input.discogs_id);
      const limit = Math.min(Math.max(Number(input.limit ?? 15), 1), 20);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.release_credits");
      const result = await getArtistCredits(db, id, batchId, dumpDate, limit) as any;
      const credits = (result.links ?? []).map((l: any) => ({
        discogs_id: l.release_discogs_id ?? l.discogs_id,
        title: l.title,
        year: l.year ?? null,
        roles: l.roles ?? [],
        role_family: l.role_family ?? null,
        dig_url: `https://app.dig.baby/version/${l.release_discogs_id ?? l.discogs_id}`,
      }));
      for (const c of credits.slice(0, 5)) {
        evidenceCollector.push({ type: "release", discogs_id: c.discogs_id, title: c.title, dig_url: c.dig_url });
      }
      return {
        credits,
        total: result.pagination?.total_estimate ?? (result.links?.length ?? 0),
      };
    }

    if (name === "get_label_releases") {
      const id = Number(input.discogs_id);
      const limit = Math.min(Math.max(Number(input.limit ?? 15), 1), 20);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.labels");
      const result = await getLabelReleases(db, id, batchId, dumpDate, limit) as any;
      const labelReleases = (result.links ?? []).map((l: any) => ({
        discogs_id: l.discogs_id,
        master_discogs_id: l.master_discogs_id ?? null,
        title: l.title,
        year: l.year ?? null,
        artist: l.artist ?? null,
        dig_url: l.master_discogs_id
          ? `https://app.dig.baby/release/${l.master_discogs_id}`
          : `https://app.dig.baby/version/${l.discogs_id}`,
      }));
      for (const r of labelReleases.slice(0, 3)) {
        evidenceCollector.push({ type: "release", discogs_id: r.discogs_id, title: r.title, dig_url: r.dig_url });
        if (r.master_discogs_id != null) allowedMasterIds.add(r.master_discogs_id);
      }
      return {
        releases: labelReleases,
        total: result.pagination?.total_estimate ?? (result.links?.length ?? 0),
        has_more: result.pagination?.has_more ?? false,
      };
    }

    if (name === "get_connections") {
      const id = Number(input.discogs_id);
      const rows = await sql<any>`
        SELECT re.edge_type, re.target_entity_type, re.target_discogs_id,
               a.name as target_name, re.valid_from, re.valid_to
        FROM enrich.relationship_edges re
        LEFT JOIN catalog.artists a
          ON a.discogs_id = re.target_discogs_id
         AND re.target_entity_type = 'artist'
        WHERE re.source_discogs_id = ${id}
          AND re.source_entity_type = 'artist'
        LIMIT 20
      `.execute(db);

      return {
        connections: rows.rows.map((r: any) => ({
          type: r.edge_type,
          entity_type: r.target_entity_type,
          discogs_id: r.target_discogs_id,
          name: r.target_name ?? null,
          from: r.valid_from ?? null,
          to: r.valid_to ?? null,
        })),
        total: rows.rows.length,
      };
    }

    if (name === "get_context") {
      const id = Number(input.discogs_id);
      const rows = await sql<any>`
        SELECT context_type, content_json, source
        FROM enrich.entity_context
        WHERE entity_type = 'artist' AND discogs_id = ${id}
        ORDER BY context_type
        LIMIT 6
      `.execute(db);

      if (rows.rows.length === 0) return { context: null };

      return {
        context: rows.rows.map((r: any) => {
          const content = r.content_json;
          const text = typeof content === "string"
            ? content
            : content?.text ?? content?.value ?? JSON.stringify(content);
          return { type: r.context_type, text: String(text).slice(0, 500) };
        }),
      };
    }

    errorRef.count++;
    return { error: `Unknown tool: ${name}` };
  } catch (err: any) {
    errorRef.count++;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_CALL_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
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
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

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
}): Promise<{ answer: string; model: string; tool_calls: number; media: MediaItem[]; evidence: EvidenceItem[]; mode: ResponseMode }> {
  const messages: AnthropicMessage[] = [
    ...params.history,
    { role: "user", content: params.question },
  ];

  let usedModel = params.model;
  let toolCallCount = 0;
  const mediaCollector: MediaItem[] = [];
  const evidenceCollector: EvidenceItem[] = [];
  const errorRef = { count: 0 };
  const allowedMasterIds = new Set<number>();
  const deadline = Date.now() + LOOP_DEADLINE_MS;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (Date.now() > deadline) {
      const mode: ResponseMode = evidenceCollector.length > 0 ? "timeout_degraded" : "grounded_empty";
      return { answer: "Taking too long — try a more specific question.", model: usedModel, tool_calls: toolCallCount, media: mediaCollector, evidence: evidenceCollector, mode };
    }
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
      const mode: ResponseMode = evidenceCollector.length > 0 ? "grounded_success" : errorRef.count > 0 ? "timeout_degraded" : "grounded_empty";
      return { answer, model: usedModel, tool_calls: toolCallCount, media: mediaCollector, evidence: evidenceCollector, mode };
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
            evidenceCollector,
            errorRef,
            allowedMasterIds,
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
    const mode: ResponseMode = evidenceCollector.length > 0 ? "grounded_success" : "timeout_degraded";
    return {
      answer: String(textBlock?.text ?? "Something went wrong.").trim(),
      model: usedModel,
      tool_calls: toolCallCount,
      media: mediaCollector,
      evidence: evidenceCollector,
      mode,
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
  const mode: ResponseMode = evidenceCollector.length > 0 ? "grounded_success" : "timeout_degraded";
  return {
    answer: String(textBlock?.text ?? "").trim() || "I hit a complexity limit — try a more specific question.",
    model: usedModel,
    tool_calls: toolCallCount,
    media: mediaCollector,
    evidence: evidenceCollector,
    mode,
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
      const { answer, model: usedModel, tool_calls, media, evidence, mode } = await runAgenticLoop({
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

      // Deduplicate evidence by dig_url
      const seenEvidence = new Set<string>();
      const dedupedEvidence = evidence.filter((e) => {
        if (seenEvidence.has(e.dig_url)) return false;
        seenEvidence.add(e.dig_url);
        return true;
      });

      // Media binding validator: only keep media whose source master is in evidence
      const evidenceMasterIds = new Set(
        dedupedEvidence.filter((e) => e.type === "master").map((e) => e.discogs_id)
      );
      const boundMedia = dedupedMedia.filter((m) => evidenceMasterIds.has(m.discogs_id));

      return reply.send({
        answer,
        media: boundMedia,
        mode,
        evidence: dedupedEvidence.slice(0, 20),
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
        mode: "upstream_error" as ResponseMode,
      });
    }
  });
}
