/**
 * match.ts - one producer matcher, shared by load-producer-links.ts and
 * load-systembolaget.ts.
 *
 * Cascade, stopping at the first hit:
 *   exact          raw name string equals a producer's name or display_name
 *   norm           norm(name) equals name_norm or norm(display_name)
 *   norm_stripped  as above with title words (chateau, domaine, bodegas...) removed both sides
 *   trgm           similarity(name_norm, candidate) >= 0.6, same country only
 *   none           no candidate
 *
 * Country narrows every stage when the source gives one; when it does not, the
 * whole LWIN set is the candidate pool and trgm is skipped (too noisy without
 * a country). When a stage returns several candidates the one with the highest
 * wine_count wins and the method is suffixed '_ambiguous'.
 */
import type pg from "pg";
import { norm } from "./lib";

export type MatchMethod =
  | "exact" | "exact_ambiguous"
  | "norm" | "norm_ambiguous"
  | "norm_stripped" | "norm_stripped_ambiguous"
  | "trgm" | "trgm_ambiguous"
  | "none";

export type Match = {
  producer_id: number | null;
  method: MatchMethod;
  score: number | null;
  candidates: number;
};

/** Title / legal-form words that carry no identity. Removed from both sides. */
const TITLE_PHRASES = ["azienda agricola", "s r l", "s l", "s a", "and co"];
const TITLE_WORDS = new Set([
  "chateau", "domaine", "weingut", "bodega", "bodegas", "cantina", "tenuta", "maison", "clos",
  "mas", "quinta", "castello", "fattoria", "podere", "vina", "vinos", "cave", "caves", "celler",
  "cellers", "schloss", "winery", "vineyards", "vineyard", "estate", "wines", "wine", "family",
  "co", "az", "agr",
]);

/** norm() with title words and legal forms removed. "" when nothing is left. */
export function stripTitle(s: string | null | undefined): string {
  let t = ` ${norm(s)} `;
  for (const p of TITLE_PHRASES) t = t.split(` ${p} `).join(" ");
  const kept = t.trim().split(" ").filter((w) => w && !TITLE_WORDS.has(w));
  return kept.join(" ");
}

type Row = {
  id: number;
  name: string;
  display_name: string;
  name_norm: string;
  country: string | null;
  wine_count: number;
};

const NONE: Match = { producer_id: null, method: "none", score: null, candidates: 0 };

export class ProducerMatcher {
  private rows: Row[] = [];
  private exact = new Map<string, Row[]>();
  private byNorm = new Map<string, Row[]>();
  private byStripped = new Map<string, Row[]>();
  private trgmCache = new Map<string, Match>();

  constructor(private pool: pg.Pool) {}

  async load(source = "lwin"): Promise<number> {
    const res = await this.pool.query<Row>(
      `SELECT id, name, display_name, name_norm, country, wine_count
         FROM wine.producers WHERE source = $1`,
      [source],
    );
    this.rows = res.rows;
    for (const r of this.rows) {
      // Two country buckets per key: the producer's own, and "" for
      // country-blind lookups.
      for (const c of [r.country ?? "", ""]) {
        push(this.exact, `${r.name}|${c}`, r);
        if (r.display_name !== r.name) push(this.exact, `${r.display_name}|${c}`, r);
        push(this.byNorm, `${r.name_norm}|${c}`, r);
        const dn = norm(r.display_name);
        if (dn !== r.name_norm) push(this.byNorm, `${dn}|${c}`, r);
        const sn = stripTitle(r.name);
        if (sn) push(this.byStripped, `${sn}|${c}`, r);
        const sd = stripTitle(r.display_name);
        if (sd && sd !== sn) push(this.byStripped, `${sd}|${c}`, r);
      }
    }
    return this.rows.length;
  }

  /** country is ISO alpha-2 or null/'' for a country-blind match. */
  async match(name: string | null | undefined, country: string | null | undefined): Promise<Match> {
    if (!name || !name.trim()) return NONE;
    const c = country ?? "";
    const raw = name.trim();

    const stages: Array<[MatchMethod, Row[] | undefined]> = [
      ["exact", this.exact.get(`${raw}|${c}`)],
      ["norm", this.byNorm.get(`${norm(raw)}|${c}`)],
      ["norm_stripped", stripTitle(raw) ? this.byStripped.get(`${stripTitle(raw)}|${c}`) : undefined],
    ];
    for (const [method, hits] of stages) {
      if (hits && hits.length) {
        const best = pickBest(hits);
        return {
          producer_id: best.id,
          method: (hits.length > 1 ? `${method}_ambiguous` : method) as MatchMethod,
          score: 1,
          candidates: hits.length,
        };
      }
    }
    if (!c) return NONE;
    return this.trgm(norm(raw), c);
  }

  private async trgm(nameNorm: string, country: string): Promise<Match> {
    if (!nameNorm) return NONE;
    const key = `${nameNorm}|${country}`;
    const cached = this.trgmCache.get(key);
    if (cached) return cached;
    const res = await this.pool.query<{ id: number; s: string; n: string }>(
      `SELECT id, similarity(name_norm, $1)::text s, count(*) OVER ()::text n
         FROM wine.producers
        WHERE source = 'lwin' AND country = $2 AND similarity(name_norm, $1) >= 0.6
        ORDER BY similarity(name_norm, $1) DESC, wine_count DESC
        LIMIT 5`,
      [nameNorm, country],
    );
    const out: Match = res.rows.length
      ? {
          producer_id: res.rows[0].id,
          method: (res.rows.length > 1 && res.rows[1].s === res.rows[0].s ? "trgm_ambiguous" : "trgm") as MatchMethod,
          score: Number(res.rows[0].s),
          candidates: res.rows.length,
        }
      : NONE;
    this.trgmCache.set(key, out);
    return out;
  }
}

function push(m: Map<string, Row[]>, k: string, r: Row): void {
  const a = m.get(k);
  if (a) { if (!a.includes(r)) a.push(r); } else m.set(k, [r]);
}

function pickBest(rows: Row[]): Row {
  return rows.reduce((a, b) => (b.wine_count > a.wine_count ? b : a));
}

/**
 * pg_trgm's similarity(), in TS, so wine-name matching inside one producer's
 * catalogue does not cost a round trip per row. Same rule: split on
 * non-alphanumerics, pad each word with two leading and one trailing space,
 * take the set of trigrams, score |A n B| / |A u B|. Verified against
 * similarity() in Postgres for 'chateau margaux' / 'margaux' (0.5) and
 * 'le demi sec' / 'demi sec' (0.75).
 */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of norm(s).split(" ")) {
    if (!w) continue;
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

export function trgmSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Word-boundary containment on norm() strings: does `needle` appear in `hay`
 * as whole words? "chateau margaux rouge" contains "margaux", not "arg".
 */
export function normContains(hay: string, needle: string): boolean {
  if (!hay || !needle) return false;
  return ` ${hay} `.includes(` ${needle} `);
}

/**
 * Containment in either direction, with a floor on the shorter string.
 * The floor is the whole point: LWIN wine_name is often a single letter
 * ("E", "C", "T"), and without it every long label "contains" one of them and
 * every wine matches everything.
 */
export function bidiContains(a: string, b: string, min = 5): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  if (short.length < min) return false;
  return normContains(a, b) || normContains(b, a);
}
