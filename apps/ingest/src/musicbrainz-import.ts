/**
 * MusicBrainz crosswalk import CLI.
 *
 * Parses mbdump.tar.bz2 to extract Discogs↔MusicBrainz crosswalks
 * and writes them to enrich.release_crosswalks and enrich.artist_crosswalks.
 *
 * Usage:
 *   pnpm --filter @dig/ingest musicbrainz -- --file ./mbdump.tar.bz2
 *   pnpm --filter @dig/ingest musicbrainz -- --file ./mbdump.tar.bz2 --entity artists
 *   pnpm --filter @dig/ingest musicbrainz -- --file ./mbdump.tar.bz2 --entity releases
 *
 * The dump can be downloaded from:
 *   https://metabrainz.org/datasets/postgres-dumps
 *
 * Only needs mbdump.tar.bz2 (~5-7GB compressed, CC0 licensed).
 * Streams tables: link_type, link, url, release, artist, l_release_url, l_artist_url.
 * Joins in memory, then writes to enrich.*_crosswalks in batches.
 *
 * Artist crosswalks also extract Wikidata QIDs from MB's artist↔wikidata URL links.
 *
 * Requires `bzcat` on PATH (macOS/Linux have it by default).
 */

import { spawn } from "node:child_process";
import { createDb, sql } from "@dig/db";
import * as tar from "tar-stream";

type EntityMode = "releases" | "artists" | "all";

const BATCH_SIZE = 500;

// URL regex patterns
const DISCOGS_RELEASE_URL_RE = /\/release\/(\d+)/;
const DISCOGS_ARTIST_URL_RE = /\/artist\/(\d+)/;
const WIKIDATA_URL_RE = /wikidata\.org\/(?:wiki\/|entity\/)(Q\d+)/;

// MusicBrainz link_type GIDs (stable, documented at https://musicbrainz.org/relationships)
const DISCOGS_RELEASE_LINK_TYPE_GID = "4a78823c-1c53-4176-a5f3-58026c76f2bc";
const DISCOGS_ARTIST_LINK_TYPE_GID = "04a5b104-a4c2-4bac-99a1-7b837c37d9e4";
const WIKIDATA_ARTIST_LINK_TYPE_GID = "689870a4-a1e4-4912-b17f-7b2664215698";

function parseArgs(): { file: string; databaseUrl: string; entity: EntityMode } {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let file = "";
  let entity: EntityMode = "all";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) file = args[++i];
    if (args[i] === "--entity" && args[i + 1]) {
      const v = args[++i];
      if (v === "releases" || v === "artists" || v === "all") entity = v;
      else {
        console.error("Invalid --entity value. Use: releases | artists | all");
        process.exit(1);
      }
    }
  }
  if (!file) {
    console.error("Usage: pnpm --filter @dig/ingest musicbrainz -- --file ./mbdump.tar.bz2 [--entity releases|artists|all]");
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL env var required");
    process.exit(1);
  }
  return { file, databaseUrl, entity };
}

function computeTablesNeeded(entity: EntityMode): string[] {
  const base = ["link_type", "link", "url"];
  if (entity === "releases") return [...base, "release", "l_release_url"];
  if (entity === "artists") return [...base, "artist", "l_artist_url"];
  return [...base, "release", "l_release_url", "artist", "l_artist_url"];
}

async function createBatch(db: ReturnType<typeof createDb>, batchKey: string): Promise<number | null> {
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
  return rows[0]?.id ?? null;
}

async function finalizeBatch(db: ReturnType<typeof createDb>, batchId: number | null, stats: Record<string, unknown>): Promise<void> {
  await sql`
    UPDATE enrich.ingest_batches
    SET status = 'active', completed_at = now(),
        stats = ${JSON.stringify(stats)}::jsonb
    WHERE id = ${batchId ?? 0}
  `.execute(db);
}

async function main() {
  const { file, databaseUrl, entity } = parseArgs();
  const db = createDb(databaseUrl);
  const tablesNeeded = computeTablesNeeded(entity);
  const doReleases = entity === "releases" || entity === "all";
  const doArtists = entity === "artists" || entity === "all";

  console.log(`[mb-import] Starting import from ${file} (entity: ${entity})`);
  console.log(`[mb-import] Tables needed: ${tablesNeeded.join(", ")}`);
  const t0 = Date.now();

  // --- In-memory lookup maps ---
  // link_type GID → link_type internal ID (discovered during parse)
  let discogsReleaseLinkTypeId: number | null = null;
  let discogsArtistLinkTypeId: number | null = null;
  let wikidataArtistLinkTypeId: number | null = null;

  // link.id → link.link_type
  const linkIdToLinkType = new Map<number, number>();

  // URL maps
  const urlIdToDiscogsReleaseId = new Map<number, number>();
  const urlIdToDiscogsArtistId = new Map<number, number>();
  const urlIdToWikidataQid = new Map<number, string>();

  // Entity maps
  const releaseIdToMbid = new Map<number, string>();
  const artistIdToMbid = new Map<number, string>();

  // Triples: [linkId, entityId, urlId]
  const relUrlTriples: Array<[number, number, number]> = [];
  const artUrlTriples: Array<[number, number, number]> = [];

  const filesProcessed = new Set<string>();

  // --- Stream tar.bz2 via bzcat → tar-stream ---
  const extract = tar.extract();

  extract.on("entry", (header, stream, next) => {
    const name = header.name.replace(/^mbdump\//, "");
    if (!tablesNeeded.includes(name)) {
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
            const gid = f[3];
            const id = parseInt(f[0], 10);
            if (gid === DISCOGS_RELEASE_LINK_TYPE_GID) {
              discogsReleaseLinkTypeId = id;
              console.log(`[mb-import] Discogs release link_type id: ${id}`);
            }
            if (gid === DISCOGS_ARTIST_LINK_TYPE_GID) {
              discogsArtistLinkTypeId = id;
              console.log(`[mb-import] Discogs artist link_type id: ${id}`);
            }
            if (gid === WIKIDATA_ARTIST_LINK_TYPE_GID) {
              wikidataArtistLinkTypeId = id;
              console.log(`[mb-import] Wikidata artist link_type id: ${id}`);
            }
            break;
          }
          case "link": {
            linkIdToLinkType.set(parseInt(f[0], 10), parseInt(f[1], 10));
            break;
          }
          case "url": {
            const url = f[2];
            if (!url) break;
            if (doReleases && url.includes("discogs.com/release/")) {
              const m = url.match(DISCOGS_RELEASE_URL_RE);
              if (m) urlIdToDiscogsReleaseId.set(parseInt(f[0], 10), parseInt(m[1], 10));
            }
            if (doArtists && url.includes("discogs.com/artist/")) {
              const m = url.match(DISCOGS_ARTIST_URL_RE);
              if (m) urlIdToDiscogsArtistId.set(parseInt(f[0], 10), parseInt(m[1], 10));
            }
            if (doArtists && url.includes("wikidata.org/")) {
              const m = url.match(WIKIDATA_URL_RE);
              if (m) urlIdToWikidataQid.set(parseInt(f[0], 10), m[1]);
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
          case "artist": {
            const gid = f[1];
            if (gid && gid.length === 36) {
              artistIdToMbid.set(parseInt(f[0], 10), gid);
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
          case "l_artist_url": {
            // columns: id, link, entity0(artist), entity1(url), ...
            artUrlTriples.push([
              parseInt(f[1], 10), // link id
              parseInt(f[2], 10), // artist.id (MB internal)
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
  const missing = tablesNeeded.filter((t) => !filesProcessed.has(t));
  if (missing.length) {
    console.error(`[mb-import] Missing tables: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(`[mb-import] Maps built:`);
  console.log(`  Total links: ${linkIdToLinkType.size.toLocaleString()}`);
  if (doReleases) {
    console.log(`  Discogs release URLs: ${urlIdToDiscogsReleaseId.size.toLocaleString()}`);
    console.log(`  MB releases: ${releaseIdToMbid.size.toLocaleString()}`);
    console.log(`  l_release_url triples: ${relUrlTriples.length.toLocaleString()}`);
  }
  if (doArtists) {
    console.log(`  Discogs artist URLs: ${urlIdToDiscogsArtistId.size.toLocaleString()}`);
    console.log(`  Wikidata URLs: ${urlIdToWikidataQid.size.toLocaleString()}`);
    console.log(`  MB artists: ${artistIdToMbid.size.toLocaleString()}`);
    console.log(`  l_artist_url triples: ${artUrlTriples.length.toLocaleString()}`);
  }

  // ========================
  // RELEASE CROSSWALKS
  // ========================
  if (doReleases) {
    if (discogsReleaseLinkTypeId === null) {
      console.error("[mb-import] Discogs release link_type not found in dump");
      process.exit(1);
    }

    const discogsReleaseLinkIds = new Set<number>();
    for (const [linkId, linkType] of linkIdToLinkType) {
      if (linkType === discogsReleaseLinkTypeId) discogsReleaseLinkIds.add(linkId);
    }
    console.log(`[mb-import] Discogs release link IDs: ${discogsReleaseLinkIds.size.toLocaleString()}`);

    console.log("[mb-import] Joining release crosswalks...");
    const relMappings: Array<{ discogsId: number; mbid: string }> = [];
    const seenRel = new Set<number>();
    const seenRelMbid = new Set<string>();
    let skRelLink = 0, skRelUrl = 0, skRelMbid = 0;

    for (const [linkId, releaseId, urlId] of relUrlTriples) {
      if (!discogsReleaseLinkIds.has(linkId)) { skRelLink++; continue; }
      const discogsId = urlIdToDiscogsReleaseId.get(urlId);
      if (discogsId === undefined) { skRelUrl++; continue; }
      const mbid = releaseIdToMbid.get(releaseId);
      if (!mbid) { skRelMbid++; continue; }
      if (discogsId > 2_147_483_647) continue;
      if (seenRel.has(discogsId)) continue;
      if (seenRelMbid.has(mbid)) continue;
      seenRel.add(discogsId);
      seenRelMbid.add(mbid);
      relMappings.push({ discogsId, mbid });
    }

    console.log(`[mb-import] Release matches: ${relMappings.length.toLocaleString()}`);
    console.log(`  Skipped (wrong link): ${skRelLink.toLocaleString()}, (no URL): ${skRelUrl.toLocaleString()}, (no MBID): ${skRelMbid.toLocaleString()}`);

    if (relMappings.length > 0) {
      const batchKey = `musicbrainz-releases-${new Date().toISOString().slice(0, 7)}`;
      const batchId = await createBatch(db, batchKey);

      console.log(`[mb-import] Writing ${relMappings.length.toLocaleString()} release crosswalks...`);
      let written = 0;
      for (let i = 0; i < relMappings.length; i += BATCH_SIZE) {
        const chunk = relMappings.slice(i, i + BATCH_SIZE);
        const values = chunk.map(
          (m) => sql`(${m.discogsId}, ${m.mbid}, 1.000, 'musicbrainz_url', TRUE, ${batchId})`
        );
        await sql`
          INSERT INTO enrich.release_crosswalks
            (discogs_release_id, mbid, confidence, match_method, is_verified, source_batch_id)
          VALUES ${sql.join(values, sql`, `)}
          ON CONFLICT (discogs_release_id) DO UPDATE SET
            mbid = EXCLUDED.mbid, confidence = EXCLUDED.confidence,
            match_method = EXCLUDED.match_method, is_verified = EXCLUDED.is_verified,
            source_batch_id = EXCLUDED.source_batch_id, updated_at = now()
        `.execute(db);
        written += chunk.length;
        if (written % 50_000 === 0 || written === relMappings.length) {
          console.log(`[mb-import] Releases: ${written.toLocaleString()} / ${relMappings.length.toLocaleString()}`);
        }
      }
      await finalizeBatch(db, batchId, { total_mappings: relMappings.length, written });
      console.log(`[mb-import] Release crosswalks done: ${written.toLocaleString()}`);
    }
  }

  // ========================
  // ARTIST CROSSWALKS
  // ========================
  if (doArtists) {
    if (discogsArtistLinkTypeId === null) {
      console.error("[mb-import] Discogs artist link_type not found in dump");
      process.exit(1);
    }

    // Build link ID sets for artist-discogs and artist-wikidata
    const discogsArtistLinkIds = new Set<number>();
    const wikidataArtistLinkIds = new Set<number>();
    for (const [linkId, linkType] of linkIdToLinkType) {
      if (linkType === discogsArtistLinkTypeId) discogsArtistLinkIds.add(linkId);
      if (wikidataArtistLinkTypeId !== null && linkType === wikidataArtistLinkTypeId) wikidataArtistLinkIds.add(linkId);
    }
    console.log(`[mb-import] Discogs artist link IDs: ${discogsArtistLinkIds.size.toLocaleString()}`);
    console.log(`[mb-import] Wikidata artist link IDs: ${wikidataArtistLinkIds.size.toLocaleString()}`);

    // Phase 1: Build discogsArtistId → mbid from l_artist_url (discogs links)
    console.log("[mb-import] Joining artist crosswalks (discogs)...");
    const artistMappings = new Map<number, { discogsId: number; mbid: string }>();
    const seenArtMbid = new Set<string>();
    // Also build mbArtistId → discogsId for wikidata resolution
    const mbArtistIdToDiscogsId = new Map<number, number>();
    let skArtLink = 0, skArtUrl = 0, skArtMbid = 0;

    for (const [linkId, artistId, urlId] of artUrlTriples) {
      if (!discogsArtistLinkIds.has(linkId)) continue;
      const discogsId = urlIdToDiscogsArtistId.get(urlId);
      if (discogsId === undefined) { skArtUrl++; continue; }
      if (discogsId > 2_147_483_647) continue;
      const mbid = artistIdToMbid.get(artistId);
      if (!mbid) { skArtMbid++; continue; }
      if (artistMappings.has(discogsId)) continue;
      if (seenArtMbid.has(mbid)) continue;
      seenArtMbid.add(mbid);
      artistMappings.set(discogsId, { discogsId, mbid });
      mbArtistIdToDiscogsId.set(artistId, discogsId);
    }

    console.log(`[mb-import] Artist discogs matches: ${artistMappings.size.toLocaleString()}`);
    console.log(`  Skipped (no URL): ${skArtUrl.toLocaleString()}, (no MBID): ${skArtMbid.toLocaleString()}`);

    // Phase 2: Enrich with Wikidata QIDs from l_artist_url (wikidata links)
    console.log("[mb-import] Resolving Wikidata QIDs...");
    const wikidataByDiscogsId = new Map<number, string>();
    const seenQid = new Set<string>();
    let wdMatched = 0, wdSkipped = 0;

    for (const [linkId, artistId, urlId] of artUrlTriples) {
      if (!wikidataArtistLinkIds.has(linkId)) continue;
      const qid = urlIdToWikidataQid.get(urlId);
      if (!qid) continue;
      const discogsId = mbArtistIdToDiscogsId.get(artistId);
      if (discogsId === undefined) { wdSkipped++; continue; }
      if (seenQid.has(qid)) { wdSkipped++; continue; } // unique index safety
      if (wikidataByDiscogsId.has(discogsId)) continue;
      seenQid.add(qid);
      wikidataByDiscogsId.set(discogsId, qid);
      wdMatched++;
    }

    console.log(`[mb-import] Wikidata QIDs resolved: ${wdMatched.toLocaleString()} (skipped: ${wdSkipped.toLocaleString()})`);

    if (artistMappings.size > 0) {
      const batchKey = `musicbrainz-artists-${new Date().toISOString().slice(0, 7)}`;
      const batchId = await createBatch(db, batchKey);

      const artistRows = Array.from(artistMappings.values());
      console.log(`[mb-import] Writing ${artistRows.length.toLocaleString()} artist crosswalks...`);
      let written = 0;

      for (let i = 0; i < artistRows.length; i += BATCH_SIZE) {
        const chunk = artistRows.slice(i, i + BATCH_SIZE);
        const values = chunk.map((m) => {
          const qid = wikidataByDiscogsId.get(m.discogsId) ?? null;
          return sql`(${m.discogsId}, ${m.mbid}, ${qid}, 1.000, 'musicbrainz_url', TRUE, ${batchId})`;
        });

        await sql`
          INSERT INTO enrich.artist_crosswalks
            (discogs_artist_id, mbid, wikidata_qid, confidence, match_method, is_verified, source_batch_id)
          VALUES ${sql.join(values, sql`, `)}
          ON CONFLICT (discogs_artist_id) DO UPDATE SET
            mbid = EXCLUDED.mbid,
            wikidata_qid = COALESCE(EXCLUDED.wikidata_qid, enrich.artist_crosswalks.wikidata_qid),
            confidence = EXCLUDED.confidence,
            match_method = EXCLUDED.match_method,
            is_verified = EXCLUDED.is_verified,
            source_batch_id = EXCLUDED.source_batch_id,
            updated_at = now()
        `.execute(db);

        written += chunk.length;
        if (written % 50_000 === 0 || written === artistRows.length) {
          console.log(`[mb-import] Artists: ${written.toLocaleString()} / ${artistRows.length.toLocaleString()}`);
        }
      }

      await finalizeBatch(db, batchId, {
        total_artist_mappings: artistMappings.size,
        with_wikidata_qid: wdMatched,
        written,
      });
      console.log(`[mb-import] Artist crosswalks done: ${written.toLocaleString()} (${wdMatched.toLocaleString()} with Wikidata QID)`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[mb-import] All done in ${elapsed}s.`);
  await db.destroy();
}

main().catch((err) => {
  console.error("[mb-import] Fatal:", err);
  process.exit(1);
});
