// ---------------------------------------------------------------------------
// Artist identity — the person behind the credit rows.
//
// Discogs stores every recording name as its own artist row, so Larry Heard
// is nine rows (Mr. Fingers, Loosefingers, Gherkin Jerks, ...). A model that
// thinks in people needs one lookup that returns the whole person: every
// alias resolved to its in-scope ID with how much it recorded and when, the
// groups around them, and the credit roles they actually hold. Everything
// here is derived from tables that already exist; no re-ingest.
// ---------------------------------------------------------------------------

import { sql, type Kysely } from "kysely";
import type { Database } from "@dig/db";
import { getArtistGroupsAndMembers, type ArtistGroupEdge } from "./credits.js";

export interface ArtistIdentityAlias {
  discogs_id: number;
  name: string;
  /** In-scope masters credited to this name. */
  masters: number;
  year_min: number | null;
  year_max: number | null;
  /** Highest curation weight among this name's masters. */
  top_weight: number | null;
}

/** Role families, matching the `role` values get_artist_credits accepts. */
export type CreditRoleFamily = "remix" | "produce" | "engineer" | "mix" | "master" | "write" | "vocal" | "other";

export interface ArtistIdentityRole {
  role: CreditRoleFamily;
  /** Distinct in-scope masters carrying this role, across all aliases. */
  masters: number;
}

export interface ArtistIdentity {
  discogs_id: number;
  name: string;
  real_name: string | null;
  /** The requested name plus every alias found in scope, most-recorded first. */
  names: ArtistIdentityAlias[];
  /** Alias names Discogs lists that have no in-scope records. */
  names_out_of_scope: string[];
  groups: ArtistGroupEdge[];
  members: ArtistGroupEdge[];
  roles: ArtistIdentityRole[];
  meta: { elapsed_ms: number };
}

const ROLE_FAMILY: Array<{ family: CreditRoleFamily; test: RegExp }> = [
  { family: "remix", test: /remix|re-?edit|rework|version/i },
  { family: "produce", test: /produc/i },
  { family: "engineer", test: /engineer|recorded by/i },
  { family: "mix", test: /mixed|mix(?!.*remix)|mixing/i },
  { family: "master", test: /master/i },
  { family: "write", test: /writ|compos|lyric/i },
  { family: "vocal", test: /vocal|voice|sing/i },
];

export function creditRoleFamily(role: string | null | undefined): CreditRoleFamily {
  if (!role) return "other";
  for (const { family, test } of ROLE_FAMILY) if (test.test(role)) return family;
  return "other";
}

export async function getArtistIdentity(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
): Promise<ArtistIdentity | null> {
  const start = Date.now();

  const artist = await db
    .selectFrom("catalog.artists")
    .select(["discogs_id", "name", "real_name", "aliases_text"])
    .where("discogs_id", "=", artistDiscogsId)
    .where("batch_id", "=", batchId)
    .executeTakeFirst();
  if (!artist) return null;

  const aliasNames = (Array.isArray(artist.aliases_text) ? artist.aliases_text : [])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);

  // Resolve alias names to in-scope artist rows. Names that resolve to
  // nothing are reported as out of scope rather than dropped, so the model
  // can say "not one of mine" instead of "doesn't exist".
  const resolved = aliasNames.length > 0
    ? await db
        .selectFrom("catalog.artists")
        .select(["discogs_id", "name"])
        .where("batch_id", "=", batchId)
        .where("name", "in", aliasNames)
        .limit(30)
        .execute()
    : [];
  const idByName = new Map<string, number>();
  for (const r of resolved) idByName.set(r.name, r.discogs_id);
  const ids = Array.from(new Set<number>([artist.discogs_id, ...resolved.map((r) => r.discogs_id)]));
  const namesOutOfScope = aliasNames.filter((n) => !idByName.has(n));

  const [stats, groupsAndMembers, trackRoles, releaseRoles] = await Promise.all([
    db
      .selectFrom("catalog.master_artists as ma")
      .innerJoin("catalog.masters as m", (join) =>
        join.onRef("m.discogs_id", "=", "ma.master_discogs_id").on("m.batch_id", "=", batchId),
      )
      .select([
        "ma.artist_discogs_id",
        sql<number>`COUNT(DISTINCT ma.master_discogs_id)::int`.as("masters"),
        sql<number | null>`MIN(m.year)`.as("year_min"),
        sql<number | null>`MAX(m.year)`.as("year_max"),
        sql<number | null>`MAX(m.scene_weight)`.as("top_weight"),
      ])
      .where("ma.artist_discogs_id", "in", ids)
      .where("ma.batch_id", "=", batchId)
      .groupBy("ma.artist_discogs_id")
      .execute(),
    getArtistGroupsAndMembers(db, artistDiscogsId, batchId).catch(() => null),
    db
      .selectFrom("catalog.master_track_credits")
      .select(["role", "master_discogs_id"])
      .where("artist_discogs_id", "in", ids)
      .limit(5000)
      .execute(),
    db
      .selectFrom("catalog.master_release_credits")
      .select(["role", "master_discogs_id"])
      .where("artist_discogs_id", "in", ids)
      .limit(5000)
      .execute(),
  ]);

  const statById = new Map(stats.map((s) => [s.artist_discogs_id, s]));
  const nameById = new Map<number, string>([[artist.discogs_id, artist.name]]);
  for (const r of resolved) nameById.set(r.discogs_id, r.name);

  const names: ArtistIdentityAlias[] = ids.map((id) => {
    const s = statById.get(id);
    return {
      discogs_id: id,
      name: nameById.get(id) ?? String(id),
      masters: s?.masters ?? 0,
      year_min: s?.year_min ?? null,
      year_max: s?.year_max ?? null,
      top_weight: s?.top_weight ?? null,
    };
  });
  names.sort((a, b) => b.masters - a.masters || a.name.localeCompare(b.name));

  // Distinct masters per role family across the whole person.
  const perFamily = new Map<CreditRoleFamily, Set<number>>();
  for (const r of [...trackRoles, ...releaseRoles]) {
    const fam = creditRoleFamily(r.role);
    if (!perFamily.has(fam)) perFamily.set(fam, new Set());
    perFamily.get(fam)!.add(r.master_discogs_id);
  }
  const roles: ArtistIdentityRole[] = Array.from(perFamily.entries())
    .map(([role, set]) => ({ role, masters: set.size }))
    .sort((a, b) => b.masters - a.masters);

  return {
    discogs_id: artist.discogs_id,
    name: artist.name,
    real_name: artist.real_name ?? null,
    names,
    names_out_of_scope: namesOutOfScope,
    groups: groupsAndMembers?.groups ?? [],
    members: groupsAndMembers?.members ?? [],
    roles,
    meta: { elapsed_ms: Date.now() - start },
  };
}
