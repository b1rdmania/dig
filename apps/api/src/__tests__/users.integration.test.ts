/**
 * Discogs sign-in against a real Postgres (migration 038): sessions, the /v1/me
 * routes, and the crate read Record Bore makes. Discogs itself is not called -
 * the account and crates are written straight to the tables.
 *
 * Skipped when DATABASE_URL is not set, like the other integration suites.
 */
import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

const DATABASE_URL = process.env.DATABASE_URL;
const IN_SHOP = 990_000_001; // a master the test puts in the shop
const NOT_IN_SHOP = 990_000_002;
const BATCH = "00000000-0000-4000-8000-000000000038";

describe.skipIf(!DATABASE_URL)("users integration", () => {
  let app: FastifyInstance;
  let db: any;
  let store: typeof import("../users/store.js");
  let accountId: string;
  let token: string;

  beforeAll(async () => {
    process.env.DISCOGS_CONSUMER_KEY = "test-key";
    process.env.DISCOGS_CONSUMER_SECRET = "test-secret";
    process.env.USER_TOKEN_KEY = randomBytes(32).toString("base64");
    const { buildApp } = await import("../app.js");
    const built = await buildApp({ databaseUrl: DATABASE_URL! });
    app = built.app;
    db = built.db;
    await app.ready();
    store = await import("../users/store.js");

    await db.deleteFrom("users.accounts").where("discogs_user_id", "=", 424242).execute();
    await db.deleteFrom("catalog.masters").where("discogs_id", "in", [IN_SHOP]).execute();
    await db.insertInto("ingest.dump_batches")
      .values({ id: BATCH, dump_date: "2026-01-01", status: "completed" })
      .onConflict((oc: any) => oc.column("id").doNothing()).execute();
    await db.insertInto("catalog.masters")
      .values({ discogs_id: IN_SHOP, title: "Strings Of Life", data_quality: "Correct", batch_id: BATCH })
      .execute();

    accountId = await store.upsertAccount(db, { id: 424242, username: "crate_test" }, { token: "tok", secret: "sec" });
    token = await store.createSession(db, accountId);
    const base = { account_id: accountId, styles: ["Detroit Techno"], artist: "Rhythim Is Rhythim", label: "Transmat", year: 1987 };
    await db.insertInto("users.crate_items").values([
      { ...base, list: "want", release_discogs_id: 1, master_discogs_id: NOT_IN_SHOP, title: "Not Stocked", added_at: new Date("2025-01-02") },
      { ...base, list: "want", release_discogs_id: 2, master_discogs_id: IN_SHOP, title: "Strings Of Life", added_at: new Date("2024-01-01") },
      { ...base, list: "collection", release_discogs_id: 3, master_discogs_id: null, title: "White Label", styles: ["Acid"], added_at: null },
    ]).execute();
    await db.updateTable("users.accounts").set({ synced_at: new Date() }).where("id", "=", accountId).execute();
  });

  afterAll(async () => {
    await db?.deleteFrom("users.accounts").where("discogs_user_id", "=", 424242).execute();
    await db?.deleteFrom("catalog.masters").where("discogs_id", "=", IN_SHOP).execute();
    await db?.deleteFrom("ingest.dump_batches").where("id", "=", BATCH).execute();
    await app?.close();
    await db?.destroy();
  });

  it("stores the Discogs token only as ciphertext", async () => {
    const row = await db.selectFrom("users.accounts").selectAll().where("id", "=", accountId).executeTakeFirst();
    expect(row.token_enc).not.toContain("tok");
    expect(store.unseal(row.token_enc)).toBe("tok");
  });

  it("GET /v1/me knows the customer and counts both lists", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ username: "crate_test", wants: 2, collection: 1, syncing: false, sync_failed: false });
  });

  it("GET /v1/me refuses no session and a made-up one", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    const fake = randomBytes(32).toString("base64url");
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${fake}` } })).statusCode).toBe(401);
  });

  it("the crate read puts in-shop records first, and only they carry a link", async () => {
    const { summary, items } = await store.readCrates(db, accountId, { list: "want", limit: 10 });
    expect(items.map((i) => i.title)).toEqual(["Strings Of Life", "Not Stocked"]);
    expect(items[0].dig_url).toBe(`https://app.dig.baby/master/${IN_SHOP}`);
    expect(items[1].dig_url).toBeUndefined();
    expect(summary.wantlist).toEqual({ records: 2, in_this_shop: 1 });
    expect(summary.top_styles).toContain("Detroit Techno");
  });

  it("filters by style", async () => {
    const { items } = await store.readCrates(db, accountId, { list: "both", limit: 10, style: "acid" });
    expect(items.map((i) => i.title)).toEqual(["White Label"]);
  });

  it("login redirects to Discogs, or back to the page if Discogs refuses", async () => {
    // Discogs is not reachable from tests; a failed request token must land
    // the visitor back on the page, never on an error.
    const res = await app.inject({ method: "GET", url: "/v1/me/discogs/login?return=//evil.com" });
    expect(res.statusCode).toBe(302);
    const loc = String(res.headers.location);
    expect(loc.startsWith("https://www.discogs.com/oauth/authorize") || loc === "https://app.dig.baby/recordbore#dig_signin=failed").toBe(true);
  });

  it("a callback with an unknown request token goes back cancelled", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me/discogs/callback?oauth_token=nope&oauth_verifier=x" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://app.dig.baby/recordbore#dig_signin=cancelled");
  });

  it("logout ends the session; DELETE /v1/me forgets everything", async () => {
    const second = await store.createSession(db, accountId);
    const out = await app.inject({ method: "POST", url: "/v1/me/logout", headers: { authorization: `Bearer ${second}` } });
    expect(out.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${second}` } })).statusCode).toBe(401);

    const del = await app.inject({ method: "DELETE", url: "/v1/me", headers: { authorization: `Bearer ${token}` } });
    expect(del.statusCode).toBe(204);
    const left = await db.selectFrom("users.crate_items").select(db.fn.countAll().as("n")).where("account_id", "=", accountId).executeTakeFirst();
    expect(Number(left.n)).toBe(0);
    expect(await db.selectFrom("users.accounts").selectAll().where("id", "=", accountId).executeTakeFirst()).toBeUndefined();
  });
});
