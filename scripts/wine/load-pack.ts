/**
 * Loads the Wine Bore curation pack (bores/wine-bore/pack/shelves.json) into
 * wine.shelves / wine.shelf_members / wine.shelf_edges.
 *
 * Idempotent: verifies every member id against the corpus first, then replaces
 * the members and edges of the slugs in the file. Rows belonging to slugs the
 * file does not mention are left alone - the pack owns its own slugs, nothing
 * more. Register beats pack: this writes no register table.
 *
 * Everything lands with status 'draft'. Notes are opinions, not ground truth.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig \
 *     pnpm exec tsx scripts/wine/load-pack.ts
 */
import { resolve } from "node:path";
import { connect, logLoad, readJson, REPO_ROOT } from "./lib";

type EntityType = "producer" | "appellation" | "wine" | "grape";

interface Member {
  type: EntityType;
  id: number;
  name: string;
  rank: number;
  note?: string;
}

interface Edge {
  to: string;
  direction: string;
  note?: string;
}

interface Shelf {
  slug: string;
  name: string;
  blurb?: string;
  rank: number;
  members: Member[];
  edges: Edge[];
}

const PACK = resolve(REPO_ROOT, "bores", "wine-bore", "pack", "shelves.json");

// entity_type -> (table, id column, display column). `wine` is keyed on LWIN-7,
// not on a surrogate id, so shelf_members.entity_id holds the LWIN.
const ENTITIES: Record<EntityType, { table: string; key: string; display: string }> = {
  producer: { table: "wine.producers", key: "id", display: "display_name" },
  appellation: { table: "wine.appellations", key: "id", display: "name" },
  wine: { table: "wine.wines", key: "lwin", display: "display_name" },
  grape: { table: "wine.grapes", key: "id", display: "name" },
};

const DIRECTIONS = new Set(["deeper", "cleaner", "wilder", "earlier", "cheaper", "grander"]);

async function main(): Promise<void> {
  const pack = readJson<{ shelves: Shelf[] }>(PACK);
  const shelves = pack.shelves ?? [];
  if (shelves.length === 0) throw new Error(`${PACK} holds no shelves`);

  const slugs = shelves.map((s) => s.slug);
  const dupSlugs = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dupSlugs.length) throw new Error(`duplicate shelf slugs: ${dupSlugs.join(", ")}`);
  const known = new Set(slugs);

  const pool = connect();
  try {
    // ---- verify, loudly, before touching a single row -------------------
    const problems: string[] = [];
    const renames: string[] = [];
    let members = 0;

    for (const type of Object.keys(ENTITIES) as EntityType[]) {
      const wanted = new Map<number, Member[]>();
      for (const shelf of shelves) {
        for (const m of shelf.members) {
          if (m.type !== type) continue;
          if (!Number.isInteger(m.id)) {
            problems.push(`${shelf.slug}: ${type} id "${m.id}" is not an integer`);
            continue;
          }
          const list = wanted.get(m.id) ?? [];
          list.push({ ...m, name: `${shelf.slug}/${m.name}` });
          wanted.set(m.id, list);
        }
      }
      if (wanted.size === 0) continue;
      const { table, key, display } = ENTITIES[type];
      const res = await pool.query<{ id: string; display: string }>(
        `SELECT ${key}::text AS id, ${display} AS display FROM ${table} WHERE ${key} = ANY($1::bigint[])`,
        [[...wanted.keys()]],
      );
      const found = new Map(res.rows.map((r) => [Number(r.id), r.display]));
      for (const [id, refs] of wanted) {
        const real = found.get(id);
        if (real === undefined) {
          for (const r of refs) problems.push(`${r.name}: ${type} id ${id} is not in ${table}`);
          continue;
        }
        for (const r of refs) {
          const packName = r.name.split("/").slice(1).join("/");
          if (packName !== real) renames.push(`${r.name}: ${type} ${id} is "${real}" in ${table}`);
        }
      }
    }

    for (const shelf of shelves) {
      const seen = new Set<string>();
      for (const m of shelf.members) {
        members += 1;
        if (!(m.type in ENTITIES)) problems.push(`${shelf.slug}: unknown entity_type "${m.type}"`);
        const pk = `${m.type}:${m.id}`;
        if (seen.has(pk)) problems.push(`${shelf.slug}: ${pk} listed twice`);
        seen.add(pk);
      }
      for (const e of shelf.edges) {
        if (!known.has(e.to)) problems.push(`${shelf.slug} -> ${e.to}: no such shelf in the pack`);
        if (e.to === shelf.slug) problems.push(`${shelf.slug} -> itself: edges must point elsewhere`);
        if (!DIRECTIONS.has(e.direction)) problems.push(`${shelf.slug} -> ${e.to}: bad direction "${e.direction}"`);
      }
    }

    if (problems.length) {
      console.error(`[load-pack] ${problems.length} problem(s), nothing written:`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exitCode = 1;
      return;
    }
    // A name that no longer matches the DB is a warning: the register wins, the
    // pack's `name` is only there so a human can read the file.
    for (const r of renames) console.warn(`[load-pack] name drift: ${r}`);

    // ---- write ----------------------------------------------------------
    const client = await pool.connect();
    let edges = 0;
    try {
      await client.query("BEGIN");
      for (const shelf of shelves) {
        await client.query(
          `INSERT INTO wine.shelves (slug, name, blurb, status, rank) VALUES ($1,$2,$3,'draft',$4)
           ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, blurb=EXCLUDED.blurb, status='draft', rank=EXCLUDED.rank`,
          [shelf.slug, shelf.name, shelf.blurb ?? null, shelf.rank],
        );
      }
      // Second pass: edges reference other shelves, so every row must exist first.
      await client.query(`DELETE FROM wine.shelf_members WHERE shelf_slug = ANY($1::text[])`, [slugs]);
      await client.query(`DELETE FROM wine.shelf_edges WHERE from_slug = ANY($1::text[])`, [slugs]);
      for (const shelf of shelves) {
        await client.query(
          `INSERT INTO wine.shelf_members (shelf_slug, entity_type, entity_id, rank, note, status)
           SELECT $1, m.entity_type, m.entity_id, m.rank, m.note, 'draft'
           FROM jsonb_to_recordset($2::jsonb) AS m(entity_type text, entity_id bigint, rank int, note text)`,
          [shelf.slug, JSON.stringify(shelf.members.map((m) => ({ entity_type: m.type, entity_id: m.id, rank: m.rank, note: m.note ?? null })))],
        );
        const er = await client.query(
          `INSERT INTO wine.shelf_edges (from_slug, to_slug, direction, note)
           SELECT $1, e.to_slug, e.direction, e.note
           FROM jsonb_to_recordset($2::jsonb) AS e(to_slug text, direction text, note text)
           ON CONFLICT (from_slug, to_slug, direction) DO UPDATE SET note = EXCLUDED.note`,
          [shelf.slug, JSON.stringify(shelf.edges.map((e) => ({ to_slug: e.to, direction: e.direction, note: e.note ?? null })))],
        );
        edges += er.rowCount ?? 0;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    await logLoad(
      pool,
      "load-pack",
      { rows_in: members + edges, rows_out: shelves.length, matched: members, unmatched: 0 },
      { shelves: shelves.length, members, edges, name_drift: renames.length, status: "draft", source: "bores/wine-bore/pack/shelves.json" },
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
