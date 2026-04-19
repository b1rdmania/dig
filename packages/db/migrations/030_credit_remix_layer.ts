/**
 * Migration 030: Credit + remix layer.
 *
 * Adds the credit/remix tables that migration 026 deliberately dropped from
 * the slim master-first model. v1 was master-first and credit-light, but
 * remixes/productions are scene-defining content (e.g. MAW's remix career
 * is at least as important as their primary catalogue).
 *
 * See docs/credit-and-remix-extraction-plan.md for the full plan including
 * the two scoping rules:
 *
 *   - Rule A (carried in catalog.master_track_credits + master_release_credits):
 *     all credits on tracks/releases that belong to a master in our scope.
 *   - Rule B (carried in catalog.cross_scope_credits): all remix/production
 *     credits where the credited artist is in scope but the host release is
 *     NOT in scope (the MAW-on-Madonna case).
 *
 * Plus one optional extra:
 *   - catalog.artist_group_members: the small slice of group/member edges
 *     where both ends are scope artists (e.g. UR collective members,
 *     MAW = Louie + Kenny).
 *
 * All four tables are populated by scripts/build-scoped-db.ts at scope-build
 * time. Forward-only on the scoped DB. Safe to apply on dig-db too if anyone
 * wants to test there.
 *
 * down() drops in reverse order.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1. catalog.master_track_credits — Rule A, track-level
  // ---------------------------------------------------------------------------
  // One row per (master, track-position, artist, role). Track position joins
  // back to catalog.master_tracks.position. role is the NORMALISED bucket
  // (Remix / Producer / Mixed By / etc.); role_raw preserves the original
  // Discogs string so we can re-normalise without re-extracting.
  await sql`
    CREATE TABLE IF NOT EXISTS catalog.master_track_credits (
      id                  BIGSERIAL   PRIMARY KEY,
      master_discogs_id   INTEGER     NOT NULL,
      track_position      TEXT,
      track_title         TEXT,
      artist_discogs_id   INTEGER     NOT NULL,
      artist_name         TEXT        NOT NULL,
      anv                 TEXT,
      role                TEXT        NOT NULL,
      role_raw            TEXT,
      source_release_id   INTEGER     NOT NULL,
      built_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  // For master page tracklist render
  await sql`
    CREATE INDEX IF NOT EXISTS idx_mtc_master
      ON catalog.master_track_credits (master_discogs_id, track_position)
  `.execute(db);

  // For artist page "Credits & remixes" tabs (filter by role)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_mtc_artist_role
      ON catalog.master_track_credits (artist_discogs_id, role)
  `.execute(db);

  // De-dup constraint — same artist on same track in same role only once
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mtc
      ON catalog.master_track_credits (
        master_discogs_id,
        COALESCE(track_position, ''),
        artist_discogs_id,
        role
      )
  `.execute(db);

  await sql`
    COMMENT ON TABLE catalog.master_track_credits IS
      'Track-level credits per master, denormed at scope-build time from catalog.tracks + catalog.track_credits in the source DB. Rule A only (host release is in scope). role is the normalised vocab (Remix / Producer / Mixed By / Edit / Dub / Engineer / Mastered By / Written By / Vocals / Other); role_raw is the original Discogs string.'
  `.execute(db);

  // ---------------------------------------------------------------------------
  // 2. catalog.master_release_credits — Rule A, release-level
  // ---------------------------------------------------------------------------
  // Release-level credits that don't attach to a specific track:
  // "Mastered By", "Cover Photography", "A&R", "Distributed By", etc.
  // Lower priority than track credits but cheap to carry once filtered.
  await sql`
    CREATE TABLE IF NOT EXISTS catalog.master_release_credits (
      id                  BIGSERIAL   PRIMARY KEY,
      master_discogs_id   INTEGER     NOT NULL,
      source_release_id   INTEGER     NOT NULL,
      artist_discogs_id   INTEGER     NOT NULL,
      artist_name         TEXT        NOT NULL,
      anv                 TEXT,
      role                TEXT        NOT NULL,
      role_raw            TEXT,
      built_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_mrc_master
      ON catalog.master_release_credits (master_discogs_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_mrc_artist_role
      ON catalog.master_release_credits (artist_discogs_id, role)
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mrc
      ON catalog.master_release_credits (
        master_discogs_id,
        source_release_id,
        artist_discogs_id,
        role
      )
  `.execute(db);

  await sql`
    COMMENT ON TABLE catalog.master_release_credits IS
      'Release-level credits per master (Mastered By, Cover Art By, A&R, etc.) — Rule A only. Pulled but not necessarily surfaced; safety-carry so we never need to re-extract.'
  `.execute(db);

  // ---------------------------------------------------------------------------
  // 3. catalog.cross_scope_credits — Rule B
  // ---------------------------------------------------------------------------
  // Scope artist credited on a NON-scope release. The host master/release is
  // not in our catalog so we carry enough denormed data to render an outbound
  // card on the artist page (host title + label + year, link to Discogs).
  // These are TERMINAL — no traversal into them.
  await sql`
    CREATE TABLE IF NOT EXISTS catalog.cross_scope_credits (
      id                       BIGSERIAL   PRIMARY KEY,
      artist_discogs_id        INTEGER     NOT NULL,
      artist_name              TEXT        NOT NULL,
      anv                      TEXT,
      role                     TEXT        NOT NULL,
      role_raw                 TEXT,
      host_release_id          INTEGER     NOT NULL,
      host_release_title       TEXT        NOT NULL,
      host_release_year        INTEGER,
      host_primary_artist_name TEXT,
      host_label_name          TEXT,
      track_position           TEXT,
      track_title              TEXT,
      built_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_csc_artist
      ON catalog.cross_scope_credits (artist_discogs_id, role)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_csc_year
      ON catalog.cross_scope_credits (host_release_year)
      WHERE host_release_year IS NOT NULL
  `.execute(db);

  // De-dup: same artist remixing the same track on the same host release
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_csc
      ON catalog.cross_scope_credits (
        artist_discogs_id,
        host_release_id,
        COALESCE(track_position, ''),
        role
      )
  `.execute(db);

  await sql`
    COMMENT ON TABLE catalog.cross_scope_credits IS
      'Cross-scope catch (Rule B): scope artist credited on a NON-scope release with a remix/mix/production role. Terminal cards — link out to Discogs. Carries denormed host metadata so we never need to query the host release.'
  `.execute(db);

  // ---------------------------------------------------------------------------
  // 4. catalog.artist_group_members — small slice
  // ---------------------------------------------------------------------------
  // Only edges where BOTH ends are scope artists. Enables "Members of UR /
  // MAW / Wu-Tang / NWA" sidebars without restoring the full artist_groups /
  // artist_members tables.
  await sql`
    CREATE TABLE IF NOT EXISTS catalog.artist_group_members (
      group_artist_id   INTEGER NOT NULL,
      member_artist_id  INTEGER NOT NULL,
      built_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (group_artist_id, member_artist_id),
      CHECK (group_artist_id <> member_artist_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_agm_member
      ON catalog.artist_group_members (member_artist_id)
  `.execute(db);

  await sql`
    COMMENT ON TABLE catalog.artist_group_members IS
      'Artist group membership edges, scoped to pairs where BOTH artists are in catalog.artists. Enables "members" sidebar on group artist pages and "groups" sidebar on member artist pages without carrying the full source-DB artist_groups/artist_members tables.'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS catalog.artist_group_members`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.cross_scope_credits`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.master_release_credits`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.master_track_credits`.execute(db);
}
