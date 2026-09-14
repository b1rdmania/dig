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
import { connect, logLoad, norm } from "./lib";

/** Colour adjectives bolted onto a variety name. Same set as load-grapes.ts. */
const COLOUR_WORDS = new Set([
  "weisser", "weisse", "weiss", "weisen", "blauer", "blaue", "blau", "grauer", "graue",
  "roter", "rote", "rot", "gelber", "gelbe", "fruhroter", "fruhrote", "schwarzer",
  "blanc", "blanche", "blancs", "noir", "noire", "noirs", "gris", "grise", "rouge", "rose",
  "bianco", "bianca", "bianchi", "nero", "nera", "neri", "grigio", "grigia", "rosso", "rossa",
  "blanco", "blanca", "tinto", "tinta", "negro", "negra", "rosado", "roxo", "branco",
]);

function stripColourWords(nameNorm: string): string {
  return nameNorm.split(" ").filter((t) => t && !COLOUR_WORDS.has(t)).join(" ");
}

async function main() {
  const pool = connect();
  const notes: Record<string, unknown> = {};

  await pool.query(`UPDATE wine.wine_grapes SET grape_id = NULL WHERE grape_id IS NOT NULL`);

  // ---- index every grape spelling -------------------------------------
  const { rows: grapes } = await pool.query(
    `SELECT id, name_norm, coalesce(array_length(vivc_ids,1),0)::int vivc FROM wine.grapes`,
  );
  const primaryNorm = new Map<number, string>();
  const vivcById = new Map<number, number>();
  for (const g of grapes) { primaryNorm.set(g.id, g.name_norm); vivcById.set(g.id, g.vivc); }

  const { rows: names } = await pool.query(`SELECT grape_id, name_norm FROM wine.grape_names`);
  const byNorm = new Map<string, number[]>();
  const aliasCount = new Map<number, number>();
  for (const n of names) {
    const list = byNorm.get(n.name_norm);
    if (list) { if (!list.includes(n.grape_id)) list.push(n.grape_id); }
    else byNorm.set(n.name_norm, [n.grape_id]);
    aliasCount.set(n.grape_id, (aliasCount.get(n.grape_id) ?? 0) + 1);
  }

  let disambiguated = 0;
  function pick(nn: string): number | null {
    const ids = byNorm.get(nn);
    if (!ids || ids.length === 0) return null;
    if (ids.length === 1) return ids[0];
    let cand = ids.filter((id) => primaryNorm.get(id) === nn);
    if (cand.length === 0) cand = [...ids];
    if (cand.length > 1) {
      disambiguated++;
      cand.sort((a, b) =>
        (vivcById.get(b) ?? 0) - (vivcById.get(a) ?? 0) ||
        (aliasCount.get(b) ?? 0) - (aliasCount.get(a) ?? 0) ||
        a - b);
    }
    return cand[0];
  }

  // ---- resolve --------------------------------------------------------
  const { rows: wg } = await pool.query(
    `SELECT lwin::text, grape_name_raw, source FROM wine.wine_grapes`,
  );
  const stages: Record<string, number> = { exact: 0, colour_stripped: 0, first_two: 0 };
  const updates: Array<[string, string, string, number]> = [];
  const unresolved = new Map<string, number>();

  for (const r of wg) {
    const nn = norm(r.grape_name_raw);
    let gid = pick(nn);
    if (gid) stages.exact++;
    if (!gid) {
      const stripped = stripColourWords(nn);
      if (stripped && stripped !== nn) {
        gid = pick(stripped);
        if (gid) stages.colour_stripped++;
      }
    }
    if (!gid) {
      for (const cand of [nn, stripColourWords(nn)]) {
        const toks = cand.split(" ").filter(Boolean);
        if (toks.length <= 2) continue;
        gid = pick(toks.slice(0, 2).join(" "));
        if (gid) { stages.first_two++; break; }
      }
    }
    if (gid) updates.push([r.lwin, r.grape_name_raw, r.source, gid]);
    else unresolved.set(r.grape_name_raw, (unresolved.get(r.grape_name_raw) ?? 0) + 1);
  }

  // ---- write ----------------------------------------------------------
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
  notes.disambiguated = disambiguated;
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
