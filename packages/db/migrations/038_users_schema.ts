/**
 * Migration 038: the `users` schema - Discogs sign-in for Record Bore.
 *
 * The first per-person data dig has held since 023 retired `auth`. It sits in
 * its own schema, apart from the catalog and the wine book, and nothing in
 * `catalog.*`, `enrich.*` or `wine.*` references it: dropping the schema
 * removes every trace of every customer.
 *
 * - accounts: one row per Discogs user. The Discogs access token and secret
 *   are AES-256-GCM ciphertext (key in USER_TOKEN_KEY, never in the DB), so a
 *   dump of this table cannot act as anyone on Discogs.
 * - sessions: the dig session. Only the SHA-256 of the token is stored.
 * - oauth_pending: OAuth 1.0a request tokens between "Sign in" and the
 *   Discogs callback. Short-lived; swept on every sign-in.
 * - crate_items: the customer's wantlist and collection as Discogs returned
 *   them, one row per (account, list, release). Replaced whole on each sync.
 */

import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS users`.execute(db);

  await sql`
    CREATE TABLE users.accounts (
      id BIGSERIAL PRIMARY KEY,
      discogs_user_id BIGINT NOT NULL UNIQUE,
      discogs_username TEXT NOT NULL,
      token_enc TEXT NOT NULL,
      secret_enc TEXT NOT NULL,
      synced_at TIMESTAMPTZ,
      sync_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE users.sessions (
      token_hash TEXT PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES users.accounts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `.execute(db);
  await sql`CREATE INDEX sessions_account_idx ON users.sessions (account_id)`.execute(db);

  await sql`
    CREATE TABLE users.oauth_pending (
      request_token TEXT PRIMARY KEY,
      request_secret TEXT NOT NULL,
      return_to TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE users.crate_items (
      account_id BIGINT NOT NULL REFERENCES users.accounts(id) ON DELETE CASCADE,
      list TEXT NOT NULL CHECK (list IN ('want', 'collection')),
      release_discogs_id BIGINT NOT NULL,
      master_discogs_id BIGINT,
      title TEXT NOT NULL,
      artist TEXT,
      label TEXT,
      year INT,
      styles TEXT[] NOT NULL DEFAULT '{}',
      added_at TIMESTAMPTZ,
      PRIMARY KEY (account_id, list, release_discogs_id)
    )
  `.execute(db);
  await sql`CREATE INDEX crate_items_master_idx ON users.crate_items (account_id, master_discogs_id)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS users CASCADE`.execute(db);
}
