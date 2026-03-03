/**
 * Wikidata context import CLI (EN-C).
 *
 * Fetches artist context (bio, location, timeline) from Wikidata
 * for artists that have a wikidata_qid in enrich.artist_crosswalks.
 * Writes to enrich.entity_context with ON CONFLICT upsert.
 *
 * Usage:
 *   pnpm --filter @dig/ingest wikidata-context
 *   pnpm --filter @dig/ingest wikidata-context -- --limit 1000
 *   pnpm --filter @dig/ingest wikidata-context -- --offset 5000 --limit 2000
 *
 * Rate limiting: Wikidata API allows ~200 req/s for bots with User-Agent.
 * We batch 50 QIDs per request and add a small delay between batches.
 */

import { createDb, sql } from "@dig/db";

// --- Config ---

const BATCH_SIZE = 50; // Wikidata wbgetentities max per request
const WRITE_BATCH = 200; // rows per INSERT
const DELAY_MS = 200; // ms between API calls
const USER_AGENT = "DigBabyBot/1.0 (https://dig.baby; andy@dig.baby) node-fetch";

// Wikidata property IDs for artist context
const PROPS = {
  // Bio-relevant
  description: "description", // built-in, not a P-value
  instanceOf: "P31",
  // Location
  countryOfOrigin: "P495",
  countryOfCitizenship: "P27",
  locationOfFormation: "P740",
  placeOfBirth: "P19",
  // Timeline
  inception: "P571",
  dissolved: "P576",
  dateOfBirth: "P569",
  dateOfDeath: "P570",
  // Genre (useful for bio context)
  genre: "P136",
  // Official website
  officialWebsite: "P856",
};

// All P-values we need to fetch
const PROP_IDS = [
  PROPS.instanceOf,
  PROPS.countryOfOrigin,
  PROPS.countryOfCitizenship,
  PROPS.locationOfFormation,
  PROPS.placeOfBirth,
  PROPS.inception,
  PROPS.dissolved,
  PROPS.dateOfBirth,
  PROPS.dateOfDeath,
  PROPS.genre,
  PROPS.officialWebsite,
];

// --- Types ---

interface CrosswalkRow {
  discogs_artist_id: number;
  wikidata_qid: string;
}

interface ContextRow {
  entity_type: string;
  discogs_id: number;
  context_type: string;
  content_json: unknown;
  source: string;
  source_id: string;
  confidence: number;
  match_method: string;
  context_key: string;
}

// --- Wikidata API ---

async function fetchWikidataEntities(
  qids: string[],
): Promise<Record<string, any>> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("ids", qids.join("|"));
  url.searchParams.set("props", "labels|descriptions|claims");
  url.searchParams.set("languages", "en");
  url.searchParams.set("format", "json");

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!resp.ok) {
    throw new Error(`Wikidata API error: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as { entities?: Record<string, any> };
  return data.entities || {};
}

// --- Extraction helpers ---

function getEnLabel(entity: any): string | null {
  return entity?.labels?.en?.value ?? null;
}

function getEnDescription(entity: any): string | null {
  return entity?.descriptions?.en?.value ?? null;
}

function getClaimValue(entity: any, prop: string): any | null {
  const claims = entity?.claims?.[prop];
  if (!claims || claims.length === 0) return null;
  return claims[0]?.mainsnak?.datavalue?.value ?? null;
}

function getAllClaimValues(entity: any, prop: string): any[] {
  const claims = entity?.claims?.[prop];
  if (!claims) return [];
  return claims
    .map((c: any) => c?.mainsnak?.datavalue?.value)
    .filter(Boolean);
}

function getTimeValue(val: any): string | null {
  if (!val || typeof val !== "object") return null;
  // Wikidata time format: "+2020-01-01T00:00:00Z"
  const time = val.time;
  if (!time) return null;
  // Extract year (or year-month-day based on precision)
  const precision = val.precision;
  const match = time.match(/^[+-]?(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  if (precision === 9) return match[1]; // year only
  if (precision === 10) return `${match[1]}-${match[2]}`; // year-month
  return `${match[1]}-${match[2]}-${match[3]}`; // full date
}

function getEntityLabel(val: any): string | null {
  // For entity-type values (like locations), return the QID
  // We'll resolve labels separately if needed
  if (val && typeof val === "object" && val.id) return val.id;
  return null;
}

// --- Context extraction ---

function extractContextRows(
  discogsId: number,
  qid: string,
  entity: any,
): ContextRow[] {
  const rows: ContextRow[] = [];

  // 1. Bio context
  const description = getEnDescription(entity);
  const label = getEnLabel(entity);
  const genres = getAllClaimValues(entity, PROPS.genre).map(
    (v: any) => v?.id ?? null,
  );
  const website = getClaimValue(entity, PROPS.officialWebsite);

  if (description || label) {
    const bioJson: Record<string, unknown> = {};
    if (label) bioJson.name = label;
    if (description) bioJson.summary = description;
    if (genres.length > 0) bioJson.genre_qids = genres;
    if (website) bioJson.official_website = website;

    rows.push({
      entity_type: "artist",
      discogs_id: discogsId,
      context_type: "bio",
      content_json: bioJson,
      source: "wikidata",
      source_id: qid,
      confidence: 0.85,
      match_method: "artist_crosswalk",
      context_key: `wikidata:artist:${discogsId}:bio`,
    });
  }

  // 2. Location context
  const countryOfOrigin = getEntityLabel(
    getClaimValue(entity, PROPS.countryOfOrigin),
  );
  const citizenship = getEntityLabel(
    getClaimValue(entity, PROPS.countryOfCitizenship),
  );
  const formationPlace = getEntityLabel(
    getClaimValue(entity, PROPS.locationOfFormation),
  );
  const birthPlace = getEntityLabel(
    getClaimValue(entity, PROPS.placeOfBirth),
  );

  const locationJson: Record<string, string> = {};
  if (countryOfOrigin) locationJson.country_of_origin_qid = countryOfOrigin;
  if (citizenship) locationJson.country_of_citizenship_qid = citizenship;
  if (formationPlace) locationJson.location_of_formation_qid = formationPlace;
  if (birthPlace) locationJson.place_of_birth_qid = birthPlace;

  if (Object.keys(locationJson).length > 0) {
    rows.push({
      entity_type: "artist",
      discogs_id: discogsId,
      context_type: "location",
      content_json: locationJson,
      source: "wikidata",
      source_id: qid,
      confidence: 0.85,
      match_method: "artist_crosswalk",
      context_key: `wikidata:artist:${discogsId}:location`,
    });
  }

  // 3. Timeline context
  const inception = getTimeValue(getClaimValue(entity, PROPS.inception));
  const dissolved = getTimeValue(getClaimValue(entity, PROPS.dissolved));
  const born = getTimeValue(getClaimValue(entity, PROPS.dateOfBirth));
  const died = getTimeValue(getClaimValue(entity, PROPS.dateOfDeath));

  const timelineJson: Record<string, string> = {};
  if (inception) timelineJson.formed = inception;
  if (dissolved) timelineJson.dissolved = dissolved;
  if (born) timelineJson.born = born;
  if (died) timelineJson.died = died;

  if (Object.keys(timelineJson).length > 0) {
    rows.push({
      entity_type: "artist",
      discogs_id: discogsId,
      context_type: "timeline_note",
      content_json: timelineJson,
      source: "wikidata",
      source_id: qid,
      confidence: 0.85,
      match_method: "artist_crosswalk",
      context_key: `wikidata:artist:${discogsId}:timeline_note`,
    });
  }

  return rows;
}

// --- Resolve QID labels (for location display) ---

async function resolveQidLabels(
  qids: string[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (qids.length === 0) return labels;

  // Batch in groups of 50
  for (let i = 0; i < qids.length; i += BATCH_SIZE) {
    const batch = qids.slice(i, i + BATCH_SIZE);
    const entities = await fetchWikidataEntities(batch);
    for (const [qid, entity] of Object.entries(entities)) {
      const label = getEnLabel(entity);
      if (label) labels.set(qid, label);
    }
    if (i + BATCH_SIZE < qids.length) {
      await sleep(DELAY_MS);
    }
  }

  return labels;
}

// --- DB write ---

async function writeContextBatch(
  db: ReturnType<typeof createDb>,
  rows: ContextRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const chunk = rows.slice(i, i + WRITE_BATCH);
    const values = chunk
      .map(
        (r) =>
          sql`(${r.entity_type}, ${r.discogs_id}, ${r.context_type}, ${JSON.stringify(r.content_json)}::jsonb, ${r.source}, ${r.source_id}, ${r.confidence}, ${r.match_method}, ${r.context_key})`,
      );

    await sql`
      INSERT INTO enrich.entity_context
        (entity_type, discogs_id, context_type, content_json, source, source_id, confidence, match_method, context_key)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (context_key) DO UPDATE SET
        content_json = EXCLUDED.content_json,
        confidence = EXCLUDED.confidence,
        updated_at = now()
    `.execute(db);

    written += chunk.length;
  }

  return written;
}

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(): {
  databaseUrl: string;
  limit: number;
  offset: number;
  resolveLabels: boolean;
} {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let limit = 0; // 0 = all
  let offset = 0;
  let resolveLabels = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10);
    if (args[i] === "--offset" && args[i + 1])
      offset = parseInt(args[++i], 10);
    if (args[i] === "--resolve-labels") resolveLabels = true;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  return { databaseUrl, limit, offset, resolveLabels };
}

// --- Main ---

async function main() {
  const config = parseArgs();
  const db = createDb(config.databaseUrl);

  console.log("=== Wikidata Context Import (EN-C) ===");

  // 1. Fetch crosswalks with wikidata_qid
  console.log("Fetching artist crosswalks with Wikidata QIDs...");
  let query = sql<CrosswalkRow>`
    SELECT discogs_artist_id, wikidata_qid
    FROM enrich.artist_crosswalks
    WHERE wikidata_qid IS NOT NULL
    ORDER BY discogs_artist_id ASC
  `;

  if (config.offset > 0 || config.limit > 0) {
    query = sql<CrosswalkRow>`
      SELECT discogs_artist_id, wikidata_qid
      FROM enrich.artist_crosswalks
      WHERE wikidata_qid IS NOT NULL
      ORDER BY discogs_artist_id ASC
      ${config.offset > 0 ? sql`OFFSET ${config.offset}` : sql``}
      ${config.limit > 0 ? sql`LIMIT ${config.limit}` : sql``}
    `;
  }

  const { rows: crosswalks } = await query.execute(db);
  console.log(`Found ${crosswalks.length} artists with Wikidata QIDs`);

  if (crosswalks.length === 0) {
    console.log("Nothing to import.");
    await db.destroy();
    return;
  }

  // 2. Create batch record
  const batchKey = `wikidata-context-${new Date().toISOString().slice(0, 7)}`;
  await sql`
    INSERT INTO enrich.ingest_batches (source, source_batch_key, status, started_at)
    VALUES ('wikidata', ${batchKey}, 'importing', now())
    ON CONFLICT (source, source_batch_key)
    DO UPDATE SET status = 'importing', started_at = now()
  `.execute(db);

  // 3. Process in batches of 50 (Wikidata API limit)
  let totalContextRows = 0;
  let totalArtistsProcessed = 0;
  let totalArtistsWithContext = 0;
  let errors = 0;
  const allLocationQids = new Set<string>();

  for (let i = 0; i < crosswalks.length; i += BATCH_SIZE) {
    const batch = crosswalks.slice(i, i + BATCH_SIZE);
    const qidToDiscogs = new Map<string, number>();
    for (const row of batch) {
      qidToDiscogs.set(row.wikidata_qid, row.discogs_artist_id);
    }

    const qids = [...qidToDiscogs.keys()];

    try {
      const entities = await fetchWikidataEntities(qids);
      const contextRows: ContextRow[] = [];

      for (const [qid, entity] of Object.entries(entities)) {
        if (entity.missing !== undefined) continue;
        const discogsId = qidToDiscogs.get(qid);
        if (!discogsId) continue;

        const rows = extractContextRows(discogsId, qid, entity);
        contextRows.push(...rows);
        if (rows.length > 0) totalArtistsWithContext++;

        // Collect location QIDs for label resolution
        for (const row of rows) {
          if (row.context_type === "location") {
            const loc = row.content_json as Record<string, string>;
            for (const val of Object.values(loc)) {
              if (val.startsWith("Q")) allLocationQids.add(val);
            }
          }
        }
      }

      const written = await writeContextBatch(db, contextRows);
      totalContextRows += written;
      totalArtistsProcessed += batch.length;

      if ((i / BATCH_SIZE) % 20 === 0 || i + BATCH_SIZE >= crosswalks.length) {
        const pct = ((i + batch.length) / crosswalks.length * 100).toFixed(1);
        console.log(
          `  [${pct}%] Processed ${totalArtistsProcessed}/${crosswalks.length} artists, ${totalContextRows} context rows, ${errors} errors`,
        );
      }
    } catch (err) {
      errors++;
      console.error(
        `  Error processing batch at offset ${i}: ${err instanceof Error ? err.message : err}`,
      );
      // Continue on error — don't let one bad batch kill the whole import
    }

    await sleep(DELAY_MS);
  }

  // 4. Optional: resolve location QID labels and update content_json
  if (config.resolveLabels && allLocationQids.size > 0) {
    console.log(
      `\nResolving ${allLocationQids.size} location QID labels...`,
    );
    const labels = await resolveQidLabels([...allLocationQids]);
    console.log(`  Resolved ${labels.size} labels`);

    // Update location context rows with resolved labels
    let updatedLocations = 0;
    for (const [qid, label] of labels) {
      await sql`
        UPDATE enrich.entity_context
        SET content_json = content_json || ${JSON.stringify({ [`_label_${qid}`]: label })}::jsonb,
            updated_at = now()
        WHERE context_type = 'location'
          AND source = 'wikidata'
          AND content_json::text LIKE ${"%" + qid + "%"}
      `.execute(db);
      updatedLocations++;
    }
    console.log(`  Updated ${updatedLocations} location rows with labels`);
  }

  // 5. Update batch record
  await sql`
    UPDATE enrich.ingest_batches
    SET status = 'active',
        completed_at = now(),
        stats = ${JSON.stringify({
          total_qids: crosswalks.length,
          artists_processed: totalArtistsProcessed,
          artists_with_context: totalArtistsWithContext,
          context_rows_written: totalContextRows,
          unique_location_qids: allLocationQids.size,
          errors,
        })}::jsonb
    WHERE source = 'wikidata' AND source_batch_key = ${batchKey}
  `.execute(db);

  console.log("\n=== Import Complete ===");
  console.log(`  Artists processed: ${totalArtistsProcessed}`);
  console.log(`  Artists with context: ${totalArtistsWithContext}`);
  console.log(`  Context rows written: ${totalContextRows}`);
  console.log(`  Unique location QIDs: ${allLocationQids.size}`);
  console.log(`  Errors: ${errors}`);

  await db.destroy();
}

// Export for testing
export { extractContextRows, getTimeValue, getEnDescription, getEnLabel };

// Only run main when executed directly (not imported by tests)
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
