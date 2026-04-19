/**
 * Migration 031: Credit-build audit marker.
 *
 * Records each credit-extraction pass so we can answer:
 *   - "Which scope manifest was used to populate the credit tables?"
 *   - "When were the credits last refreshed?"
 *   - "How many rows did we pull and from where?"
 *
 * One row per credit-build run. Written by scripts/build-scoped-db.ts at the
 * end of the credit phases when a Scope Manifest is in use. The
 * `manifest_id` (e.g. "v2-house-techno", "hip-hop-1979-1999") is the join
 * key against packages/db/scope-manifests/<manifest_id>.yaml.
 *
 * Forward-only.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.credit_build_audit (
      id                      BIGSERIAL   PRIMARY KEY,
      manifest_id             TEXT        NOT NULL,
      manifest_version        TEXT,
      source_batch_id         UUID,
      track_credits_count     INTEGER     NOT NULL DEFAULT 0,
      release_credits_count   INTEGER     NOT NULL DEFAULT 0,
      cross_scope_count       INTEGER     NOT NULL DEFAULT 0,
      group_member_count      INTEGER     NOT NULL DEFAULT 0,
      role_vocab              JSONB,
      notes                   TEXT,
      built_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_credit_build_audit_manifest
      ON enrich.credit_build_audit (manifest_id, built_at DESC)
  `.execute(db);

  await sql`
    COMMENT ON TABLE enrich.credit_build_audit IS
      'One row per credit-extraction run. manifest_id matches packages/db/scope-manifests/<id>.yaml. Lets us answer "which manifest is this DB built from" + "when were credits last refreshed".'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS enrich.credit_build_audit`.execute(db);
}
