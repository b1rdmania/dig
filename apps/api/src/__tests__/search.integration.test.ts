/**
 * Search v2 integration tests — seeded catalog data against the real app.
 *
 * Proves the properties the unit tests can't: stop-word names are searchable
 * ('simple' config), the last token prefix-matches (typeahead), the cursor
 * paginates without skips/dupes, and the type gate 400s retired types.
 *
 * Requires DATABASE_URL pointing at a migrated Postgres (033+). Skipped
 * when DATABASE_URL is not set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { sql } from "@dig/db";

const DATABASE_URL = process.env.DATABASE_URL;

const BATCH_ID = randomUUID();
const DUMP_DATE = "2026-02-01";

// IDs in a range unlikely to collide with real catalog data.
const BASE_ID = 900_000_000;

const ARTISTS = [
  { id: BASE_ID + 1, name: "Them" },              // pure stop word — the 'english' config killer
  { id: BASE_ID + 2, name: "Aphex Twin" },        // prefix target
  { id: BASE_ID + 3, name: "Theo Parrish" },      // shares 'the' prefix with "Them"
  { id: BASE_ID + 11, name: "Housemaster Quint" },
  { id: BASE_ID + 12, name: "Housemaster Reza" },
  { id: BASE_ID + 13, name: "Housemaster Sona" },
  { id: BASE_ID + 14, name: "Housemaster Tariq" },
  { id: BASE_ID + 15, name: "Housemaster Uma" },
];

const LABELS = [{ id: BASE_ID + 21, name: "Transmat" }];

const MASTERS = [
  { id: BASE_ID + 31, title: "Strings Of Life", artist: "Rhythim Is Rhythim", label: "Transmat", year: 1987 },
];

describe.skipIf(!DATABASE_URL)("search v2 integration (seeded)", () => {
  let app: FastifyInstance;
  let db: any;

  async function get(url: string) {
    const res = await app.inject({ method: "GET", url });
    return { status: res.statusCode, body: res.json() };
  }

  beforeAll(async () => {
    const { buildApp } = await import("../app.js");
    const built = await buildApp({ databaseUrl: DATABASE_URL! });
    app = built.app;
    db = built.db;
    await app.ready();

    await sql`
      INSERT INTO ingest.dump_batches (id, dump_date, status)
      VALUES (${BATCH_ID}::uuid, ${DUMP_DATE}, 'active')
    `.execute(db);

    for (const a of ARTISTS) {
      await sql`
        INSERT INTO catalog.artists (discogs_id, name, data_quality, batch_id, search_vector)
        VALUES (${a.id}, ${a.name}, 'Correct', ${BATCH_ID}::uuid,
                setweight(to_tsvector('simple', ${a.name}), 'A'))
      `.execute(db);
    }
    for (const l of LABELS) {
      await sql`
        INSERT INTO catalog.labels (discogs_id, name, data_quality, batch_id, search_vector)
        VALUES (${l.id}, ${l.name}, 'Correct', ${BATCH_ID}::uuid,
                setweight(to_tsvector('simple', ${l.name}), 'A'))
      `.execute(db);
    }
    for (const m of MASTERS) {
      await sql`
        INSERT INTO catalog.masters
          (discogs_id, title, year, data_quality, batch_id,
           primary_artist_name, primary_label_name, search_vector)
        VALUES
          (${m.id}, ${m.title}, ${m.year}, 'Correct', ${BATCH_ID}::uuid,
           ${m.artist}, ${m.label},
           setweight(to_tsvector('simple', ${m.title}), 'A')
           || setweight(to_tsvector('simple', ${m.artist}), 'B')
           || setweight(to_tsvector('simple', ${m.label}), 'C'))
      `.execute(db);
    }
  });

  afterAll(async () => {
    if (db) {
      await sql`DELETE FROM catalog.masters WHERE batch_id = ${BATCH_ID}::uuid`.execute(db).catch(() => {});
      await sql`DELETE FROM catalog.labels WHERE batch_id = ${BATCH_ID}::uuid`.execute(db).catch(() => {});
      await sql`DELETE FROM catalog.artists WHERE batch_id = ${BATCH_ID}::uuid`.execute(db).catch(() => {});
      await sql`DELETE FROM ingest.dump_batches WHERE id = ${BATCH_ID}::uuid`.execute(db).catch(() => {});
    }
    await app?.close();
    await db?.destroy();
  });

  it("finds an artist whose name is an English stop word", async () => {
    const { status, body } = await get("/v1/search?q=them&type=artist");
    expect(status).toBe(200);
    const names = body.results.map((r: any) => r.name);
    expect(names).toContain("Them");
    expect(body.meta.degraded).toBe(false);
  });

  it("prefix-matches the last token (typeahead)", async () => {
    const { status, body } = await get("/v1/search?q=aphex%20tw&type=artist");
    expect(status).toBe(200);
    expect(body.results.map((r: any) => r.name)).toContain("Aphex Twin");
  });

  it("ranks the exact name hit above prefix-sharing artists", async () => {
    const { status, body } = await get("/v1/search?q=them&type=artist");
    expect(status).toBe(200);
    expect(body.results[0].name).toBe("Them");
  });

  it("finds masters by title with denormed artist/label attached", async () => {
    const { status, body } = await get("/v1/search?q=strings%20of%20life&type=master");
    expect(status).toBe(200);
    const hit = body.results.find((r: any) => r.title === "Strings Of Life");
    expect(hit).toBeDefined();
    expect(hit.primary_artist).toBe("Rhythim Is Rhythim");
    expect(hit.primary_label).toBe("Transmat");
    expect(hit.year).toBe(1987);
  });

  it("returns a pinned top_match for an exact label name on untyped search", async () => {
    const { status, body } = await get("/v1/search?q=transmat");
    expect(status).toBe(200);
    expect(body.top_match).not.toBeNull();
    expect(body.top_match.type).toBe("label");
    expect(body.top_match.name).toBe("Transmat");
  });

  it("paginates with the cursor without skipping or duplicating", async () => {
    const page1 = await get("/v1/search?q=housemaster&type=artist&limit=2");
    expect(page1.status).toBe(200);
    expect(page1.body.results).toHaveLength(2);
    expect(page1.body.pagination.has_more).toBe(true);
    expect(page1.body.pagination.cursor).toBeTruthy();

    const page2 = await get(
      `/v1/search?q=housemaster&type=artist&limit=2&cursor=${encodeURIComponent(page1.body.pagination.cursor)}`,
    );
    expect(page2.status).toBe(200);
    expect(page2.body.results.length).toBeGreaterThan(0);

    const ids1 = new Set<number>(page1.body.results.map((r: any) => r.discogs_id as number));
    for (const r of page2.body.results) {
      expect(ids1.has(r.discogs_id)).toBe(false);
    }

    // Drain everything and verify total coverage (5 seeded matches)
    const seen = new Set<number>([...ids1]);
    let cursor = page2.body.pagination.cursor;
    for (const r of page2.body.results) seen.add(r.discogs_id);
    let guard = 0;
    while (cursor && guard++ < 10) {
      const page = await get(
        `/v1/search?q=housemaster&type=artist&limit=2&cursor=${encodeURIComponent(cursor)}`,
      );
      for (const r of page.body.results) {
        expect(seen.has(r.discogs_id)).toBe(false);
        seen.add(r.discogs_id);
      }
      cursor = page.body.pagination.cursor;
    }
    expect(seen.size).toBe(5);
  });

  it("400s the retired release type with a pointer to masters", async () => {
    const { status, body } = await get("/v1/search?q=anything&type=release");
    expect(status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.message).toContain("master");
  });

  it("400s unknown types", async () => {
    const { status, body } = await get("/v1/search?q=anything&type=banana");
    expect(status).toBe(400);
    expect(body.error.message).toContain("artist, label, master");
  });

  it("degrades cleanly on punctuation-only queries", async () => {
    const { status, body } = await get("/v1/search?q=%21%21%21");
    expect(status).toBe(200);
    expect(body.results).toHaveLength(0);
    expect(body.meta.degraded_reason).toBe("empty_tsquery");
  });
});
