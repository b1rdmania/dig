/**
 * MCP smoke test — validates all tools return contract-compliant responses
 * against the scene-scoped slim catalog.
 *
 * Requires: MCP server running on localhost:3001 with DATABASE_URL set
 * to the dig-db-scene Postgres instance.
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
  const client = new Client({ name: "dig-smoke-test", version: "0.2.0" }, { capabilities: {} });
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
  assert(toolNames.includes("get_release_shadow"), "get_release_shadow registered");
  assert(toolNames.includes("get_release"), "get_release registered (GONE shim)");
  assert(toolNames.includes("traverse_links"), "traverse_links registered");

  // --- search_catalog (master) ---
  console.log("\n--- search_catalog (master) ---");
  const searchResult = await client.callTool({
    name: "search_catalog",
    arguments: { query: "tresor", type: "master", limit: 3 },
  });
  const sr = JSON.parse((searchResult.content as any)[0].text);
  assert(Array.isArray(sr.results), "results is array");
  assert(sr.results.length > 0, "has results");
  assert(sr._mcp?.contract_version === "v1-alpha", "_mcp contract version present");
  assert(typeof sr._mcp?.request_id === "string", "_mcp request_id present");
  assert(sr.results[0].provenance?.source === "discogs", "provenance.source = discogs");
  assert(typeof sr.meta.degraded === "boolean", "meta.degraded is boolean");
  assert("degraded_reason" in sr.meta, "meta.degraded_reason present");
  assert(typeof sr.meta.elapsed_ms === "number", "meta.elapsed_ms is number");
  assert("cursor" in sr.pagination, "pagination.cursor present");
  console.log(`  Results: ${sr.results.length}, first: ${sr.results[0]?.name ?? sr.results[0]?.title} (${sr.results[0]?.discogs_id})`);

  // --- search_catalog defaults to master when type omitted ---
  console.log("\n--- search_catalog (default type = master) ---");
  const defaultResult = await client.callTool({
    name: "search_catalog",
    arguments: { query: "tresor", limit: 3 },
  });
  const def = JSON.parse((defaultResult.content as any)[0].text);
  assert(Array.isArray(def.results), "default results is array");
  if (def.results.length > 0) {
    assert(def.results[0].type === "master", "first result is a master when no type given");
  }

  // --- search_catalog (stop-word query — search v2 'simple' config serves these) ---
  console.log("\n--- search_catalog (stop-word query, search v2) ---");
  const stopResult = await client.callTool({
    name: "search_catalog",
    arguments: { query: "The", type: "master" },
  });
  const sw = JSON.parse((stopResult.content as any)[0].text);
  assert(sw.meta.degraded === false, "stop-word query is not degraded under search v2");
  assert(Array.isArray(sw.results), "stop-word query returns a results array");
  console.log(`  Degraded: ${sw.meta.degraded}, results: ${sw.results.length}`);

  // --- search_catalog (release deprecated → empty) ---
  console.log("\n--- search_catalog (type=release deprecated) ---");
  const relResult = await client.callTool({
    name: "search_catalog",
    arguments: { query: "tresor", type: "release", limit: 3 },
  });
  const rel = JSON.parse((relResult.content as any)[0].text);
  assert(rel.results.length === 0, "type=release returns 0 results");
  console.log(`  Release results: ${rel.results.length} (deprecated entity)`);

  // --- get_artist ---
  console.log("\n--- get_artist ---");
  const artistResult = await client.callTool({
    name: "get_artist",
    arguments: { discogs_id: 1 }, // Persuader / Jesper Dahlbäck — well-known scene artist
  });
  const ar = JSON.parse((artistResult.content as any)[0].text);
  if (!ar.error) {
    assert(ar.artist !== undefined, "artist key present");
    assert(typeof ar.artist.discogs_id === "number", "artist.discogs_id is number");
    assert(typeof ar.artist.name === "string", "artist.name is string");
    assert(Array.isArray(ar.artist.aliases), "artist.aliases is array");
    assert(Array.isArray(ar.artist.members), "artist.members is array (slim: empty)");
    assert(ar.artist.provenance?.source === "discogs", "artist provenance.source");
    console.log(`  Artist: ${ar.artist.name} (${ar.artist.discogs_id}), aliases: ${ar.artist.aliases.length}`);
  } else {
    console.log(`  Artist 1 not in scene scope — skipping shape assertions.`);
  }

  // --- get_artist NOT_FOUND ---
  console.log("\n--- get_artist (NOT_FOUND) ---");
  const notFound = await client.callTool({
    name: "get_artist",
    arguments: { discogs_id: 999999999 },
  });
  assert(notFound.isError === true, "isError is true");
  const nf = JSON.parse((notFound.content as any)[0].text);
  assert(typeof nf._mcp?.request_id === "string", "error _mcp request_id present");
  assert(nf.error.code === "NOT_FOUND", "error code is NOT_FOUND");
  assert(nf.error.details === null, "error details is null");
  console.log(`  Error: ${nf.error.code} — ${nf.error.message}`);

  // --- get_label ---
  console.log("\n--- get_label ---");
  const labelResult = await client.callTool({
    name: "get_label",
    arguments: { discogs_id: 12 }, // Tresor
  });
  const lr = JSON.parse((labelResult.content as any)[0].text);
  if (!lr.error) {
    assert(lr.label !== undefined, "label key present");
    assert(typeof lr.label.name === "string", "label.name is string");
    assert("tier" in lr.label, "label.tier present (slim addition)");
    assert(lr.label.provenance?.source === "discogs", "label provenance.source");
    console.log(`  Label: ${lr.label.name} (${lr.label.discogs_id}) tier=${lr.label.tier}`);
  }

  // --- get_master ---
  console.log("\n--- get_master ---");
  // Find a master ID by searching first (catalog content varies; don't hard-code).
  const masterSearch = await client.callTool({
    name: "search_catalog",
    arguments: { query: "techno", type: "master", limit: 1 },
  });
  const msr = JSON.parse((masterSearch.content as any)[0].text);
  const masterId = msr.results?.[0]?.discogs_id;
  if (typeof masterId === "number") {
    const masterResult = await client.callTool({
      name: "get_master",
      arguments: { discogs_id: masterId },
    });
    const mr = JSON.parse((masterResult.content as any)[0].text);
    assert(mr.master !== undefined, "master key present");
    assert(typeof mr.master.title === "string", "master.title is string");
    assert(Array.isArray(mr.master.genres), "master.genres is array (denormed)");
    assert(Array.isArray(mr.master.styles), "master.styles is array (denormed)");
    assert("scene_weight" in mr.master, "master.scene_weight present (slim addition)");
    assert(mr.master.provenance?.source === "discogs", "master provenance.source");
    console.log(`  Master: ${mr.master.title} (${mr.master.discogs_id}) scene_weight=${mr.master.scene_weight}`);
  } else {
    console.log("  No master returned from search; skipping get_master shape assertions.");
  }

  // --- get_release_shadow (scene-scoped resolver) ---
  console.log("\n--- get_release_shadow ---");
  // We need a known-in-scope release ID. main_release_discogs_id from the master fetched above is reliable.
  let shadowReleaseId: number | undefined;
  if (typeof masterId === "number") {
    const mres = await client.callTool({
      name: "get_master",
      arguments: { discogs_id: masterId },
    });
    const mres_parsed = JSON.parse((mres.content as any)[0].text);
    shadowReleaseId = mres_parsed.master?.main_release_discogs_id ?? undefined;
  }
  if (typeof shadowReleaseId === "number") {
    const shadowResult = await client.callTool({
      name: "get_release_shadow",
      arguments: { discogs_id: shadowReleaseId },
    });
    const sh = JSON.parse((shadowResult.content as any)[0].text);
    assert(sh.release_shadow !== undefined, "release_shadow key present");
    assert(typeof sh.release_shadow.master_discogs_id === "number", "shadow.master_discogs_id is number");
    assert(sh.release_shadow.master_discogs_id === masterId, "shadow resolves back to source master");
    console.log(`  Shadow: release ${shadowReleaseId} → master ${sh.release_shadow.master_discogs_id}`);
  } else {
    console.log("  No main_release_discogs_id available; skipping release_shadow assertions.");
  }

  // --- get_release (GONE) ---
  console.log("\n--- get_release (GONE) ---");
  const goneResult = await client.callTool({
    name: "get_release",
    arguments: { discogs_id: 1 },
  });
  assert(goneResult.isError === true, "get_release returns isError");
  const gone = JSON.parse((goneResult.content as any)[0].text);
  assert(gone.error.code === "GONE", "get_release error code is GONE");
  assert(gone.error.details?.successor === "get_release_shadow", "GONE points at successor");
  console.log(`  Error: ${gone.error.code} → ${gone.error.details?.successor}`);

  // --- traverse_links: artist_masters ---
  console.log("\n--- traverse_links (artist_masters) ---");
  if (typeof masterId === "number") {
    const masterRes = await client.callTool({
      name: "get_master",
      arguments: { discogs_id: masterId },
    });
    const mr_parsed = JSON.parse((masterRes.content as any)[0].text);
    const artistId = mr_parsed.master?.primary_artist?.discogs_id ?? mr_parsed.master?.artists?.[0]?.discogs_id;
    if (typeof artistId === "number") {
      const travResult = await client.callTool({
        name: "traverse_links",
        arguments: { link_type: "artist_masters", discogs_id: artistId, limit: 3 },
      });
      const tr = JSON.parse((travResult.content as any)[0].text);
      assert(Array.isArray(tr.links), "links is array");
      assert("cursor" in tr.pagination, "pagination.cursor present");
      assert(typeof tr.meta.source_discogs_id === "number", "meta.source_discogs_id");
      console.log(`  artist_masters links: ${tr.links.length}`);
    }
  }

  // --- traverse_links: master_releases (Notable Versions) ---
  console.log("\n--- traverse_links (master_releases) ---");
  if (typeof masterId === "number") {
    const versions = await client.callTool({
      name: "traverse_links",
      arguments: { link_type: "master_releases", discogs_id: masterId, limit: 5 },
    });
    const v = JSON.parse((versions.content as any)[0].text);
    assert(Array.isArray(v.links), "master_releases links is array");
    console.log(`  master_releases (Notable Versions): ${v.links.length}`);
  }

  // --- traverse_links: master_videos ---
  console.log("\n--- traverse_links (master_videos) ---");
  if (typeof masterId === "number") {
    const vids = await client.callTool({
      name: "traverse_links",
      arguments: { link_type: "master_videos", discogs_id: masterId, limit: 10 },
    });
    const vp = JSON.parse((vids.content as any)[0].text);
    assert(Array.isArray(vp.videos ?? vp.links), "master_videos returns an array (videos or links)");
    console.log(`  master_videos count: ${(vp.videos ?? vp.links)?.length ?? 0}`);
  }

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
