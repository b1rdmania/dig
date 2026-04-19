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
  opts: { limit?: number; roleFilter?: string | null } = {},
): Promise<ArtistMasterCreditsResponse> {
  const start = Date.now();
  const limit = clampLimit(opts.limit);
  const roles = expandRoleFilter(opts.roleFilter);

  let trackQ = db
    .selectFrom("catalog.master_track_credits as mtc")
    .select([
      "mtc.master_discogs_id",
      "mtc.track_position",
      "mtc.track_title",
      "mtc.role",
    ])
    .where("mtc.artist_discogs_id", "=", artistDiscogsId);
  if (roles) trackQ = trackQ.where("mtc.role", "in", roles);

  let releaseQ = db
    .selectFrom("catalog.master_release_credits as mrc")
    .select(["mrc.master_discogs_id", "mrc.role"])
    .where("mrc.artist_discogs_id", "=", artistDiscogsId);
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
    // Order: scene_weight DESC then year DESC then master_id ASC
    .sort((a: any, b: any) =>
      b._scene_weight - a._scene_weight || b._year - a._year || a.master_discogs_id - b.master_discogs_id,
    )
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
    .orderBy("csc.host_release_year", sql`desc nulls last`)
    .orderBy("csc.host_release_id", "desc")
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
// Artist → group/member edges
// ---------------------------------------------------------------------------
export interface ArtistGroupEdge {
  discogs_id: number;
  name: string | null;
}

export interface ArtistGroupsAndMembersResponse {
  artist_discogs_id: number;
  /** Groups this artist is a member of (e.g. "MAW" for Louie Vega) */
  groups: ArtistGroupEdge[];
  /** Members of this artist (e.g. Louie Vega, Kenny Dope for "MAW") */
  members: ArtistGroupEdge[];
  meta: { elapsed_ms: number };
}

export async function getArtistGroupsAndMembers(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
): Promise<ArtistGroupsAndMembersResponse> {
  const start = Date.now();
  const [asMember, asGroup] = await Promise.all([
    db
      .selectFrom("catalog.artist_group_members as agm")
      .innerJoin("catalog.artists as a", (j) =>
        j.onRef("a.discogs_id", "=", "agm.group_artist_id").on("a.batch_id", "=", batchId),
      )
      .select(["agm.group_artist_id as discogs_id", "a.name"])
      .where("agm.member_artist_id", "=", artistDiscogsId)
      .execute(),
    db
      .selectFrom("catalog.artist_group_members as agm")
      .innerJoin("catalog.artists as a", (j) =>
        j.onRef("a.discogs_id", "=", "agm.member_artist_id").on("a.batch_id", "=", batchId),
      )
      .select(["agm.member_artist_id as discogs_id", "a.name"])
      .where("agm.group_artist_id", "=", artistDiscogsId)
      .execute(),
  ]);

  return {
    artist_discogs_id: artistDiscogsId,
    groups: asMember.map((r) => ({ discogs_id: r.discogs_id, name: r.name })),
    members: asGroup.map((r) => ({ discogs_id: r.discogs_id, name: r.name })),
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
