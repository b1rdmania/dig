#!/usr/bin/env npx tsx
/**
 * Seed `enrich.scenes`, `enrich.scene_labels`, and `enrich.scene_bridges`
 * from packages/db/seeds/scenes_v1.json.
 *
 * Resolves each label name to a `discogs_label_id` by joining against the
 * already-seeded `enrich.label_editorial` table (which itself is name-resolved
 * by scripts/seed-label-editorial.ts). This guarantees scene membership is
 * limited to labels we've already curated.
 *
 * Idempotent: UPSERT on primary keys. Bridges are deduped on
 * (from_slug, to_slug, via_kind, via_id).
 *
 * Usage:
 *   DATABASE_URL=<pg_url> npx tsx scripts/seed-scenes.ts
 *
 * Local (Docker):
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig \
 *     npx tsx scripts/seed-scenes.ts
 *
 * Fly (against dig-db-scene via proxy):
 *   fly proxy 15433:5432 -a dig-db-scene &
 *   DATABASE_URL=postgresql://postgres:<pass>@localhost:15433/dig \
 *     npx tsx scripts/seed-scenes.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { Database } from "../packages/db/src/schema.js";

const REPO_ROOT = resolve(__dirname, "..");
const SEED_FILE = resolve(REPO_ROOT, "packages/db/seeds/scenes_v1.json");

interface LabelMember {
  name: string;
  role?: "core" | "adjacent" | "bridge";
  rank?: number;
}

interface SceneSeed {
  slug: string;
  name: string;
  city?: string | null;
  era_start?: number | null;
  era_end?: number | null;
  parent_slug?: string | null;
  axis: "geography" | "sound" | "era" | "cluster" | "bridge" | "micro";
  depth?: number;
  blurb?: string | null;
  hero_label_name?: string | null;
  palette?: { accent: string; accent_ink: string } | null;
  labels: LabelMember[];
}

interface BridgeSeed {
  from_slug: string;
  to_slug: string;
  via_kind: "artist" | "label" | "sound";
  via_name?: string | null;
  via_id?: number | null;
  blurb?: string | null;
}

interface SeedFile {
  scenes: SceneSeed[];
  bridges?: BridgeSeed[];
}

async function resolveLabelByName(
  db: Kysely<Database>,
  name: string,
): Promise<number | null> {
  // Resolve directly from catalog.labels and tie-break by master count DESC.
  // Discogs has many same-name siblings (e.g. "KMS" / "KMS Records" /
  // "KMS (2)") and the only meaningful disambiguator at scene-seed time is
  // "which one actually has releases on it". Editorial palette is a separate
  // concern and is joined later via discogs_label_id.
  const candidates = await sql<{ discogs_id: number; name: string; master_count: string }>`
    SELECT
      l.discogs_id,
      l.name,
      (SELECT COUNT(*) FROM catalog.masters m WHERE m.primary_label_discogs_id = l.discogs_id) AS master_count
    FROM catalog.labels l
    WHERE LOWER(TRIM(l.name)) = LOWER(TRIM(${name}))
    ORDER BY (SELECT COUNT(*) FROM catalog.masters m WHERE m.primary_label_discogs_id = l.discogs_id) DESC,
             l.discogs_id ASC
    LIMIT 1
  `.execute(db);
  return candidates.rows.length > 0 ? candidates.rows[0].discogs_id : null;
}

async function upsertScene(
  db: Kysely<Database>,
  scene: SceneSeed,
  heroLabelId: number | null,
): Promise<void> {
  const palette = scene.palette ? JSON.stringify(scene.palette) : null;
  await sql`
    INSERT INTO enrich.scenes (
      slug, name, city, era_start, era_end, parent_slug, axis, depth,
      blurb, hero_label_id, palette, updated_at
    ) VALUES (
      ${scene.slug}, ${scene.name}, ${scene.city ?? null},
      ${scene.era_start ?? null}, ${scene.era_end ?? null},
      ${scene.parent_slug ?? null}, ${scene.axis}, ${scene.depth ?? 1},
      ${scene.blurb ?? null}, ${heroLabelId}, ${palette}::jsonb, now()
    )
    ON CONFLICT (slug) DO UPDATE SET
      name          = EXCLUDED.name,
      city          = EXCLUDED.city,
      era_start     = EXCLUDED.era_start,
      era_end       = EXCLUDED.era_end,
      parent_slug   = EXCLUDED.parent_slug,
      axis          = EXCLUDED.axis,
      depth         = EXCLUDED.depth,
      blurb         = EXCLUDED.blurb,
      hero_label_id = EXCLUDED.hero_label_id,
      palette       = COALESCE(EXCLUDED.palette, enrich.scenes.palette),
      updated_at    = now()
  `.execute(db);
}

async function upsertSceneLabel(
  db: Kysely<Database>,
  sceneSlug: string,
  discogsLabelId: number,
  role: "core" | "adjacent" | "bridge",
  rank: number,
): Promise<void> {
  await sql`
    INSERT INTO enrich.scene_labels (
      scene_slug, discogs_label_id, role, rank
    ) VALUES (
      ${sceneSlug}, ${discogsLabelId}, ${role}, ${rank}
    )
    ON CONFLICT (scene_slug, discogs_label_id) DO UPDATE SET
      role = EXCLUDED.role,
      rank = EXCLUDED.rank
  `.execute(db);
}

async function upsertBridge(
  db: Kysely<Database>,
  bridge: BridgeSeed,
  viaId: number,
): Promise<void> {
  await sql`
    INSERT INTO enrich.scene_bridges (
      from_slug, to_slug, via_kind, via_id, via_name, blurb
    ) VALUES (
      ${bridge.from_slug}, ${bridge.to_slug}, ${bridge.via_kind},
      ${viaId}, ${bridge.via_name ?? null}, ${bridge.blurb ?? null}
    )
    ON CONFLICT (from_slug, to_slug, via_kind, via_id) DO UPDATE SET
      via_name = EXCLUDED.via_name,
      blurb    = COALESCE(EXCLUDED.blurb, enrich.scene_bridges.blurb)
  `.execute(db);
}

async function resolveArtistByName(
  db: Kysely<Database>,
  name: string,
): Promise<number | null> {
  const r = await sql<{ discogs_id: number }>`
    SELECT discogs_id
    FROM catalog.artists
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(${name}))
    ORDER BY discogs_id ASC
    LIMIT 1
  `.execute(db);
  return r.rows.length > 0 ? r.rows[0].discogs_id : null;
}

async function clearExistingMembership(db: Kysely<Database>): Promise<void> {
  // Wipe membership but preserve scenes themselves so we can re-seed cleanly
  // without losing any external references. Same for bridges.
  await sql`DELETE FROM enrich.scene_labels`.execute(db);
  await sql`DELETE FROM enrich.scene_bridges`.execute(db);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(2);
  }
  const seed: SeedFile = JSON.parse(readFileSync(SEED_FILE, "utf8"));
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  try {
    await clearExistingMembership(db);

    let scenesUpserted = 0;
    let labelsResolved = 0;
    let labelsUnresolved = 0;
    let bridgesUpserted = 0;
    let bridgesUnresolved = 0;
    const unresolvedLabels: Array<{ scene: string; name: string }> = [];
    const unresolvedBridges: Array<{ from: string; to: string; via: string }> = [];

    for (const scene of seed.scenes) {
      const heroLabelId = scene.hero_label_name
        ? await resolveLabelByName(db, scene.hero_label_name)
        : null;
      await upsertScene(db, scene, heroLabelId);
      scenesUpserted++;

      let rankCounter = 0;
      for (const member of scene.labels) {
        const labelId = await resolveLabelByName(db, member.name);
        if (!labelId) {
          labelsUnresolved++;
          unresolvedLabels.push({ scene: scene.slug, name: member.name });
          continue;
        }
        await upsertSceneLabel(
          db,
          scene.slug,
          labelId,
          member.role ?? "core",
          member.rank ?? ++rankCounter,
        );
        labelsResolved++;
      }
    }

    for (const bridge of seed.bridges ?? []) {
      let viaId: number | null = bridge.via_id ?? null;
      if (!viaId && bridge.via_name) {
        if (bridge.via_kind === "artist") {
          viaId = await resolveArtistByName(db, bridge.via_name);
        } else if (bridge.via_kind === "label") {
          viaId = await resolveLabelByName(db, bridge.via_name);
        }
      }
      // For 'sound' bridges (no entity carrier), use 0 as the synthetic via_id
      // so the (from, to, kind, via_id) PK is well-defined.
      if (bridge.via_kind === "sound" && viaId === null) viaId = 0;

      if (viaId === null) {
        bridgesUnresolved++;
        unresolvedBridges.push({
          from: bridge.from_slug,
          to: bridge.to_slug,
          via: bridge.via_name ?? "(no name)",
        });
        continue;
      }
      await upsertBridge(db, bridge, viaId);
      bridgesUpserted++;
    }

    console.log("");
    console.log("=== seed-scenes summary ===");
    console.log(`  scenes upserted:   ${scenesUpserted}`);
    console.log(`  labels resolved:   ${labelsResolved}`);
    console.log(`  labels unresolved: ${labelsUnresolved}`);
    console.log(`  bridges upserted:  ${bridgesUpserted}`);
    console.log(`  bridges unresolved: ${bridgesUnresolved}`);

    if (unresolvedLabels.length > 0) {
      console.error("");
      console.error("Unresolved labels (likely not in scope or unseeded):");
      for (const u of unresolvedLabels) {
        console.error(`  - [${u.scene}] ${u.name}`);
      }
    }
    if (unresolvedBridges.length > 0) {
      console.error("");
      console.error("Unresolved bridges:");
      for (const u of unresolvedBridges) {
        console.error(`  - ${u.from} → ${u.to} via ${u.via}`);
      }
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
