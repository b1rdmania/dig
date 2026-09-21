/**
 * producer-merge.ts - conservative producer de-duplication for wine.producers.
 *
 * LWIN keys a producer on (PRODUCER_TITLE, PRODUCER_NAME, COUNTRY), so one
 * house lands on several rows: "Domaine X" beside "X", "X" beside "X et
 * Fils". Some look-alikes are genuinely different houses (the Gros family in
 * Burgundy, Domaine Overnoy vs Maison Pierre Overnoy in the Jura, Conterno,
 * Mascarello, Prum). A wrong merge is worse than a missed one, so every rule
 * here is deliberately narrow: a differing personal given name is NEVER
 * classed 'auto', whatever the corroborating evidence.
 *
 * Pipeline (same country only, checked before any rule runs):
 *   1. same_norm       - identical name_norm (title/punctuation differs only)
 *   2. title_stripped  - identical after stripping legal/title/connector
 *                        tokens (domaine, chateau, ..., et fils, azienda
 *                        agricola, et/de/la/... )
 *   3. given_name_diff  - shares a core token (the surname) but the two
 *                        names differ by at least one extra token once legal
 *                        and connector words are removed - almost always a
 *                        first name, an "et Fils" heir, or a sibling. Never
 *                        classed 'auto'.
 *   Anything with no shared core token is not a candidate at all - the pair
 *   is simply not generated (this is where Prum's JJ/SA branches and
 *   Conterno's Giacomo/Aldo/Paolo fall, since they share only the family
 *   name and this rule requires a shared name AFTER the surname test above,
 *   i.e. it still fires - the guard against wrongly merging them is the
 *   corroboration step, not non-generation. See classifyPair.)
 *
 * Corroboration comes from the wines, never the name alone: same `region`
 * plus an overlapping `sub_region` set (LWIN's own field - no dependency on
 * wine.appellations, which another agent reloads independently). Region
 * alone is too coarse: Domaine Overnoy and Maison Pierre Overnoy are both
 * REGION='Jura' but the first's wines are all Cotes du Jura and the
 * second's are all Arbois/Arbois Pupillin - disjoint sub_regions, so
 * corroborate() returns 'none' and the pair rejects even though the rule
 * (given_name_diff) fired.
 *
 * Classification:
 *   auto   - same_norm or title_stripped, AND corroboration 'strong'.
 *   review - given_name_diff with any corroboration, OR same_norm /
 *            title_stripped with corroboration 'weak' (region matches,
 *            sub_regions are both non-empty and disjoint - ambiguous).
 *   reject - corroboration 'none' (region does not match), or
 *            given_name_diff with corroboration 'weak'.
 *
 * Idempotent apply: every run first puts each wine back on its LWIN producer
 * (resetToLwin, from lwin.csv), then generates candidates from that clean
 * state and applies class 'auto'. A rule change that withdraws a merge
 * therefore undoes it on the next run. Nothing keys on a serial id.
 * producer-merges.json records each row's LWIN `source_ref` for the auditor;
 * the apply step does not read that file back.
 *
 * Titles: two rows that both carry a title, and different ones, are never
 * 'auto' (Domaine Leroy is the estate, Maison Leroy the negociant).
 *
 * A merged-away row is kept, not deleted (wine.wines.producer_id has no
 * ON DELETE, and wine.listings does not cascade either - see
 * docs/wine-bore-build.md). It is left in wine.producers with
 * wine_count = 0 (so it drops out of every ranked list and tool query) and
 * gets one wine.producer_links row, kind='merged_into', pointing at the
 * surviving producer. producer_links already exists for exactly this job
 * (linking a producer id to other identifiers) and its schema has no CHECK
 * on `kind`, so this is the smallest change that records the canonical row
 * without a migration. Its FK is ON DELETE CASCADE, so a future full LWIN
 * reload cleans these rows up for free when it deletes wine.producers.
 *
 * Order: producer-merge.ts --reset-only, then load-producer-links.ts and
 * load-systembolaget.ts if they need a re-run, then producer-merge.ts.
 *
 * CLI (guarded - importing this module runs nothing):
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig \
 *     pnpm exec tsx scripts/wine/producer-merge.ts
 *
 * Writes scripts/wine/producer-merges.json and
 * docs/wine-bore-producer-merge-review.md, then applies every class='auto'
 * row, recomputes wine_count for every producer touched, and writes one
 * wine.load_log row.
 */
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import type pg from "pg";
import { RAW, connect, logLoad, na, readCsv, readJson, REPO_ROOT } from "./lib";
import {
  type Candidate,
  type ProducerRow,
  type WineEvidence,
  generateCandidates,
} from "./producer-merge-rules";

export * from "./producer-merge-rules";

// ---------------------------------------------------------------------------
// CLI - DB I/O, file writing, apply. Nothing below runs on import.
// ---------------------------------------------------------------------------

const MERGES_JSON = resolve(REPO_ROOT, "scripts", "wine", "producer-merges.json");
const REVIEW_MD = resolve(REPO_ROOT, "docs", "wine-bore-producer-merge-review.md");
const PACK_JSON = resolve(REPO_ROOT, "bores", "wine-bore", "pack", "shelves.json");

async function loadProducers(pool: pg.Pool): Promise<ProducerRow[]> {
  const res = await pool.query<ProducerRow>(
    `SELECT id, name, title, name_norm, country, region, wine_count, source_ref
       FROM wine.producers WHERE source = 'lwin'`,
  );
  return res.rows;
}

/**
 * Every run starts from LWIN. The apply step overwrites wine.wines.producer_id,
 * so without this a merge that a rule change withdraws (Domaine Leroy into
 * Maison Leroy, first cut of this script) could never be undone, and a second
 * run would see the merged-away row with no wines and no evidence. LWIN's CSV
 * holds each wine's (title, name, country), which is wine.producers.source_ref.
 *
 * wine_count is LIVE wines, as load-lwin.ts defines it.
 *
 * Listings and producer_links that a withdrawn merge moved are not moved back
 * here: re-run load-producer-links.ts and load-systembolaget.ts for that.
 */
async function resetToLwin(pool: pg.Pool): Promise<number> {
  const { rows: prod } = await pool.query<{ id: number; source_ref: string }>(`SELECT id, source_ref FROM wine.producers WHERE source = 'lwin'`);
  const idByRef = new Map(prod.map((r) => [r.source_ref, r.id]));
  const { rows: cur } = await pool.query<{ lwin: string; producer_id: number | null }>(`SELECT lwin::text, producer_id FROM wine.wines`);
  const current = new Map(cur.map((r) => [r.lwin, r.producer_id]));
  const fixes: [string, number][] = [];
  for await (const r of readCsv(resolve(RAW, "lwin", "lwin.csv"))) {
    const lwin = na(r.LWIN);
    if (!lwin || !current.has(lwin)) continue;
    const id = idByRef.get(`${na(r.PRODUCER_TITLE) ?? ""}|${na(r.PRODUCER_NAME) ?? ""}|${na(r.COUNTRY) ?? ""}`);
    if (id && current.get(lwin) !== id) fixes.push([lwin, id]);
  }
  for (let i = 0; i < fixes.length; i += 2000) {
    const slice = fixes.slice(i, i + 2000);
    const params: unknown[] = [];
    const values = slice.map(([l, id]) => { params.push(l, id); return `($${params.length - 1}::bigint,$${params.length}::int)`; }).join(",");
    await pool.query(`UPDATE wine.wines w SET producer_id = v.pid FROM (VALUES ${values}) AS v(lwin, pid) WHERE w.lwin = v.lwin`, params);
  }
  await pool.query(`DELETE FROM wine.producer_links WHERE source = 'producer-merge'`);
  await pool.query(`UPDATE wine.producers p SET wine_count = c.n FROM (SELECT p2.id, count(w.lwin)::int n FROM wine.producers p2 LEFT JOIN wine.wines w ON w.producer_id = p2.id AND w.status = 'Live' GROUP BY p2.id) c WHERE c.id = p.id AND p.wine_count <> c.n`);
  return fixes.length;
}

/**
 * One evidence row per producer, derived from its CURRENT wines. A producer
 * whose wines have already moved away (wine_count 0 - either genuinely thin
 * in LWIN, or already merged away by an earlier run of this script) has no
 * row here; the caller fills that gap from wine.producers.region so a
 * second run still corroborates a merge it already applied, instead of
 * losing the region signal the moment a merge succeeds.
 */
async function loadEvidence(pool: pg.Pool): Promise<Map<number, WineEvidence>> {
  const res = await pool.query<{ producer_id: number; region: string | null; sub_regions: string[] }>(
    `SELECT producer_id, mode() WITHIN GROUP (ORDER BY region) AS region,
            array_remove(array_agg(DISTINCT sub_region), NULL) AS sub_regions
       FROM wine.wines
      WHERE producer_id IS NOT NULL
      GROUP BY producer_id`,
  );
  const m = new Map<number, WineEvidence>();
  for (const r of res.rows) m.set(r.producer_id, { region: r.region, subRegions: r.sub_regions ?? [] });
  return m;
}

/** Fills in a fallback evidence row (region only, no sub_regions) for every
 * producer loadEvidence did not cover, from the producer's own stored
 * `region` column - see loadEvidence's doc comment. */
function withRegionFallback(producers: ProducerRow[], evidence: Map<number, WineEvidence>): Map<number, WineEvidence> {
  const out = new Map(evidence);
  for (const p of producers) {
    if (!out.has(p.id)) out.set(p.id, { region: p.region, subRegions: [] });
  }
  return out;
}

function packProducerIds(): Set<number> {
  const pack = readJson<{ shelves: Array<{ members: Array<{ type: string; id: number }> }> }>(PACK_JSON);
  const ids = new Set<number>();
  for (const shelf of pack.shelves ?? [])
    for (const m of shelf.members ?? []) if (m.type === "producer") ids.add(m.id);
  return ids;
}

function orderCandidates(candidates: Candidate[], top500: Set<number>, pack: Set<number>): Candidate[] {
  const rank = (c: Candidate): number => {
    if (top500.has(c.keep_id) || top500.has(c.merge_id)) return 0;
    if (pack.has(c.keep_id) || pack.has(c.merge_id)) return 1;
    return 2;
  };
  return [...candidates].sort((x, y) => {
    const r = rank(x) - rank(y);
    if (r !== 0) return r;
    return y.keep_wines + y.merge_wines - (x.keep_wines + x.merge_wines);
  });
}

function writeReviewMd(shown: Candidate[], all: Candidate[]): void {
  const review = shown.filter((c) => c.class === "review");
  const auto = all.filter((c) => c.class === "auto");
  const allReview = all.filter((c) => c.class === "review").length;
  const allReject = all.filter((c) => c.class === "reject").length;

  const lines: string[] = [];
  lines.push("# Wine Bore producer merge review");
  lines.push("");
  lines.push(
    `Generated by scripts/wine/producer-merge.ts. ${auto.length} pairs are class auto and were applied. ` +
    `${allReview} pairs are class review; the ${review.length} below touch a top-500 producer or a shelf producer. ` +
    `${allReject} pairs were rejected (different region, or a shared surname with no shared village).`,
  );
  lines.push("");
  lines.push("## Review - needs a human decision");
  lines.push("");
  lines.push("| Keep | Merge candidate | Country | Region | Rule | Wines (keep / merge) | Evidence |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const c of review) {
    lines.push(
      `| ${c.keep_name} (#${c.keep_id}) | ${c.merge_name} (#${c.merge_id}) | ${c.country} | ${c.region ?? "-"} | ` +
      `${c.rule} | ${c.keep_wines} / ${c.merge_wines} | ${c.evidence} |`,
    );
  }
  lines.push("");
  writeFileSync(REVIEW_MD, lines.join("\n") + "\n");
}

/**
 * Exactly one candidate is allowed to claim a given merge_id. A name_norm
 * bucket with three or more rows (e.g. three separate LWIN rows all called
 * "Gabbiano") produces several pairwise 'auto' candidates that name the SAME
 * thin row as their merge target from different keeps; applying more than
 * one would either double-move the same wines or - worse - splice two
 * otherwise-unrelated keeps together through a shared merge target that was
 * never itself vetted by classifyPair. The candidate with the most keep_wines
 * (the most established row) wins; the rest are left for a future run, where
 * they will very likely just disappear (their evidence changes once the
 * winning merge has been applied).
 */
function dedupeByMergeTarget(auto: Candidate[]): Candidate[] {
  const best = new Map<number, Candidate>();
  for (const c of auto) {
    const cur = best.get(c.merge_id);
    if (!cur || c.keep_wines > cur.keep_wines) best.set(c.merge_id, c);
  }
  return [...best.values()];
}

/**
 * Orders candidates so a chain applies correctly without ever redirecting a
 * candidate to an id it was not itself classified against. #35854 -> #35853
 * -> #35851 (three LWIN rows all named "Leroy") is two SEPARATE, independently
 * vetted candidates; applying #35854->#35853 before #35853->#35851 means the
 * second UPDATE moves "whatever wine.wines currently has producer_id=35853"
 * - which by then includes #35854's wines too - straight to #35851. Nothing
 * is ever merged into an id the candidate list did not itself pair it with.
 * Kahn's algorithm: candidate D depends on every candidate C whose keep_id
 * equals D's merge_id (C's result must land on D's merge target before D
 * moves it onward).
 */
function topoSortAuto(candidates: Candidate[]): Candidate[] {
  const byKeepId = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const l = byKeepId.get(c.keep_id);
    if (l) l.push(c); else byKeepId.set(c.keep_id, [c]);
  }
  const indegree = new Map<Candidate, number>();
  const dependents = new Map<Candidate, Candidate[]>();
  for (const c of candidates) {
    const prereqs = byKeepId.get(c.merge_id) ?? [];
    indegree.set(c, prereqs.length);
    for (const p of prereqs) {
      const l = dependents.get(p);
      if (l) l.push(c); else dependents.set(p, [c]);
    }
  }
  const queue = candidates.filter((c) => (indegree.get(c) ?? 0) === 0);
  const out: Candidate[] = [];
  const done = new Set<Candidate>();
  while (queue.length) {
    const c = queue.shift() as Candidate;
    if (done.has(c)) continue;
    done.add(c);
    out.push(c);
    for (const d of dependents.get(c) ?? []) {
      const n = (indegree.get(d) ?? 1) - 1;
      indegree.set(d, n);
      if (n <= 0) queue.push(d);
    }
  }
  // A cycle should not occur (keep is always the higher wine_count side, so
  // a merge_id/keep_id loop can only happen on an exact wine_count tie chain
  // that also loops back, vanishingly unlikely) - append anything left over
  // as-is rather than dropping it; resetToLwin starts the next run from LWIN again.
  for (const c of candidates) if (!done.has(c)) out.push(c);
  return out;
}

async function applyAuto(pool: pg.Pool, auto: Candidate[]): Promise<{ wines: number; listings: number; links: number }> {
  let wines = 0;
  let listings = 0;
  let links = 0;

  const ordered = topoSortAuto(dedupeByMergeTarget(auto));

  for (const c of ordered) {
    if (c.keep_id === c.merge_id) continue;

    await pool.query("BEGIN");
    try {
      const w = await pool.query(
        `UPDATE wine.wines SET producer_id = $1 WHERE producer_id = $2`,
        [c.keep_id, c.merge_id],
      );
      wines += w.rowCount ?? 0;

      const l = await pool.query(
        `UPDATE wine.listings SET producer_id = $1 WHERE producer_id = $2`,
        [c.keep_id, c.merge_id],
      );
      listings += l.rowCount ?? 0;

      // producer_links' PK is (source, source_ref), not producer_id, so a
      // merge-away producer's existing links (wikidata, exa, trade-body)
      // move to the surviving row rather than being duplicated or dropped.
      // Any link that would collide on (source, source_ref) with a link the
      // keep row already has stays on the merged-away row - it is kept
      // (wine_count 0), so nothing is lost, just not de-duplicated further.
      const moved = await pool.query(
        `UPDATE wine.producer_links SET producer_id = $1
           WHERE producer_id = $2
             AND NOT EXISTS (
               SELECT 1 FROM wine.producer_links x
                WHERE x.producer_id = $1 AND x.source = wine.producer_links.source
                  AND x.source_ref = wine.producer_links.source_ref
             )`,
        [c.keep_id, c.merge_id],
      );
      links += moved.rowCount ?? 0;

      await pool.query(
        `INSERT INTO wine.producer_links (producer_id, source, source_ref, name_as_found, url, kind, match_method, match_score)
         VALUES ($1, 'producer-merge', $2, $3, NULL, 'merged_into', $4, 1)
         ON CONFLICT (source, source_ref) DO UPDATE SET producer_id = EXCLUDED.producer_id, match_method = EXCLUDED.match_method`,
        [c.keep_id, c.merge_source_ref, c.merge_name, c.rule],
      );

      await pool.query(
        `UPDATE wine.producers SET wine_count = (SELECT count(*) FROM wine.wines WHERE producer_id = wine.producers.id AND status = 'Live')
          WHERE id IN ($1, $2)`,
        [c.keep_id, c.merge_id],
      );

      await pool.query("COMMIT");
    } catch (e) {
      await pool.query("ROLLBACK");
      throw e;
    }
  }

  return { wines, listings, links };
}

async function main(): Promise<void> {
  const pool = connect();

  const restored = await resetToLwin(pool);
  console.log(`[producer-merge] ${restored} wine(s) put back on their LWIN producer before matching`);
  // load-producer-links.ts and load-systembolaget.ts match against producers
  // and their wines, so they must run on the LWIN state, not the merged one
  // (a listing matched to a merged-away row finds an empty catalogue).
  if (process.argv.includes("--reset-only")) { await pool.end(); return; }

  const producers = await loadProducers(pool);
  const evidence = withRegionFallback(producers, await loadEvidence(pool));
  const top500 = new Set(
    [...producers].sort((a, b) => b.wine_count - a.wine_count).slice(0, 500).map((p) => p.id),
  );
  const pack = packProducerIds();

  const candidates = orderCandidates(generateCandidates(producers, evidence), top500, pack);

  // The files are for a reader. Every auto merge is listed. Review pairs are
  // listed when either house is in the top 500 by wine count or on a shelf;
  // the long tail and the rejects are counted, not printed.
  const shown = candidates.filter((c) => c.class === "auto"
    || (c.class === "review" && [c.keep_id, c.merge_id].some((id) => top500.has(id) || pack.has(id))));
  writeFileSync(MERGES_JSON, "[\n" + shown.map((c) => JSON.stringify(c)).join(",\n") + "\n]\n");
  writeReviewMd(shown, candidates);

  const auto = candidates.filter((c) => c.class === "auto");
  const review = candidates.filter((c) => c.class === "review");
  const reject = candidates.filter((c) => c.class === "reject");

  const applied = await applyAuto(pool, auto);

  await logLoad(pool, "producer-merge", {
    rows_in: producers.length,
    rows_out: applied.wines,
    matched: auto.length,
    unmatched: review.length + reject.length,
  }, {
    candidates: candidates.length,
    auto: auto.length,
    review: review.length,
    reject: reject.length,
    wines_repointed: applied.wines,
    listings_repointed: applied.listings,
    producer_links_touched: applied.links,
  });

  console.log(
    `[producer-merge] candidates=${candidates.length} auto=${auto.length} review=${review.length} ` +
    `reject=${reject.length} wines_repointed=${applied.wines} listings_repointed=${applied.listings}`,
  );

  await pool.end();
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
