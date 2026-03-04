/**
 * Setlist.fm performance event import CLI (EN-D spike).
 *
 * Fetches setlists for a cohort of artists via setlist.fm API,
 * stores in enrich.performance_events with ON CONFLICT upsert.
 *
 * Usage:
 *   SETLISTFM_API_KEY=xxx DATABASE_URL=xxx pnpm --filter @dig/ingest setlistfm-import
 *   SETLISTFM_API_KEY=xxx DATABASE_URL=xxx pnpm --filter @dig/ingest setlistfm-import -- --limit 100
 *   SETLISTFM_API_KEY=xxx DATABASE_URL=xxx pnpm --filter @dig/ingest setlistfm-import -- --pages 3
 *
 * Rate limiting: 1,400 calls/day on free key. Default delay 2s between calls.
 * Attribution: setlistfm_url must be displayed wherever data is shown.
 */

import { createDb, sql } from "@dig/db";

// --- Config ---

const DELAY_MS = 2000; // 2s between API calls (conservative for 1,400/day)
const ITEMS_PER_PAGE = 20; // setlist.fm default
const WRITE_BATCH = 100;
const MAX_RETRIES = 3; // retry network errors
const RETRY_BACKOFF_MS = 5000; // 5s backoff between retries
const USER_AGENT = "DigBabyBot/1.0 (https://dig.baby; andy@dig.baby)";

// --- Types ---

interface CohortRow {
  discogs_artist_id: number;
  mbid: string;
}

interface SetlistEvent {
  discogs_artist_id: number;
  event_date: string; // YYYY-MM-DD
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

// --- Setlist.fm API ---

async function fetchArtistSetlists(
  apiKey: string,
  mbid: string,
  page: number = 1,
): Promise<{ setlists: any[]; total: number; page: number }> {
  const url = `https://api.setlist.fm/rest/1.0/artist/${mbid}/setlists?p=${page}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(15000), // 15s timeout
      });

      if (resp.status === 404) {
        return { setlists: [], total: 0, page };
      }

      if (resp.status === 429) {
        throw new Error("RATE_LIMITED");
      }

      if (!resp.ok) {
        throw new Error(`Setlist.fm API error: ${resp.status} ${resp.statusText}`);
      }

      const data = (await resp.json()) as {
        setlist?: any[];
        total?: number;
        page?: number;
      };

      return {
        setlists: data.setlist || [],
        total: data.total || 0,
        page: data.page || page,
      };
    } catch (err) {
      if (err instanceof Error && err.message === "RATE_LIMITED") throw err;
      if (attempt === MAX_RETRIES) throw err;
      // Network error — retry with backoff
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }

  // Unreachable, but satisfies TS
  throw new Error("Max retries exceeded");
}

// --- Parse setlist into event ---

function parseSetlist(
  discogsArtistId: number,
  setlist: any,
): SetlistEvent | null {
  const id = setlist.id;
  const url = setlist.url;
  if (!id || !url) return null;

  // Parse date: "dd-MM-yyyy" -> "YYYY-MM-DD"
  const rawDate = setlist.eventDate;
  if (!rawDate) return null;
  const [dd, mm, yyyy] = rawDate.split("-");
  if (!dd || !mm || !yyyy) return null;
  const eventDate = `${yyyy}-${mm}-${dd}`;

  // Venue info
  const venue = setlist.venue;
  const city = venue?.city;
  const coords = city?.coords;
  const country = city?.country;

  // Count songs across all sets
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

// --- DB write ---

async function writeEventBatch(
  db: ReturnType<typeof createDb>,
  events: SetlistEvent[],
  batchId: number | null,
): Promise<number> {
  if (events.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < events.length; i += WRITE_BATCH) {
    const chunk = events.slice(i, i + WRITE_BATCH);
    const values = chunk.map(
      (e) =>
        sql`(${e.discogs_artist_id}, ${e.event_date}::date, ${e.venue_name}, ${e.city_name}, ${e.country_name}, ${e.country_code}, ${e.latitude}, ${e.longitude}, ${e.tour_name}, ${e.song_count}, ${e.setlistfm_id}, ${e.setlistfm_url}, 'setlistfm', ${batchId}, now(), now())`,
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

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(): {
  databaseUrl: string;
  apiKey: string;
  limit: number;
  offset: number;
  pages: number;
  delayMs: number;
  skipExisting: boolean;
} {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let limit = 1000; // default cohort size
  let offset = 0;
  let pages = 1; // pages per artist
  let delayMs = DELAY_MS;
  let skipExisting = true; // default: skip artists already in performance_events

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10);
    if (args[i] === "--offset" && args[i + 1])
      offset = parseInt(args[++i], 10);
    if (args[i] === "--pages" && args[i + 1]) pages = parseInt(args[++i], 10);
    if (args[i] === "--delay" && args[i + 1])
      delayMs = parseInt(args[++i], 10);
    if (args[i] === "--no-skip-existing") skipExisting = false;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const apiKey = process.env.SETLISTFM_API_KEY;
  if (!apiKey) {
    console.error("SETLISTFM_API_KEY is required");
    process.exit(1);
  }

  return { databaseUrl, apiKey, limit, offset, pages, delayMs, skipExisting };
}

// --- Cohort selection ---

async function selectCohort(
  db: ReturnType<typeof createDb>,
  limit: number,
  offset: number,
): Promise<CohortRow[]> {
  // Deterministic cohort: artists with MBID, ordered by discogs_artist_id.
  // Use OFFSET for resumability. Random sampling was too slow over proxy.
  const { rows } = await sql<CohortRow>`
    SELECT discogs_artist_id, mbid
    FROM enrich.artist_crosswalks
    WHERE mbid IS NOT NULL
      AND confidence >= 0.9
    ORDER BY discogs_artist_id
    OFFSET ${offset}
    LIMIT ${limit}
  `.execute(db);

  return rows;
}

// --- Main ---

async function main() {
  const config = parseArgs();
  const db = createDb(config.databaseUrl);

  console.log("=== Setlist.fm Performance Event Import (EN-D Spike) ===");
  console.log(`  Cohort size: ${config.limit}, Pages per artist: ${config.pages}, Delay: ${config.delayMs}ms, Skip existing: ${config.skipExisting}`);

  // 1. Select cohort
  console.log("\nSelecting artist cohort...");
  let cohort = await selectCohort(db, config.limit, config.offset);
  console.log(`  Selected ${cohort.length} artists from crosswalks`);

  if (cohort.length === 0) {
    console.log("No artists found. Check crosswalks.");
    await db.destroy();
    return;
  }

  // 1b. Filter out artists already in performance_events
  if (config.skipExisting && cohort.length > 0) {
    const { rows: existingRows } = await sql<{ discogs_artist_id: number }>`
      SELECT DISTINCT discogs_artist_id
      FROM enrich.performance_events
      WHERE discogs_artist_id = ANY(${cohort.map((c) => c.discogs_artist_id)}::int[])
    `.execute(db);
    const existingSet = new Set(existingRows.map((r) => r.discogs_artist_id));
    const before = cohort.length;
    cohort = cohort.filter((c) => !existingSet.has(c.discogs_artist_id));
    console.log(`  Skipping ${before - cohort.length} artists with existing events, ${cohort.length} remaining`);
  }

  if (cohort.length === 0) {
    console.log("All artists already imported. Nothing to do.");
    await db.destroy();
    return;
  }

  // 2. Create batch record
  const batchKey = `setlistfm-spike-${new Date().toISOString().slice(0, 10)}`;
  const { rows: batchRows } = await sql<{ id: number }>`
    INSERT INTO enrich.ingest_batches (source, source_batch_key, status, started_at)
    VALUES ('setlistfm', ${batchKey}, 'importing', now())
    ON CONFLICT (source, source_batch_key)
    DO UPDATE SET status = 'importing', started_at = now()
    RETURNING id
  `.execute(db);
  const batchId = batchRows[0]?.id ?? null;

  // 3. Fetch setlists for each artist
  let totalEvents = 0;
  let artistsWithEvents = 0;
  let artistsProcessed = 0;
  let apiCalls = 0;
  let errors = 0;
  let rateLimited = 0;

  for (const artist of cohort) {
    let artistEvents: SetlistEvent[] = [];

    for (let page = 1; page <= config.pages; page++) {
      try {
        const result = await fetchArtistSetlists(
          config.apiKey,
          artist.mbid,
          page,
        );
        apiCalls++;

        for (const setlist of result.setlists) {
          const event = parseSetlist(artist.discogs_artist_id, setlist);
          if (event) artistEvents.push(event);
        }

        // Stop pagination early if no more results
        if (
          result.setlists.length < ITEMS_PER_PAGE ||
          result.total <= page * ITEMS_PER_PAGE
        ) {
          break;
        }
      } catch (err) {
        if (err instanceof Error && err.message === "RATE_LIMITED") {
          rateLimited++;
          console.error(
            `  Rate limited at artist ${artist.discogs_artist_id}. Waiting 60s...`,
          );
          await sleep(60000);
          page--; // retry this page
          continue;
        }
        errors++;
        if (errors <= 10) {
          console.error(
            `  Error for artist ${artist.discogs_artist_id}: ${err instanceof Error ? err.message : err}`,
          );
        }
        break; // skip to next artist on error
      }

      await sleep(config.delayMs);
    }

    // Write events for this artist
    if (artistEvents.length > 0) {
      await writeEventBatch(db, artistEvents, batchId);
      totalEvents += artistEvents.length;
      artistsWithEvents++;
    }

    artistsProcessed++;
    if (artistsProcessed % 50 === 0 || artistsProcessed === cohort.length) {
      const pct = ((artistsProcessed / cohort.length) * 100).toFixed(1);
      console.log(
        `  [${pct}%] ${artistsProcessed}/${cohort.length} artists, ${totalEvents} events, ${apiCalls} API calls, ${errors} errors, ${rateLimited} rate-limits`,
      );
    }
  }

  // 4. Update batch record
  await sql`
    UPDATE enrich.ingest_batches
    SET status = 'active',
        completed_at = now(),
        stats = ${JSON.stringify({
          cohort_size: cohort.length,
          artists_processed: artistsProcessed,
          artists_with_events: artistsWithEvents,
          total_events: totalEvents,
          api_calls: apiCalls,
          errors,
          rate_limited: rateLimited,
          pages_per_artist: config.pages,
        })}::jsonb
    WHERE id = ${batchId}
  `.execute(db);

  console.log("\n=== Import Complete ===");
  console.log(`  Artists processed: ${artistsProcessed}`);
  console.log(`  Artists with events: ${artistsWithEvents} (${((artistsWithEvents / artistsProcessed) * 100).toFixed(1)}%)`);
  console.log(`  Total events: ${totalEvents}`);
  console.log(`  API calls: ${apiCalls}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Rate limited: ${rateLimited}`);

  await db.destroy();
}

// Export for testing
export { parseSetlist, selectCohort };

// Only run main when executed directly
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
