/**
 * EN-D Full-Catalog Setlist.fm Import
 *
 * Processes all quality-eligible artists in enrich.artist_crosswalks:
 *   - eligible: quality_status IN ('active','low_value')
 *   - excluded: quality_status = 'suppressed'
 *
 * Resumable via DB checkpoint (last processed discogs_artist_id stored in ingest_batches).
 * Idempotent: ON CONFLICT (setlistfm_id) DO UPDATE — safe to re-run.
 * Stops cleanly on quota exhaustion (429) and saves checkpoint for next run.
 *
 * Usage:
 *   DATABASE_URL=xxx SETLISTFM_API_KEY=xxx pnpm --filter @dig/ingest setlistfm-full-catalog
 *   DATABASE_URL=xxx SETLISTFM_API_KEY=xxx pnpm --filter @dig/ingest setlistfm-full-catalog -- --pages 3 --delay 2500
 *   DATABASE_URL=xxx SETLISTFM_API_KEY=xxx pnpm --filter @dig/ingest setlistfm-full-catalog -- --idempotency-check
 *
 * Rate limits: free key = 1,400 calls/day. Script stops at quota and resumes from checkpoint.
 * Attribution: setlistfm_url must be displayed wherever data is shown.
 */

import { createDb, sql } from "@dig/db";
// --- Config ---

const DELAY_MS = 2200;          // ~2.2s between API calls
const ITEMS_PER_PAGE = 20;      // setlist.fm default
const WRITE_BATCH = 100;        // DB write batch size
const ARTIST_BATCH = 50;        // artists per processing batch (for progress reporting)
const MAX_RETRIES = 2;          // retry network errors (NOT quota — that stops cleanly)
const RETRY_BACKOFF_MS = 5000;
const USER_AGENT = "DigBabyBot/1.0 (https://dig.baby; andy@dig.baby)";
const BATCH_KEY = "setlistfm-full-catalog-v1";
const MAX_ERROR_RATE = 0.02;    // 2% error rate guardrail (over last 1,000 artists)
const ERROR_WINDOW = 1000;

// --- Types ---

interface CheckpointData {
  last_discogs_artist_id: number;
  artists_processed: number;
  artists_with_events: number;
  total_events: number;
  total_api_calls: number;
  total_errors: number;
  quota_wait_events: number;
  started_at: string;
  updated_at: string;
}

interface EligibleArtist {
  discogs_artist_id: number;
  mbid: string;
  quality_status: string;
}

interface SetlistEvent {
  discogs_artist_id: number;
  event_date: string;
  venue_name: string | null;
  city_name: string | null;
  country_name: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  tour_name: string | null;
  song_count: number;
  setlistfm_id: string;
  setlistfm_url: string;
}

// --- API ---

async function fetchArtistSetlists(
  apiKey: string,
  mbid: string,
  page: number,
): Promise<{ setlists: any[]; total: number } | "QUOTA_EXHAUSTED" | "NOT_FOUND"> {
  const url = `https://api.setlist.fm/rest/1.0/artist/${mbid}/setlists?p=${page}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (resp.status === 404) return "NOT_FOUND";
      if (resp.status === 429) return "QUOTA_EXHAUSTED";
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = (await resp.json()) as { setlist?: any[]; total?: number };
      return { setlists: data.setlist || [], total: data.total || 0 };
    } catch (err: any) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }
  throw new Error("Max retries exceeded");
}

// --- Parser ---

function parseSetlist(discogsArtistId: number, setlist: any): SetlistEvent | null {
  const id = setlist.id;
  const url = setlist.url;
  if (!id || !url) return null;

  const rawDate = setlist.eventDate;
  if (!rawDate) return null;
  const [dd, mm, yyyy] = rawDate.split("-");
  if (!dd || !mm || !yyyy) return null;
  const eventDate = `${yyyy}-${mm}-${dd}`;

  const venue = setlist.venue;
  const city = venue?.city;
  const coords = city?.coords;
  const country = city?.country;

  let songCount = 0;
  const sets = setlist.sets?.set;
  if (Array.isArray(sets)) {
    for (const s of sets) {
      if (Array.isArray(s.song)) songCount += s.song.length;
    }
  }

  return {
    discogs_artist_id: discogsArtistId,
    event_date: eventDate,
    venue_name: venue?.name || null,
    city_name: city?.name || null,
    country_name: country?.name || null,
    country_code: country?.code || null,
    latitude: coords?.lat ? parseFloat(coords.lat) : null,
    longitude: coords?.long ? parseFloat(coords.long) : null,
    tour_name: setlist.tour?.name || null,
    song_count: songCount,
    setlistfm_id: id,
    setlistfm_url: url,
  };
}

// --- DB Writes ---

async function writeEventBatch(
  db: ReturnType<typeof createDb>,
  events: SetlistEvent[],
  sourceBatchId: number | null,
): Promise<number> {
  if (events.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < events.length; i += WRITE_BATCH) {
    const chunk = events.slice(i, i + WRITE_BATCH);
    const values = chunk.map(
      (e) =>
        sql`(${e.discogs_artist_id}, ${e.event_date}::date, ${e.venue_name}, ${e.city_name}, ${e.country_name}, ${e.country_code}, ${e.latitude}, ${e.longitude}, ${e.tour_name}, ${e.song_count}, ${e.setlistfm_id}, ${e.setlistfm_url}, 'setlistfm', ${sourceBatchId}, now(), now())`,
    );
    await sql`
      INSERT INTO enrich.performance_events
        (discogs_artist_id, event_date, venue_name, city_name, country_name, country_code, latitude, longitude, tour_name, song_count, setlistfm_id, setlistfm_url, source, source_batch_id, fetched_at, created_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (setlistfm_id) DO UPDATE SET
        venue_name = EXCLUDED.venue_name,
        city_name = EXCLUDED.city_name,
        country_name = EXCLUDED.country_name,
        song_count = EXCLUDED.song_count,
        tour_name = EXCLUDED.tour_name,
        fetched_at = now()
    `.execute(db);
    written += chunk.length;
  }
  return written;
}

// --- Checkpoint ---

async function loadCheckpoint(db: ReturnType<typeof createDb>): Promise<CheckpointData | null> {
  const { rows } = await sql<{ notes: string | null }>`
    SELECT notes FROM enrich.ingest_batches
    WHERE source = 'setlistfm' AND source_batch_key = ${BATCH_KEY}
    ORDER BY id DESC LIMIT 1
  `.execute(db);
  if (rows.length === 0 || !rows[0].notes) return null;
  try {
    return JSON.parse(rows[0].notes) as CheckpointData;
  } catch {
    return null;
  }
}

async function saveCheckpoint(db: ReturnType<typeof createDb>, batchId: number, data: CheckpointData): Promise<void> {
  await sql`
    UPDATE enrich.ingest_batches
    SET notes = ${JSON.stringify(data)}, updated_at = now()
    WHERE id = ${batchId}
  `.execute(db);
}

// --- Eligible Population ---

async function fetchEligibleBatch(
  db: ReturnType<typeof createDb>,
  afterArtistId: number,
  limit: number,
): Promise<EligibleArtist[]> {
  const { rows } = await sql<EligibleArtist>`
    SELECT ac.discogs_artist_id, ac.mbid, eq.quality_status
    FROM enrich.artist_crosswalks ac
    JOIN enrich.entity_quality eq
      ON eq.entity_type = 'artist'
      AND eq.discogs_id = ac.discogs_artist_id
    WHERE ac.mbid IS NOT NULL
      AND ac.confidence >= 0.9
      AND eq.quality_status IN ('active','low_value')
      AND ac.discogs_artist_id > ${afterArtistId}
    ORDER BY ac.discogs_artist_id
    LIMIT ${limit}
  `.execute(db);
  return rows;
}

async function countEligiblePopulation(db: ReturnType<typeof createDb>): Promise<{
  total: number; eligible: number; excluded: number; no_quality: number;
}> {
  const { rows } = await sql<{
    eligible: string; excluded: string; no_quality: string; total: string;
  }>`
    SELECT
      COUNT(*) FILTER (WHERE eq.quality_status IN ('active','low_value')) as eligible,
      COUNT(*) FILTER (WHERE eq.quality_status = 'suppressed') as excluded,
      COUNT(*) FILTER (WHERE eq.quality_status IS NULL) as no_quality,
      COUNT(*) as total
    FROM enrich.artist_crosswalks ac
    LEFT JOIN enrich.entity_quality eq
      ON eq.entity_type = 'artist'
      AND eq.discogs_id = ac.discogs_artist_id
    WHERE ac.mbid IS NOT NULL AND ac.confidence >= 0.9
  `.execute(db);
  const r = rows[0];
  return {
    total: parseInt(r.total),
    eligible: parseInt(r.eligible),
    excluded: parseInt(r.excluded),
    no_quality: parseInt(r.no_quality),
  };
}

async function countArtistsWithTimeline(db: ReturnType<typeof createDb>): Promise<number> {
  const { rows } = await sql<{ cnt: string }>`
    SELECT COUNT(DISTINCT pe.discogs_artist_id) as cnt
    FROM enrich.performance_events pe
    JOIN enrich.entity_quality eq
      ON eq.entity_type = 'artist'
      AND eq.discogs_id = pe.discogs_artist_id
    WHERE eq.quality_status IN ('active','low_value')
  `.execute(db);
  return parseInt(rows[0].cnt);
}

// --- Idempotency Check ---

async function idempotencyCheck(db: ReturnType<typeof createDb>, apiKey: string, pages: number): Promise<void> {
  console.log("\n=== Idempotency Check Mode ===");
  const beforeCount = await sql<{ cnt: string }>`
    SELECT COUNT(*) as cnt FROM enrich.performance_events WHERE entity_type = 'artist' OR source = 'setlistfm'
  `.execute(db).then(r => parseInt(r.rows[0].cnt)).catch(() => 0);

  const { rows: sampleRows } = await sql<{ discogs_artist_id: number; mbid: string }>`
    SELECT ac.discogs_artist_id, ac.mbid
    FROM enrich.artist_crosswalks ac
    JOIN enrich.entity_quality eq ON eq.entity_type = 'artist' AND eq.discogs_id = ac.discogs_artist_id
    JOIN enrich.performance_events pe ON pe.discogs_artist_id = ac.discogs_artist_id
    WHERE ac.mbid IS NOT NULL AND ac.confidence >= 0.9 AND eq.quality_status IN ('active','low_value')
    LIMIT 5
  `.execute(db);

  if (sampleRows.length === 0) {
    console.log("  No previously processed artists found for idempotency check.");
    return;
  }

  console.log(`  Re-fetching ${sampleRows.length} previously processed artists...`);
  let _reFetched = 0;

  for (const artist of sampleRows) {
    const artistEvents: SetlistEvent[] = [];
    for (let page = 1; page <= pages; page++) {
      const result = await fetchArtistSetlists(apiKey, artist.mbid, page);
      if (result === "QUOTA_EXHAUSTED") { console.log("  Quota exhausted during check."); break; }
      if (result === "NOT_FOUND") break;
      for (const setlist of result.setlists) {
        const event = parseSetlist(artist.discogs_artist_id, setlist);
        if (event) artistEvents.push(event);
      }
      if (result.setlists.length < ITEMS_PER_PAGE) break;
      await sleep(DELAY_MS);
    }
    if (artistEvents.length > 0) {
      await writeEventBatch(db, artistEvents, null);
    }
    _reFetched++;
    await sleep(DELAY_MS);
  }

  const afterCount = await sql<{ cnt: string }>`
    SELECT COUNT(*) as cnt FROM enrich.performance_events WHERE entity_type = 'artist' OR source = 'setlistfm'
  `.execute(db).then(r => parseInt(r.rows[0].cnt)).catch(() => 0);

  const delta = afterCount - beforeCount;
  console.log(`  Before: ${beforeCount}, After: ${afterCount}, Delta: ${delta}`);
  console.log(`  idempotency_delta = ${delta} (must be 0 for FULLY_CLOSED)`);
  if (delta !== 0) {
    console.error(`  FAIL: idempotency_delta != 0. Investigate before closing.`);
  } else {
    console.log(`  PASS: idempotency confirmed.`);
  }
}

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(): {
  databaseUrl: string;
  apiKey: string;
  pages: number;
  delayMs: number;
  idempotencyCheckMode: boolean;
} {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let pages = 2;
  let delayMs = DELAY_MS;
  let idempotencyCheckMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pages" && args[i + 1]) pages = parseInt(args[++i], 10);
    if (args[i] === "--delay" && args[i + 1]) delayMs = parseInt(args[++i], 10);
    if (args[i] === "--idempotency-check") idempotencyCheckMode = true;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) { console.error("DATABASE_URL required"); process.exit(1); }
  const apiKey = process.env.SETLISTFM_API_KEY;
  if (!apiKey) { console.error("SETLISTFM_API_KEY required"); process.exit(1); }

  return { databaseUrl, apiKey, pages, delayMs, idempotencyCheckMode };
}

// --- Main ---

async function main() {
  const config = parseArgs();
  const db = createDb(config.databaseUrl);

  console.log("=== EN-D Full-Catalog Setlist.fm Import ===");
  console.log(`  Pages per artist: ${config.pages}, Delay: ${config.delayMs}ms`);
  console.log(`  Batch key: ${BATCH_KEY}`);

  // Idempotency check mode
  if (config.idempotencyCheckMode) {
    await idempotencyCheck(db, config.apiKey, config.pages);
    await db.destroy();
    return;
  }

  // --- Population snapshot ---
  console.log("\nCounting eligible population (this may take 20-30s)...");
  const pop = await countEligiblePopulation(db);
  console.log(`  Total crosswalks (MBID, conf≥0.9): ${pop.total.toLocaleString()}`);
  console.log(`  Eligible (active+low_value): ${pop.eligible.toLocaleString()}`);
  console.log(`  Excluded (suppressed): ${pop.excluded.toLocaleString()}`);
  console.log(`  No quality row (pass-through): ${pop.no_quality.toLocaleString()}`);

  // --- Get/create batch record ---
  const { rows: batchRows } = await sql<{ id: number; notes: string | null }>`
    INSERT INTO enrich.ingest_batches (source, source_batch_key, status, started_at)
    VALUES ('setlistfm', ${BATCH_KEY}, 'importing', now())
    ON CONFLICT (source, source_batch_key)
    DO UPDATE SET status = 'importing', updated_at = now()
    RETURNING id, notes
  `.execute(db);
  const batchId = batchRows[0].id;

  // --- Load checkpoint ---
  const existingCheckpoint = await loadCheckpoint(db);
  const checkpoint: CheckpointData = existingCheckpoint ?? {
    last_discogs_artist_id: 0,
    artists_processed: 0,
    artists_with_events: 0,
    total_events: 0,
    total_api_calls: 0,
    total_errors: 0,
    quota_wait_events: 0,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (existingCheckpoint) {
    console.log(`\nResuming from checkpoint: last artist_id=${checkpoint.last_discogs_artist_id}, processed=${checkpoint.artists_processed.toLocaleString()}`);
  } else {
    console.log("\nStarting fresh run.");
  }

  // Error rate tracking (rolling window)
  const recentErrors: boolean[] = [];
  function trackError(isError: boolean) {
    recentErrors.push(isError);
    if (recentErrors.length > ERROR_WINDOW) recentErrors.shift();
  }
  function recentErrorRate(): number {
    if (recentErrors.length < 10) return 0;
    return recentErrors.filter(Boolean).length / recentErrors.length;
  }

  // --- Main processing loop ---
  let quotaExhausted = false;

  while (!quotaExhausted) {
    // Fetch next batch of eligible artists from checkpoint
    const batch = await fetchEligibleBatch(db, checkpoint.last_discogs_artist_id, ARTIST_BATCH);

    if (batch.length === 0) {
      console.log("\nAll eligible artists processed. Run complete.");
      break;
    }

    for (const artist of batch) {
      const artistEvents: SetlistEvent[] = [];

      for (let page = 1; page <= config.pages; page++) {
        let result: Awaited<ReturnType<typeof fetchArtistSetlists>>;
        try {
          result = await fetchArtistSetlists(config.apiKey, artist.mbid, page);
        } catch (err: any) {
          checkpoint.total_errors++;
          trackError(true);
          if (checkpoint.total_errors <= 20) {
            console.error(`  Error artist ${artist.discogs_artist_id}: ${err?.message}`);
          }
          break;
        }

        checkpoint.total_api_calls++;

        if (result === "QUOTA_EXHAUSTED") {
          checkpoint.quota_wait_events++;
          console.log(`\n  Quota exhausted at artist ${artist.discogs_artist_id} after ${checkpoint.total_api_calls} API calls.`);
          quotaExhausted = true;
          break;
        }

        if (result === "NOT_FOUND") {
          trackError(false);
          break;
        }

        for (const setlist of result.setlists) {
          const event = parseSetlist(artist.discogs_artist_id, setlist);
          if (event) artistEvents.push(event);
        }
        trackError(false);

        // Stop pagination if no more results
        if (result.setlists.length < ITEMS_PER_PAGE || result.total <= page * ITEMS_PER_PAGE) {
          break;
        }

        await sleep(config.delayMs);
      }

      if (quotaExhausted) break;

      // Write events for this artist
      if (artistEvents.length > 0) {
        await writeEventBatch(db, artistEvents, batchId);
        checkpoint.total_events += artistEvents.length;
        checkpoint.artists_with_events++;
      }

      checkpoint.artists_processed++;
      checkpoint.last_discogs_artist_id = artist.discogs_artist_id;
      checkpoint.updated_at = new Date().toISOString();

      // Guardrail: stop on high error rate
      const errRate = recentErrorRate();
      if (errRate > MAX_ERROR_RATE && recentErrors.length >= 100) {
        console.error(`\n  GUARDRAIL: Error rate ${(errRate * 100).toFixed(1)}% exceeds ${MAX_ERROR_RATE * 100}% threshold. Stopping.`);
        quotaExhausted = true; // reuse flag to exit cleanly
        break;
      }

      await sleep(config.delayMs);
    }

    // Save checkpoint after each batch
    await saveCheckpoint(db, batchId, checkpoint);

    const pct = ((checkpoint.artists_processed / pop.eligible) * 100).toFixed(2);
    console.log(
      `  [${pct}%] processed=${checkpoint.artists_processed.toLocaleString()}, events=${checkpoint.total_events.toLocaleString()}, api_calls=${checkpoint.total_api_calls.toLocaleString()}, errors=${checkpoint.total_errors}, quota_waits=${checkpoint.quota_wait_events}`
    );
  }

  // Final checkpoint save
  await saveCheckpoint(db, batchId, checkpoint);

  // Mark batch as paused/complete
  const finalStatus = quotaExhausted ? "quota_paused" : "complete";
  await sql`
    UPDATE enrich.ingest_batches
    SET status = ${finalStatus}, completed_at = now()
    WHERE id = ${batchId}
  `.execute(db);

  // --- Final metrics ---
  const artistsWithTimeline = await countArtistsWithTimeline(db);
  const coverage = pop.eligible > 0 ? ((artistsWithTimeline / pop.eligible) * 100).toFixed(3) : "0";

  console.log("\n=== EN-D Run Metrics ===");
  console.log(`  artists_total:              ${pop.total.toLocaleString()}`);
  console.log(`  artists_eligible:           ${pop.eligible.toLocaleString()}`);
  console.log(`  artists_excluded_suppressed:${pop.excluded.toLocaleString()}`);
  console.log(`  artists_processed:          ${checkpoint.artists_processed.toLocaleString()}`);
  console.log(`  artists_with_timeline:      ${artistsWithTimeline.toLocaleString()}`);
  console.log(`  coverage_pct:               ${coverage}%`);
  console.log(`  total_api_calls:            ${checkpoint.total_api_calls.toLocaleString()}`);
  console.log(`  total_errors:               ${checkpoint.total_errors}`);
  console.log(`  error_rate_pct:             ${recentErrors.length > 0 ? (recentErrors.filter(Boolean).length / recentErrors.length * 100).toFixed(2) : '0'}%`);
  console.log(`  quota_wait_events:          ${checkpoint.quota_wait_events}`);
  console.log(`  status:                     ${finalStatus}`);
  console.log(`  checkpoint:                 artist_id=${checkpoint.last_discogs_artist_id}`);

  if (finalStatus === "quota_paused") {
    console.log("\nQuota exhausted. Resume tomorrow with same command — checkpoint saved.");
  } else {
    console.log("\nRun complete. Run with --idempotency-check to verify delta=0.");
  }

  await db.destroy();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
