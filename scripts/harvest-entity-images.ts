#!/usr/bin/env npx tsx
/**
 * Wikidata image harvester for labels and artists.
 *
 * Two phases, both idempotent:
 *
 *  PHASE 1  (--phase=crosswalks)
 *    Copy in-scope crosswalk slices (Wikidata QIDs + MBIDs) from the
 *    SOURCE_URL database (dig-db full catalog) into the TARGET_URL
 *    database (dig-db-scene). Keeps the harvester self-contained on the
 *    target DB after this runs.
 *
 *  PHASE 2  (--phase=images)
 *    Walk in-scope crosswalks on the target DB, batch QIDs (~50 at a
 *    time), hit Wikidata SPARQL for P18 (image) and P154 (logo image),
 *    upsert into enrich.entity_images.
 *
 *  --phase=all (default) runs both in order.
 *
 * Image URLs are stored as Wikimedia "Special:FilePath" URLs, which the
 * Wikipedia/Commons CDN serves directly and supports auto-thumbnailing
 * via ?width=… The API image proxy resolves the final binary URL with
 * Redis caching (mirroring the Cover Art Archive cover proxy pattern).
 *
 * Usage (local):
 *   SOURCE_URL=postgresql://postgres:<pass>@localhost:15432/dig \
 *   TARGET_URL=postgresql://postgres:<pass>@localhost:15433/dig \
 *     npx tsx scripts/harvest-entity-images.ts --phase=all
 *
 * Useful flags:
 *   --phase=crosswalks|images|all   default: all
 *   --entity=label|artist|both       default: both
 *   --batch=50                       SPARQL batch size (max 100)
 *   --max=NUMBER                     cap entities per entity-type (debug)
 *   --rate-ms=1100                   sleep between SPARQL calls (Wikidata
 *                                    asks for 1 req/sec, we use 1.1s)
 *   --resume                         skip entities already in entity_images
 */

import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { Database } from "../packages/db/src/schema.js";

interface Args {
  phase: "crosswalks" | "images" | "all";
  entity: "label" | "artist" | "both";
  batch: number;
  max: number | null;
  rateMs: number;
  resume: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    phase: "all",
    entity: "both",
    batch: 50,
    max: null,
    rateMs: 1100,
    resume: true,
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--phase=")) args.phase = a.slice(8) as Args["phase"];
    else if (a.startsWith("--entity=")) args.entity = a.slice(9) as Args["entity"];
    else if (a.startsWith("--batch=")) args.batch = Math.min(100, Math.max(1, parseInt(a.slice(8), 10)));
    else if (a.startsWith("--max=")) args.max = parseInt(a.slice(6), 10);
    else if (a.startsWith("--rate-ms=")) args.rateMs = Math.max(0, parseInt(a.slice(10), 10));
    else if (a === "--no-resume") args.resume = false;
    else if (a === "--resume") args.resume = true;
    else if (a === "--help" || a === "-h") {
      console.log(`harvest-entity-images.ts — see file header for docs`);
      process.exit(0);
    }
  }
  return args;
}

function makeDb(url: string): { db: Kysely<Database>; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 60_000 });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  return { db, pool };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- PHASE 1 ----------------------------------------------------------------
//
// Copy in-scope crosswalks from source → target. We stream rows in chunks of
// 5_000 IDs at a time and INSERT … ON CONFLICT DO UPDATE so re-runs are safe.

async function phaseCrosswalks(source: Kysely<Database>, target: Kysely<Database>, entity: Args["entity"]) {
  if (entity === "label" || entity === "both") {
    await copyLabelCrosswalks(source, target);
  }
  if (entity === "artist" || entity === "both") {
    await copyArtistCrosswalks(source, target);
  }
}

async function copyLabelCrosswalks(source: Kysely<Database>, target: Kysely<Database>) {
  console.log("[crosswalks] copying label crosswalks for in-scope labels…");
  const t0 = Date.now();
  const inScope = await sql<{ discogs_id: number }>`
    SELECT discogs_id FROM catalog.labels
  `.execute(target);
  const ids = inScope.rows.map((r) => r.discogs_id);
  console.log(`  in-scope labels: ${ids.length.toLocaleString()}`);

  let inserted = 0;
  for (let i = 0; i < ids.length; i += 5_000) {
    const slice = ids.slice(i, i + 5_000);
    const rows = await sql<{
      discogs_label_id: number;
      mbid: string | null;
      wikidata_qid: string | null;
      confidence: string;
      match_method: string;
      is_verified: boolean;
    }>`
      SELECT discogs_label_id, mbid, wikidata_qid, confidence, match_method, is_verified
      FROM enrich.label_crosswalks
      WHERE discogs_label_id = ANY(${slice})
    `.execute(source);
    if (rows.rows.length === 0) continue;

    const valueTuples = rows.rows.map(
      (r) =>
        sql`(${r.discogs_label_id}, ${r.mbid}, ${r.wikidata_qid}, ${Number(r.confidence)}, ${r.match_method}, ${r.is_verified})`,
    );
    await sql`
      INSERT INTO enrich.label_crosswalks
        (discogs_label_id, mbid, wikidata_qid, confidence, match_method, is_verified)
      VALUES ${sql.join(valueTuples, sql`, `)}
      ON CONFLICT (discogs_label_id) DO UPDATE
        SET mbid = EXCLUDED.mbid,
            wikidata_qid = EXCLUDED.wikidata_qid,
            confidence = EXCLUDED.confidence,
            match_method = EXCLUDED.match_method,
            is_verified = EXCLUDED.is_verified,
            updated_at = now()
    `.execute(target);
    inserted += rows.rows.length;
  }
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${inserted.toLocaleString()} rows upserted`);
}

async function copyArtistCrosswalks(source: Kysely<Database>, target: Kysely<Database>) {
  console.log("[crosswalks] copying artist crosswalks for in-scope artists…");
  const t0 = Date.now();
  const inScope = await sql<{ discogs_id: number }>`
    SELECT discogs_id FROM catalog.artists
  `.execute(target);
  const ids = inScope.rows.map((r) => r.discogs_id);
  console.log(`  in-scope artists: ${ids.length.toLocaleString()}`);

  let inserted = 0;
  for (let i = 0; i < ids.length; i += 5_000) {
    const slice = ids.slice(i, i + 5_000);
    const rows = await sql<{
      discogs_artist_id: number;
      mbid: string | null;
      wikidata_qid: string | null;
      setlistfm_artist_id: string | null;
      confidence: string;
      match_method: string;
      is_verified: boolean;
    }>`
      SELECT discogs_artist_id, mbid, wikidata_qid, setlistfm_artist_id,
             confidence, match_method, is_verified
      FROM enrich.artist_crosswalks
      WHERE discogs_artist_id = ANY(${slice})
    `.execute(source);
    if (rows.rows.length === 0) continue;

    const valueTuples = rows.rows.map(
      (r) =>
        sql`(${r.discogs_artist_id}, ${r.mbid}, ${r.wikidata_qid}, ${r.setlistfm_artist_id}, ${Number(r.confidence)}, ${r.match_method}, ${r.is_verified})`,
    );
    await sql`
      INSERT INTO enrich.artist_crosswalks
        (discogs_artist_id, mbid, wikidata_qid, setlistfm_artist_id,
         confidence, match_method, is_verified)
      VALUES ${sql.join(valueTuples, sql`, `)}
      ON CONFLICT (discogs_artist_id) DO UPDATE
        SET mbid = EXCLUDED.mbid,
            wikidata_qid = EXCLUDED.wikidata_qid,
            setlistfm_artist_id = EXCLUDED.setlistfm_artist_id,
            confidence = EXCLUDED.confidence,
            match_method = EXCLUDED.match_method,
            is_verified = EXCLUDED.is_verified,
            updated_at = now()
    `.execute(target);
    inserted += rows.rows.length;
    if (i % 50_000 === 0 && i > 0) {
      console.log(`    …${i.toLocaleString()} processed, ${inserted.toLocaleString()} rows upserted`);
    }
  }
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${inserted.toLocaleString()} rows upserted`);
}

// --- PHASE 2 ----------------------------------------------------------------
//
// SPARQL harvest. Wikidata's public endpoint accepts SPARQL over GET. We use
// VALUES bindings to fetch P18 (image) and P154 (logo image) plus a few
// optional credit/license hints in one shot.

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "Dig/2.0 (https://dig.baby; hello@dig.baby) harvest-entity-images";
const COMMONS_FILEPATH = "https://commons.wikimedia.org/wiki/Special:FilePath/";

interface SparqlImageRow {
  qid: string;
  image: string | null;
  logo: string | null;
}

async function sparqlBatch(qids: string[]): Promise<SparqlImageRow[]> {
  // VALUES bindings: wd:Q1 wd:Q2 …
  const values = qids.map((q) => `wd:${q}`).join(" ");
  const query = `
    SELECT ?qid ?image ?logo WHERE {
      VALUES ?qid { ${values} }
      OPTIONAL { ?qid wdt:P18 ?image. }
      OPTIONAL { ?qid wdt:P154 ?logo. }
    }
  `;
  const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SPARQL ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    results: { bindings: Array<{ qid: { value: string }; image?: { value: string }; logo?: { value: string } }> };
  };
  // qid value is "http://www.wikidata.org/entity/Q1234"; reduce to Q1234.
  return json.results.bindings.map((b) => ({
    qid: b.qid.value.replace(/.*\//, ""),
    image: b.image?.value ?? null,
    logo: b.logo?.value ?? null,
  }));
}

// Wikidata returns image URLs as direct Special:FilePath links to Commons.
// We normalise to the Commons CDN form and let the proxy auto-thumbnail.
function normaliseCommonsUrl(raw: string): string {
  if (!raw) return raw;
  // Already a FilePath URL → keep as-is.
  if (raw.includes("Special:FilePath/")) return raw;
  // Bare Commons file URL: convert to Special:FilePath form for the proxy.
  const match = raw.match(/\/wiki\/(File:[^/]+)$/i);
  if (match) return `${COMMONS_FILEPATH}${decodeURIComponent(match[1].slice(5))}`;
  return raw;
}

interface ImageInsert {
  entity_type: "label" | "artist";
  discogs_id: number;
  image_kind: "logo" | "photo" | "hero";
  source: "wikidata";
  source_id: string;
  source_url: string;
  attribution: string;
  license: string | null;
}

async function upsertImages(db: Kysely<Database>, rows: ImageInsert[]) {
  if (rows.length === 0) return;
  // Wikidata can return multiple P18 values per QID, and our image_kind
  // mapping collapses them into the same target row. Dedup within the
  // batch so ON CONFLICT only sees each unique key once (Postgres errors
  // 21000 otherwise: "command cannot affect row a second time").
  const dedup = new Map<string, ImageInsert>();
  for (const r of rows) {
    const key = `${r.entity_type}|${r.discogs_id}|${r.image_kind}`;
    if (!dedup.has(key)) dedup.set(key, r);
  }
  const unique = [...dedup.values()];
  const valueTuples = unique.map(
    (r) =>
      sql`(${r.entity_type}, ${r.discogs_id}, ${r.image_kind}, ${r.source}, ${r.source_id}, ${r.source_url}, ${r.attribution}, ${r.license})`,
  );
  await sql`
    INSERT INTO enrich.entity_images
      (entity_type, discogs_id, image_kind, source, source_id, source_url, attribution, license)
    VALUES ${sql.join(valueTuples, sql`, `)}
    ON CONFLICT (entity_type, discogs_id, image_kind) DO UPDATE
      SET source = EXCLUDED.source,
          source_id = EXCLUDED.source_id,
          source_url = EXCLUDED.source_url,
          attribution = EXCLUDED.attribution,
          license = EXCLUDED.license,
          updated_at = now()
  `.execute(db);
}

async function harvestEntity(
  db: Kysely<Database>,
  entityType: "label" | "artist",
  args: Args,
) {
  // Fetch QIDs for this entity that we haven't already harvested (when --resume).
  const tableRef = entityType === "label" ? sql`enrich.label_crosswalks` : sql`enrich.artist_crosswalks`;
  const idColRef = entityType === "label" ? sql.ref("discogs_label_id") : sql.ref("discogs_artist_id");
  const resumeFilter = args.resume
    ? sql`AND NOT EXISTS (
            SELECT 1 FROM enrich.entity_images ei
            WHERE ei.entity_type = ${entityType}
              AND ei.discogs_id = c.${idColRef}
              AND ei.source = 'wikidata'
          )`
    : sql``;
  const limitClause = args.max ? sql`LIMIT ${sql.lit(args.max)}` : sql``;

  const { rows } = await sql<{ discogs_id: number; qid: string }>`
    SELECT c.${idColRef} AS discogs_id, c.wikidata_qid AS qid
    FROM ${tableRef} c
    WHERE c.wikidata_qid IS NOT NULL
      ${resumeFilter}
    ORDER BY c.${idColRef}
    ${limitClause}
  `.execute(db);

  console.log(`[images:${entityType}] ${rows.length.toLocaleString()} QIDs to harvest`);
  if (rows.length === 0) return { harvested: 0, withImage: 0 };

  // QID → discogs_id may be 1:1 (the unique constraint enforces it),
  // but build a lookup just in case.
  const qidToDiscogs = new Map<string, number>();
  for (const r of rows) qidToDiscogs.set(r.qid, r.discogs_id);

  let processed = 0;
  let withImage = 0;
  const batches: string[][] = [];
  for (let i = 0; i < rows.length; i += args.batch) {
    batches.push(rows.slice(i, i + args.batch).map((r) => r.qid));
  }
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    let attempt = 0;
    let resBatch: SparqlImageRow[] = [];
    while (true) {
      try {
        resBatch = await sparqlBatch(batch);
        break;
      } catch (err) {
        attempt++;
        const wait = Math.min(60_000, 1500 * attempt * attempt);
        console.warn(`  SPARQL error (attempt ${attempt}): ${(err as Error).message} — sleeping ${wait}ms`);
        if (attempt >= 5) throw err;
        await sleep(wait);
      }
    }
    const inserts: ImageInsert[] = [];
    for (const row of resBatch) {
      const discogsId = qidToDiscogs.get(row.qid);
      if (!discogsId) continue;
      const photoUrl = row.image ? normaliseCommonsUrl(row.image) : null;
      const logoUrl = row.logo ? normaliseCommonsUrl(row.logo) : null;
      const attribution = `Image from Wikimedia Commons via Wikidata (${row.qid})`;
      // For labels we prefer P154 as logo; P18 as hero/photo.
      // For artists P18 is the portrait — we record as 'photo'.
      if (entityType === "label") {
        if (logoUrl) {
          inserts.push({
            entity_type: "label", discogs_id: discogsId, image_kind: "logo",
            source: "wikidata", source_id: row.qid, source_url: logoUrl,
            attribution, license: "see-commons",
          });
          withImage++;
        }
        if (photoUrl) {
          inserts.push({
            entity_type: "label", discogs_id: discogsId, image_kind: "hero",
            source: "wikidata", source_id: row.qid, source_url: photoUrl,
            attribution, license: "see-commons",
          });
          if (!logoUrl) withImage++;
        }
      } else {
        if (photoUrl) {
          inserts.push({
            entity_type: "artist", discogs_id: discogsId, image_kind: "photo",
            source: "wikidata", source_id: row.qid, source_url: photoUrl,
            attribution, license: "see-commons",
          });
          withImage++;
        }
        if (logoUrl) {
          // Some bands have a P154 logo too; use as 'logo' kind.
          inserts.push({
            entity_type: "artist", discogs_id: discogsId, image_kind: "logo",
            source: "wikidata", source_id: row.qid, source_url: logoUrl,
            attribution, license: "see-commons",
          });
        }
      }
    }
    if (inserts.length > 0) {
      await upsertImages(db, inserts);
    }
    processed += batch.length;
    if (bi % 10 === 0 || bi === batches.length - 1) {
      console.log(
        `  batch ${bi + 1}/${batches.length} — processed ${processed.toLocaleString()}, with image ${withImage.toLocaleString()}`,
      );
    }
    if (bi < batches.length - 1) await sleep(args.rateMs);
  }
  return { harvested: processed, withImage };
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const sourceUrl = process.env.SOURCE_URL ?? "";
  const targetUrl = process.env.TARGET_URL ?? process.env.DATABASE_URL ?? "";
  if (!targetUrl) {
    console.error("TARGET_URL (or DATABASE_URL) must be set");
    process.exit(2);
  }
  if ((args.phase === "crosswalks" || args.phase === "all") && !sourceUrl) {
    console.error("SOURCE_URL must be set for --phase=crosswalks or --phase=all");
    process.exit(2);
  }

  console.log(`harvest-entity-images: phase=${args.phase} entity=${args.entity}`);
  console.log(`  target: ${targetUrl.replace(/:[^:@]+@/, ":***@")}`);
  if (sourceUrl) console.log(`  source: ${sourceUrl.replace(/:[^:@]+@/, ":***@")}`);

  const { db: target, pool: targetPool } = makeDb(targetUrl);
  const sourceConn = sourceUrl ? makeDb(sourceUrl) : null;

  try {
    if (args.phase === "crosswalks" || args.phase === "all") {
      await phaseCrosswalks(sourceConn!.db, target, args.entity);
    }
    if (args.phase === "images" || args.phase === "all") {
      if (args.entity === "label" || args.entity === "both") {
        const r = await harvestEntity(target, "label", args);
        console.log(`  labels: harvested=${r.harvested}, with_image=${r.withImage}`);
      }
      if (args.entity === "artist" || args.entity === "both") {
        const r = await harvestEntity(target, "artist", args);
        console.log(`  artists: harvested=${r.harvested}, with_image=${r.withImage}`);
      }
    }
  } finally {
    await target.destroy();
    if (sourceConn) await sourceConn.db.destroy();
    void targetPool;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
