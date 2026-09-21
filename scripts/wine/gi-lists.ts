/**
 * gi-lists.ts - pure helpers for load-gi-lists.ts. No side effects.
 * norm() comes from text.ts: one normalisation, ledger rule 1.
 */
import { norm } from "./text";

/** TTB AVA geojson `within`/`contains`: pipe-separated, possibly empty. */
export function parsePipeList(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split("|").map((t) => t.trim()).filter(Boolean);
}

/**
 * TTB AVA geojson `aka`: comma-separated alternate names, but the field is
 * free text and a few rows carry a prose note instead of a name list
 * ("refered by many newspaper articles as the ... Oak Flats Valley Ranch").
 * A candidate is kept only if it reads as a name: no digits, no quote marks,
 * and no more than 6 words - long enough for "Kelsey Bench, Kelseyfille
 * Bench" but short enough to drop a sentence.
 */
export function parseAkaList(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 60)
    .filter((t) => !/["\d]/.test(t))
    .filter((t) => t.split(/\s+/).length <= 6);
}

/** One row from a committed scripts/wine/gi-lists/<cc>.json file. */
export type GiListRow = {
  name: string;
  gi_type: string;
  parent: string | null;
  aliases: string[];
  source_url: string;
};

/**
 * De-duplicate a set of candidate alias strings against the protected name
 * and against each other, by name_norm. Returns the aliases actually worth
 * inserting as appellation_names rows (kind='alias'): non-empty norm, not
 * equal to the protected name's norm, first spelling wins on a norm clash.
 */
export function dedupeAliases(protectedName: string, candidates: string[]): string[] {
  const primaryNorm = norm(protectedName);
  const seen = new Set<string>([primaryNorm]);
  const out: string[] = [];
  for (const c of candidates) {
    const nn = norm(c);
    if (!nn || seen.has(nn)) continue;
    seen.add(nn);
    out.push(c);
  }
  return out;
}

/**
 * Resolve each row's `parent` name (a string in the same list) to that row's
 * own index, for a single country's flat list. A parent name that does not
 * exist in the list is dropped (never invented), and is reported by the
 * caller through a returned miss.
 */
export function resolveParents(rows: GiListRow[]): { parentIndex: Array<number | null>; misses: string[] } {
  const indexByNorm = new Map<string, number>();
  rows.forEach((r, i) => {
    const nn = norm(r.name);
    if (!indexByNorm.has(nn)) indexByNorm.set(nn, i);
  });
  const misses: string[] = [];
  const parentIndex = rows.map((r) => {
    if (!r.parent) return null;
    const idx = indexByNorm.get(norm(r.parent));
    if (idx === undefined) { misses.push(`${r.name} -> ${r.parent}`); return null; }
    return idx;
  });
  return { parentIndex, misses };
}
