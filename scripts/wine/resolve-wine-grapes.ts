/**
 * resolve-wine-grapes.ts - fill wine.wine_grapes.grape_id.
 *
 * The grape lists on wine_grapes come from Systembolaget (1,931 rows) and
 * Wikidata (3), so the spellings are a monopoly catalogue's Swedish-facing
 * labels, not register Latin. Same cascade as load-grapes.ts uses for
 * appellation_grapes, minus the register colour code (a listing carries no
 * colour code, so the colour veto has nothing to veto with):
 *
 *   exact            norm(grape_name_raw) == a wine.grape_names.name_norm
 *   colour_stripped  the same after dropping colour adjectives
 *                    ("Pinot grigio" -> "Pinot", only when the bare name hits)
 *   first_two        first two tokens, for names longer than two words
 *                    ("Corvina veronese" -> "Corvina")
 *
 * No trigram stage. load-grapes.ts found nothing usable below 0.7 and a wrong
 * variety on a wine is worse than a NULL the Bore can decline to answer.
 *
 * A norm that hits several grapes is decided the same way load-grapes.ts
 * decides it: an exact primary-name hit, then how much Wikidata knows about
 * the item (VIVC ids, then alias count), then the lower id.
 *
 * Idempotent: nulls every grape_id, then re-resolves.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/resolve-wine-grapes.ts
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type Colour, GrapeResolver, type NameTier } from "./grape-rules";
import { connect, logLoad, norm, readJson } from "./lib";

const SYNONYMS_PATH = resolve(__dirname, "grape-synonyms.json");

async function main() {
  const pool = connect();
  const notes: Record<string, unknown> = {};

  await pool.query(`UPDATE wine.wine_grapes SET grape_id = NULL WHERE grape_id IS NOT NULL`);

  // Same resolver as load-grapes.ts (grape-rules.ts). A wine string carries no
  // colour code, so a VIVC synonym shared by several varieties stays unresolved.
  const { rows: grapes } = await pool.query(
    `SELECT g.id, g.name_norm, g.colour, g.vivc_ids, coalesce(array_length(g.vivc_ids,1),0)::int * 4
            + (SELECT count(*) FROM wine.grape_names n WHERE n.grape_id = g.id AND n.source <> 'vivc')::int AS weight
     FROM wine.grapes g`,
  );
  const { rows: names } = await pool.query(`SELECT grape_id, name_norm, kind, source FROM wine.grape_names`);
  // The hand-checked map in grape-synonyms.json (raw_norm -> QID), same as load-grapes.ts.
  const manualQids: Record<string, string> = existsSync(SYNONYMS_PATH)
    ? readJson<{ manual?: Record<string, string> }>(SYNONYMS_PATH).manual ?? {} : {};
  const { rows: qids } = await pool.query(`SELECT id, wikidata_qid FROM wine.grapes WHERE wikidata_qid IS NOT NULL`);
  const idByQid = new Map<string, number>(qids.map((r) => [r.wikidata_qid, r.id]));
  const manual = new Map<string, number>();
  for (const [rawNorm, qid] of Object.entries(manualQids)) {
    const id = idByQid.get(qid);
    if (id) manual.set(rawNorm, id);
  }

  const resolver = new GrapeResolver(
    grapes.map((g) => ({ id: g.id, primaryNorm: g.name_norm, colour: g.colour as Colour, weight: g.weight, vivc: g.vivc_ids.length === 1 ? g.vivc_ids[0] : null })),
    names.map((n) => ({
      grapeId: n.grape_id, nameNorm: n.name_norm,
      tier: (n.kind === "primary" ? "primary" : n.source === "vivc" ? "vivc" : "wikidata") as NameTier,
    })),
    manual,
  );

  const { rows: wg } = await pool.query(
    `SELECT lwin::text, grape_name_raw, source FROM wine.wine_grapes`,
  );
  const stages: Record<string, number> = { manual: 0, exact: 0, colour_stripped: 0, first_two: 0 };
  const updates: Array<[string, string, string, number]> = [];
  const unresolved = new Map<string, number>();

  for (const r of wg) {
    const hit = resolver.resolve(norm(r.grape_name_raw));
    if (hit) { stages[hit.stage]++; updates.push([r.lwin, r.grape_name_raw, r.source, hit.id]); }
    else unresolved.set(r.grape_name_raw, (unresolved.get(r.grape_name_raw) ?? 0) + 1);
  }

  const CHUNK = 2000;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const values = slice.map((u) => {
      params.push(u[0], u[1], u[2], u[3]);
      return `($${params.length - 3}::bigint,$${params.length - 2},$${params.length - 1},$${params.length}::int)`;
    }).join(",");
    await pool.query(
      `UPDATE wine.wine_grapes g SET grape_id = v.gid
         FROM (VALUES ${values}) AS v(lwin, raw, src, gid)
        WHERE g.lwin = v.lwin AND g.grape_name_raw = v.raw AND g.source = v.src`,
      params,
    );
  }

  const top = [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  notes.stages = stages;
  notes.disambiguated = resolver.disambiguated;
  notes.vivc_synonym_shared_and_skipped = resolver.vivcAmbiguous;
  notes.rate_pct = Number(((100 * updates.length) / wg.length).toFixed(2));
  notes.distinct_unresolved = unresolved.size;
  notes.top_unresolved = top.map(([name, rows]) => ({ name, rows }));

  console.log(`resolved ${updates.length}/${wg.length} = ${notes.rate_pct}%`, stages);
  console.log("top 20 unresolved:");
  for (const [n, c] of top) console.log(`  ${String(c).padStart(4)}  ${n}`);

  await logLoad(pool, "resolve-wine-grapes", {
    rows_in: wg.length, rows_out: wg.length, matched: updates.length, unmatched: wg.length - updates.length,
  }, notes);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
