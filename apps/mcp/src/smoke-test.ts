/**
 * MCP smoke test — validates all tools return contract-compliant responses.
 * Requires: MCP server running on localhost:3001 with DATABASE_URL set.
 *
 * Usage: npx tsx apps/mcp/src/smoke-test.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const BASE_URL = process.env.MCP_URL ?? "http://localhost:3001/sse";
let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failed++;
  } else {
    passed++;
  }
}

async function main() {
  console.log(`Connecting to ${BASE_URL}...`);
  const transport = new SSEClientTransport(new URL(BASE_URL));
  const client = new Client({ name: "dig-smoke-test", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("Connected!\n");

  // List tools
  const tools = await client.listTools();
  const toolNames = tools.tools.map((t) => t.name);
  console.log("Tools:", toolNames.join(", "));
  assert(toolNames.includes("search_catalog"), "search_catalog registered");
  assert(toolNames.includes("get_artist"), "get_artist registered");
  assert(toolNames.includes("get_label"), "get_label registered");
  assert(toolNames.includes("get_master"), "get_master registered");
  assert(toolNames.includes("get_release"), "get_release registered");
  assert(toolNames.includes("traverse_links"), "traverse_links registered");

  // --- search_catalog ---
  console.log("\n--- search_catalog (normal) ---");
  const searchResult = await client.callTool({
    name: "search_catalog",
    arguments: { query: "radiohead", type: "artist", limit: 3 },
  });
  const sr = JSON.parse((searchResult.content as any)[0].text);
  assert(Array.isArray(sr.results), "results is array");
  assert(sr.results.length > 0, "has results");
  assert(sr.results[0].provenance?.source === "discogs", "provenance.source = discogs");
  assert(typeof sr.meta.degraded === "boolean", "meta.degraded is boolean");
  assert("degraded_reason" in sr.meta, "meta.degraded_reason present");
  assert(typeof sr.meta.elapsed_ms === "number", "meta.elapsed_ms is number");
  assert("cursor" in sr.pagination, "pagination.cursor present");
  console.log(`  Results: ${sr.results.length}, first: ${sr.results[0]?.name} (${sr.results[0]?.discogs_id})`);

  // --- search_catalog (degraded: empty_tsquery) ---
  console.log("\n--- search_catalog (empty_tsquery) ---");
  const stopResult = await client.callTool({
    name: "search_catalog",
    arguments: { query: "The", type: "release" },
  });
  const sw = JSON.parse((stopResult.content as any)[0].text);
  assert(sw.meta.degraded === true, "degraded is true for stop word");
  assert(sw.meta.degraded_reason === "empty_tsquery", "reason is empty_tsquery");
  assert(sw.results.length === 0, "0 results for stop word");
  console.log(`  Degraded: ${sw.meta.degraded}, reason: ${sw.meta.degraded_reason}`);

  // --- get_artist ---
  console.log("\n--- get_artist ---");
  const artistResult = await client.callTool({
    name: "get_artist",
    arguments: { discogs_id: 3840 },
  });
  const ar = JSON.parse((artistResult.content as any)[0].text);
  assert(ar.artist !== undefined, "artist key present");
  assert(typeof ar.artist.discogs_id === "number", "artist.discogs_id is number");
  assert(typeof ar.artist.name === "string", "artist.name is string");
  assert(Array.isArray(ar.artist.aliases), "artist.aliases is array");
  assert(Array.isArray(ar.artist.members), "artist.members is array");
  assert(ar.artist.provenance?.source === "discogs", "artist provenance.source");
  console.log(`  Artist: ${ar.artist.name} (${ar.artist.discogs_id}), aliases: ${ar.artist.aliases.length}`);

  // --- get_artist NOT_FOUND ---
  console.log("\n--- get_artist (NOT_FOUND) ---");
  const notFound = await client.callTool({
    name: "get_artist",
    arguments: { discogs_id: 999999999 },
  });
  assert(notFound.isError === true, "isError is true");
  const nf = JSON.parse((notFound.content as any)[0].text);
  assert(nf.error.code === "NOT_FOUND", "error code is NOT_FOUND");
  assert(nf.error.details === null, "error details is null");
  console.log(`  Error: ${nf.error.code} — ${nf.error.message}`);

  // --- get_label ---
  console.log("\n--- get_label ---");
  const labelResult = await client.callTool({
    name: "get_label",
    arguments: { discogs_id: 1 },
  });
  const lr = JSON.parse((labelResult.content as any)[0].text);
  assert(lr.label !== undefined, "label key present");
  assert(typeof lr.label.name === "string", "label.name is string");
  assert(lr.label.provenance?.source === "discogs", "label provenance.source");
  console.log(`  Label: ${lr.label.name} (${lr.label.discogs_id})`);

  // --- get_master ---
  console.log("\n--- get_master ---");
  const masterResult = await client.callTool({
    name: "get_master",
    arguments: { discogs_id: 384323 },
  });
  const mr = JSON.parse((masterResult.content as any)[0].text);
  assert(mr.master !== undefined, "master key present");
  assert(typeof mr.master.title === "string", "master.title is string");
  assert(Array.isArray(mr.master.genres), "master.genres is array");
  assert(Array.isArray(mr.master.styles), "master.styles is array");
  assert(mr.master.provenance?.source === "discogs", "master provenance.source");
  console.log(`  Master: ${mr.master.title} (${mr.master.discogs_id})`);

  // --- get_release ---
  console.log("\n--- get_release ---");
  const releaseResult = await client.callTool({
    name: "get_release",
    arguments: { discogs_id: 1 },
  });
  const rr = JSON.parse((releaseResult.content as any)[0].text);
  assert(rr.release !== undefined, "release key present");
  assert(typeof rr.release.title === "string", "release.title is string");
  assert(Array.isArray(rr.release.tracks), "release.tracks is array");
  assert(Array.isArray(rr.release.credits), "release.credits is array");
  assert(Array.isArray(rr.release.labels), "release.labels is array");
  assert(rr.release.provenance?.source === "discogs", "release provenance.source");
  console.log(`  Release: ${rr.release.title} (${rr.release.discogs_id}), tracks: ${rr.release.tracks.length}`);

  // --- traverse_links ---
  console.log("\n--- traverse_links (artist_releases) ---");
  const travResult = await client.callTool({
    name: "traverse_links",
    arguments: { link_type: "artist_releases", discogs_id: 3840, limit: 3 },
  });
  const tr = JSON.parse((travResult.content as any)[0].text);
  assert(Array.isArray(tr.links), "links is array");
  assert(tr.links.length > 0, "has links");
  assert(tr.links[0].provenance?.source === "discogs", "link provenance.source");
  assert("cursor" in tr.pagination, "pagination.cursor present");
  assert(typeof tr.meta.source_discogs_id === "number", "meta.source_discogs_id");
  assert(tr.meta.link_type === "releases", "meta.link_type correct");
  console.log(`  Links: ${tr.links.length}, first: ${tr.links[0]?.title} (${tr.links[0]?.discogs_id})`);

  // --- INVALID_REQUEST ---
  console.log("\n--- INVALID_REQUEST error ---");
  const invalid = await client.callTool({
    name: "search_catalog",
    arguments: { query: "a" }, // too short
  });
  assert(invalid.isError === true, "isError for validation failure");
  const iv = JSON.parse((invalid.content as any)[0].text);
  assert(iv.error.code === "INVALID_REQUEST", "error code is INVALID_REQUEST");
  console.log(`  Error: ${iv.error.code} — ${iv.error.message}`);

  // Summary
  await client.close();
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("All MCP smoke tests passed!");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
