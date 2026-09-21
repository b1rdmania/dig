/**
 * load-rule-facts.ts - facts read out of the attached rule texts (migration 035).
 *
 * Reads:  wine.appellation_documents (text), wine.appellation_grapes, wine.grape_names
 * Writes: wine.appellations.base_yield_hl / butoir_yield_hl / yield_rules   (French cahiers)
 *         wine.appellation_grapes.named_in_rules                            (every appellation with a rule text)
 *
 * Run AFTER load-appellations, load-grapes and load-appellation-documents:
 * load-appellations rebuilds appellation_grapes, and a grape's synonyms are
 * one of the ways a rule text names it. Idempotent: clears its four columns,
 * then fills them. The parsing is in rule-facts.ts (pure, tested).
 *
 * max_yield_hl is not touched: it stays the EU register figure.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/load-rule-facts.ts
 */
import { connect, logLoad, norm } from "./lib";
import { agreesWithRegister, namedInText, parseFrenchYields, trustworthy, type YieldRule } from "./rule-facts";

async function main() {
  const pool = connect();
  const notes: Record<string, unknown> = {};

  await pool.query(`UPDATE wine.appellations SET base_yield_hl = NULL, butoir_yield_hl = NULL, yield_rules = NULL WHERE base_yield_hl IS NOT NULL OR butoir_yield_hl IS NOT NULL OR yield_rules IS NOT NULL`);
  await pool.query(`UPDATE wine.appellation_grapes SET named_in_rules = NULL WHERE named_in_rules IS NOT NULL`);

  const { rows: docs } = await pool.query<{ appellation_id: number; country: string; source: string; text: string }>(
    `SELECT appellation_id, country, source, text FROM wine.appellation_documents WHERE appellation_id IS NOT NULL ORDER BY appellation_id, id`,
  );
  const textByApp = new Map<number, string>();
  const frenchByApp = new Map<number, string>();
  for (const d of docs) {
    textByApp.set(d.appellation_id, `${textByApp.get(d.appellation_id) ?? ""}\n${d.text}`);
    if (d.source === "inao" && !frenchByApp.has(d.appellation_id)) frenchByApp.set(d.appellation_id, d.text);
  }

  // ---- yields ---------------------------------------------------------
  const { rows: apps } = await pool.query<{ id: number; name: string; max_yield_hl: string | null }>(
    `SELECT id, name, max_yield_hl FROM wine.appellations WHERE id = ANY($1::int[])`, [[...frenchByApp.keys()]],
  );
  const registerById = new Map(apps.map((a) => [a.id, a.max_yield_hl === null ? null : Number(a.max_yield_hl)]));
  const nameById = new Map(apps.map((a) => [a.id, a.name]));
  const refused: string[] = [];
  let single = 0;
  let several = 0;
  let registerIsButoir = 0;
  let registerIsBase = 0;
  let registerIsNeither = 0;
  for (const [id, text] of frenchByApp) {
    // The Alsace grand cru cahier covers 51 names; its table is per lieu-dit and per variety.
    if (text.length > 300000) continue;
    const rules: YieldRule[] = parseFrenchYields(text);
    if (!rules.length) continue;
    if (!trustworthy(rules) || !agreesWithRegister(rules, registerById.get(id) ?? null)) { refused.push(nameById.get(id) ?? String(id)); continue; }
    const one = rules.length === 1 ? rules[0] : null;
    if (one) single++; else several++;
    const reg = registerById.get(id);
    if (reg != null) {
      if (rules.some((r) => r.butoir_hl === reg)) registerIsButoir++;
      else if (rules.some((r) => r.base_hl === reg)) registerIsBase++;
      else registerIsNeither++;
    }
    await pool.query(
      `UPDATE wine.appellations SET base_yield_hl = $2, butoir_yield_hl = $3, yield_rules = $4::jsonb WHERE id = $1`,
      [id, one?.base_hl ?? null, one?.butoir_hl ?? null, JSON.stringify(rules)],
    );
  }
  notes.french_cahiers = frenchByApp.size;
  notes.yields_one_pair = single;
  notes.yields_several_pairs = several;
  notes.yield_parses_refused = refused;
  notes.register_figure_is = { butoir: registerIsButoir, base: registerIsBase, neither: registerIsNeither };

  // ---- grapes named in the rule text ------------------------------------
  const { rows: names } = await pool.query<{ grape_id: number; name: string }>(`SELECT grape_id, name FROM wine.grape_names`);
  const namesByGrape = new Map<number, string[]>();
  for (const n of names) {
    const list = namesByGrape.get(n.grape_id);
    if (list) list.push(n.name); else namesByGrape.set(n.grape_id, [n.name]);
  }
  const { rows: ag } = await pool.query<{ appellation_id: number; grape_name_raw: string; grape_id: number | null }>(
    `SELECT DISTINCT appellation_id, grape_name_raw, grape_id FROM wine.appellation_grapes WHERE appellation_id = ANY($1::int[])`,
    [[...textByApp.keys()]],
  );
  const normByApp = new Map<number, string>();
  const updates: [number, string, boolean][] = [];
  for (const r of ag) {
    let t = normByApp.get(r.appellation_id);
    if (t === undefined) { t = norm(textByApp.get(r.appellation_id) as string); normByApp.set(r.appellation_id, t); }
    const candidates = [r.grape_name_raw, ...(r.grape_id ? namesByGrape.get(r.grape_id) ?? [] : [])];
    updates.push([r.appellation_id, r.grape_name_raw, namedInText(t, candidates)]);
  }
  for (let i = 0; i < updates.length; i += 1000) {
    const slice = updates.slice(i, i + 1000);
    const params: unknown[] = [];
    const values = slice.map((u) => { params.push(u[0], u[1], u[2]); return `($${params.length - 2}::int,$${params.length - 1}::text,$${params.length}::boolean)`; }).join(",");
    await pool.query(
      `UPDATE wine.appellation_grapes g SET named_in_rules = v.named FROM (VALUES ${values}) AS v(app_id, raw, named)
       WHERE g.appellation_id = v.app_id AND g.grape_name_raw = v.raw`, params,
    );
  }
  const named = updates.filter((u) => u[2]).length;
  notes.appellations_with_rule_text = textByApp.size;
  notes.grape_rows_checked = updates.length;
  notes.grape_rows_named = named;
  // An appellation where the text names nothing is a parse miss, not a rule: leave it unmarked.
  const cleared = await pool.query(
    `UPDATE wine.appellation_grapes g SET named_in_rules = NULL
     WHERE g.named_in_rules IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wine.appellation_grapes x WHERE x.appellation_id = g.appellation_id AND x.named_in_rules)`,
  );
  notes.rows_unmarked_because_text_names_nothing = cleared.rowCount ?? 0;

  await logLoad(pool, "load-rule-facts", { rows_in: docs.length, rows_out: single + several, matched: named, unmatched: updates.length - named }, notes);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
