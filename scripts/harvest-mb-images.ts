#!/usr/bin/env npx tsx
/**
 * MusicBrainz URL-relationships image harvester (fallback after Wikidata).
 *
 * The Wikidata harvester (scripts/harvest-entity-images.ts) covers entities
 * with a Wikidata QID *and* a P18/P154 statement. That leaves a long tail of
 * in-scope entities that:
 *   - have an MBID but no QID (some never made it to Wikidata), OR
 *   - have a QID but no image statement on Wikidata.
 *
 * MusicBrainz exposes URL relationships per entity. Two relevant types:
 *   - "image"  →  https://commons.wikimedia.org/wiki/File:…
 *   - "logo"   →  same (labels only)
 *   - "blog"/"official site"  →  ignored (would need OG-scraping)
 *
 * We only accept Commons URLs because those have a known license + serving
 * pattern (Special:FilePath?width=…).
 *
 * Usage:
 *   TARGET_URL=postgresql://postgres:<pass>@localhost:15433/dig \
 *     pnpm exec tsx scripts/harvest-mb-images.ts --entity=label --batch=1
 *
 * Flags:
 *   --entity=label|artist|both    default: both
 *   --max=NUMBER                  cap entities (debug)
 *   --rate-ms=1100                MB asks for 1 req/sec; we use 1.1s
 *   --resume                      skip entities already having an image (default: true)
 *   --no-resume                   re-process even if already imaged
 *   --tier1-first                 process tier-1 labels/artists first
 *   --priority-table=NAME         only process discogs ids from this prio table
 *
 * Notes:
 *   - We hit the MB JSON API: /ws/2/<entity>/<mbid>?inc=url-rels&fmt=json
 *   - One MBID at a time (no batch endpoint exists for url-rels).
 *   - We honour their User-Agent requirement.
 *   - At ~1.1s/entity this is slow: 50k labels ≈ 15h. Use --tier1-first to
 *     get visible coverage on the canonical labels first, then run again
 *     unbounded for the long tail.
 */

import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { Database } from "../packages/db/src/schema.js";

interface Args {
  entity: "label" | "artist" | "both";
  max: number | null;
  rateMs: number;
  resume: boolean;
  tier1First: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    entity: "both",
    max: null,
    rateMs: 1100,
    resume: true,
    tier1First: false,
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--entity=")) args.entity = a.slice(9) as Args["entity"];
    else if (a.startsWith("--max=")) args.max = parseInt(a.slice(6), 10);
    else if (a.startsWith("--rate-ms=")) args.rateMs = Math.max(0, parseInt(a.slice(10), 10));
    else if (a === "--no-resume") args.resume = false;
    else if (a === "--resume") args.resume = true;
    else if (a === "--tier1-first") args.tier1First = true;
    else if (a === "--help" || a === "-h") {
      console.log("harvest-mb-images.ts — see file header for docs");
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

const MB_ENDPOINT = "https://musicbrainz.org/ws/2";
const USER_AGENT = "Dig/2.0 (https://dig.baby; hello@dig.baby) harvest-mb-images";
const COMMONS_FILEPATH = "https://commons.wikimedia.org/wiki/Special:FilePath/";

interface MBRelation {
  type: string;
  url?: { resource: string };
}

interface MBEntityResponse {
  id: string;
  relations?: MBRelation[];
}

async function fetchMb(entity: "label" | "artist", mbid: string): Promise<MBEntityResponse | null> {
  const url = `${MB_ENDPOINT}/${entity}/${mbid}?inc=url-rels&fmt=json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (res.status === 503) {
      // MB asks for backoff on 503.
      throw new Error("503 throttled");
    }
    if (!res.ok) throw new Error(`MB ${res.status} ${res.statusText}`);
    return (await res.json()) as MBEntityResponse;
  } finally {
    clearTimeout(timeout);
  }
}

// Convert a raw MB url-rel value to a Commons Special:FilePath URL we can
// store (mirroring the Wikidata harvester's behaviour). Returns null if the
// URL isn't a Commons file.
function commonsFilePathFromMbUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!/(^|\.)wikimedia\.org$/.test(u.hostname)) return null;
    // Examples we accept:
    //   https://commons.wikimedia.org/wiki/File:Foo.jpg
    //   https://commons.wikimedia.org/wiki/Special:FilePath/Foo.jpg
    if (u.pathname.startsWith("/wiki/Special:FilePath/")) {
      return `${COMMONS_FILEPATH}${decodeURIComponent(u.pathname.replace(/^\/wiki\/Special:FilePath\//, ""))}`;
    }
    if (u.pathname.startsWith("/wiki/File:")) {
      return `${COMMONS_FILEPATH}${decodeURIComponent(u.pathname.replace(/^\/wiki\/File:/, ""))}`;
    }
    return null;
  } catch {
    return null;
  }
}

interface ImageInsert {
  entity_type: "label" | "artist";
  discogs_id: number;
  image_kind: "logo" | "photo" | "hero";
  source: "musicbrainz";
  source_id: string;
  source_url: string;
  attribution: string;
  license: string | null;
}

async function upsertImages(db: Kysely<Database>, rows: ImageInsert[]) {
  if (rows.length === 0) return;
  // Dedup by (entity_type, discogs_id, image_kind) so ON CONFLICT won't
  // see duplicates.
  const dedup = new Map<string, ImageInsert>();
  for (const r of rows) {
    const key = `${r.entity_type}|${r.discogs_id}|${r.image_kind}`;
    if (!dedup.has(key)) dedup.set(key, r);
  }
  const unique = [...dedup.values()];
  for (const r of unique) {
    // Per-row insert with ON CONFLICT — preserves any earlier 'wikidata'
    // source. We only want to fill *gaps*, not overwrite Wikidata data.
    await sql`
      INSERT INTO enrich.entity_images
        (entity_type, discogs_id, image_kind, source, source_id, source_url, attribution, license)
      VALUES (${r.entity_type}, ${r.discogs_id}, ${r.image_kind}, ${r.source}, ${r.source_id}, ${r.source_url}, ${r.attribution}, ${r.license})
      ON CONFLICT (entity_type, discogs_id, image_kind) DO NOTHING
    `.execute(db);
  }
}

async function harvestEntity(db: Kysely<Database>, entityType: "label" | "artist", args: Args) {
  const tableRef = entityType === "label" ? sql`enrich.label_crosswalks` : sql`enrich.artist_crosswalks`;
  const idColRef = entityType === "label" ? sql.ref("discogs_label_id") : sql.ref("discogs_artist_id");

  // Candidates: in-scope (already mirrored to target) entities with MBID
  // and no existing image row of any kind. We also accept entities that
  // *have* a 'logo' but no 'photo' (and vice versa) — but only when not
  // resuming. For simplicity here we treat any image as "covered".
  const resumeFilter = args.resume
    ? sql`AND NOT EXISTS (
            SELECT 1 FROM enrich.entity_images ei
            WHERE ei.entity_type = ${entityType}
              AND ei.discogs_id = c.${idColRef}
          )`
    : sql``;

  // For tier-1 priority we lean on enrich.label_editorial (populated from
  // packages/db/seeds/scope-manifests/<scope>/tier1.csv). Tier-1 labels
  // are surfaced first; everyone else falls back to discogs_id ASC.
  // Artists don't have an editorial tier table yet, so we order by name
  // (already populated for in-scope rows).
  const orderBy = args.tier1First
    ? entityType === "label"
      ? sql`ORDER BY (le.tier IS NULL) ASC, le.tier ASC, l.name ASC`
      : sql`ORDER BY a.name ASC`
    : sql`ORDER BY c.${idColRef}`;

  const join =
    entityType === "label"
      ? sql`JOIN catalog.labels l ON l.discogs_id = c.${idColRef}
            LEFT JOIN enrich.label_editorial le ON le.discogs_label_id = c.${idColRef}`
      : sql`JOIN catalog.artists a ON a.discogs_id = c.${idColRef}`;

  const limitClause = args.max ? sql`LIMIT ${sql.lit(args.max)}` : sql``;

  const { rows } = await sql<{ discogs_id: number; mbid: string }>`
    SELECT c.${idColRef} AS discogs_id, c.mbid AS mbid
    FROM ${tableRef} c
    ${join}
    WHERE c.mbid IS NOT NULL
      ${resumeFilter}
    ${orderBy}
    ${limitClause}
  `.execute(db);

  console.log(`[mb:${entityType}] ${rows.length.toLocaleString()} MBIDs to query`);
  if (rows.length === 0) return { processed: 0, withImage: 0 };

  let processed = 0;
  let withImage = 0;
  for (let i = 0; i < rows.length; i++) {
    const { discogs_id, mbid } = rows[i];
    let mb: MBEntityResponse | null = null;
    let attempt = 0;
    while (true) {
      try {
        mb = await fetchMb(entityType, mbid);
        break;
      } catch (err) {
        attempt++;
        const wait = Math.min(60_000, 1500 * attempt * attempt);
        console.warn(`  MB error mbid=${mbid} (attempt ${attempt}): ${(err as Error).message} — sleeping ${wait}ms`);
        if (attempt >= 5) {
          mb = null;
          break;
        }
        await sleep(wait);
      }
    }
    if (mb && mb.relations) {
      const inserts: ImageInsert[] = [];
      for (const rel of mb.relations) {
        if (!rel.url?.resource) continue;
        const isImage = rel.type === "image";
        const isLogo = rel.type === "logo";
        if (!isImage && !isLogo) continue;
        const commons = commonsFilePathFromMbUrl(rel.url.resource);
        if (!commons) continue;
        const attribution = `Image from Wikimedia Commons via MusicBrainz (${mbid})`;
        if (entityType === "label") {
          inserts.push({
            entity_type: "label",
            discogs_id,
            image_kind: isLogo ? "logo" : "hero",
            source: "musicbrainz",
            source_id: mbid,
            source_url: commons,
            attribution,
            license: "see-commons",
          });
        } else {
          inserts.push({
            entity_type: "artist",
            discogs_id,
            image_kind: isLogo ? "logo" : "photo",
            source: "musicbrainz",
            source_id: mbid,
            source_url: commons,
            attribution,
            license: "see-commons",
          });
        }
      }
      if (inserts.length > 0) {
        await upsertImages(db, inserts);
        withImage++;
      }
    }
    processed++;
    if (processed % 100 === 0 || processed === rows.length) {
      console.log(
        `  ${processed.toLocaleString()}/${rows.length.toLocaleString()} processed, ${withImage.toLocaleString()} with image`,
      );
    }
    if (i < rows.length - 1) await sleep(args.rateMs);
  }
  return { processed, withImage };
}

async function main() {
  const args = parseArgs();
  const targetUrl = process.env.TARGET_URL ?? process.env.DATABASE_URL ?? "";
  if (!targetUrl) {
    console.error("TARGET_URL (or DATABASE_URL) must be set");
    process.exit(2);
  }
  console.log(`harvest-mb-images: entity=${args.entity} resume=${args.resume} tier1First=${args.tier1First}`);
  console.log(`  target: ${targetUrl.replace(/:[^:@]+@/, ":***@")}`);
  const { db: target } = makeDb(targetUrl);
  try {
    if (args.entity === "label" || args.entity === "both") {
      const r = await harvestEntity(target, "label", args);
      console.log(`  labels: processed=${r.processed}, with_image=${r.withImage}`);
    }
    if (args.entity === "artist" || args.entity === "both") {
      const r = await harvestEntity(target, "artist", args);
      console.log(`  artists: processed=${r.processed}, with_image=${r.withImage}`);
    }
  } finally {
    await target.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
