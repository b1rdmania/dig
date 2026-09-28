// ---------------------------------------------------------------------------
// The users schema (migration 038): token encryption, dig sessions, the
// wantlist/collection sync, and the read Record Bore's crate tool makes.
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sql, type Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { fetchList, type Consumer, type CrateRow } from "./discogs.js";

// --- Encryption at rest ------------------------------------------------------
// AES-256-GCM, stored as base64url "iv.tag.ciphertext". The key is
// USER_TOKEN_KEY (32 bytes, base64); without it sign-in stays switched off.

function tokenKey(): Buffer | null {
  const raw = String(process.env.USER_TOKEN_KEY ?? "").trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function isSignInConfigured(): boolean {
  return tokenKey() !== null;
}

export function seal(plain: string, key = tokenKey()): string {
  if (!key) throw new Error("USER_TOKEN_KEY is not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}

export function unseal(sealed: string, key = tokenKey()): string {
  if (!key) throw new Error("USER_TOKEN_KEY is not set");
  const [iv, tag, ct] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// --- Sessions ----------------------------------------------------------------

const SESSION_DAYS = 90;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Kysely<Database>, accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insertInto("users.sessions").values({
    token_hash: hash(token),
    account_id: accountId,
    expires_at: new Date(Date.now() + SESSION_DAYS * 86_400_000),
  }).execute();
  return token;
}

export async function endSession(db: Kysely<Database>, token: string): Promise<void> {
  await db.deleteFrom("users.sessions").where("token_hash", "=", hash(token)).execute();
}

/** "Authorization: Bearer <dig session>" - the X-API-Key header stays for keys. */
export function bearer(headers: Record<string, unknown>): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(String(headers.authorization ?? "").trim());
  return m ? m[1] : null;
}

export interface Customer {
  accountId: string;
  username: string;
  wants: number;
  collection: number;
  syncedAt: Date | null;
  syncError: string | null;
}

export async function customerForToken(db: Kysely<Database>, token: string | null): Promise<Customer | null> {
  if (!token) return null;
  const row = await db
    .selectFrom("users.sessions as s")
    .innerJoin("users.accounts as a", "a.id", "s.account_id")
    .select(["a.id", "a.discogs_username", "a.synced_at", "a.sync_error"])
    .select((eb) => [
      eb.selectFrom("users.crate_items as c").whereRef("c.account_id", "=", "a.id").where("c.list", "=", "want")
        .select(sql<string>`count(*)`.as("n")).as("wants"),
      eb.selectFrom("users.crate_items as c").whereRef("c.account_id", "=", "a.id").where("c.list", "=", "collection")
        .select(sql<string>`count(*)`.as("n")).as("collection"),
    ])
    .where("s.token_hash", "=", hash(token))
    .where("s.expires_at", ">", new Date())
    .executeTakeFirst();
  if (!row) return null;
  await db.updateTable("users.sessions").set({ last_seen_at: new Date() }).where("token_hash", "=", hash(token)).execute();
  return {
    accountId: String(row.id),
    username: row.discogs_username,
    wants: Number(row.wants ?? 0),
    collection: Number(row.collection ?? 0),
    syncedAt: row.synced_at,
    syncError: row.sync_error,
  };
}

// --- Accounts ----------------------------------------------------------------

export async function upsertAccount(
  db: Kysely<Database>,
  identity: { id: number; username: string },
  access: { token: string; secret: string },
): Promise<string> {
  const row = await db.insertInto("users.accounts").values({
    discogs_user_id: identity.id,
    discogs_username: identity.username,
    token_enc: seal(access.token),
    secret_enc: seal(access.secret),
  }).onConflict((oc) => oc.column("discogs_user_id").doUpdateSet({
    discogs_username: identity.username,
    token_enc: seal(access.token),
    secret_enc: seal(access.secret),
    updated_at: new Date(),
  })).returning("id").executeTakeFirstOrThrow();
  return String(row.id);
}

/** Forget the customer: account, sessions and crates go (FK cascade). */
export async function deleteAccount(db: Kysely<Database>, accountId: string): Promise<void> {
  await db.deleteFrom("users.accounts").where("id", "=", accountId).execute();
}

// --- Sync --------------------------------------------------------------------

const RESYNC_AFTER_MS = 24 * 3_600_000;
const syncing = new Set<string>();

export function isStale(c: Customer): boolean {
  return !c.syncedAt || Date.now() - c.syncedAt.getTime() > RESYNC_AFTER_MS;
}

/**
 * Pull both lists from Discogs and replace the stored copy whole. One sync per
 * account at a time on this machine; a failure is kept on the account row so
 * the Bore can say the crates didn't come through instead of "you own nothing".
 */
export async function syncCrates(
  db: Kysely<Database>,
  consumer: Consumer,
  accountId: string,
  log: (msg: string, extra?: Record<string, unknown>) => void,
): Promise<void> {
  if (syncing.has(accountId)) return;
  syncing.add(accountId);
  const started = Date.now();
  try {
    const acct = await db.selectFrom("users.accounts").select(["discogs_username", "token_enc", "secret_enc"])
      .where("id", "=", accountId).executeTakeFirst();
    if (!acct) return;
    const token = unseal(acct.token_enc);
    const secret = unseal(acct.secret_enc);
    const wants = await fetchList(consumer, token, secret, acct.discogs_username, "want");
    const collection = await fetchList(consumer, token, secret, acct.discogs_username, "collection");
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom("users.crate_items").where("account_id", "=", accountId).execute();
      const rows = [
        ...dedupe(wants).map((r) => ({ ...r, account_id: accountId, list: "want" as const })),
        ...dedupe(collection).map((r) => ({ ...r, account_id: accountId, list: "collection" as const })),
      ];
      for (let i = 0; i < rows.length; i += 500) {
        await trx.insertInto("users.crate_items").values(rows.slice(i, i + 500)).execute();
      }
      await trx.updateTable("users.accounts").set({ synced_at: new Date(), sync_error: null, updated_at: new Date() })
        .where("id", "=", accountId).execute();
    });
    log("users:sync_done", { wants: wants.length, collection: collection.length, elapsed_ms: Date.now() - started });
  } catch (err: any) {
    const message = String(err?.message ?? err).slice(0, 300);
    log("users:sync_failed", { error: message, elapsed_ms: Date.now() - started });
    await db.updateTable("users.accounts").set({ sync_error: message, updated_at: new Date() })
      .where("id", "=", accountId).execute().catch(() => {});
  } finally {
    syncing.delete(accountId);
  }
}

// A record can sit in two collection folders; the primary key can't.
function dedupe(rows: CrateRow[]): CrateRow[] {
  const seen = new Set<number>();
  return rows.filter((r) => (seen.has(r.release_discogs_id) ? false : (seen.add(r.release_discogs_id), true)));
}

// --- The Bore's read ---------------------------------------------------------

export interface CrateItemOut {
  list: "want" | "collection";
  title: string;
  artist: string | null;
  label: string | null;
  year: number | null;
  styles: string[];
  /** Present only when the master is in the shop - the link the Bore may use. */
  dig_url?: string;
}

/**
 * The customer's records for the Bore: in-shop records first (they carry a
 * dig_url, so the answer can link them), newest additions next. The summary
 * is what the Bore sizes a customer up from without reading every row.
 */
export async function readCrates(
  db: Kysely<Database>,
  accountId: string,
  opts: { list: "want" | "collection" | "both"; limit: number; style?: string },
): Promise<{ summary: Record<string, unknown>; items: CrateItemOut[] }> {
  let q = db.selectFrom("users.crate_items as c")
    .leftJoin("catalog.masters as m", (j) => j.onRef("m.discogs_id", "=", sql<number>`c.master_discogs_id`))
    .select(["c.list", "c.title", "c.artist", "c.label", "c.year", "c.styles", "c.added_at", "m.discogs_id as in_shop"])
    .where("c.account_id", "=", accountId);
  if (opts.list !== "both") q = q.where("c.list", "=", opts.list);
  if (opts.style) q = q.where(sql<boolean>`${opts.style} ILIKE ANY (c.styles)`);
  const rows = await q
    .orderBy(sql`m.discogs_id IS NULL`)
    .orderBy("c.added_at", "desc")
    .limit(opts.limit)
    .execute();

  const counts = await db.selectFrom("users.crate_items as c")
    .leftJoin("catalog.masters as m", (j) => j.onRef("m.discogs_id", "=", sql<number>`c.master_discogs_id`))
    .select(["c.list", sql<string>`count(*)`.as("n"), sql<string>`count(m.discogs_id)`.as("in_shop")])
    .where("c.account_id", "=", accountId)
    .groupBy("c.list")
    .execute();
  const top = async (col: "label" | "artist") =>
    (await db.selectFrom("users.crate_items").select([col, sql<string>`count(*)`.as("n")])
      .where("account_id", "=", accountId).where(col, "is not", null)
      .groupBy(col).orderBy(sql`count(*)`, "desc").limit(8).execute()).map((r: any) => r[col]);
  const topStyles = (await sql<{ style: string }>`
    SELECT s AS style FROM users.crate_items, unnest(styles) s
    WHERE account_id = ${accountId} GROUP BY s ORDER BY count(*) DESC LIMIT 8
  `.execute(db)).rows.map((r) => r.style);

  const summary: Record<string, unknown> = { top_styles: topStyles, top_labels: await top("label"), top_artists: await top("artist") };
  for (const c of counts) {
    summary[c.list === "want" ? "wantlist" : "collection"] = { records: Number(c.n), in_this_shop: Number(c.in_shop) };
  }

  return {
    summary,
    items: rows.map((r) => ({
      list: r.list,
      title: r.title,
      artist: r.artist,
      label: r.label,
      year: r.year,
      styles: r.styles,
      ...(r.in_shop ? { dig_url: `https://app.dig.baby/master/${r.in_shop}` } : {}),
    })),
  };
}
