/**
 * @dig/mcp — MCP server scaffold
 *
 * Transport: SSE (HTTP, remote) via express + @modelcontextprotocol/sdk
 *
 * Tools registered here will ultimately be backed by @dig/domain retrieval
 * services (vector search, catalog lookup, recommendation engine, etc.).
 * For now each tool returns a stub response so the server can boot and
 * respond to a well-formed MCP tool call.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ---------------------------------------------------------------------------
// MCP server instance
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "dig-catalog",
  version: "0.0.1",
});

// ---------------------------------------------------------------------------
// Tool: search_catalog
//
// TODO: replace stub with @dig/domain retrieval service calls (vector search,
//       full-text search, faceted filtering against the Discogs catalog).
// ---------------------------------------------------------------------------

server.tool(
  "search_catalog",
  "Search the Dig music catalog by artist, release, label, or genre.",
  {
    query: z.string().describe("Free-text search query"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of results to return"),
  },
  async ({ query, limit }) => {
    // Stub — real implementation will call @dig/domain retrieval services.
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            stub: true,
            query,
            limit,
            results: [],
            message:
              "search_catalog is not yet implemented. This stub confirms the tool is reachable.",
          }),
        },
      ],
    };
  }
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

app.post("/messages", express.json(), async (req, res) => {
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
});
