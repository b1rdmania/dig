/**
 * MusicBrainz crosswalk import CLI.
 *
 * Parses mbdump.tar.bz2 to extract discogs_release_id → musicbrainz_id
 * mappings and writes them to enrich.release_crosswalks.
 *
 * Usage:
 *   pnpm --filter @dig/ingest musicbrainz -- --file ./mbdump.tar.bz2
 *
 * The dump can be downloaded from:
 *   https://metabrainz.org/datasets/postgres-dumps
 *
 * Only needs mbdump.tar.bz2 (~5GB compressed, CC0 licensed).
 * Streams 5 tables: link_type, link, l_release_url, url, release.
 * Joins in memory, then writes to enrich.release_crosswalks in batches.
 *
 * Requires `bzcat` on PATH (macOS/Linux have it by default).
 */

import { spawn } from "node:child_process";
import { createDb, sql } from "@dig/db";
import * as tar from "tar-stream";

const BATCH_SIZE = 500;
const DISCOGS_URL_REGEX = /\/release\/(\d+)/;
// MusicBrainz link_type GID for "discogs" relationship on releases
const DISCOGS_LINK_TYPE_GID = "4a78823c-1c53-4176-a5f3-58026c76f2bc";

const TABLES_NEEDED = ["link_type", "link", "l_release_url", "url", "release"];

function parseArgs(): { file: string; databaseUrl: string } {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let file = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) file = args[++i];
  }
  if (!file) {
    console.error("Usage: pnpm --filter @dig/ingest musicbrainz -- --file ./mbdump.tar.bz2");
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL env var required");
    process.exit(1);
  }
  return { file, databaseUrl };
}

async function main() {
  const { file, databaseUrl } = parseArgs();
  const db = createDb(databaseUrl);

  console.log(`[mb-import] Starting import from ${file}`);
  const t0 = Date.now();

  // In-memory lookup maps (populated during tar stream)
  let discogsLinkTypeId: number | null = null;
  // link.id → link.link_type — we store all, then filter after link_type is known
  const linkIdToLinkType = new Map<number, number>();
  const urlIdToDiscogsId = new Map<number, number>();
  const releaseIdToMbid = new Map<number, string>();
  // Store full triple for l_release_url so we can filter by link ID after
  const relUrlTriples: Array<[number, number, number]> = []; // [linkId, releaseId, urlId]
  const filesProcessed = new Set<string>();

  // --- Stream tar.bz2 via bzcat → tar-stream ---
  const extract = tar.extract();

  extract.on("entry", (header, stream, next) => {
    const name = header.name.replace(/^mbdump\//, "");
    if (!TABLES_NEEDED.includes(name)) {
      stream.resume();
      next();
      return;
    }

    console.log(`[mb-import] Processing: ${name}`);
    let buf = "";
    let rows = 0;

    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        if (!line) continue;
        const f = line.split("\t");
        rows++;

        switch (name) {
          case "link_type": {
            if (f[3] === DISCOGS_LINK_TYPE_GID) {
              discogsLinkTypeId = parseInt(f[0], 10);
              console.log(`[mb-import] Discogs link_type id: ${discogsLinkTypeId}`);
            }
            break;
          }
          case "link": {
            // Store all — we filter by link_type after all tables are parsed
            linkIdToLinkType.set(parseInt(f[0], 10), parseInt(f[1], 10));
            break;
          }
          case "url": {
            const url = f[2];
            if (url && url.includes("discogs.com/release/")) {
              const m = url.match(DISCOGS_URL_REGEX);
              if (m) urlIdToDiscogsId.set(parseInt(f[0], 10), parseInt(m[1], 10));
            }
            break;
          }
          case "release": {
            const gid = f[1];
            if (gid && gid.length === 36) {
              releaseIdToMbid.set(parseInt(f[0], 10), gid);
            }
            break;
          }
          case "l_release_url": {
            // columns: id, link, entity0(release), entity1(url), ...
            relUrlTriples.push([
              parseInt(f[1], 10), // link id
              parseInt(f[2], 10), // release.id
              parseInt(f[3], 10), // url.id
            ]);
            break;
          }
        }
      }
    });

    stream.on("end", () => {
      filesProcessed.add(name);
      console.log(`[mb-import] ${name}: ${rows.toLocaleString()} rows`);
      next();
    });
  });

  // Decompress bz2 via system bzcat (node:zlib doesn't support bz2)
  await new Promise<void>((resolve, reject) => {
    const bz2 = spawn("bzcat", [file], { stdio: ["ignore", "pipe", "inherit"] });
    bz2.stdout.pipe(extract);
    extract.on("finish", resolve);
    bz2.on("error", (e) => reject(new Error(`bzcat failed: ${e.message}`)));
    bz2.on("exit", (code) => {
      if (code && code !== 0) reject(new Error(`bzcat exit ${code}`));
    });
    extract.on("error", reject);
  });

  // --- Validate ---
  const missing = TABLES_NEEDED.filter((t) => !filesProcessed.has(t));
  if (missing.length) {
    console.error(`[mb-import] Missing tables: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (discogsLinkTypeId === null) {
    console.error("[mb-import] Discogs link_type not found in dump");
    process.exit(1);
  }

  // Build discogsLinkIds now that link_type has been parsed
  const discogsLinkIds = new Set<number>();
  if (discogsLinkTypeId !== null) {
    for (const [linkId, linkType] of linkIdToLinkType) {
      if (linkType === discogsLinkTypeId) discogsLinkIds.add(linkId);
    }
  }

  console.log(`[mb-import] Maps built:`);
  console.log(`  Discogs link IDs: ${discogsLinkIds.size.toLocaleString()} (from ${linkIdToLinkType.size.toLocaleString()} total links)`);
  console.log(`  Discogs URLs: ${urlIdToDiscogsId.size.toLocaleString()}`);
  console.log(`  MB releases: ${releaseIdToMbid.size.toLocaleString()}`);
  console.log(`  l_release_url triples: ${relUrlTriples.length.toLocaleString()}`);

  // --- Join: discogs_id → mbid ---
  // A valid mapping requires:
  //   1. l_release_url.link is in discogsLinkIds (correct relationship type)
  //   2. l_release_url.entity1 (url.id) maps to a Discogs release URL
  //   3. l_release_url.entity0 (release.id) maps to an MBID
  console.log("[mb-import] Joining...");
  const mappings: Array<{ discogsId: number; mbid: string }> = [];
  const seen = new Set<number>();
  const seenMbid = new Set<string>();
  let skippedLink = 0;
  let skippedUrl = 0;
  let skippedMbid = 0;

  for (const [linkId, releaseId, urlId] of relUrlTriples) {
    if (!discogsLinkIds.has(linkId)) { skippedLink++; continue; }
    const discogsId = urlIdToDiscogsId.get(urlId);
    if (discogsId === undefined) { skippedUrl++; continue; }
    const mbid = releaseIdToMbid.get(releaseId);
    if (!mbid) { skippedMbid++; continue; }
    if (discogsId > 2_147_483_647) continue; // exceeds int32 — bogus URL
    if (seen.has(discogsId)) continue;
    if (seenMbid.has(mbid)) continue; // multiple Discogs releases can share one MBID
    seen.add(discogsId);
    seenMbid.add(mbid);
    mappings.push({ discogsId, mbid });
  }

  console.log(`[mb-import] Matched: ${mappings.length.toLocaleString()}`);
  console.log(`  Skipped (wrong link type): ${skippedLink.toLocaleString()}`);
  console.log(`  Skipped (no Discogs URL): ${skippedUrl.toLocaleString()}`);
  console.log(`  Skipped (no MBID): ${skippedMbid.toLocaleString()}`);

  if (mappings.length === 0) {
    console.log("[mb-import] No mappings. Exiting.");
    await db.destroy();
    return;
  }

  // --- Create enrichment batch ---
  const batchKey = `musicbrainz-${new Date().toISOString().slice(0, 7)}`;
  await sql`
    INSERT INTO enrich.ingest_batches (source, source_batch_key, status, started_at)
    VALUES ('musicbrainz', ${batchKey}, 'importing', now())
    ON CONFLICT (source, source_batch_key)
    DO UPDATE SET status = 'importing', started_at = now()
  `.execute(db);

  const { rows } = await sql<{ id: number }>`
    SELECT id FROM enrich.ingest_batches
    WHERE source = 'musicbrainz' AND source_batch_key = ${batchKey}
  `.execute(db);
  const batchId = rows[0]?.id ?? null;

  // --- Batch write to enrich.release_crosswalks ---
  console.log(`[mb-import] Writing ${mappings.length.toLocaleString()} crosswalks...`);
  let written = 0;

  for (let i = 0; i < mappings.length; i += BATCH_SIZE) {
    const chunk = mappings.slice(i, i + BATCH_SIZE);
    const values = chunk.map(
      (m) => sql`(${m.discogsId}, ${m.mbid}, 1.000, 'musicbrainz_url', TRUE, ${batchId})`
    );

    await sql`
      INSERT INTO enrich.release_crosswalks
        (discogs_release_id, mbid, confidence, match_method, is_verified, source_batch_id)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (discogs_release_id) DO UPDATE SET
        mbid = EXCLUDED.mbid,
        confidence = EXCLUDED.confidence,
        match_method = EXCLUDED.match_method,
        is_verified = EXCLUDED.is_verified,
        source_batch_id = EXCLUDED.source_batch_id,
        updated_at = now()
    `.execute(db);

    written += chunk.length;
    if (written % 50_000 === 0 || written === mappings.length) {
      console.log(`[mb-import] ${written.toLocaleString()} / ${mappings.length.toLocaleString()}`);
    }
  }

  // --- Finalize batch ---
  await sql`
    UPDATE enrich.ingest_batches
    SET status = 'active', completed_at = now(),
        stats = ${JSON.stringify({ total_mappings: mappings.length, written })}::jsonb
    WHERE id = ${batchId ?? 0}
  `.execute(db);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[mb-import] Done. ${written.toLocaleString()} crosswalks in ${elapsed}s.`);
  await db.destroy();
}

main().catch((err) => {
  console.error("[mb-import] Fatal:", err);
  process.exit(1);
});
