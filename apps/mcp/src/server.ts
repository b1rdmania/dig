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

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(DATABASE_URL);

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

/** Format a successful tool result with JSON content */
function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Format an error tool result matching REST error taxonomy */
function toolError(code: string, message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: { code, message, details: null } }),
      },
    ],
    isError: true,
  };
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
      return toolError("INVALID_REQUEST", validationError.message);
    }

    try {
      const result = await search(db, params);
      return toolResult(result);
    } catch (err: any) {
      const pgCode = err.code ?? err.cause?.code;
      if (pgCode === "57014") {
        return toolError("QUERY_TIMEOUT", "Search query exceeded timeout");
      }
      console.error("[mcp] search_catalog error:", err);
      return toolError("INTERNAL_ERROR", "Internal server error");
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
    try {
      const { batchId, dumpDate } = await getBatchInfo();
      const artist = await getArtist(db, discogs_id, batchId, dumpDate);
      if (!artist) {
        return toolError("NOT_FOUND", `Artist ${discogs_id} not found`);
      }
      return toolResult({ artist });
    } catch (err: any) {
      console.error("[mcp] get_artist error:", err);
      return toolError("INTERNAL_ERROR", "Internal server error");
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
    try {
      const { batchId, dumpDate } = await getBatchInfo();
      const label = await getLabel(db, discogs_id, batchId, dumpDate);
      if (!label) {
        return toolError("NOT_FOUND", `Label ${discogs_id} not found`);
      }
      return toolResult({ label });
    } catch (err: any) {
      console.error("[mcp] get_label error:", err);
      return toolError("INTERNAL_ERROR", "Internal server error");
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
    try {
      const { batchId, dumpDate } = await getBatchInfo();
      const master = await getMaster(db, discogs_id, batchId, dumpDate);
      if (!master) {
        return toolError("NOT_FOUND", `Master ${discogs_id} not found`);
      }
      return toolResult({ master });
    } catch (err: any) {
      console.error("[mcp] get_master error:", err);
      return toolError("INTERNAL_ERROR", "Internal server error");
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
    try {
      const { batchId, dumpDate } = await getBatchInfo();
      const release = await getRelease(db, discogs_id, batchId, dumpDate);
      if (!release) {
        return toolError("NOT_FOUND", `Release ${discogs_id} not found`);
      }
      return toolResult({ release });
    } catch (err: any) {
      console.error("[mcp] get_release error:", err);
      return toolError("INTERNAL_ERROR", "Internal server error");
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
        return toolError("INVALID_REQUEST", `Unknown link_type: ${link_type}`);
      }

      const result = await handler();
      return toolResult(result);
    } catch (err: any) {
      console.error(`[mcp] traverse_links error (${link_type}):`, err);
      return toolError("INTERNAL_ERROR", "Internal server error");
    }
  },
);

// ---------------------------------------------------------------------------
// Express app — SSE transport
// ---------------------------------------------------------------------------

const app = express();

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
