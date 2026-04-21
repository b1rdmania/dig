/**
 * Credits domain layer (migration 030 / Phase 5).
 *
 * Surfaces the four credit tables built by `scripts/build-scoped-db.ts`:
 *
 *   - catalog.master_track_credits    — Rule A, track-level
 *   - catalog.master_release_credits  — Rule A, release-level (Mastered By, A&R…)
 *   - catalog.cross_scope_credits     — Rule B, scope-artist on out-of-scope host
 *   - catalog.artist_group_members    — group ↔ member edges (both in scope)
 *
 * Public functions are intentionally narrow and SQL-light. The frontend wires
 * them up as:
 *
 *   - artist page → "Remixes & productions" (Rule A grouped by master)
 *                 → "Cross-scope credits"  (Rule B terminal cards, link to Discogs)
 *                 → "Members / Groups"     (artist_group_members edges)
 *   - master page → per-track credit list  (track_position join)
 *                 → release-level credit strip (Mastered By, A&R, etc.)
 *
 * No SET LOCAL statement_timeout calls in here — callers are expected to wrap
 * in a transaction with the appropriate budget (artist-level reads are 8s,
 * master-level reads 12s, see apps/api/src/routes/v1/entities.ts).
 */
import { sql, type Kysely } from "kysely";
import type { Database } from "@dig/db";
import { expandArtistAliasIds } from "./traversal.js";

// ---------------------------------------------------------------------------
// Shape: per-master credit summary on artist pages
// ---------------------------------------------------------------------------
// We collapse the (potentially many) credit rows into one card per master so
// the artist-page UI doesn't have to render a flat list of 5,000 line items.
export interface ArtistMasterCredit {
  master_discogs_id: number;
  master_title: string | null;
  master_year: number | null;
  primary_artist_discogs_id: number | null;
  primary_artist_name: string | null;
  primary_label_discogs_id: number | null;
  primary_label_name: string | null;
  /** Distinct normalised roles this artist has on this master */
  roles: string[];
  /** Per-track lines (track_position + role) for the optional expand view */
  track_lines: Array<{
    track_position: string | null;
    track_title: string | null;
    role: string;
  }>;
  /** Whether this master has any release-level credit (Mastered By, A&R…) too */
  has_release_level: boolean;
}

export interface ArtistMasterCreditsResponse {
  links: ArtistMasterCredit[];
  pagination: {
    cursor: string | null;
    has_more: boolean;
    total_estimate: number | null;
  };
  meta: {
    source_type: "artist";
    source_discogs_id: number;
    link_type: "rule_a_credits";
    role_filter: string | null;
    elapsed_ms: number;
  };
}

const ROLE_ALIASES: Record<string, string[]> = {
  remix:   ["Remix", "Edit", "Dub"],
  produce: ["Producer", "Additional Production"],
  mix:     ["Mixed By"],
  master:  ["Mastered By"],
  write:   ["Written By"],
  vocal:   ["Vocals"],
  engineer:["Engineer"],
};

function expandRoleFilter(roleFilter?: string | null): string[] | null {
  if (!roleFilter) return null;
  const alias = ROLE_ALIASES[roleFilter.toLowerCase()];
  if (alias) return alias;
  // Pass through as-is if caller specified an exact normalised role
  return [roleFilter];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(n: number | undefined): number {
  if (!n || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// ---------------------------------------------------------------------------
// Artist → Rule A credits (both track + release-level merged into per-master)
// ---------------------------------------------------------------------------
// One row per master where this artist has at least one Rule A credit. We
// aggregate roles + track lines client-side from a single composed query.
//
// NOTE: this query intentionally hits both master_track_credits and
// master_release_credits in two separate selects + a node-side merge rather
// than a single UNION. Reason: the indexes on (artist_discogs_id, role) make
// each lookup O(matching-rows-only); UNION-ALL into a single CTE was 4-6x
// slower in dev because the planner couldn't push role filters down cleanly.
export async function getArtistRuleACredits(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
  opts: {
    limit?: number;
    roleFilter?: string | null;
    /** If true, also match credits under this artist's aliases. Default: true. */
    includeAliases?: boolean;
    /**
     * If true, drop credits whose master's primary artist IS in the alias
     * set. Used by the Remixes tab on the artist page so we don't double-
     * show records where the artist is already the headline credit.
     */
    excludeSelfPrimary?: boolean;
  } = {},
): Promise<ArtistMasterCreditsResponse> {
  const start = Date.now();
  const limit = clampLimit(opts.limit);
  const roles = expandRoleFilter(opts.roleFilter);
  const includeAliases = opts.includeAliases !== false;

  const artistIds = includeAliases
    ? await expandArtistAliasIds(db, artistDiscogsId, batchId)
    : [artistDiscogsId];

  let trackQ = db
    .selectFrom("catalog.master_track_credits as mtc")
    .select([
      "mtc.master_discogs_id",
      "mtc.track_position",
      "mtc.track_title",
      "mtc.role",
    ])
    .where("mtc.artist_discogs_id", "in", artistIds);
  if (roles) trackQ = trackQ.where("mtc.role", "in", roles);

  let releaseQ = db
    .selectFrom("catalog.master_release_credits as mrc")
    .select(["mrc.master_discogs_id", "mrc.role"])
    .where("mrc.artist_discogs_id", "in", artistIds);
  if (roles) releaseQ = releaseQ.where("mrc.role", "in", roles);

  const [trackRows, releaseRows] = await Promise.all([
    trackQ.execute(),
    releaseQ.execute(),
  ]);

  // Merge into per-master buckets
  type Bucket = {
    master_discogs_id: number;
    roles: Set<string>;
    track_lines: ArtistMasterCredit["track_lines"];
    has_release_level: boolean;
  };
  const buckets = new Map<number, Bucket>();

  const ensure = (mid: number): Bucket => {
    let b = buckets.get(mid);
    if (!b) {
      b = { master_discogs_id: mid, roles: new Set(), track_lines: [], has_release_level: false };
      buckets.set(mid, b);
    }
    return b;
  };

  for (const r of trackRows) {
    const b = ensure(r.master_discogs_id);
    b.roles.add(r.role);
    b.track_lines.push({
      track_position: r.track_position,
      track_title: r.track_title,
      role: r.role,
    });
  }
  for (const r of releaseRows) {
    const b = ensure(r.master_discogs_id);
    b.roles.add(r.role);
    b.has_release_level = true;
  }

  if (buckets.size === 0) {
    return {
      links: [],
      pagination: { cursor: null, has_more: false, total_estimate: 0 },
      meta: {
        source_type: "artist",
        source_discogs_id: artistDiscogsId,
        link_type: "rule_a_credits",
        role_filter: opts.roleFilter ?? null,
        elapsed_ms: Date.now() - start,
      },
    };
  }

  // Hydrate master metadata (one round trip)
  const masterIds = Array.from(buckets.keys());
  const masters = await db
    .selectFrom("catalog.masters")
    .select([
      "discogs_id",
      "title",
      "year",
      "primary_artist_discogs_id",
      "primary_artist_name",
      "primary_label_discogs_id",
      "primary_label_name",
      "scene_weight",
    ])
    .where("discogs_id", "in", masterIds)
    .where("batch_id", "=", batchId)
    .execute();

  const masterMap = new Map(masters.map((m) => [m.discogs_id, m]));
  const artistIdSet = new Set(artistIds);
  const total = buckets.size;
  const links: ArtistMasterCredit[] = Array.from(buckets.values())
    .map((b) => {
      const m = masterMap.get(b.master_discogs_id);
      return {
        master_discogs_id: b.master_discogs_id,
        master_title: m?.title ?? null,
        master_year: m?.year ?? null,
        primary_artist_discogs_id: m?.primary_artist_discogs_id ?? null,
        primary_artist_name: m?.primary_artist_name ?? null,
        primary_label_discogs_id: m?.primary_label_discogs_id ?? null,
        primary_label_name: m?.primary_label_name ?? null,
        roles: Array.from(b.roles).sort(),
        track_lines: b.track_lines.sort((a, c) =>
          (a.track_position ?? "").localeCompare(c.track_position ?? "", undefined, { numeric: true }),
        ),
        has_release_level: b.has_release_level,
        _scene_weight: m?.scene_weight ?? 0,
        _year: m?.year ?? 0,
      };
    })
    // Drop credits that point at masters we couldn't hydrate (rare — usually
    // a quality-suppressed or out-of-batch master that slipped through)
    .filter((l) => l.master_title !== null)
    // Remixes tab: drop masters where the artist (or any alias) is the
    // primary credit — those already appear in the 12" / LP tabs.
    .filter((l) =>
      !opts.excludeSelfPrimary ||
      l.primary_artist_discogs_id == null ||
      !artistIdSet.has(l.primary_artist_discogs_id),
    )
    // Order for the Remixes tab is chronological (oldest → newest) to
    // match the rest of the artist page — reading a catalogue forward
    // in time tells the arc of a producer's remix work. For non-remix
    // credits we keep the existing scene_weight-first ranking (that
    // surface is ranked by importance, not timeline).
    .sort((a: any, b: any) => {
      if (opts.excludeSelfPrimary) {
        const ya = a._year || Infinity;
        const yb = b._year || Infinity;
        return (ya - yb) || (a.master_discogs_id - b.master_discogs_id);
      }
      return (
        b._scene_weight - a._scene_weight ||
        b._year - a._year ||
        a.master_discogs_id - b.master_discogs_id
      );
    })
    .slice(0, limit)
    .map(({ _scene_weight: _w, _year: _y, ...rest }: any) => rest as ArtistMasterCredit);

  return {
    links,
    pagination: {
      cursor: null,
      has_more: total > limit,
      total_estimate: total,
    },
    meta: {
      source_type: "artist",
      source_discogs_id: artistDiscogsId,
      link_type: "rule_a_credits",
      role_filter: opts.roleFilter ?? null,
      elapsed_ms: Date.now() - start,
    },
  };
}

// ---------------------------------------------------------------------------
// Artist → cross-scope credits (Rule B, terminal cards)
// ---------------------------------------------------------------------------
export interface CrossScopeCreditCard {
  host_release_id: number;
  host_release_title: string;
  host_release_year: number | null;
  host_primary_artist_name: string | null;
  host_label_name: string | null;
  track_position: string | null;
  track_title: string | null;
  role: string;
  role_raw: string | null;
  /** Outbound link target — we don't host this entity */
  discogs_release_url: string;
}

export interface CrossScopeCreditsResponse {
  links: CrossScopeCreditCard[];
  pagination: {
    cursor: string | null;
    has_more: boolean;
    total_estimate: number | null;
  };
  meta: {
    source_type: "artist";
    source_discogs_id: number;
    link_type: "cross_scope_credits";
    role_filter: string | null;
    elapsed_ms: number;
  };
}

export async function getArtistCrossScopeCredits(
  db: Kysely<Database>,
  artistDiscogsId: number,
  opts: { limit?: number; roleFilter?: string | null } = {},
): Promise<CrossScopeCreditsResponse> {
  const start = Date.now();
  const limit = clampLimit(opts.limit);
  const roles = expandRoleFilter(opts.roleFilter);

  let q = db
    .selectFrom("catalog.cross_scope_credits as csc")
    .select([
      "csc.host_release_id",
      "csc.host_release_title",
      "csc.host_release_year",
      "csc.host_primary_artist_name",
      "csc.host_label_name",
      "csc.track_position",
      "csc.track_title",
      "csc.role",
      "csc.role_raw",
    ])
    .where("csc.artist_discogs_id", "=", artistDiscogsId);
  if (roles) q = q.where("csc.role", "in", roles);

  // We over-fetch by 1 to compute has_more cheaply
  const rows = await q
    // Chronological (oldest → newest) to match the rest of the artist
    // page. NULLs last so undated credits sink to the bottom.
    .orderBy("csc.host_release_year", sql`asc nulls last`)
    .orderBy("csc.host_release_id", "asc")
    .limit(limit + 1)
    .execute();

  const hasMore = rows.length > limit;
  const slice = rows.slice(0, limit);

  return {
    links: slice.map((r) => ({
      host_release_id: r.host_release_id,
      host_release_title: r.host_release_title,
      host_release_year: r.host_release_year,
      host_primary_artist_name: r.host_primary_artist_name,
      host_label_name: r.host_label_name,
      track_position: r.track_position,
      track_title: r.track_title,
      role: r.role,
      role_raw: r.role_raw,
      discogs_release_url: `https://www.discogs.com/release/${r.host_release_id}`,
    })),
    pagination: {
      cursor: null,
      has_more: hasMore,
      total_estimate: null,
    },
    meta: {
      source_type: "artist",
      source_discogs_id: artistDiscogsId,
      link_type: "cross_scope_credits",
      role_filter: opts.roleFilter ?? null,
      elapsed_ms: Date.now() - start,
    },
  };
}

// ---------------------------------------------------------------------------
// Master → credits (per-track + release-level)
// ---------------------------------------------------------------------------
export interface MasterTrackCreditLine {
  track_position: string | null;
  track_title: string | null;
  artist_discogs_id: number;
  artist_name: string;
  anv: string | null;
  role: string;
  role_raw: string | null;
}

export interface MasterReleaseCreditLine {
  artist_discogs_id: number;
  artist_name: string;
  anv: string | null;
  role: string;
  role_raw: string | null;
}

export interface MasterCreditsResponse {
  master_discogs_id: number;
  /** Per-track credits, ordered by track position (numeric-aware) */
  track_credits: MasterTrackCreditLine[];
  /** Release-level credits — Mastered By, A&R, Cover Art, etc. */
  release_credits: MasterReleaseCreditLine[];
  meta: { elapsed_ms: number };
}

export async function getMasterCredits(
  db: Kysely<Database>,
  masterDiscogsId: number,
): Promise<MasterCreditsResponse> {
  const start = Date.now();
  const [trackRows, releaseRows] = await Promise.all([
    db
      .selectFrom("catalog.master_track_credits")
      .select([
        "track_position",
        "track_title",
        "artist_discogs_id",
        "artist_name",
        "anv",
        "role",
        "role_raw",
      ])
      .where("master_discogs_id", "=", masterDiscogsId)
      .execute(),
    db
      .selectFrom("catalog.master_release_credits")
      .select([
        "artist_discogs_id",
        "artist_name",
        "anv",
        "role",
        "role_raw",
      ])
      .where("master_discogs_id", "=", masterDiscogsId)
      .execute(),
  ]);

  const tracks: MasterTrackCreditLine[] = trackRows
    .slice()
    .sort((a, b) => {
      const ax = numericLead(a.track_position);
      const bx = numericLead(b.track_position);
      if (ax !== bx) return ax - bx;
      return (a.track_position ?? "").localeCompare(b.track_position ?? "", undefined, { numeric: true });
    });

  // De-dup release-level credits at app layer too (in case of build hiccups)
  const seen = new Set<string>();
  const releases: MasterReleaseCreditLine[] = [];
  for (const r of releaseRows) {
    const k = `${r.artist_discogs_id}|${r.role}`;
    if (seen.has(k)) continue;
    seen.add(k);
    releases.push({
      artist_discogs_id: r.artist_discogs_id,
      artist_name: r.artist_name,
      anv: r.anv,
      role: r.role,
      role_raw: r.role_raw,
    });
  }

  return {
    master_discogs_id: masterDiscogsId,
    track_credits: tracks,
    release_credits: releases,
    meta: { elapsed_ms: Date.now() - start },
  };
}

function numericLead(pos: string | null): number {
  if (!pos) return Number.MAX_SAFE_INTEGER;
  const m = pos.match(/(\d+)/);
  if (!m) return Number.MAX_SAFE_INTEGER - 1;
  return parseInt(m[1], 10);
}

// ---------------------------------------------------------------------------
// Artist → group/member edges — the "See also" surface
// ---------------------------------------------------------------------------
// House & techno leans heavily on the pattern "group act with solo-producer
// members" (MAW ↔ Kenny Dope/Louie Vega, Inner City ↔ Kevin Saunderson,
// Underground Resistance ↔ Jeff Mills / Mad Mike / Rob Hood). Rather than
// merging them as aliases — they produce musically distinct catalogues —
// we surface them as "see also" edges so users can jump sideways.
//
// Three directions:
//   • groups     — groups this artist is a member of
//   • members    — members of this artist (when it *is* a group)
//   • bandmates  — other members of any group this artist belongs to
//
// Each edge is filtered to in-scope entities and annotated with a
// `master_count` so the UI can order by connection weight and the user can
// see at-a-glance whether a hop will actually land somewhere with records.

export interface ArtistGroupEdge {
  discogs_id: number;
  name: string | null;
  /** How many in-scope masters this entity has. Used for ordering + badges. */
  master_count: number;
}

export interface ArtistGroupsAndMembersResponse {
  artist_discogs_id: number;
  /** Groups this artist is a member of (e.g. "MAW" for Louie Vega) */
  groups: ArtistGroupEdge[];
  /** Members of this artist (e.g. Louie Vega, Kenny Dope for "MAW") */
  members: ArtistGroupEdge[];
  /** Other members of any group this artist belongs to (excludes self) */
  bandmates: ArtistGroupEdge[];
  meta: { elapsed_ms: number };
}

export async function getArtistGroupsAndMembers(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
): Promise<ArtistGroupsAndMembersResponse> {
  const start = Date.now();

  // One round-trip. Each row carries a `kind` tag so we can split on return.
  // In-scope master counts come from a lateral join to catalog.master_artists;
  // the join doubles as the in-scope filter (`master_count > 0`).
  const { rows } = await sql<{
    kind: "group" | "member" | "bandmate";
    discogs_id: number;
    name: string | null;
    master_count: number;
  }>`
    WITH groups_of_artist AS (
      SELECT group_artist_id
      FROM catalog.artist_group_members
      WHERE member_artist_id = ${artistDiscogsId}
    ),
    edges AS (
      -- Groups the artist is a member of
      SELECT 'group'::text AS kind, agm.group_artist_id AS discogs_id
      FROM catalog.artist_group_members agm
      WHERE agm.member_artist_id = ${artistDiscogsId}
      UNION ALL
      -- Members of this artist (when this artist is itself a group)
      SELECT 'member'::text AS kind, agm.member_artist_id AS discogs_id
      FROM catalog.artist_group_members agm
      WHERE agm.group_artist_id = ${artistDiscogsId}
      UNION ALL
      -- Other members of groups this artist belongs to — distinct so
      -- someone in two shared groups still only shows once.
      SELECT DISTINCT 'bandmate'::text AS kind, agm.member_artist_id AS discogs_id
      FROM catalog.artist_group_members agm
      JOIN groups_of_artist g ON g.group_artist_id = agm.group_artist_id
      WHERE agm.member_artist_id <> ${artistDiscogsId}
    )
    SELECT e.kind, e.discogs_id, a.name, mc.n::int AS master_count
    FROM edges e
    JOIN catalog.artists a
      ON a.discogs_id = e.discogs_id
     AND a.batch_id   = ${batchId}
    JOIN LATERAL (
      SELECT COUNT(DISTINCT master_discogs_id) AS n
      FROM catalog.master_artists
      WHERE artist_discogs_id = e.discogs_id
        AND batch_id = ${batchId}
    ) mc ON mc.n > 0
    ORDER BY mc.n DESC, a.name ASC
  `.execute(db);

  const groups: ArtistGroupEdge[] = [];
  const members: ArtistGroupEdge[] = [];
  const bandmates: ArtistGroupEdge[] = [];
  for (const r of rows) {
    const edge: ArtistGroupEdge = {
      discogs_id: r.discogs_id,
      name: r.name,
      master_count: r.master_count,
    };
    if (r.kind === "group") groups.push(edge);
    else if (r.kind === "member") members.push(edge);
    else bandmates.push(edge);
  }

  return {
    artist_discogs_id: artistDiscogsId,
    groups,
    members,
    bandmates,
    meta: { elapsed_ms: Date.now() - start },
  };
}

// ---------------------------------------------------------------------------
// Artist → close collaborators (the "credit constellation")
// ---------------------------------------------------------------------------
// Dance music doesn't run on bands. It runs on credit constellations —
// producer/engineer/mix partnerships, vocalist pairings, long-running studio
// collectives (Def Mix, Murk, Basement Boys) that never took a single artist
// name but show up together on record after record.
//
// This query finds them. For masters where the subject artist is *any*
// credited artist (so alias-consolidated), we aggregate every other artist
// who shares Producer / Engineer / Mixed By / Written By / Vocals / Remix /
// Mastered By / Additional Production credits on those same masters. Rank
// by distinct masters together so a one-off 8-way remix package doesn't
// drown out someone who genuinely worked with the subject over years.
//
// Roles are returned ordered by frequency (the primary role goes first), so
// a name like "David Morales" on Knuckles surfaces as "Remix · Mixed By"
// and "Eric Kupper" surfaces as "Engineer · Producer".

export interface ArtistCollaborator {
  discogs_id: number;
  name: string | null;
  /** Distinct in-scope masters the two appear on together. */
  masters_together: number;
  /** Normalised roles taken on those masters, most-frequent first. */
  roles: string[];
}

export interface ArtistCollaboratorsResponse {
  artist_discogs_id: number;
  collaborators: ArtistCollaborator[];
  meta: { elapsed_ms: number };
}

export async function getArtistCollaborators(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
  opts: { limit?: number } = {},
): Promise<ArtistCollaboratorsResponse> {
  const start = Date.now();
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 30));
  const artistIds = await expandArtistAliasIds(db, artistDiscogsId, batchId);

  // Single round-trip. The CTE chain is:
  //   primary_masters — masters where any alias is a credited artist
  //   credits         — track + release credits on those masters, excluding
  //                     rows where the collaborator IS the artist/alias
  //   role_counts     — per (collaborator, role) count for role ordering
  //   ranked          — per-collaborator distinct-master count + role array
  //                     ordered by frequency (ties broken alphabetically)
  const { rows } = await sql<{
    discogs_id: number;
    name: string | null;
    masters_together: number;
    roles: string[];
  }>`
    WITH primary_masters AS (
      SELECT DISTINCT master_discogs_id
      FROM catalog.master_artists
      WHERE artist_discogs_id = ANY(${artistIds})
        AND batch_id = ${batchId}
    ),
    credits AS (
      SELECT mtc.master_discogs_id, mtc.artist_discogs_id, mtc.role
      FROM catalog.master_track_credits mtc
      JOIN primary_masters pm USING (master_discogs_id)
      WHERE mtc.artist_discogs_id <> ALL(${artistIds})
      UNION ALL
      SELECT mrc.master_discogs_id, mrc.artist_discogs_id, mrc.role
      FROM catalog.master_release_credits mrc
      JOIN primary_masters pm USING (master_discogs_id)
      WHERE mrc.artist_discogs_id <> ALL(${artistIds})
    ),
    role_counts AS (
      SELECT artist_discogs_id, role, COUNT(*)::int AS n
      FROM credits
      GROUP BY 1, 2
    ),
    role_arrays AS (
      SELECT
        artist_discogs_id,
        ARRAY_AGG(role ORDER BY n DESC, role ASC) AS roles
      FROM role_counts
      GROUP BY artist_discogs_id
    ),
    master_counts AS (
      SELECT artist_discogs_id, COUNT(DISTINCT master_discogs_id)::int AS masters_together
      FROM credits
      GROUP BY 1
    )
    SELECT
      a.discogs_id,
      a.name,
      mc.masters_together,
      ra.roles
    FROM master_counts mc
    JOIN role_arrays ra USING (artist_discogs_id)
    JOIN catalog.artists a
      ON a.discogs_id = mc.artist_discogs_id
     AND a.batch_id = ${batchId}
    ORDER BY mc.masters_together DESC, a.name ASC
    LIMIT ${limit}
  `.execute(db);

  return {
    artist_discogs_id: artistDiscogsId,
    collaborators: rows.map((r) => ({
      discogs_id: r.discogs_id,
      name: r.name,
      masters_together: r.masters_together,
      roles: r.roles ?? [],
    })),
    meta: { elapsed_ms: Date.now() - start },
  };
}

// ---------------------------------------------------------------------------
// Artist → aggregated labelmates (across ALL labels they released on)
// ---------------------------------------------------------------------------
// Previous UX picked the artist's #1 label and showed its roster, which
// misrepresented what "labelmates" means — someone on six scene labels
// looked like they were only on one. This aggregates across every label
// where the subject is a primary artist of ≥2 masters, weights by an
// IDF term (1/√label_total) so sprawling majors don't swamp tight
// indies, filters labels to either indies (≤500 in-scope masters) or
// ones where the subject is ≥10% of output, and excludes the subject's
// own aliases + groups + group-members from the result.
//
// The resulting ranking reads like a label's in-house family. For
// Frankie Knuckles it surfaces the Chicago Trax / DJ International
// canon (Farley Jackmaster Funk, Marshall Jefferson, Mr. Fingers,
// Phuture, Armando); for Larry Heard it surfaces the Alleviated /
// Distance / Track Mode circle; for Kenny Dope it surfaces the
// Henry Street / Strictly Rhythm NYC pantheon.

export interface ArtistLabelmate {
  discogs_id: number;
  name: string | null;
  /** Sum over shared labels of min(my_masters_there, their_masters_there) */
  shared_records: number;
  /** How many distinct labels the two overlap on */
  shared_labels: number;
  /** Up to 3 label names where they overlapped, ordered alphabetically */
  labels: string[];
}

export interface ArtistLabelmatesResponse {
  artist_discogs_id: number;
  labelmates: ArtistLabelmate[];
  meta: { elapsed_ms: number };
}

export async function getArtistLabelmates(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
  opts: { limit?: number } = {},
): Promise<ArtistLabelmatesResponse> {
  const start = Date.now();
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 30));
  const artistIds = await expandArtistAliasIds(db, artistDiscogsId, batchId);

  // Self-network exclusion set: the artist + aliases + groups they're
  // part of + members they contain. Keeps the labelmate list to actual
  // peers and doesn't echo the subject back to themselves.
  // artist_group_members is a one-shot ETL table (no batch_id column).
  // See credits.ts header comment — the whole credits layer is a one-shot
  // import from the legacy dig-db.
  const { rows: selfEdges } = await sql<{ id: number }>`
    SELECT unnest(${artistIds}::int[]) AS id
    UNION
    SELECT group_artist_id AS id
    FROM catalog.artist_group_members
    WHERE member_artist_id = ANY(${artistIds})
    UNION
    SELECT member_artist_id AS id
    FROM catalog.artist_group_members
    WHERE group_artist_id = ANY(${artistIds})
  `.execute(db);
  const excludeIds = selfEdges.map((r) => r.id);

  // One round-trip. CTEs:
  //   artist_labels — labels where subject (any alias) is primary on ≥2 masters
  //   label_totals  — total in-scope masters per candidate label (for IDF)
  //   scene_labels  — filtered to indie labels (≤500) OR dominant-share (≥10%)
  //                 + precomputed IDF weight per label
  // The LATERAL JOIN then, for each scene label, enumerates every other
  // primary artist on that label and counts their masters, producing one
  // row per (subject-label, other-artist) pair. The outer aggregate
  // combines those pairs into the final ranking.
  const { rows } = await sql<{
    discogs_id: number;
    name: string | null;
    shared_records: number;
    shared_labels: number;
    labels: string[];
  }>`
    WITH artist_labels AS (
      SELECT
        primary_label_discogs_id AS label_id,
        primary_label_name       AS label_name,
        COUNT(DISTINCT discogs_id)::int AS my_masters
      FROM catalog.masters
      WHERE primary_artist_discogs_id = ANY(${artistIds})
        AND batch_id = ${batchId}
        AND primary_label_discogs_id IS NOT NULL
      GROUP BY 1, 2
      HAVING COUNT(DISTINCT discogs_id) >= 2
    ),
    label_totals AS (
      SELECT primary_label_discogs_id AS label_id, COUNT(*)::int AS label_total
      FROM catalog.masters
      WHERE batch_id = ${batchId}
        AND primary_label_discogs_id IN (SELECT label_id FROM artist_labels)
      GROUP BY 1
    ),
    scene_labels AS (
      SELECT
        al.label_id,
        al.label_name,
        al.my_masters,
        lt.label_total,
        (1.0 / sqrt(lt.label_total))::numeric AS idf
      FROM artist_labels al
      JOIN label_totals lt USING (label_id)
      WHERE lt.label_total <= 500
         OR (al.my_masters::numeric / lt.label_total) >= 0.10
    )
    SELECT
      a.discogs_id,
      a.name,
      SUM(LEAST(sl.my_masters, x.their_masters))::int AS shared_records,
      COUNT(DISTINCT sl.label_id)::int AS shared_labels,
      (ARRAY_AGG(DISTINCT sl.label_name ORDER BY sl.label_name))[:3] AS labels
    FROM scene_labels sl
    JOIN LATERAL (
      SELECT
        m2.primary_artist_discogs_id AS other_id,
        COUNT(DISTINCT m2.discogs_id)::int AS their_masters
      FROM catalog.masters m2
      WHERE m2.primary_label_discogs_id = sl.label_id
        AND m2.batch_id = ${batchId}
        AND m2.primary_artist_discogs_id IS NOT NULL
        AND m2.primary_artist_discogs_id <> ALL(${excludeIds})
      GROUP BY m2.primary_artist_discogs_id
    ) x ON true
    JOIN catalog.artists a
      ON a.discogs_id = x.other_id
     AND a.batch_id = ${batchId}
    GROUP BY a.discogs_id, a.name
    ORDER BY
      SUM(LEAST(sl.my_masters, x.their_masters) * sl.idf) DESC,
      COUNT(DISTINCT sl.label_id) DESC,
      a.name ASC
    LIMIT ${limit}
  `.execute(db);

  return {
    artist_discogs_id: artistDiscogsId,
    labelmates: rows.map((r) => ({
      discogs_id: r.discogs_id,
      name: r.name,
      shared_records: r.shared_records,
      shared_labels: r.shared_labels,
      labels: r.labels ?? [],
    })),
    meta: { elapsed_ms: Date.now() - start },
  };
}

// ---------------------------------------------------------------------------
// Label → top remixers (cross-roster signal)
// ---------------------------------------------------------------------------
// "Producers + remixers most active on this label" — combines master_track and
// master_release credits filtered to masters whose primary_label is this label.
//
// Surfaces the scene-defining remixers (e.g. on Strictly Rhythm: MAW, Roger S,
// Armand Van Helden) without us having to re-aggregate at request time.
export interface LabelTopCreditEntry {
  artist_discogs_id: number;
  artist_name: string;
  /** Distinct masters they touched on this label */
  master_count: number;
  /** Distinct credits (rows). Always >= master_count */
  credit_count: number;
  /** Up to 5 normalised roles, ordered by frequency on this label */
  roles: string[];
}

export async function getLabelTopCredits(
  db: Kysely<Database>,
  labelDiscogsId: number,
  batchId: string,
  opts: { limit?: number; role?: string | null } = {},
): Promise<LabelTopCreditEntry[]> {
  const limit = clampLimit(opts.limit);
  const roles = expandRoleFilter(opts.role);

  // Single CTE: union track + release credits, restricted to masters whose
  // primary_label is this label (the most reliable signal we have without
  // building a full label_master_credits index).
  const rows = await sql<{
    artist_discogs_id: number;
    artist_name: string;
    role: string;
    master_discogs_id: number;
  }>`
    WITH label_masters AS (
      SELECT discogs_id
      FROM catalog.masters
      WHERE batch_id = ${batchId}::uuid
        AND primary_label_discogs_id = ${labelDiscogsId}
    ),
    raw AS (
      SELECT mtc.artist_discogs_id, mtc.artist_name, mtc.role, mtc.master_discogs_id
      FROM catalog.master_track_credits mtc
      WHERE mtc.master_discogs_id IN (SELECT discogs_id FROM label_masters)
        ${roles ? sql`AND mtc.role IN (${sql.join(roles.map((r) => sql.lit(r)))})` : sql``}
      UNION ALL
      SELECT mrc.artist_discogs_id, mrc.artist_name, mrc.role, mrc.master_discogs_id
      FROM catalog.master_release_credits mrc
      WHERE mrc.master_discogs_id IN (SELECT discogs_id FROM label_masters)
        ${roles ? sql`AND mrc.role IN (${sql.join(roles.map((r) => sql.lit(r)))})` : sql``}
    )
    SELECT artist_discogs_id, artist_name, role, master_discogs_id FROM raw
  `.execute(db);

  type Agg = {
    artist_discogs_id: number;
    artist_name: string;
    masters: Set<number>;
    credits: number;
    roleCount: Map<string, number>;
  };
  const agg = new Map<number, Agg>();
  for (const r of rows.rows) {
    let a = agg.get(r.artist_discogs_id);
    if (!a) {
      a = {
        artist_discogs_id: r.artist_discogs_id,
        artist_name: r.artist_name,
        masters: new Set(),
        credits: 0,
        roleCount: new Map(),
      };
      agg.set(r.artist_discogs_id, a);
    }
    a.masters.add(r.master_discogs_id);
    a.credits += 1;
    a.roleCount.set(r.role, (a.roleCount.get(r.role) ?? 0) + 1);
  }

  return Array.from(agg.values())
    .map((a) => ({
      artist_discogs_id: a.artist_discogs_id,
      artist_name: a.artist_name,
      master_count: a.masters.size,
      credit_count: a.credits,
      roles: Array.from(a.roleCount.entries())
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5)
        .map(([role]) => role),
    }))
    // Order: distinct masters DESC then credit count DESC
    .sort((a, b) => b.master_count - a.master_count || b.credit_count - a.credit_count)
    .slice(0, limit);
}
