/**
 * grape-rules.ts - the rules both grape resolvers share.
 *
 * load-grapes.ts (register strings -> grapes) and resolve-wine-grapes.ts
 * (wine strings -> grapes) used to carry a copy each. One copy, tested:
 * scripts/wine/__tests__/grape-rules.test.ts. Pure functions, no I/O.
 */

/** Wikidata colour statements -> the four values the schema allows. */
const ROSE = ["pink", "grey", "gris", "rose", "rosé", "rosa"];
const RED = ["black", "blue", "noir", "red", "purpl", "violet", "ruby", "brick", "jet"];
const WHITE = ["white", "green", "yellow", "blanc", "gold", "lime", "amber"];

export type Colour = "red" | "white" | "rose" | "unknown";

/**
 * Wikidata carries two colour statements per variety and they disagree for
 * 368 rows: Semillon is "black berry skin|white". "black berry skin" is the
 * spurious one, so rose beats white beats red. A lone "black berry skin" is no
 * evidence: where VIVC can check it, it is wrong 45% of the time.
 */
export function wikidataColour(cell: string | null | undefined): Colour {
  const raw = (cell ?? "").trim();
  if (!raw || raw === "NA") return "unknown";
  const toks = raw.split("|").map((t) => t.toLowerCase());
  if (toks.length === 1 && toks[0] === "black berry skin") return "unknown";
  if (toks.some((t) => ROSE.some((k) => t.includes(k)))) return "rose";
  if (toks.some((t) => WHITE.some((k) => t.includes(k)))) return "white";
  if (toks.some((t) => RED.some((k) => t.includes(k)))) return "red";
  return "unknown";
}

/**
 * VIVC passport "Color of berry skin" -> schema colour. ROUGE is a red-skinned
 * berry, not a red-wine grape: Riesling Rot, Silvaner Rot, Catawba, Muscat a
 * petits grains rouges. The register codes the same grapes Rg or Rs, so ROUGE
 * sits with ROSE and GRIS. NOIR is the red-wine colour.
 */
const VIVC_COLOUR: Record<string, Colour> = { BLANC: "white", NOIR: "red", ROUGE: "rose", ROSE: "rose", GRIS: "rose" };

export function vivcColour(cell: string | null | undefined): Colour | null {
  return VIVC_COLOUR[(cell ?? "").trim().toUpperCase()] ?? null;
}

/** VIVC is ampelography. When it states one colour for the item's numbers, it wins over Wikidata. */
export function grapeColour(vivcColours: (Colour | null | undefined)[], wikidataCell: string | null | undefined): Colour {
  const stated = [...new Set(vivcColours.filter((c): c is Colour => !!c))];
  if (stated.length === 1) return stated[0];
  return wikidataColour(wikidataCell);
}

/** Register colour code -> expected grape colour. */
export function colourFromCode(code: string | null | undefined): Colour | null {
  if (!code) return null;
  if (code === "B") return "white";
  if (code === "N") return "red";
  if (["Rs", "Rg", "G", "Gr", "R"].includes(code)) return "rose";
  return null;
}

/** Colour adjectives the national registers bolt onto a variety name: "Weißer Riesling" is Riesling. */
const COLOUR_WORDS = new Set([
  "weisser", "weisse", "weiss", "weisen", "blauer", "blaue", "blau", "grauer", "graue",
  "roter", "rote", "rot", "gelber", "gelbe", "fruhroter", "fruhrote", "schwarzer",
  "blanc", "blanche", "blancs", "noir", "noire", "noirs", "gris", "grise", "rouge", "rose",
  "bianco", "bianca", "bianchi", "nero", "nera", "neri", "grigio", "grigia", "rosso", "rossa",
  "blanco", "blanca", "tinto", "tinta", "negro", "negra", "rosado", "roxo", "branco",
]);

export function stripColourWords(nameNorm: string): string {
  return nameNorm.split(" ").filter((t) => t && !COLOUR_WORDS.has(t)).join(" ");
}

const NAME_WHITE = new Set(["blanc", "blanche", "blanco", "bianco", "bianca", "branco", "weiss", "weisser", "white", "belyi", "zold", "verde", "bily"]);
const NAME_RED = new Set(["noir", "noire", "nero", "nera", "negro", "negra", "tinto", "tinta", "neagra", "modre", "modry", "schwarz", "schwarzer", "black", "rouge", "rosso", "rossa", "kek"]);

/** The colour a variety name states about itself: "Caino blanco" is white, "Douce noir" red. */
export function nameColourWord(nameNorm: string): "white" | "red" | null {
  const toks = nameNorm.split(" ");
  if (toks.some((t) => NAME_WHITE.has(t))) return "white";
  if (toks.some((t) => NAME_RED.has(t))) return "red";
  return null;
}

/** "CABERNET FRANC" -> "Cabernet Franc"; "MUELLER THURGAU WEISS" stays readable. */
export function titleCase(upper: string): string {
  return upper.toLowerCase().replace(/(^|[\s\-'’(/])(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toUpperCase());
}

// ---- the resolver ------------------------------------------------------------

export interface GrapeFact {
  id: number;
  primaryNorm: string;
  colour: Colour;
  /** How much the sources know about this grape. Breaks ties. */
  weight: number;
  /** The grape's single VIVC number, when it has one. */
  vivc?: string | null;
}

/** Where a name came from. A VIVC synonym is shared between varieties far more often than a Wikidata name. */
export type NameTier = "primary" | "wikidata" | "vivc";
const TIER_ORDER: NameTier[] = ["primary", "wikidata", "vivc"];

export interface Resolution { id: number; stage: string }

export class GrapeResolver {
  private byNorm = new Map<string, Map<number, NameTier>>();
  private facts = new Map<number, GrapeFact>();
  vetoedByColourWord = 0;
  disambiguated = 0;
  vivcAmbiguous = 0;

  constructor(facts: GrapeFact[], names: { grapeId: number; nameNorm: string; tier: NameTier }[], private manual = new Map<string, number>()) {
    for (const f of facts) this.facts.set(f.id, f);
    for (const n of names) {
      if (!n.nameNorm) continue;
      let m = this.byNorm.get(n.nameNorm);
      if (!m) { m = new Map(); this.byNorm.set(n.nameNorm, m); }
      const held = m.get(n.grapeId);
      if (!held || TIER_ORDER.indexOf(n.tier) < TIER_ORDER.indexOf(held)) m.set(n.grapeId, n.tier);
    }
  }

  /**
   * One candidate or none. A white register row never resolves to a name that
   * says "noir". Several candidates: the best name tier first, then a primary
   * name, then the colour the register wants, then weight, then the lower id.
   * A VIVC synonym shared by several varieties resolves only when the wanted
   * colour leaves exactly one.
   */
  pick(nn: string, want: Colour | null, strict: boolean): number | null {
    const m = this.byNorm.get(nn);
    if (!m || m.size === 0) return null;
    let ids = [...m.keys()];
    if (want === "white" || want === "red") {
      const kept = ids.filter((id) => {
        const w = nameColourWord(this.facts.get(id)?.primaryNorm ?? "");
        return !w || w === want;
      });
      if (kept.length < ids.length) this.vetoedByColourWord++;
      if (kept.length === 0) return null;
      ids = kept;
    }
    const bestTier = TIER_ORDER.find((t) => ids.some((id) => m.get(id) === t)) as NameTier;
    ids = ids.filter((id) => m.get(id) === bestTier);
    // Rows that stayed apart in mergeByVivc can still share a VIVC number; the
    // synonym is then not shared between varieties, only between rows.
    const numbers = new Set(ids.map((id) => this.facts.get(id)?.vivc ?? `row:${id}`));
    if (bestTier === "vivc" && ids.length > 1 && numbers.size > 1) {
      const byColour = want ? ids.filter((id) => this.facts.get(id)?.colour === want) : [];
      if (byColour.length !== 1) { this.vivcAmbiguous++; return null; }
      ids = byColour;
    }
    if (ids.length > 1) {
      this.disambiguated++;
      ids.sort((a, b) => {
        const fa = this.facts.get(a) as GrapeFact;
        const fb = this.facts.get(b) as GrapeFact;
        const ca = want && fa.colour === want ? 1 : 0;
        const cb = want && fb.colour === want ? 1 : 0;
        return cb - ca || fb.weight - fa.weight || a - b;
      });
    }
    const id = ids[0];
    if ((strict || bestTier === "vivc") && want) {
      const c = this.facts.get(id)?.colour;
      if (c && c !== "unknown" && c !== want) return null;
    }
    return id;
  }

  /** manual -> exact -> colour words stripped -> first two tokens. No trigram stage: a near miss is a different grape. */
  resolve(nameNorm: string, want: Colour | null = null): Resolution | null {
    const manual = this.manual.get(nameNorm);
    if (manual) return { id: manual, stage: "manual" };
    const exact = this.pick(nameNorm, want, false);
    if (exact) return { id: exact, stage: "exact" };
    const stripped = stripColourWords(nameNorm);
    if (stripped && stripped !== nameNorm) {
      const s = this.pick(stripped, want, true);
      if (s) return { id: s, stage: "colour_stripped" };
    }
    for (const cand of [nameNorm, stripped]) {
      const toks = cand.split(" ").filter(Boolean);
      if (toks.length <= 2) continue;
      const two = this.pick(toks.slice(0, 2).join(" "), want, true);
      if (two) return { id: two, stage: "first_two" };
    }
    return null;
  }
}

// ---- merging Wikidata items that are one variety ------------------------------

export interface ItemForMerge {
  qid: string;
  vivc: string[];
  weight: number;
  /** norm() of the item's display name. */
  primaryNorm: string;
  /** norm() of every label and alias the item carries. */
  nameNorms: string[];
  /** VIVC lists one of the item's own names under this number. Wikidata's P3904 is wrong often enough ("Spergola" carries Vernaccia di Oristano's number) that a bare number is not evidence. */
  vivcKnowsName: boolean;
  /** The display name is the VIVC prime name, with or without its colour word. */
  isPrimeName: boolean;
}

/**
 * Wikidata holds several items for one variety: "Grenache" and "Garnacha
 * Tinta" both carry VIVC 4461, "Trousseau" and "Bastardo" 12668. They load as
 * one row when two sources agree: VIVC files both under one number, AND one
 * Wikidata item lists the other's name among its own. VIVC alone is not
 * enough: it files Nerello Cappuccio under Magliocco Dolce, which no merchant
 * accepts and neither Wikidata item claims.
 *
 * The item named like the VIVC prime name keeps the row ("Trousseau" over
 * "Bastardo"), then the heaviest, then the older QID. Returns qid -> kept qid.
 */
export function mergeByVivc(items: ItemForMerge[]): Map<string, string> {
  const groups = new Map<string, ItemForMerge[]>();
  for (const it of items) {
    if (it.vivc.length !== 1 || !it.vivcKnowsName) continue;
    const g = groups.get(it.vivc[0]);
    if (g) g.push(it); else groups.set(it.vivc[0], [it]);
  }
  const keep = new Map<string, string>();
  for (const it of items) keep.set(it.qid, it.qid);
  const qnum = (q: string) => Number(q.slice(1));
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // Connected components over "one item names the other".
    const comp = new Map<string, number>();
    g.forEach((it, i) => comp.set(it.qid, i));
    const linked = (a: ItemForMerge, b: ItemForMerge) => a.nameNorms.includes(b.primaryNorm) || b.nameNorms.includes(a.primaryNorm);
    for (const a of g) for (const b of g) {
      if (a === b || !linked(a, b)) continue;
      const from = comp.get(b.qid) as number;
      const to = comp.get(a.qid) as number;
      if (from !== to) for (const [q, c] of comp) if (c === from) comp.set(q, to);
    }
    for (const c of new Set(comp.values())) {
      const part = g.filter((it) => comp.get(it.qid) === c);
      if (part.length < 2) continue;
      const head = [...part].sort((a, b) => Number(b.isPrimeName) - Number(a.isPrimeName) || b.weight - a.weight || qnum(a.qid) - qnum(b.qid))[0];
      for (const it of part) keep.set(it.qid, head.qid);
    }
  }
  return keep;
}

/** VIVC writes umlauts as AE/OE/UE. The forms of a label to try against VIVC names; `normFn` is lib.ts norm(). */
export function vivcForms(label: string, normFn: (s: string) => string): string[] {
  const german = label.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue");
  return [...new Set([normFn(label), normFn(german)])].filter(Boolean);
}
