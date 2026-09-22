/**
 * load-appellation-taste.ts - what the rules say a wine must look, smell and
 * taste like (migration 036).
 *
 * Reads:  wine.appellation_documents (text, resolved to an appellation)
 * Writes: wine.appellation_taste - one row per appellation, document and style,
 *         the clause verbatim in its own language, plus the citation.
 *
 * Run AFTER load-appellation-documents (it re-links source_document_id, which
 * that loader renumbers). Idempotent: rows upsert on the natural key
 * (appellation_id, doc_source, doc_source_ref, style_key), so ids hold across a
 * reload; rows the parser no longer produces are deleted. The parsing is in
 * taste-rules.ts (pure, tested). No model call: the Bore's model reads the
 * original language at answer time.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/load-appellation-taste.ts
 */
import { connect, logLoad } from "./lib";
import { TASTE_PARSER_VERSION, parseTasteClauses, type TasteClause } from "./taste-rules";

const LANG: Record<string, "fr" | "it" | "es"> = { inao: "fr", masaf: "it", mapa: "es" };

async function main() {
  const pool = connect();
  const { rows: docs } = await pool.query<{ id: number; appellation_id: number; country: string; source: string; source_ref: string; title: string; sha256: string | null; text: string }>(
    `SELECT id, appellation_id, country, source, source_ref, title, sha256, text FROM wine.appellation_documents WHERE appellation_id IS NOT NULL ORDER BY source, source_ref`,
  );

  type Row = { appellation_id: number; doc_source: string; doc_source_ref: string; source_document_id: number; language: string; clause: TasteClause; provenance: Record<string, unknown> };
  const rows: Row[] = [];
  const docsWithClause: Record<string, number> = {};
  const docsTotal: Record<string, number> = {};
  const missed: Record<string, string[]> = {};
  for (const d of docs) {
    const lang = LANG[d.source];
    if (!lang) continue;
    docsTotal[d.source] = (docsTotal[d.source] ?? 0) + 1;
    const clauses = parseTasteClauses(d.text, lang);
    if (!clauses.length) { (missed[d.source] ??= []).push(d.source_ref); continue; }
    docsWithClause[d.source] = (docsWithClause[d.source] ?? 0) + 1;
    for (const c of clauses) {
      rows.push({
        appellation_id: d.appellation_id, doc_source: d.source, doc_source_ref: d.source_ref, source_document_id: d.id, language: lang, clause: c,
        provenance: { parser: TASTE_PARSER_VERSION, section: c.section, document_title: d.title, document_sha256: d.sha256, chars: c.clause_text.length },
      });
    }
  }

  // Upsert, then drop what this run did not produce. One transaction.
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    await client.query("CREATE TEMP TABLE taste_keep (appellation_id int, doc_source text, doc_source_ref text, style_key text) ON COMMIT DROP");
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const params: unknown[] = [];
      const values = slice.map((r) => {
        params.push(r.appellation_id, r.doc_source, r.doc_source_ref, r.source_document_id, r.clause.style, r.clause.style_key, r.clause.colour, r.language, r.clause.clause_text, r.clause.min_alcohol, r.clause.sweetness, JSON.stringify(r.provenance));
        const n = params.length;
        return `($${n - 11},$${n - 10},$${n - 9},$${n - 8},$${n - 7},$${n - 6},$${n - 5},$${n - 4},$${n - 3},$${n - 2},$${n - 1},$${n}::jsonb)`;
      }).join(",");
      const res = await client.query(
        `INSERT INTO wine.appellation_taste (appellation_id, doc_source, doc_source_ref, source_document_id, style, style_key, colour, language, clause_text, min_alcohol, sweetness, provenance)
         VALUES ${values}
         ON CONFLICT (appellation_id, doc_source, doc_source_ref, style_key) DO UPDATE SET
           source_document_id = EXCLUDED.source_document_id, style = EXCLUDED.style, colour = EXCLUDED.colour, language = EXCLUDED.language,
           clause_text = EXCLUDED.clause_text, min_alcohol = EXCLUDED.min_alcohol, sweetness = EXCLUDED.sweetness, provenance = EXCLUDED.provenance, loaded_at = now()`,
        params,
      );
      inserted += res.rowCount ?? 0;
      const kp: unknown[] = [];
      const kv = slice.map((r) => { kp.push(r.appellation_id, r.doc_source, r.doc_source_ref, r.clause.style_key); return `($${kp.length - 3},$${kp.length - 2},$${kp.length - 1},$${kp.length})`; }).join(",");
      await client.query(`INSERT INTO taste_keep VALUES ${kv}`, kp);
    }
    const gone = await client.query(
      `DELETE FROM wine.appellation_taste t WHERE NOT EXISTS (
         SELECT 1 FROM taste_keep k WHERE k.appellation_id = t.appellation_id AND k.doc_source = t.doc_source AND k.doc_source_ref = t.doc_source_ref AND k.style_key = t.style_key)`,
    );
    await client.query("COMMIT");
    console.log(`appellation_taste: ${inserted} upserted, ${gone.rowCount ?? 0} stale rows removed`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // Coverage, read back from the table.
  const { rows: byCountry } = await pool.query<{ country: string; appellations: string; clauses: string }>(
    `SELECT a.country, count(DISTINCT t.appellation_id)::text AS appellations, count(*)::text AS clauses
     FROM wine.appellation_taste t JOIN wine.appellations a ON a.id = t.appellation_id GROUP BY 1 ORDER BY 1`,
  );
  const { rows: byColour } = await pool.query<{ colour: string | null; n: string }>(`SELECT colour, count(*)::text AS n FROM wine.appellation_taste GROUP BY 1 ORDER BY 2 DESC`);
  const notes: Record<string, unknown> = {
    parser: TASTE_PARSER_VERSION,
    documents_by_source: docsTotal,
    documents_with_clause: docsWithClause,
    documents_without_clause: missed,
    clauses_by_country: Object.fromEntries(byCountry.map((r) => [r.country, { appellations: Number(r.appellations), clauses: Number(r.clauses) }])),
    clauses_by_colour: Object.fromEntries(byColour.map((r) => [r.colour ?? "unknown", Number(r.n)])),
    with_min_alcohol: rows.filter((r) => r.clause.min_alcohol != null).length,
    with_sweetness: rows.filter((r) => r.clause.sweetness).length,
  };
  console.log(JSON.stringify(notes, null, 1));
  const withClause = Object.values(docsWithClause).reduce((a, b) => a + b, 0);
  await logLoad(pool, "load-appellation-taste", { rows_in: docs.length, rows_out: rows.length, matched: withClause, unmatched: docs.length - withClause }, notes);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
