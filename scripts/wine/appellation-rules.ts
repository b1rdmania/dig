/**
 * appellation-rules.ts - the pure parts of resolve-appellations.ts: which
 * strings to try against the EU register for one LWIN wine, and the trailing
 * wine-type words to strip. No I/O. Tests: __tests__/appellation-rules.test.ts
 */
import { norm } from "./text";

export type Wine = {
  lwin: string;
  country: string | null;
  region: string | null;
  sub_region: string | null;
  site: string | null;
  designation: string | null;
  classification: string | null;
  status: string;
};

/**
 * Wine-type words LWIN bolts onto a protected name. Stripped from the END of
 * a string only, and only after the exact stage has failed - so
 * "Bordeaux Superieur", which is its own PDO, is never reduced to "Bordeaux".
 */
const TYPE_SUFFIX = new Set([
  "rosso", "rossa", "bianco", "bianca", "rosato", "spumante", "chinato", "passito",
  "liquoroso", "novello", "frizzante", "amabile", "dolce", "secco", "vendemmia",
  "tardiva", "rouge", "blanc", "blanche", "rose", "sec", "moelleux", "doux", "mousseux",
  "tinto", "blanco", "espumoso", "dulce", "branco", "red", "white", "sparkling", "sweet",
  // Austrian DAC tiers: "Kremstal Reserve", "Kamptal Reserve".
  "reserve",
]);

/** The strings to try against the EU register for one wine, in order. Pure; tested. */
export function registerStages(w: Pick<Wine, "country" | "region" | "sub_region" | "site" | "classification">): Array<[string, string]> {
  const c = w.country;
  const stages: Array<[string, string]> = [];
  if (w.sub_region) {
    // The grand cru is its own PDO: "Chablis grand cru", "Saint-Emilion
    // Grand Cru", "Banyuls grand cru". LWIN keeps the rank in CLASSIFICATION
    // ("Chablis / Les Clos / Grand Cru"), so 303 Chablis grands crus sat on
    // plain Chablis and quoted its yield. Tried first; most names have no
    // such row and fall through.
    if (w.classification && /grand cru/i.test(w.classification)) stages.push(["sub_region", norm(`${w.sub_region} grand cru`)]);
    stages.push(["sub_region", norm(w.sub_region)]);
    // LWIN files the Alsace grand cru lieux-dits in SUB_REGION, not SITE
    // ("Alsace / Eichberg / Grand Cru"), and each one is its own PDO named
    // "Alsace grand cru <lieu-dit>". Without this the wine falls through to
    // the region stage and lands on plain Alsace.
    if (w.country === "FR") stages.push(["sub_region", norm(`alsace grand cru ${w.sub_region}`)]);
  }
  if (w.site) {
    stages.push(["site", norm(w.site)]);
    // Alsace grand cru lieux-dits are each their own PDO, named
    // "Alsace grand cru <lieu-dit>"; LWIN keeps the bare lieu-dit.
    if (c === "FR") stages.push(["site", norm(`alsace grand cru ${w.site}`)]);
  }
  if (w.region) stages.push(["region", norm(w.region)]);
  return stages;
}

export function stripTypeSuffix(nn: string): string {
  let toks = nn.split(" ").filter(Boolean);
  while (toks.length > 1 && TYPE_SUFFIX.has(toks[toks.length - 1])) toks = toks.slice(0, -1);
  return toks.join(" ");
}

/**
 * A maximum yield a vineyard could plausibly carry. The lowest real ceilings
 * are the sweet wines (Quarts de Chaume 25 hl/ha); the highest are pergola
 * and parral regions (Valle de Guimar 222 hl/ha, 30,000 kg/ha).
 */
export function plausibleYield(value: number, unit: "hl" | "kg"): boolean {
  return unit === "hl" ? value >= 15 && value <= 250 : value >= 1500 && value <= 35000;
}
