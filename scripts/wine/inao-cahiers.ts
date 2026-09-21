/**
 * inao-cahiers.ts - decide which cahier text belongs to which INAO slug.
 *
 * The INAO pull saved one PDF per appellation slug, but many links point at a
 * Bulletin Officiel bundle that holds several cahiers, and some point at the
 * wrong cahier outright: `gevrey-chambertin.pdf` opens with Fitou,
 * `julienas.pdf` is Regnie, `santenay.pdf` opens with Bellet. A file name is
 * therefore no evidence. The header inside the text is.
 *
 * Pure functions only. No I/O. Tests: scripts/wine/__tests__/inao-cahiers.test.ts
 */

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`´]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface CahierSection {
  /** Names inside the guillemets of the header, as printed. */
  names: string[];
  slugs: string[];
  start: number;
  end: number;
}

/**
 * A cahier header at the start of a line: "Cahier des charges de
 * l'appellation d'origine controlee « X » [ou « Y »]". The name can sit one or
 * two lines below the phrase. pdftotext starts each page with a form feed, so
 * the line can open with one. Accents are inconsistent in the source
 * ("PROTEGEE", "PROTEGÉE", "contrôlee"), so every accented letter is optional.
 */
const HEADER = new RegExp(
  "^[ \\t\\f]*(?:\\d+[ \\t]+)?cahier\\s+des\\s+charges\\s+(?:modifi[ée]\\s+)?(?:de\\s+l[’']\\s*|des\\s+|du\\s+)?" +
  "(?:aop|aoc|igp|appellations?\\s*d[’']\\s*origine(?:\\s+(?:contr[ôo]l[ée]e?s?|prot[ée]g[ée]e?s?))*|" +
  "indications?\\s+g[ée]ographiques?\\s+prot[ée]g[ée]e?s?)\\s*" +
  "((?:«[^»]{2,90}»(?:\\s*(?:ou|,|et)\\s*)?)+)",
  "gim",
);

/** Table-of-contents entries and running heads match the header too. A real cahier is never this short. */
export const MIN_SECTION_CHARS = 3000;

export function splitCahiers(text: string): CahierSection[] {
  const heads: { names: string[]; slugs: string[]; start: number }[] = [];
  for (const m of text.matchAll(HEADER)) {
    const names = [...m[1].matchAll(/«\s*([^»]+?)\s*»/g)].map((x) => x[1].replace(/\s+/g, " ").trim());
    heads.push({ names, slugs: names.map(slugify), start: m.index ?? 0 });
  }
  const merged: CahierSection[] = [];
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
    const last = merged[merged.length - 1];
    // The same cahier prints its header twice (decree line, then title page).
    if (last && last.slugs.join("|") === h.slugs.join("|")) last.end = end;
    else merged.push({ ...h, end });
  });
  return merged.filter((s) => s.end - s.start >= MIN_SECTION_CHARS);
}

/**
 * pdftotext returns symbol soup for PDFs with a private font encoding
 * (`maury`, `muscat-de-rivesaltes`). French prose is mostly letters.
 */
export function isGarbled(text: string): boolean {
  const sample = text.slice(0, 20000).replace(/\s+/g, "");
  if (sample.length < 200) return true;
  const letters = (sample.match(/[a-zA-ZÀ-ÿ]/g) ?? []).length;
  return letters / sample.length < 0.6;
}

const CONNECTORS = new Set(["ou", "et"]);

/** True when the slug is made of the header names and nothing else: "cotes-de-bourg-bourg-et-bourgeais" from « Côtes de Bourg », « Bourg », « Bourgeais ». */
export function slugNamedBy(slug: string, headerSlugs: string[]): boolean {
  if (headerSlugs.includes(slug)) return true;
  if (slug.split("-ou-").some((part) => headerSlugs.includes(part))) return true;
  // The register shortened a name INAO prints in full: "la-liviniere" from « Minervois-La Livinière ».
  if (headerSlugs.some((h) => h.endsWith(`-${slug}`))) return true;
  const slugToks = slug.split("-");
  const used = headerSlugs.filter((h) => h.split("-").every((t) => slugToks.includes(t)));
  if (used.length === 0) return false;
  const covered = new Set(used.flatMap((h) => h.split("-")));
  return slugToks.every((t) => covered.has(t) || CONNECTORS.has(t));
}

/**
 * One cahier covers many appellations. INAO publishes a single document for
 * "les cinquante et une appellations d'origine controlees « Alsace grand cru »".
 * The lieu-dit must still appear in the text.
 */
const SHARED_CAHIERS = ["alsace-grand-cru"];

export function namesInHead(text: string, chars = 4000): string[] {
  return [...text.slice(0, chars).matchAll(/«\s*([^»]+?)\s*»/g)].map((m) => slugify(m[1].replace(/\s+/g, " ")));
}

export type CahierVerdict =
  | { ok: true; how: "section" | "whole" | "shared"; text: string }
  | { ok: false; reason: "garbled" | "wrong_cahier" | "bundle_without_slug"; found: string[] };

/** The text to file under `slug`, given the text extracted from `<slug>.pdf`. */
export function cahierFor(slug: string, fileText: string): CahierVerdict {
  if (isGarbled(fileText)) return { ok: false, reason: "garbled", found: [] };
  const sections = splitCahiers(fileText);
  const own = sections.filter((s) => slugNamedBy(slug, s.slugs)).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (own && sections.length > 1) return { ok: true, how: "section", text: fileText.slice(own.start, own.end) };
  if (sections.length > 1) return { ok: false, reason: "bundle_without_slug", found: sections.map((s) => s.slugs[0]) };
  const head = namesInHead(fileText);
  if (slugNamedBy(slug, head)) return { ok: true, how: "whole", text: fileText };
  const shared = SHARED_CAHIERS.find((p) => slug.startsWith(`${p}-`) && head.includes(p));
  if (shared) {
    const lieuDit = slug.slice(shared.length + 1).replace(/-/g, " ");
    const flat = fileText.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
    if (flat.includes(lieuDit)) return { ok: true, how: "shared", text: fileText };
  }
  return { ok: false, reason: "wrong_cahier", found: head.slice(0, 3) };
}
