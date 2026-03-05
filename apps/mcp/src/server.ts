/**
 * @dig/mcp — MCP server for the Dig music catalog.
 *
 * Transport: SSE (HTTP, remote) via express + @modelcontextprotocol/sdk
 *
 * All tools delegate to @dig/domain retrieval services.
 * Tool outputs match REST response contracts (docs/phase2-response-contracts.md)
 * including degraded, degraded_reason, and provenance fields.
 *
 * Error taxonomy matches REST: INVALID_REQUEST, NOT_FOUND, QUERY_TIMEOUT, INTERNAL_ERROR.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createDb } from "@dig/db";
import {
  search,
  validateSearchParams,
  getArtist,
  getLabel,
  getMaster,
  getRelease,
  getArtistReleases,
  getArtistMasters,
  getLabelReleases,
  getMasterReleases,
  getReleaseCredits,
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

/** Get the current active batch info for provenance */
async function getBatchInfo(): Promise<{ batchId: string; dumpDate: string }> {
  const batch = await db
    .selectFrom("ingest.dump_batches" as any)
    .select(["id", "dump_date"] as any[])
    .where("status" as any, "in", ["active", "qa"])
    .orderBy("created_at" as any, "desc")
    .executeTakeFirstOrThrow();
  return { batchId: (batch as any).id, dumpDate: (batch as any).dump_date };
}

function createRequestId(): string {
  return randomUUID();
}

function logToolInvocation(
  requestId: string,
  tool: string,
  status: "ok" | "error",
  elapsedMs: number,
  errorCode: string | null,
) {
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
// MCP server instance
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "dig-catalog",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Tool: search_catalog
// ---------------------------------------------------------------------------

const VALID_TYPES = ["artist", "label", "master", "release"] as const;

server.tool(
  "search_catalog",
  "Search the Dig music catalog (24M+ records from Discogs). " +
  "Supports FTS, fuzzy matching for artist/label/master typos, " +
  "and structured filters (genre, style, year, country). " +
  "Query must be 2-200 characters. Max 50 results per page.",
  {
    query: z.string().describe("Free-text search query (2-200 chars). Can be empty if filters are provided."),
    type: z.enum(VALID_TYPES).optional().describe("Entity type filter: artist, label, master, or release"),
    genre: z.string().optional().describe("Genre filter (e.g. 'Electronic', 'Rock', 'Jazz')"),
    style: z.string().optional().describe("Style filter (e.g. 'Deep House', 'Ambient', 'Punk')"),
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
      type: type as SearchEntityType | undefined,
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
  "Get full details for an artist by Discogs ID. " +
  "Returns name, real name, profile, aliases, members, groups, URLs, and provenance.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs artist ID"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId, dumpDate } = await getBatchInfo();
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
  "Get full details for a record label by Discogs ID. " +
  "Returns name, profile, contact info, parent label, URLs, and provenance.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs label ID"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId, dumpDate } = await getBatchInfo();
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
  "Get full details for a master release by Discogs ID. " +
  "Returns title, year, artists, genres, styles, videos, and provenance.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs master release ID"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId, dumpDate } = await getBatchInfo();
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
// Tool: get_release
// ---------------------------------------------------------------------------

server.tool(
  "get_release",
  "Get full details for a specific release by Discogs ID. " +
  "Returns title, artists, labels, formats, tracks with credits, " +
  "genres, styles, identifiers, companies, videos, and provenance.",
  {
    discogs_id: z.number().int().min(1).describe("Discogs release ID"),
  },
  async ({ discogs_id }) => {
    const requestId = createRequestId();
    const started = Date.now();
    let status: "ok" | "error" = "ok";
    let errorCode: string | null = null;
    try {
      const { batchId, dumpDate } = await getBatchInfo();
      const release = await getRelease(db, discogs_id, batchId, dumpDate);
      if (!release) {
        status = "error";
        errorCode = "NOT_FOUND";
        return toolError("NOT_FOUND", `Release ${discogs_id} not found`, { tool: "get_release", requestId });
      }
      return toolResult({ release }, { tool: "get_release", requestId });
    } catch (err: any) {
      console.error("[mcp] get_release error:", err);
      status = "error";
      errorCode = "INTERNAL_ERROR";
      return toolError("INTERNAL_ERROR", "Internal server error", { tool: "get_release", requestId });
    } finally {
      logToolInvocation(requestId, "get_release", status, Date.now() - started, errorCode);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: traverse_links
// ---------------------------------------------------------------------------

const LINK_TYPES = [
  "artist_releases",
  "artist_masters",
  "label_releases",
  "master_releases",
  "release_credits",
] as const;

server.tool(
  "traverse_links",
  "Navigate relationships in the music graph. " +
  "Supported link types: artist_releases, artist_masters, label_releases, " +
  "master_releases, release_credits. Returns paginated results.",
  {
    link_type: z.enum(LINK_TYPES).describe(
      "Relationship type: artist_releases, artist_masters, label_releases, master_releases, or release_credits",
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
      const { batchId, dumpDate } = await getBatchInfo();

      const handlers: Record<string, () => Promise<any>> = {
        artist_releases: () => getArtistReleases(db, discogs_id, batchId, dumpDate, limit, cursor),
        artist_masters: () => getArtistMasters(db, discogs_id, batchId, dumpDate, limit, cursor),
        label_releases: () => getLabelReleases(db, discogs_id, batchId, dumpDate, limit, cursor),
        master_releases: () => getMasterReleases(db, discogs_id, batchId, dumpDate, limit, cursor),
        release_credits: () => getReleaseCredits(db, discogs_id, batchId, dumpDate, limit, cursor),
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
// Express app — SSE transport
// ---------------------------------------------------------------------------

const app = express();
app.use(rateLimitMiddleware);

// One transport instance per SSE connection.
const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (_req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);

  res.on("close", () => {
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query["sessionId"] as string | undefined;

  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId query parameter" });
    return;
  }

  const transport = transports.get(sessionId);

  if (!transport) {
    res.status(404).json({ error: `No active session: ${sessionId}` });
    return;
  }

  await transport.handlePostMessage(req, res);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[dig-mcp] MCP server listening on http://localhost:${PORT}`);
  console.log(`[dig-mcp]   SSE endpoint : GET  /sse`);
  console.log(`[dig-mcp]   Post endpoint: POST /messages?sessionId=<id>`);
  console.log(`[dig-mcp]   Tools: search_catalog, get_artist, get_label, get_master, get_release, traverse_links`);
});
