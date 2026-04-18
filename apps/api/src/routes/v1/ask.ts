import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import {
  search,
  getArtist,
  getLabel,
  getMaster,
  getArtistMasters,
  getLabelReleases,
  getBatchForTable,
  listScenes,
  getScene,
  getLabelCoreRun,
  getLabelRelated,
} from "@dig/domain";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = process.env.LLM_MODEL ?? "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 3;
const MAX_HISTORY_TURNS = 6;
const ANTHROPIC_CALL_TIMEOUT_MS = 30_000;
const TOOL_EXEC_TIMEOUT_MS = 15_000;
const LOOP_DEADLINE_MS = 60_000;

const PRIVATE_KEYS = new Set(
  (process.env.LLM_BETA_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// ---------------------------------------------------------------------------
// Personality — Dig v2: scene-scoped catalog (1988–2003 house & techno)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the librarian for Dig — a curated catalog of house and techno from 1988 to 2003. The scope is Detroit techno, Chicago house, NYC garage, UK rave / hardcore / jungle, Berlin techno, dub techno, IDM, Italo, electro, ambient techno, and microhouse. The catalog is ~80,000 master releases plus 15 hand-curated scenes, label "core runs" (essential listening per label), and directional related-label edges (deeper, harder, rawer, cleaner, weirder, poppier, earlier, later).

Your job is to help people find what's in this collection. You are not a music encyclopedia — you are a guide to a specific, opinionated catalog.

GROUNDING — these are hard rules, not preferences:

1. Every concrete claim about an artist, label, release, year, scene, or relationship MUST come from a tool result you obtained THIS turn. Do not answer from memory. If you didn't call a tool, you don't know.
2. Every artist, label, master, or scene you name in your answer must have been returned by a tool call in this turn. Never invent IDs, titles, or years.
3. If a tool returns nothing, say so. "Not in our catalog" or "outside the 1988–2003 window" is the correct answer — don't pad with general knowledge to fill the gap.
4. The catalog is scoped. Rock, jazz, hip-hop, classical, contemporary EDM, post-2003 electronic music — out of scope. Tell the user honestly. Genres adjacent to house/techno (IDM, electro, ambient techno, UK rave/jungle, Italo) are in scope; check before assuming.
5. You access a DATABASE through tools. Never say "I can't access URLs" or "I don't have internet" — you have tools, use them.

WHEN TO USE WHICH TOOL:

- Specific artist/label/release named by the user → search_catalog first to resolve the ID, then get_artist / get_label / get_master.
- "Recommend music by X" or "what's their discography" → get_artist_masters. Always. The video rail depends on this.
- "What's good on label Y" → get_label_essentials FIRST (curated core run + directional related labels). Fall back to get_label_releases only if essentials returns empty.
- "Tell me about Detroit / Berlin / Chicago / dub techno / IDM scene" → list_scenes to find the slug, then get_scene for member labels and bridges.
- "Walk me from X to Y" or "what's similar to label Z" → get_label_essentials on Z and use the directional related edges (deeper, harder, etc.) to chart a path.

LINKS — THIS IS HOW VIDEOS BIND:

Every entity you mention in your answer MUST be a markdown link to its Dig page:
- Master: [Title](https://app.dig.baby/master/ID)
- Artist: [Name](https://app.dig.baby/artist/ID)
- Label: [Label](https://app.dig.baby/label/ID)
- Scene: [Scene name](https://app.dig.baby/scene/SLUG)

Videos auto-render below your answer ONLY for masters whose URL appears in your text. If you mention 4 masters but only link 2, only those 2 videos appear. So link every master you actually want surfaced — and don't link masters you're only naming in passing. No video should ever appear that isn't tied to a record you specifically wrote about.

Never link to Discogs, Bandcamp, YouTube, NTS, Spotify, or anything outside dig.baby unless the user explicitly asks.

VOICE:

Terse. Two or three things worth saying — not a checklist. No bullet points, no numbered lists, no bold headers. Talk like a person who knows the records.

When you find something genuinely good — a deep cut, a connection worth making, a record that matters — open up. Say what's special about it. Opinions are allowed and welcome.

If the question is ambiguous, ask one direct question. Not three. Not an apology.

If a tool errored or the catalog has nothing useful, say it plainly. Don't paper over it.`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "search_catalog",
    description:
      "Search the Dig scene-scoped catalog (~80k 90s house/techno masters, plus their artists and labels). Use to find artists, labels, or masters by name, genre, style, or keywords. Returns matching entities with IDs you can use in follow-up calls.",
    input_schema: {
      type: "object" as const,
      properties: {
        q: { type: "string", description: "Search query — artist name, master title, label, genre term, etc." },
        type: {
          type: "string",
          enum: ["artist", "label", "master"],
          description: "Filter to a specific entity type. Omit to search masters (the default).",
        },
        genre: { type: "string", description: "Filter by genre (e.g. 'House', 'Techno', 'Electronic')" },
        limit: { type: "number", description: "Results to return (1–10, default 8)" },
      },
      required: ["q"],
    },
  },
  {
    name: "get_artist",
    description:
      "Get full details for an artist by Discogs ID: name, aliases, genres, styles, biography. Use after search_catalog returns an artist ID.",
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
      "Get full details for a record label by Discogs ID: parent label, sublabels, profile, editorial tier (tier1 means a canonical scene label like Tresor or Warp).",
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
      "Get full details for a master release by Discogs ID: tracklist, primary artist, primary label, year, genres, styles, scene_weight (curation score), and YouTube videos. The master is the canonical recording.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs master ID (from search results)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_artist_masters",
    description:
      "Get an artist's catalog of masters in the scene — albums, EPs, singles. Always try this first for any artist catalog query. Returns titles, years, and Dig URLs you should link.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID" },
        release_type: {
          type: "string",
          enum: ["album", "single_ep", "compilation", "all"],
          description: "Filter by type. Use 'album' for main studio releases, 'all' for everything. Default: 'all'.",
        },
        limit: { type: "number", description: "Number of masters to return (1–20, default 12)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_label_releases",
    description:
      "Get masters released on a specific label — useful for 'what's on Warp Records' or 'show me the Tresor catalog'. Returns titles, primary artists, years. Prefer get_label_essentials first; fall back here if essentials are empty or you need the wider catalog.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs label ID" },
        limit: { type: "number", description: "Number of masters (1–20, default 15)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_label_essentials",
    description:
      "The most opinionated 'what's good here and what's nearby' tool. Returns a label's curated Core Run (essential masters everyone should hear, ranked) plus its directional related labels (deeper / harder / rawer / cleaner / weirder / poppier / earlier / later). Use this BEFORE get_label_releases for any 'what should I listen to from label X' question.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs label ID (from search_catalog)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "list_scenes",
    description:
      "List all 15 curated scenes (Detroit Core, Berlin Techno, Chicago House, Dub Techno, Cologne Minimal, etc.). Returns slug, name, axis (geography/sound/era/cluster/bridge/micro), city, era window, and blurb. Use this to find a scene slug before calling get_scene.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_scene",
    description:
      "Get full detail for one curated scene by slug: member labels (with role: core/adjacent/bridge), bridges to other scenes, palette, blurb. Use after list_scenes to drill into a specific scene.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug: {
          type: "string",
          description: "Scene slug (e.g. 'detroit-core', 'berlin-techno', 'dub-techno', 'chicago-house')",
        },
      },
      required: ["slug"],
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
  type: "artist" | "label" | "master";
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
        const entityType = r.type === "master" ? "master" : r.type === "artist" ? "artist" : "label";
        const path = r.type === "master" ? "master" : r.type === "artist" ? "artist" : "label";
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
        tier: d.tier ?? null,
        profile: d.profile ? String(d.profile).slice(0, 600) : null,
        dig_url: `https://app.dig.baby/label/${d.discogs_id}`,
      };
    }

    if (name === "get_master") {
      const id = Number(input.discogs_id);
      // Server-side guard: reject if this ID was never established as a master ID
      if (!allowedMasterIds.has(id)) {
        return { error: "Invalid master ID — this ID was not established as a master in this conversation. Search first, then use the resulting master IDs." };
      }
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.masters");
      const d = await getMaster(db, id, batchId, dumpDate) as any;
      if (!d) { errorRef.count++; return { error: "Master not found" }; }

      evidenceCollector.push({ type: "master", discogs_id: d.discogs_id, title: d.title, dig_url: `https://app.dig.baby/master/${d.discogs_id}` });

      // Collect YouTube videos
      const artistName = d.primary_artist?.name ?? d.artists?.[0]?.name ?? "Unknown";
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
        primary_artist: d.primary_artist?.name ?? null,
        primary_label: d.primary_label?.name ?? null,
        artists: d.artists?.map((a: any) => a.name) ?? [],
        genres: d.genres ?? [],
        styles: d.styles ?? [],
        scene_weight: d.scene_weight ?? null,
        tracklist: d.tracklist?.slice(0, 20).map((t: any) => ({
          position: t.position,
          title: t.title,
          duration: t.duration ?? null,
        })) ?? [],
        notes: d.notes ? String(d.notes).slice(0, 300) : null,
        has_video: mediaCollector.some((m) => m.discogs_id === d.discogs_id),
        dig_url: `https://app.dig.baby/master/${d.discogs_id}`,
      };
    }

    if (name === "get_artist_masters") {
      const id = Number(input.discogs_id);
      const releaseType = (input.release_type as any) ?? "all";
      const limit = Math.min(Math.max(Number(input.limit ?? 12), 1), 20);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.master_artists");
      const result = await getArtistMasters(db, id, batchId, dumpDate, limit, undefined, "newest", releaseType);
      const masters = result.links.map((l: any) => ({
        discogs_id: l.discogs_id,
        title: l.title,
        year: l.year ?? null,
        type: l.release_type_label ?? l.release_type ?? null,
        dig_url: `https://app.dig.baby/master/${l.discogs_id}`,
      }));
      for (const m of masters.slice(0, 5)) {
        evidenceCollector.push({ type: "master", discogs_id: m.discogs_id, title: m.title, dig_url: m.dig_url });
        allowedMasterIds.add(m.discogs_id);
      }

      // Auto-collect videos from top masters so videos appear without requiring an explicit get_master call
      const top = masters.slice(0, 3);
      await Promise.all(top.map(async (m) => {
        try {
          const { batchId: mb, dumpDate: md } = await getBatchForTable(db, "catalog.masters");
          const detail = await getMaster(db, m.discogs_id, mb, md) as any;
          if (!detail) return;
          const artistName = detail.primary_artist?.name ?? detail.artists?.[0]?.name ?? m.title;
          for (const v of (detail.videos ?? []).slice(0, 2)) {
            if (v?.url && extractYouTubeId(v.url)) {
              mediaCollector.push({ discogs_id: m.discogs_id, title: v.title ?? m.title, artist: artistName, youtube_url: v.url });
            }
          }
        } catch { /* fail open */ }
      }));

      return {
        masters,
        total: result.pagination.total_estimate ?? result.links.length,
        has_more: result.pagination.has_more,
        note: masters.length === 0
          ? "No masters found in scope. Try searching by label name, or check if this artist falls outside the 90s house/techno scene."
          : undefined,
      };
    }

    if (name === "get_label_releases") {
      const id = Number(input.discogs_id);
      const limit = Math.min(Math.max(Number(input.limit ?? 15), 1), 20);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.labels");
      const result = await getLabelReleases(db, id, batchId, dumpDate, limit) as any;
      const labelMasters = (result.links ?? []).map((l: any) => ({
        discogs_id: l.discogs_id,
        title: l.title,
        year: l.year ?? null,
        artist: l.artist ?? null,
        dig_url: `https://app.dig.baby/master/${l.discogs_id}`,
      }));
      for (const r of labelMasters.slice(0, 3)) {
        evidenceCollector.push({ type: "master", discogs_id: r.discogs_id, title: r.title, dig_url: r.dig_url });
        allowedMasterIds.add(r.discogs_id);
      }
      return {
        masters: labelMasters,
        total: result.pagination?.total_estimate ?? (result.links?.length ?? 0),
        has_more: result.pagination?.has_more ?? false,
      };
    }

    if (name === "get_label_essentials") {
      const id = Number(input.discogs_id);
      const [coreRun, related] = await Promise.all([
        getLabelCoreRun(db, id, 10),
        getLabelRelated(db, id),
      ]);

      // Establish all core_run masters as cite-able and pre-fetch videos so
      // they're available if the model decides to mention them.
      for (const m of coreRun) {
        allowedMasterIds.add(m.master_discogs_id);
        evidenceCollector.push({
          type: "master",
          discogs_id: m.master_discogs_id,
          title: m.title,
          dig_url: `https://app.dig.baby/master/${m.master_discogs_id}`,
        });
      }
      const top = coreRun.slice(0, 5);
      await Promise.all(top.map(async (m) => {
        try {
          const { batchId: mb, dumpDate: md } = await getBatchForTable(db, "catalog.masters");
          const detail = await getMaster(db, m.master_discogs_id, mb, md) as any;
          if (!detail) return;
          const artistName = detail.primary_artist?.name ?? m.primary_artist_name ?? m.title;
          for (const v of (detail.videos ?? []).slice(0, 2)) {
            if (v?.url && extractYouTubeId(v.url)) {
              mediaCollector.push({
                discogs_id: m.master_discogs_id,
                title: v.title ?? m.title,
                artist: artistName,
                youtube_url: v.url,
              });
            }
          }
        } catch { /* fail open */ }
      }));

      return {
        label_id: id,
        core_run: coreRun.map((m) => ({
          master_discogs_id: m.master_discogs_id,
          title: m.title,
          year: m.year,
          primary_artist: m.primary_artist_name,
          source: m.source,
          note: m.note,
          dig_url: `https://app.dig.baby/master/${m.master_discogs_id}`,
        })),
        related: related.map((r) => ({
          to_label_id: r.to_label_id,
          to_label_name: r.to_label_name,
          direction: r.direction,
          blurb: r.blurb,
          master_count: r.to_label_master_count,
          dig_url: `https://app.dig.baby/label/${r.to_label_id}`,
        })),
        note: coreRun.length === 0
          ? "No curated core run for this label yet — fall back to get_label_releases."
          : undefined,
      };
    }

    if (name === "list_scenes") {
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const scenes = await listScenes(db, batchId);
      return {
        scenes: scenes.map((s) => ({
          slug: s.slug,
          name: s.name,
          axis: s.axis,
          city: s.city,
          era:
            s.era_start && s.era_end
              ? `${s.era_start}-${s.era_end}`
              : s.era_start
              ? `${s.era_start}-`
              : null,
          blurb: s.blurb,
          label_count: s.label_count,
          dig_url: `https://app.dig.baby/scene/${s.slug}`,
        })),
        total: scenes.length,
      };
    }

    if (name === "get_scene") {
      const slug = String(input.slug ?? "").trim().slice(0, 80);
      if (!slug) { errorRef.count++; return { error: "Scene slug required" }; }
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const scene = await getScene(db, slug, batchId);
      if (!scene) { errorRef.count++; return { error: `Scene not found: ${slug}` }; }

      // Register member labels as cite-able evidence so the model's links validate.
      for (const l of scene.labels.slice(0, 12)) {
        evidenceCollector.push({
          type: "label",
          discogs_id: l.discogs_id,
          title: l.name,
          dig_url: `https://app.dig.baby/label/${l.discogs_id}`,
        });
      }

      return {
        slug: scene.slug,
        name: scene.name,
        axis: scene.axis,
        city: scene.city,
        era:
          scene.era_start && scene.era_end
            ? `${scene.era_start}-${scene.era_end}`
            : scene.era_start
            ? `${scene.era_start}-`
            : null,
        blurb: scene.blurb,
        labels: scene.labels.map((l) => ({
          discogs_id: l.discogs_id,
          name: l.name,
          role: l.role,
          master_count: l.master_count,
          dig_url: `https://app.dig.baby/label/${l.discogs_id}`,
        })),
        bridges_out: scene.bridges_out.map((b) => ({
          to_slug: b.to_slug,
          via_kind: b.via_kind,
          via: b.via_name,
          blurb: b.blurb,
        })),
        bridges_in: scene.bridges_in.map((b) => ({
          from_slug: b.from_slug,
          via_kind: b.via_kind,
          via: b.via_name,
          blurb: b.blurb,
        })),
        dig_url: `https://app.dig.baby/scene/${scene.slug}`,
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
  log: (msg: string, extra?: Record<string, unknown>) => void;
}): Promise<{ answer: string; model: string; tool_calls: number; media: MediaItem[]; evidence: EvidenceItem[]; mode: ResponseMode }> {
  const { log } = params;
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

  log("ask:loop_start", { model: params.model, history_turns: params.history.length, question_len: params.question.length });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (Date.now() > deadline) {
      log("ask:deadline_exceeded", { round, tool_calls: toolCallCount });
      const mode: ResponseMode = evidenceCollector.length > 0 ? "timeout_degraded" : "grounded_empty";
      return { answer: "Taking too long — try a more specific question.", model: usedModel, tool_calls: toolCallCount, media: mediaCollector, evidence: evidenceCollector, mode };
    }

    const callStart = Date.now();
    log("ask:anthropic_call", { round, messages_in_context: messages.length });

    let response: Awaited<ReturnType<typeof callAnthropic>>;
    try {
      response = await callAnthropic({
        model: params.model,
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOLS,
        maxTokens: params.maxTokens,
        anthropicApiKey: params.anthropicApiKey,
      });
    } catch (err: any) {
      log("ask:anthropic_error", { round, elapsed_ms: Date.now() - callStart, error: String(err?.message ?? err) });
      throw err;
    }

    const callMs = Date.now() - callStart;
    log("ask:anthropic_response", { round, elapsed_ms: callMs, stop_reason: response.stop_reason, model: response.model });

    usedModel = response.model ?? params.model;

    if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
      const textBlock = response.content.find((b) => b.type === "text");
      const answer = String(textBlock?.text ?? "").trim() || "I couldn't find anything relevant — try searching directly on Dig.";
      const mode: ResponseMode = evidenceCollector.length > 0 ? "grounded_success" : errorRef.count > 0 ? "timeout_degraded" : "grounded_empty";
      log("ask:loop_end", { rounds: round + 1, tool_calls: toolCallCount, mode, answer_len: answer.length });
      return { answer, model: usedModel, tool_calls: toolCallCount, media: mediaCollector, evidence: evidenceCollector, mode };
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      toolCallCount += toolUseBlocks.length;
      const toolNames = toolUseBlocks.map((b) => String(b.name ?? "unknown"));
      log("ask:tool_calls", { round, tools: toolNames });

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const toolStart = Date.now();
          const toolName = String(block.name ?? "");
          const toolTimeout = new Promise<{ error: string }>((resolve) =>
            setTimeout(() => resolve({ error: `Tool ${toolName} timed out after ${TOOL_EXEC_TIMEOUT_MS}ms` }), TOOL_EXEC_TIMEOUT_MS)
          );
          const result = await Promise.race([
            executeTool(params.db, toolName, (block.input as Record<string, unknown>) ?? {}, mediaCollector, evidenceCollector, errorRef, allowedMasterIds),
            toolTimeout,
          ]);
          log("ask:tool_result", { tool: toolName, elapsed_ms: Date.now() - toolStart, timed_out: (result as any)?.error?.includes("timed out") ?? false });
          return {
            type: "tool_result" as const,
            tool_use_id: String(block.id ?? ""),
            content: JSON.stringify(result),
          };
        }),
      );

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    const mode: ResponseMode = evidenceCollector.length > 0 ? "grounded_success" : "timeout_degraded";
    log("ask:loop_end_unexpected", { round, stop_reason: response.stop_reason, mode });
    return {
      answer: String(textBlock?.text ?? "Something went wrong.").trim(),
      model: usedModel,
      tool_calls: toolCallCount,
      media: mediaCollector,
      evidence: evidenceCollector,
      mode,
    };
  }

  log("ask:max_rounds_exceeded", { tool_calls: toolCallCount });

  const finalMessages: AnthropicMessage[] = [
    ...messages,
    {
      role: "user",
      content: "Based on what you've found so far, please give your final answer.",
    },
  ];
  const finalCallStart = Date.now();
  const finalResp = await callAnthropic({
    model: params.model,
    system: SYSTEM_PROMPT,
    messages: finalMessages,
    tools: [],
    maxTokens: params.maxTokens,
    anthropicApiKey: params.anthropicApiKey,
  });
  log("ask:final_call", { elapsed_ms: Date.now() - finalCallStart, stop_reason: finalResp.stop_reason });
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
  app.post("/v1/ask", {
    config: {
      // Ask is expensive (LLM + DB). 10 req/min per IP regardless of key.
      // Private-key holders are trusted but still bounded to prevent runaway loops.
      rateLimit: { max: 10, timeWindow: "1 minute" },
    },
  }, async (req: FastifyRequest<{ Body: AskBody }>, reply) => {
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

    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history: AnthropicMessage[] = rawHistory
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }));

    const maxTokens = Math.min(Math.max(Number(body.max_tokens ?? 1200), 256), 2000);
    const model = String(body.model ?? DEFAULT_MODEL);
    const started = Date.now();
    const log = (msg: string, extra?: Record<string, unknown>) =>
      req.log.info({ event: msg, ...extra });

    try {
      const { answer, model: usedModel, tool_calls, media, evidence, mode } = await runAgenticLoop({
        db,
        question,
        history,
        model,
        maxTokens,
        anthropicApiKey,
        log,
      });

      const seenUrls = new Set<string>();
      const dedupedMedia = media.filter((m) => {
        if (seenUrls.has(m.youtube_url)) return false;
        seenUrls.add(m.youtube_url);
        return true;
      });

      const seenEvidence = new Set<string>();
      const dedupedEvidence = evidence.filter((e) => {
        if (seenEvidence.has(e.dig_url)) return false;
        seenEvidence.add(e.dig_url);
        return true;
      });

      // Citation-bound media: only return videos for masters whose dig.baby URL
      // appears in the assistant's answer text. The system prompt tells the
      // model to link every entity it mentions; this binding ensures the rail
      // only ever surfaces videos for records the model actually wrote about.
      // Strict empty is the right behaviour when the model didn't cite anything
      // — better than dumping generic videos for masters it merely fetched.
      const citedMasterIds = new Set<number>();
      const masterUrlRe = /app\.dig\.baby\/master\/(\d+)/g;
      let match: RegExpExecArray | null;
      while ((match = masterUrlRe.exec(answer)) !== null) {
        const id = Number(match[1]);
        if (Number.isFinite(id)) citedMasterIds.add(id);
      }
      const boundMedia = dedupedMedia.filter((m) => citedMasterIds.has(m.discogs_id));

      log("ask:media_bind", {
        media_total: dedupedMedia.length,
        media_cited: boundMedia.length,
        masters_cited: citedMasterIds.size,
      });

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
      log("ask:request_failed", { elapsed_ms: Date.now() - started, error: String(err?.message ?? err), status: err?.status });
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
