/**
 * @dig/mcp — MCP server for the Dig scene-scoped music catalog.
 *
 * Transport: SSE (HTTP, remote) via express + @modelcontextprotocol/sdk
 *
 * Catalog scope: ~80k 90s house & techno masters (with adjacent electro / IDM /
 * ambient techno / UK rave / Italo proto). Master is the canonical entity.
 * Per-release detail and per-release credits are NOT served — the slim DB
 * stores only a release_shadow (master_discogs_id + identifying metadata) so
 * callers can resolve a release ID to its master.
 *
 * All tools delegate to @dig/domain retrieval services.
 * Error taxonomy: INVALID_REQUEST, NOT_FOUND, GONE, QUERY_TIMEOUT, INTERNAL_ERROR.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createDb } from "@dig/db";
import {
  search,
  validateSearchParams,
  getArtist,
  getLabel,
  getMaster,
  getReleaseShadow,
  getArtistMasters,
  getLabelReleases,
  getMasterReleases,
  getMasterVideos,
  getBatchForTable,
  listScenes,
  getScene,
  getLabelCoreRun,
  getLabelRelated,
  getArtistRuleACredits,
  getArtistCrossScopeCredits,
  getMasterCredits,
  getArtistCollaborators,
  getArtistGroupsAndMembers,
  type SearchEntityType,
} from "@dig/domain";
import { toolError, toolResult } from "./contracts.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(DATABASE_URL);
const MCP_ANON_PER_MIN = Number(process.env.MCP_ANON_PER_MIN ?? 10);
const MCP_ANON_PER_DAY = Number(process.env.MCP_ANON_PER_DAY ?? 50);
const MCP_SPEND_PCT = Number(process.env.MCP_SPEND_PCT ?? 0);
const MCP_BETA_CAPACITY_MODE = process.env.MCP_BETA_CAPACITY_MODE === "on";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequestId(): string {
  return randomUUID();
}

const mcpStartedAt = Date.now();
let mcpCallsTotal = 0;
let mcpCallsError = 0;
const mcpCallsByTool = new Map<string, number>();

function logToolInvocation(
  requestId: string,
  tool: string,
  status: "ok" | "error",
  elapsedMs: number,
  errorCode: string | null,
) {
  mcpCallsTotal += 1;
  if (status === "error") mcpCallsError += 1;
  mcpCallsByTool.set(tool, (mcpCallsByTool.get(tool) ?? 0) + 1);

  console.log(
    JSON.stringify({
      kind: "mcp_tool_invocation",
      request_id: requestId,
      tool,
      status,
      elapsed_ms: elapsedMs,
      error_code: errorCode,
      timestamp: new Date().toISOString(),
    }),
  );
}

function getMcpUsageSnapshot() {
  const byTool: Record<string, number> = {};
  for (const [tool, count] of mcpCallsByTool.entries()) byTool[tool] = count;
  return {
    service: "dig-mcp",
    window: "since_process_start",
    started_at: new Date(mcpStartedAt).toISOString(),
    uptime_seconds: Math.floor((Date.now() - mcpStartedAt) / 1000),
    calls_total: mcpCallsTotal,
    errors_total: mcpCallsError,
    calls_by_tool: byTool,
  };
}

type RateCounter = {
  count: number;
  resetAt: number;
};

const ipMinuteCounters = new Map<string, RateCounter>();
const ipDayCounters = new Map<string, RateCounter>();

function applyRateWindow(counters: Map<string, RateCounter>, key: string, limit: number, now: number, windowMs: number) {
  const existing = counters.get(key);
  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowMs;
    const next = { count: 1, resetAt };
    counters.set(key, next);
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  counters.set(key, existing);
  return { allowed: true, remaining: Math.max(0, limit - existing.count), resetAt: existing.resetAt };
}

function setRateHeaders(
  res: express.Response,
  limit: number,
  remaining: number,
  resetAt: number,
  bucket: "ip" | "key",
) {
  const resetSeconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(resetSeconds));
  res.setHeader("X-RateLimit-Bucket", bucket);
}

function rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const dayWindowMs = 24 * 60 * 60 * 1000;

  let anonPerMin = MCP_ANON_PER_MIN;
  let anonPerDay = MCP_ANON_PER_DAY;
  let protectMode: "off" | "soft" | "hard" | "lock" = "off";

  // Spend-pressure protect mode.
  if (MCP_SPEND_PCT >= 100 || MCP_BETA_CAPACITY_MODE) {
    protectMode = "lock";
    anonPerMin = 0;
    anonPerDay = 0;
  } else if (MCP_SPEND_PCT >= 90) {
    protectMode = "hard";
    anonPerMin = Math.min(anonPerMin, 2);
    anonPerDay = Math.min(anonPerDay, 10);
  } else if (MCP_SPEND_PCT >= 80) {
    protectMode = "soft";
    anonPerMin = Math.min(anonPerMin, 5);
    anonPerDay = Math.min(anonPerDay, 20);
  }

  res.setHeader("X-Beta-Protect-Mode", protectMode);

  if (protectMode === "lock") {
    res.status(503).json({
      error: {
        code: "BETA_CAPACITY",
        message: "Dig MCP beta is at temporary capacity. Please try again soon or request an API key.",
        details: { upgrade_url: "https://dig.baby", phase: "beta" },
      },
    });
    return;
  }

  const ipMinute = applyRateWindow(ipMinuteCounters, ip, anonPerMin, now, 60_000);
  if (!ipMinute.allowed) {
    setRateHeaders(res, anonPerMin, 0, ipMinute.resetAt, "ip");
    res.setHeader("Retry-After", String(Math.max(0, Math.ceil((ipMinute.resetAt - now) / 1000))));
    res.status(429).json({
      error: { code: "RATE_LIMITED", message: "Per-minute anonymous limit reached", details: { bucket: "ip_minute" } },
    });
    return;
  }

  const ipDay = applyRateWindow(ipDayCounters, ip, anonPerDay, now, dayWindowMs);
  if (!ipDay.allowed) {
    res.setHeader("X-RateLimit-Day-Limit", String(anonPerDay));
    res.setHeader("X-RateLimit-Day-Remaining", "0");
    res.setHeader("X-RateLimit-Day-Reset", String(Math.max(0, Math.ceil((ipDay.resetAt - now) / 1000))));
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Daily anonymous beta quota reached. Please try later or request an API key.",
        details: { bucket: "ip_day", upgrade_url: "https://dig.baby" },
      },
    });
    return;
  }

  setRateHeaders(res, anonPerMin, ipMinute.remaining, ipMinute.resetAt, "ip");
  res.setHeader("X-RateLimit-Day-Limit", String(anonPerDay));
  res.setHeader("X-RateLimit-Day-Remaining", String(ipDay.remaining));
  res.setHeader("X-RateLimit-Day-Reset", String(Math.max(0, Math.ceil((ipDay.resetAt - now) / 1000))));

  next();
}

// ---------------------------------------------------------------------------
// MCP server factory — one instance per SSE connection. The SDK Server is
// single-transport, so a shared instance can serve only one client at a time;
// a per-connection instance lets Claude.ai, IDEs, and smoke tests coexist.
// (Tool registrations below run inside this factory; bodies keep their
// original top-level indentation.)
// ---------------------------------------------------------------------------

function buildServer(): McpServer {
const server = new McpServer({
  name: "dig-catalog",
  version: "0.2.0-scene",
});

// ---------------------------------------------------------------------------
// Tool: search_catalog
// ---------------------------------------------------------------------------

// "release" is accepted for back-compat but the domain returns degraded empty
// results (release-as-entity was dropped — masters are canonical). Default to
// master when no type is given.
const VALID_TYPES = ["artist", "label", "master", "release"] as const;

server.tool(
  "search_catalog",
  "Search the Dig scene-scoped music catalog (~80k 90s house & techno masters " +
  "from Discogs, plus their artists and labels). Supports FTS, fuzzy matching " +
  "for artist/label/master typos, and structured filters (genre, style, year, " +
  "country). When no type is given, search defaults to masters. Searching for " +
  "type=release returns a degraded empty result — release-as-entity is no " +
  "longer served. Query 2-200 chars; max 50 results per page.",
  {
    query: z.string().describe("Free-text search query (2-200 chars). Can be empty if filters are provided."),
    type: z.enum(VALID_TYPES).optional().describe("Entity type filter. Default: master. 'release' is deprecated."),
    genre: z.string().optional().describe("Genre filter (e.g. 'House', 'Techno', 'Electronic')"),
    style: z.string().optional().describe("Style filter (e.g. 'Deep House', 'Detroit Techno', 'Acid House')"),
    year: z.number().int().optional().describe("Exact release year filter"),
    year_min: z.number().int().optional().describe("Minimum release year (inclusive)"),
    year_max: z.number().int().optional().describe("Maximum release year (inclusive)"),
    country: z.string().optional().describe("Country code filter (e.g. 'US', 'UK', 'DE')"),
    limit: z.number().int().min(1).max(50).default(20).describe("Max results (1-50, default 20)"),
    cursor: z.string().optional().describe("Pagination cursor from previous response"),
  },
  async ({ query, type, genre, style, year, year_min, year_max, country, limit, cursor }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    const params = {
      q: query,
      type: (type ?? "master") as SearchEntityType,
      genre,
      style,
      year,
      yearMin: year_min,
      yearMax: year_max,
      country,
      limit,
      cursor,
    };

    const validationError = validateSearchParams(params);
    if (validationError) {
      status = "error";
      errorCode = "INVALID_REQUEST";
      logToolInvocation(requestId, "search_catalog", status, Date.now() - started, errorCode);
      return toolError("INVALID_REQUEST", validationError.message, {
        tool: "search_catalog",
        requestId,
      });
    }

    try {
      const result = await search(db, params);
      return toolResult(result, {
        tool: "search_catalog",
        requestId,
      });
    } catch (err: any) {
      const pgCode = err.code ?? err.cause?.code;
      if (pgCode === "57014") {
        status = "error";
        errorCode = "QUERY_TIMEOUT";
        return toolError("QUERY_TIMEOUT", "Search query exceeded timeout", {
          tool: "search_catalog",
          requestId,
        });
      }
      console.error("[mcp] search_catalog error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", {
        tool: "search_catalog",
        requestId,
      });
    } finally {
      logToolInvocation(requestId, "search_catalog", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_artist
// ---------------------------------------------------------------------------

server.tool(
  "get_artist",
  "Get full details for an artist by Discogs ID. Returns name, real name, " +
  "profile, aliases (denormalized text), genres/styles inferred from their " +
  "in-scope catalog, URLs, and provenance. Slim shape: members, groups, and " +
  "name_variations are no longer populated.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs artist ID"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.artists");
      const artist = await getArtist(db, discogs_id, batchId, dumpDate);
      if (!artist) {
        status = "error";
        errorCode = "NOT_FOUND";
        return toolError("NOT_FOUND", `Artist ${discogs_id} not found`, { tool: "get_artist", requestId });
      }
      return toolResult({ artist }, { tool: "get_artist", requestId });
    } catch (err: any) {
      console.error("[mcp] get_artist error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_artist", requestId });
    } finally {
      logToolInvocation(requestId, "get_artist", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_label
// ---------------------------------------------------------------------------

server.tool(
  "get_label",
  "Get full details for a record label by Discogs ID. Returns name, profile, " +
  "contact info, parent label, sublabels, aliases, URLs, editorial tier " +
  "(tier1 for canonical scene labels e.g. Tresor, Warp; denylist; or null), " +
  "and provenance.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs label ID"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.labels");
      const label = await getLabel(db, discogs_id, batchId, dumpDate);
      if (!label) {
        status = "error";
        errorCode = "NOT_FOUND";
        return toolError("NOT_FOUND", `Label ${discogs_id} not found`, { tool: "get_label", requestId });
      }
      return toolResult({ label }, { tool: "get_label", requestId });
    } catch (err: any) {
      console.error("[mcp] get_label error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_label", requestId });
    } finally {
      logToolInvocation(requestId, "get_label", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_master
// ---------------------------------------------------------------------------

server.tool(
  "get_master",
  "Get full details for a master release by Discogs ID — the canonical entity " +
  "in the scene-scoped catalog. Returns title, year, primary_artist, " +
  "primary_label, full artists list, denormalized genres + styles, " +
  "scene_weight (curation score), a synthesized 'frankenstein' tracklist, " +
  "deduped YouTube videos, and provenance.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs master release ID"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.masters");
      const master = await getMaster(db, discogs_id, batchId, dumpDate);
      if (!master) {
        status = "error";
        errorCode = "NOT_FOUND";
        return toolError("NOT_FOUND", `Master ${discogs_id} not found`, { tool: "get_master", requestId });
      }
      return toolResult({ master }, { tool: "get_master", requestId });
    } catch (err: any) {
      console.error("[mcp] get_master error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_master", requestId });
    } finally {
      logToolInvocation(requestId, "get_master", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_release_shadow
// ---------------------------------------------------------------------------

server.tool(
  "get_release_shadow",
  "Resolve a Discogs release ID to its master in the scene-scoped catalog. " +
  "Returns the minimal shadow row { master_discogs_id, title, year, format, " +
  "country, label } so callers can redirect to /master/<master_discogs_id> " +
  "and then call get_master. The full release detail (per-pressing tracks " +
  "+ credits) is no longer served.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs release ID (a specific pressing/version)"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const shadow = await getReleaseShadow(db, discogs_id);
      if (!shadow) {
        status = "error";
        errorCode = "NOT_FOUND";
        return toolError(
          "NOT_FOUND",
          `Release ${discogs_id} not in scope (only releases attached to in-scope masters are stored)`,
          { tool: "get_release_shadow", requestId },
        );
      }
      return toolResult({ release_shadow: shadow }, { tool: "get_release_shadow", requestId });
    } catch (err: any) {
      console.error("[mcp] get_release_shadow error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_release_shadow", requestId });
    } finally {
      logToolInvocation(requestId, "get_release_shadow", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_release (deprecated → GONE)
// ---------------------------------------------------------------------------

server.tool(
  "get_release",
  "DEPRECATED. Per-release detail is no longer served. Use get_release_shadow " +
  "to resolve the release ID to a master_discogs_id, then call get_master.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs release ID"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    logToolInvocation(requestId, "get_release", "error", Date.now() - started, "GONE");
    return toolError(
      "GONE",
      "Per-release detail is no longer served in the scene-scoped catalog. Call get_release_shadow to resolve the master, then get_master.",
      { tool: "get_release", requestId },
      { successor: "get_release_shadow", master_resolver: "get_master", discogs_id },
    );
  },
);

// ---------------------------------------------------------------------------
// Tool: traverse_links
// ---------------------------------------------------------------------------

const LINK_TYPES = [
  "artist_masters",
  "label_releases",
  "master_releases",
  "master_videos",
] as const;

server.tool(
  "traverse_links",
  "Navigate relationships in the scene-scoped graph. Supported link types: " +
  "artist_masters (an artist's masters), label_releases (masters released " +
  "on a label), master_releases (the Notable Versions / pressings of a " +
  "master, from release_shadow), master_videos (deduped YouTube videos for " +
  "a master, sourced from master + release-level videos). Returns paginated " +
  "results. Removed: artist_releases, release_credits.",
  {
    link_type: z.enum(LINK_TYPES).describe(
      "Relationship type: artist_masters, label_releases, master_releases, or master_videos",
    ),
    discogs_id: z.number().int().min(1).describe("Source entity Discogs ID"),
    limit: z.number().int().min(1).max(100).default(20).describe("Max results (1-100, default 20)"),
    cursor: z.string().optional().describe("Pagination cursor from previous response"),
  },
  async ({ link_type, discogs_id, limit, cursor }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      // release_shadow and master_videos_unified carry no batch_id — they are
      // rebuilt atomically with the active batch. Resolve batch context via
      // catalog.masters, same as the REST API's traversal routes.
      const LINK_TABLE: Record<string, string> = {
        artist_masters: "catalog.master_artists",
        label_releases: "catalog.masters",
        master_releases: "catalog.masters",
        master_videos: "catalog.masters",
      };
      const table = LINK_TABLE[link_type] ?? "catalog.masters";
      const { batchId, dumpDate } = await getBatchForTable(db, table);

      const handlers: Record<string, () => Promise<any>> = {
        artist_masters: () => getArtistMasters(db, discogs_id, batchId, dumpDate, limit, cursor),
        label_releases: () => getLabelReleases(db, discogs_id, batchId, dumpDate, limit, cursor),
        master_releases: () => getMasterReleases(db, discogs_id, batchId, dumpDate, limit, cursor),
        master_videos: () => getMasterVideos(db, discogs_id, batchId, dumpDate, limit),
      };

      const handler = handlers[link_type];
      if (!handler) {
        status = "error";
        errorCode = "INVALID_REQUEST";
        return toolError("INVALID_REQUEST", `Unknown link_type: ${link_type}`, {
          tool: "traverse_links",
          requestId,
        });
      }

      const result = await handler();
      return toolResult(result, { tool: "traverse_links", requestId });
    } catch (err: any) {
      console.error(`[mcp] traverse_links error (${link_type}):`, err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", {
        tool: "traverse_links",
        requestId,
      });
    } finally {
      logToolInvocation(requestId, "traverse_links", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: list_scenes
// ---------------------------------------------------------------------------

server.tool(
  "list_scenes",
  "List all curated scenes (Detroit Core, Berlin Techno, Chicago House, Dub " +
  "Techno, Cologne Minimal, etc.). Returns slug, name, axis (geography/sound/" +
  "era/cluster/bridge/micro), city, era window, blurb, and label count. Use " +
  "this to find a scene slug before calling get_scene.",
  {},
  async () => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const scenes = await listScenes(db, batchId);
      return toolResult(
        {
          scenes: scenes.map((s) => ({
            slug: s.slug,
            name: s.name,
            axis: s.axis,
            city: s.city,
            era: s.era_start && s.era_end ? `${s.era_start}-${s.era_end}` : s.era_start ? `${s.era_start}-` : null,
            blurb: s.blurb,
            label_count: s.label_count,
            dig_url: `https://app.dig.baby/scene/${s.slug}`,
          })),
          total: scenes.length,
        },
        { tool: "list_scenes", requestId },
      );
    } catch (err: any) {
      console.error("[mcp] list_scenes error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "list_scenes", requestId });
    } finally {
      logToolInvocation(requestId, "list_scenes", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_scene
// ---------------------------------------------------------------------------

server.tool(
  "get_scene",
  "Get full detail for one curated scene by slug: member labels (with role: " +
  "core/adjacent/bridge), bridges to other scenes, and blurb. Use after " +
  "list_scenes to drill into a specific scene.",
  {
    slug: z.string().min(1).max(80).describe("Scene slug from list_scenes (e.g. 'detroit-core')"),
  },
  async ({ slug }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const scene = await getScene(db, slug.trim(), batchId);
      if (!scene) {
        status = "error";
        errorCode = "NOT_FOUND";
        return toolError("NOT_FOUND", `Scene not found: ${slug}`, { tool: "get_scene", requestId });
      }
      return toolResult({ scene }, { tool: "get_scene", requestId });
    } catch (err: any) {
      console.error("[mcp] get_scene error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_scene", requestId });
    } finally {
      logToolInvocation(requestId, "get_scene", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_label_essentials
// ---------------------------------------------------------------------------

server.tool(
  "get_label_essentials",
  "Get the curated 'core run' for a label (essential listening, up to 10 " +
  "masters) plus directional related labels (deeper, harder, rawer, cleaner, " +
  "weirder, poppier, earlier, later). Prefer this over traverse_links " +
  "label_releases when someone asks what's good on a label. Falls back empty " +
  "if the label has no curated run yet.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs label ID"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const [coreRun, related] = await Promise.all([
        getLabelCoreRun(db, discogs_id, 10),
        getLabelRelated(db, discogs_id),
      ]);
      return toolResult(
        {
          label_id: discogs_id,
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
            ? "No curated core run for this label yet — fall back to traverse_links label_releases."
            : undefined,
        },
        { tool: "get_label_essentials", requestId },
      );
    } catch (err: any) {
      console.error("[mcp] get_label_essentials error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_label_essentials", requestId });
    } finally {
      logToolInvocation(requestId, "get_label_essentials", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_artist_credits
// ---------------------------------------------------------------------------

server.tool(
  "get_artist_credits",
  "Get an artist's credit work on in-scope masters — remixes, production, " +
  "mixing, writing, engineering — including credits under their aliases. " +
  "One row per master with the roles held and per-track credit lines. " +
  "role filter accepts a family (remix, produce, mix, master, write, vocal, " +
  "engineer) or an exact normalised role. With role=remix, masters where the " +
  "artist is the headline act are excluded by default, so the result is " +
  "'remixes they did for OTHERS'. This is the tool for questions like " +
  "'what did Larry Heard remix in the 90s'.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs artist ID"),
    role: z.string().optional().describe("Role family (remix, produce, mix, master, write, vocal, engineer) or exact role. Omit for all credit roles."),
    limit: z.number().int().min(1).max(200).default(50).describe("Max masters (1-200, default 50)"),
    include_self_primary: z.boolean().optional().describe("Include masters where the artist is the headline credit (default: false for role=remix, true otherwise)"),
  },
  async ({ discogs_id, role, limit, include_self_primary }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const isRemixRole = (role ?? "").toLowerCase() === "remix";
      const excludeSelfPrimary = include_self_primary !== undefined ? !include_self_primary : isRemixRole;
      const result = await getArtistRuleACredits(db, discogs_id, batchId, {
        limit,
        roleFilter: role ?? null,
        includeAliases: true,
        excludeSelfPrimary,
      });
      return toolResult(result, { tool: "get_artist_credits", requestId });
    } catch (err: any) {
      console.error("[mcp] get_artist_credits error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_artist_credits", requestId });
    } finally {
      logToolInvocation(requestId, "get_artist_credits", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_artist_cross_scope_credits
// ---------------------------------------------------------------------------

server.tool(
  "get_artist_cross_scope_credits",
  "Get an artist's credits on releases OUTSIDE the scene-scoped catalog " +
  "(host release title, artist, label, year, the role, and an outbound " +
  "Discogs URL — these entities aren't hosted on Dig). Use together with " +
  "get_artist_credits to build the full picture of someone's remix and " +
  "production work beyond the house/techno scope.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs artist ID"),
    role: z.string().optional().describe("Role family (remix, produce, mix, master, write, vocal, engineer) or exact role. Omit for all."),
    limit: z.number().int().min(1).max(200).default(50).describe("Max credits (1-200, default 50)"),
  },
  async ({ discogs_id, role, limit }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const result = await getArtistCrossScopeCredits(db, discogs_id, {
        limit,
        roleFilter: role ?? null,
      });
      return toolResult(result, { tool: "get_artist_cross_scope_credits", requestId });
    } catch (err: any) {
      console.error("[mcp] get_artist_cross_scope_credits error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_artist_cross_scope_credits", requestId });
    } finally {
      logToolInvocation(requestId, "get_artist_cross_scope_credits", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_master_credits
// ---------------------------------------------------------------------------

server.tool(
  "get_master_credits",
  "Get the full credit sheet for a master release: per-track credits " +
  "(remixer, producer, writer per track position) and release-level credits " +
  "(Mastered By, A&R, artwork). Answers 'who remixed / produced / wrote " +
  "what' on a specific record.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs master release ID"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const result = await getMasterCredits(db, discogs_id);
      return toolResult(result, { tool: "get_master_credits", requestId });
    } catch (err: any) {
      console.error("[mcp] get_master_credits error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_master_credits", requestId });
    } finally {
      logToolInvocation(requestId, "get_master_credits", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_artist_collaborators
// ---------------------------------------------------------------------------

server.tool(
  "get_artist_collaborators",
  "Get an artist's closest collaborators from the credit graph: people who " +
  "appear on the same in-scope masters (across all the artist's aliases), " +
  "with how many records they share and the roles taken. Answers 'who did " +
  "X work with'.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs artist ID"),
    limit: z.number().int().min(1).max(30).default(10).describe("Max collaborators (1-30, default 10)"),
  },
  async ({ discogs_id, limit }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const result = await getArtistCollaborators(db, discogs_id, batchId, { limit });
      return toolResult(result, { tool: "get_artist_collaborators", requestId });
    } catch (err: any) {
      console.error("[mcp] get_artist_collaborators error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_artist_collaborators", requestId });
    } finally {
      logToolInvocation(requestId, "get_artist_collaborators", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_artist_groups
// ---------------------------------------------------------------------------

server.tool(
  "get_artist_groups",
  "Get an artist's group/member edges: groups they belong to, members (if " +
  "the artist IS a group), and bandmates — each with in-scope master counts. " +
  "Use to resolve 'is X part of Y' and to hop between a group and its " +
  "members (e.g. Fingers Inc. ↔ Larry Heard).",
  {
    discogs_id: z.number().int().min(1).describe("Discogs artist ID"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const result = await getArtistGroupsAndMembers(db, discogs_id, batchId);
      return toolResult(result, { tool: "get_artist_groups", requestId });
    } catch (err: any) {
      console.error("[mcp] get_artist_groups error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_artist_groups", requestId });
    } finally {
      logToolInvocation(requestId, "get_artist_groups", status, Date.now() - started, errorCode);
    }
  },
);

return server;
}

// ---------------------------------------------------------------------------
// Express app — SSE transport
// ---------------------------------------------------------------------------

const app = express();
app.use(rateLimitMiddleware);

app.get("/usage", (_req, res) => {
  res.json(getMcpUsageSnapshot());
});

// ---------------------------------------------------------------------------
// Streamable HTTP transport (modern default — what Claude.ai custom
// connectors speak). Stateless: a fresh McpServer per request, no session
// tracking needed. Mount JSON parsing on this route only — the legacy
// /messages route parses its own body inside handlePostMessage.
// ---------------------------------------------------------------------------

app.post("/mcp", express.json({ limit: "1mb" }), async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] streamable request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless mode has no server-initiated stream or session to manage.
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: stateless transport, POST only" },
    id: null,
  });
});
app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: stateless transport, POST only" },
    id: null,
  });
});

// One transport + one McpServer instance per SSE connection (legacy transport).
const MAX_SESSIONS = 16;
interface Session {
  transport: SSEServerTransport;
  server: McpServer;
}
const sessions = new Map<string, Session>();

app.get("/sse", async (_req, res) => {
  if (sessions.size >= MAX_SESSIONS) {
    res.status(503).json({
      error: "MCP server is at session capacity. Retry shortly.",
      code: "MCP_SESSION_BUSY",
    });
    return;
  }

  const transport = new SSEServerTransport("/messages", res);
  const server = buildServer();
  sessions.set(transport.sessionId, { transport, server });
  console.log(`[mcp] session opened: ${transport.sessionId} (${sessions.size} active)`);

  res.on("close", () => {
    sessions.delete(transport.sessionId);
    console.log(`[mcp] session closed: ${transport.sessionId} (${sessions.size} active)`);
    void server.close().catch((err) => {
      console.warn("[mcp] server.close() on SSE disconnect failed:", err);
    });
  });

  try {
    await server.connect(transport);
  } catch (err) {
    sessions.delete(transport.sessionId);
    console.error("[mcp] failed to connect transport:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to establish MCP SSE session",
        code: "MCP_CONNECT_FAILED",
      });
    }
  }
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query["sessionId"] as string | undefined;

  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId query parameter" });
    return;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).json({ error: `No active session: ${sessionId}` });
    return;
  }

  await session.transport.handlePostMessage(req, res);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[dig-mcp] MCP server listening on http://localhost:${PORT}`);
  console.log(`[dig-mcp]   Streamable   : POST /mcp (stateless — use this for Claude.ai connectors)`);
  console.log(`[dig-mcp]   SSE (legacy) : GET  /sse`);
  console.log(`[dig-mcp]   Post endpoint: POST /messages?sessionId=<id>`);
  console.log(`[dig-mcp]   Scope        : 90s house & techno (~80k masters)`);
  console.log(`[dig-mcp]   Tools        : search_catalog, get_artist, get_label, get_master, get_release_shadow, traverse_links, list_scenes, get_scene, get_label_essentials, get_artist_credits, get_artist_cross_scope_credits, get_master_credits, get_artist_collaborators, get_artist_groups (+ get_release [GONE])`);
});
