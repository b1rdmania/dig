/**
 * producer-merge-rules.ts - pure, side-effect-free rule functions for
 * scripts/wine/producer-merge.ts. No DB, no fs, no `pg` import, so
 * scripts/wine/__tests__/producer-merge.test.ts can load this module under
 * Vitest without a live Postgres connection or pg's native bindings on the
 * module-resolution path. `norm()` is duplicated from ./lib rather than
 * imported, for the same reason: lib.ts imports `pg` at module scope, and an
 * ES module import evaluates the whole target module even when only one
 * export is used.
 *
 * See scripts/wine/producer-merge.ts for the design rationale (why these
 * three rules, why corroboration comes from region + sub_region, why a
 * differing personal given name is never classed 'auto').
 */

import { norm } from "./text";

export { norm };

export type MergeClass = "auto" | "review" | "reject";
export type Rule = "same_norm" | "title_stripped" | "given_name_diff";
export type Corroboration = "strong" | "weak" | "none";

export interface ProducerRow {
  id: number;
  name: string;
  title: string | null;
  name_norm: string;
  country: string | null;
  region: string | null;
  wine_count: number;
  source_ref: string;
}

export interface WineEvidence {
  region: string | null;
  subRegions: string[];
}

export interface Candidate {
  keep_id: number;
  keep_name: string;
  keep_source_ref: string;
  merge_id: number;
  merge_name: string;
  merge_source_ref: string;
  country: string;
  region: string | null;
  rule: Rule;
  class: MergeClass;
  keep_wines: number;
  merge_wines: number;
  evidence: string;
}

/**
 * Legal/title words that carry no identity. Every one of these is a single
 * norm() token (accents and punctuation are already gone by the time this
 * runs), including the multi-word phrases the task lists ("et fils",
 * "azienda agricola", "pere et fils") since norm() already splits them into
 * their component words and there is nothing left to match as a phrase.
 * "fils" and "pere" are treated as noise (a generational-continuation
 * suffix, like "& Co"), never "frere"/"soeur" ("brother"/"sister"), which
 * name a distinct legal entity (Gros Frere et Soeur is not Anne Gros) and
 * must stay significant.
 */
export const TITLE_TOKENS: ReadonlySet<string> = new Set([
  "domaine", "chateau", "maison", "weingut", "bodegas", "bodega", "tenuta",
  "cantina", "champagne", "estate", "wineries", "winery", "vineyards",
  "vineyard", "wines", "wine", "cellars", "cellar", "azienda", "agricola",
  "fils", "pere", "sons",
]);

/** Grammatical connectors that carry no identity either, across languages. */
export const CONNECTOR_TOKENS: ReadonlySet<string> = new Set([
  "et", "e", "and", "de", "du", "des", "la", "le", "les", "di", "della",
  "delle", "dei", "degli", "von", "van", "der", "y", "do", "da", "of",
]);

const NOISE_TOKENS: ReadonlySet<string> = new Set([...TITLE_TOKENS, ...CONNECTOR_TOKENS]);

function tokens(nameNorm: string): string[] {
  return nameNorm.split(" ").filter(Boolean);
}

/** name_norm with legal/title and connector tokens removed, tokens re-joined. */
export function stripNoise(nameNorm: string): string {
  return tokens(nameNorm).filter((t) => !NOISE_TOKENS.has(t)).join(" ");
}

/** The tokens left after stripNoise, in their original order. */
export function coreTokenList(nameNorm: string): string[] {
  return tokens(stripNoise(nameNorm));
}

/** The tokens left after stripNoise, as a set - used for the "shared core" test. */
export function coreTokens(nameNorm: string): Set<string> {
  return new Set(coreTokenList(nameNorm));
}

/**
 * The last noise-stripped token, on the Western-naming assumption that the
 * surname (or the estate's fixed identity word) comes last: "Frederic
 * Savart" -> "savart", "Anne et Jean-Francois Ganevat" -> "ganevat". Used as
 * the sole basis for the given_name_diff rule so that two names merely
 * sharing a FIRST name ("Markus Molitor" and "Markus Berres" - two different
 * Mosel growers) are never treated as a candidate: their last tokens
 * ("molitor" vs "berres") do not match, so detectRule finds nothing. This
 * trades a handful of missed non-Western-order duplicates for not inventing
 * relationships between people who only share a first name.
 */
export function lastCoreToken(nameNorm: string): string | null {
  const list = coreTokenList(nameNorm);
  return list.length ? list[list.length - 1] : null;
}

/**
 * Region + sub_region overlap between two producers' wines.
 * 'none' - region does not match (or either is blank): no corroboration.
 * 'weak' - region matches, but both producers carry sub_region data and it
 *          is disjoint: the region-level match is not enough on its own.
 * 'strong' - region matches and (sub_regions overlap, or at least one side
 *          has no sub_region data to compare - too few wines to expect an
 *          overlap, so the region match stands on its own).
 */
export function corroborate(a: WineEvidence, b: WineEvidence): Corroboration {
  const ra = norm(a.region);
  const rb = norm(b.region);
  if (!ra || !rb || ra !== rb) return "none";
  const sa = new Set(a.subRegions.map((s) => norm(s)).filter(Boolean));
  const sb = new Set(b.subRegions.map((s) => norm(s)).filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return "strong";
  for (const s of sa) if (sb.has(s)) return "strong";
  return "weak";
}

/**
 * Detects the naming rule that relates two SAME-COUNTRY producers, or
 * returns null when the names share no core token at all (not a candidate -
 * the pair is never generated).
 */
export function detectRule(a: ProducerRow, b: ProducerRow): Rule | null {
  if (a.name_norm === b.name_norm) return "same_norm";
  const sa = stripNoise(a.name_norm);
  const sb = stripNoise(b.name_norm);
  if (sa && sb && sa === sb) return "title_stripped";
  // The last core token must match (the surname / estate word) - a shared
  // FIRST name ("Markus Molitor" / "Markus Berres") is not enough. This is
  // what keeps two different growers who share a given name from ever
  // becoming a candidate.
  const la = lastCoreToken(a.name_norm);
  const lb = lastCoreToken(b.name_norm);
  if (!la || !lb || la !== lb) return null;
  return "given_name_diff";
}

/** Six names and a count: the review file is for reading. */
function listCapped(values: string[], cap = 6): string {
  const all = [...new Set(values)].filter(Boolean).sort();
  return all.length > cap ? `${all.slice(0, cap).join(",")},+${all.length - cap} more` : all.join(",");
}

/** Both rows carry a title and the titles differ ("Domaine" vs "Maison", "Chateau" vs "Domaine du"). */
export function titlesConflict(a: string | null, b: string | null): boolean {
  const first = (t: string | null) => norm(t ?? "").split(" ")[0] ?? "";
  const ta = first(a);
  const tb = first(b);
  return !!ta && !!tb && ta !== tb;
}

/**
 * Classifies a same-country pair. `a` and `b` may be given in either order;
 * the higher wine_count becomes `keep` (ties break on the lower id, so the
 * result is deterministic). Returns null when the names have no shared core
 * token (detectRule returned null) - not a candidate.
 */
export function classifyPair(
  a: ProducerRow,
  b: ProducerRow,
  evidenceA: WineEvidence,
  evidenceB: WineEvidence,
): Candidate | null {
  if (a.country !== b.country || !a.country) return null;
  if (a.id === b.id) return null;
  const rule = detectRule(a, b);
  if (!rule) return null;

  const [keep, merge, keepEv, mergeEv] =
    b.wine_count > a.wine_count || (b.wine_count === a.wine_count && b.id < a.id)
      ? [b, a, evidenceB, evidenceA]
      : [a, b, evidenceA, evidenceB];

  const corroboration = corroborate(keepEv, mergeEv);

  // A differing personal given name is never classed 'auto', whatever the
  // evidence - it needs strong corroboration just to reach 'review'.
  let cls: MergeClass;
  if (rule === "given_name_diff") {
    cls = corroboration === "strong" ? "review" : "reject";
  } else {
    cls = corroboration === "strong" ? "auto" : corroboration === "weak" ? "review" : "reject";
  }
  // Two different titles are two labels. In Burgundy "Domaine Leroy" is the
  // estate and "Maison Leroy" the negociant; they share a name, a region and
  // every village, and a merchant prices them a world apart. Same for Domaine
  // and Maison Louis Jadot, Faiveley, Bouchard. Only a row with NO title
  // folds into a titled one without a human.
  if (cls === "auto" && titlesConflict(a.title, b.title)) cls = "review";

  const evidence =
    `rule=${rule} region(keep)=${keepEv.region ?? "-"} region(merge)=${mergeEv.region ?? "-"} ` +
    `subregions(keep)=[${listCapped(keepEv.subRegions)}] subregions(merge)=[${listCapped(mergeEv.subRegions)}] ` +
    `corroboration=${corroboration}`;

  return {
    keep_id: keep.id,
    keep_name: keep.name,
    keep_source_ref: keep.source_ref,
    merge_id: merge.id,
    merge_name: merge.name,
    merge_source_ref: merge.source_ref,
    country: keep.country as string,
    region: keepEv.region ?? keep.region,
    rule,
    class: cls,
    keep_wines: keep.wine_count,
    merge_wines: merge.wine_count,
    evidence,
  };
}

/**
 * Builds every candidate pair across a producer set, one country at a time.
 * Bucketing keeps this well short of O(n^2): rule 1/2 candidates are found
 * by exact-match hash buckets (name_norm, then noise-stripped name), rule 3
 * by an inverted index on core tokens, skipping tokens that are too common
 * to be a useful surname signal (capped at maxTokenBucket producers) so a
 * generic word cannot blow up the comparison count.
 */
export function generateCandidates(
  producers: ProducerRow[],
  evidenceById: Map<number, WineEvidence>,
  maxTokenBucket = 40,
): Candidate[] {
  const byCountry = new Map<string, ProducerRow[]>();
  for (const p of producers) {
    if (!p.country) continue;
    const list = byCountry.get(p.country);
    if (list) list.push(p); else byCountry.set(p.country, [p]);
  }

  const emptyEv: WineEvidence = { region: null, subRegions: [] };
  const evOf = (p: ProducerRow) => evidenceById.get(p.id) ?? emptyEv;

  const seen = new Set<string>();
  const out: Candidate[] = [];
  const push = (a: ProducerRow, b: ProducerRow) => {
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const c = classifyPair(a, b, evOf(a), evOf(b));
    if (c) out.push(c);
  };

  for (const list of byCountry.values()) {
    // Rule 1: exact name_norm buckets.
    const byNorm = new Map<string, ProducerRow[]>();
    for (const p of list) {
      const l = byNorm.get(p.name_norm);
      if (l) l.push(p); else byNorm.set(p.name_norm, [p]);
    }
    for (const bucket of byNorm.values()) {
      if (bucket.length < 2) continue;
      for (let i = 0; i < bucket.length; i++)
        for (let j = i + 1; j < bucket.length; j++) push(bucket[i], bucket[j]);
    }

    // Rule 2: noise-stripped name buckets.
    const byStripped = new Map<string, ProducerRow[]>();
    for (const p of list) {
      const s = stripNoise(p.name_norm);
      if (!s) continue;
      const l = byStripped.get(s);
      if (l) l.push(p); else byStripped.set(s, [p]);
    }
    for (const bucket of byStripped.values()) {
      if (bucket.length < 2) continue;
      for (let i = 0; i < bucket.length; i++)
        for (let j = i + 1; j < bucket.length; j++) push(bucket[i], bucket[j]);
    }

    // Rule 3: inverted index on the LAST core token only (the presumed
    // surname), so two names sharing only a first name never bucket together.
    const byToken = new Map<string, ProducerRow[]>();
    for (const p of list) {
      const t = lastCoreToken(p.name_norm);
      if (!t) continue;
      const l = byToken.get(t);
      if (l) l.push(p); else byToken.set(t, [p]);
    }
    for (const bucket of byToken.values()) {
      if (bucket.length < 2 || bucket.length > maxTokenBucket) continue;
      for (let i = 0; i < bucket.length; i++)
        for (let j = i + 1; j < bucket.length; j++) push(bucket[i], bucket[j]);
    }
  }

  return out;
}
