/**
 * rule-facts.ts - facts read out of a rule text. Pure, no I/O.
 * Tests: scripts/wine/__tests__/rule-facts.test.ts
 *
 * 1. parseFrenchYields(): the base yield and the rendement butoir of a French
 *    cahier des charges, as prose ("est fixe a 35 hectolitres par hectare") or
 *    as the two-column table the Burgundy cahiers use.
 * 2. namedInText(): does a rule text name this grape variety.
 */
import { stripColourWords } from "./grape-rules";
import { norm } from "./text";

export interface YieldRule {
  /** What the pair applies to, as printed: "Vins blancs", "premier cru - Vins rouges". null when the cahier gives one pair. */
  label: string | null;
  base_hl: number;
  butoir_hl: number;
}

const PLAUSIBLE = (n: number) => n >= 10 && n <= 150;


/** A table row: a label, then two numbers in columns. */
const TABLE_ROW = /^\s*(\S.*?\S)\s{3,}(\d{2,3})\s{3,}(\d{2,3})\s*$/;
const TABLE_HEAD = /rendement\s{2,}rendement\s+butoir/i;
/** A centred context line inside the table: AOC « Meursault », mention « premier cru ». */
const CONTEXT = /«\s*([^»]+?)\s*»/;

export function parseFrenchYields(text: string): YieldRule[] {
  const rules: YieldRule[] = [];

  // ---- tables ----
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!TABLE_HEAD.test(lines[i])) continue;
    let context: string | null = null;
    let blanksAfterRow = 0;
    let sawRow = false;
    for (let j = i + 1; j < Math.min(lines.length, i + 80); j++) {
      const line = lines[j].replace(/\f/g, "");
      if (/^\s*\d+°\s*-/.test(line) || /^\s*[IVX]+\.?\s*-\s/.test(line)) break; // next numbered clause
      const row = TABLE_ROW.exec(line);
      if (row) {
        const base = Number(row[2]);
        const butoir = Number(row[3]);
        if (PLAUSIBLE(base) && PLAUSIBLE(butoir) && base <= butoir) {
          const label = row[1].replace(/\s+/g, " ");
          rules.push({ label: context && !/^aoc\b/i.test(context) ? `${context} - ${label}` : label, base_hl: base, butoir_hl: butoir });
          sawRow = true;
          blanksAfterRow = 0;
        }
        continue;
      }
      const bare = BARE_PAIR_ROW.exec(line);
      if (bare && PLAUSIBLE(Number(bare[1])) && PLAUSIBLE(Number(bare[2])) && Number(bare[1]) <= Number(bare[2])) {
        rules.push({ label: context && !/^AOC\b/.test(context) ? context : null, base_hl: Number(bare[1]), butoir_hl: Number(bare[2]) });
        sawRow = true;
        blanksAfterRow = 0;
        continue;
      }
      if (!line.trim()) { if (sawRow && ++blanksAfterRow > 12) break; continue; }
      const c = CONTEXT.exec(line);
      // A context line is short and mostly the quoted name; a page header is a full sentence.
      if (c && line.trim().length < 110 && !/opposition|comit[ée]|cahier des charges/i.test(line)) {
        context = /premier cru/i.test(line) ? "premier cru" : /^\s*aoc/i.test(line) ? `AOC ${c[1]}` : c[1];
      }
    }
  }
  if (rules.length) return dedupe(rules);

  return pairBlocks(text);
}

/** Row of a one-column table: a label and one number. Row of a label-less two-column table: two numbers. */
const ONE_COL_ROW = /^\s*(\S.*?\S)\s{3,}(\d{2,3})\s*$/;
const BARE_PAIR_ROW = /^\s*(\d{2,3})\s{6,}(\d{2,3})\s*$/;
const BLOCK_START = /\ble\s+rendement\s+(butoir\s+)?vis[ée]s?(?=\s)/gi;
/** "40 hectolitres par hectare pour les vins rouges" - the label is optional. */
const PROSE_VALUE = /(\d{2,3})\s+hectolitres\s+par\s+hectare(?:\s+pour\s+les\s+(vins\s+[^.;,]*?))?(?=\s+et\s+\d|\s*[.;,]|\s*$)/gi;
/** An opposition draft prints the struck figure beside the new one ("35 42 hectolitres"): pdftotext loses the strike, so the text cannot say which is law. */
const DRAFT_PAIR = /\b\d{2,3}\s+\d{2,3}\s+hectolitres/;

function cleanLabel(l: string | undefined): string {
  return (l ?? "").replace(/\s+/g, " ").replace(/susceptibles de b[ée]n[ée]ficier de la mention/i, "mention").trim().toLowerCase();
}

/**
 * The cahiers that state the base yield and the butoir in separate clauses:
 * as prose with or without "pour les vins rouges", or as two one-column
 * tables (Sancerre). Each clause is a block; values pair by label. One butoir
 * for "vins rouges et blancs" pairs with every base.
 */
function pairBlocks(text: string): YieldRule[] {
  const starts = [...text.matchAll(BLOCK_START)].map((m) => ({ at: m.index ?? 0, butoir: !!m[1] }));
  const base = new Map<string, number>();
  const butoir = new Map<string, number>();
  for (let i = 0; i < starts.length; i++) {
    const end = Math.min(i + 1 < starts.length ? starts[i + 1].at : text.length, starts[i].at + 1600);
    let block = text.slice(starts[i].at, end);
    const stop = block.search(/\n\s*(?:\d+°|[IVX]+\.?)\s*-\s/);
    if (stop > 0) block = block.slice(0, stop);
    // "Le rendement et le rendement butoir vises ... sont fixes a :" heads the combined table; handled above.
    if (/^le\s+rendement\s+et\s+le\s+rendement\s+butoir/i.test(block)) continue;
    if (DRAFT_PAIR.test(block)) return [];
    const into = starts[i].butoir ? butoir : base;
    const flat = block.replace(/\s+/g, " ");
    for (const m of flat.matchAll(PROSE_VALUE)) {
      const n = Number(m[1]);
      if (PLAUSIBLE(n)) into.set(cleanLabel(m[2]), n);
    }
    if (/fix[ée]s?\s+[àa]\s*:/i.test(flat)) {
      for (const line of block.split("\n")) {
        const r = ONE_COL_ROW.exec(line.replace(/\f/g, ""));
        if (r && PLAUSIBLE(Number(r[2])) && !/hectolitres|article|rendement/i.test(r[1])) into.set(cleanLabel(r[1]), Number(r[2]));
      }
    }
  }
  const rules: YieldRule[] = [];
  for (const [label, b] of base) {
    const c = butoir.get(label) ?? (butoir.size === 1 ? [...butoir.values()][0] : undefined);
    if (c === undefined || b > c) continue;
    rules.push({ label: label || null, base_hl: b, butoir_hl: c });
  }
  // Every base must have found its butoir, or the pairing is a guess.
  return rules.length === base.size ? rules : [];
}

/**
 * A label is a wine colour, type or mention. One with a figure in it is a row
 * of another table (Pecharmant's yield-by-planting-density grid); a long one is
 * a sentence the prose pattern swallowed. Either way the parse is not trusted.
 */
export function trustworthy(rules: YieldRule[]): boolean {
  return rules.every((r) => r.label === null || (r.label.length <= 60 && !/\d/.test(r.label)));
}

/**
 * The register figure is older than some cahiers (Chablis butoir 70 there, 75
 * in the 2025 text), so it need not match. But a parse where no butoir is
 * within a quarter of it has read the wrong clause (Cotes du Jura: the vin de
 * paille yield, 20, against a register 72).
 */
export function agreesWithRegister(rules: YieldRule[], registerMax: number | null): boolean {
  if (registerMax === null) return true;
  return rules.some((r) => Math.abs(r.butoir_hl - registerMax) / registerMax <= 0.25);
}

function dedupe(rules: YieldRule[]): YieldRule[] {
  const seen = new Set<string>();
  return rules.filter((r) => {
    const k = `${r.label}|${r.base_hl}|${r.butoir_hl}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---- grapes named in a rule text ---------------------------------------------

/** Qualifiers a register bolts on and a disciplinare drops: "Catarratto Bianco Comune" is "Catarratto bianco comune o lucido" or plain "Catarratto". */
const QUALIFIERS = new Set(["comune", "lucido", "lucida", "gentile", "toscano", "nostrano", "b", "n", "rs", "g"]);

/** The forms of a variety name to look for. Each is at least five characters, so "b" or "nero" alone never matches. */
export function nameForms(names: string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const nn = norm(raw);
    if (!nn) continue;
    const bare = stripColourWords(nn);
    if (!bare) continue; // the name is nothing but a colour word
    const unqualified = bare.split(" ").filter((t) => !QUALIFIERS.has(t)).join(" ");
    for (const f of [nn, bare, unqualified]) if (f.length >= 5) out.add(f);
  }
  return [...out];
}

/** `textNorm` is norm() of the whole rule text. Word-boundary match: "merlot" does not match "merlotto". */
export function namedInText(textNorm: string, names: string[]): boolean {
  const padded = ` ${textNorm} `;
  return nameForms(names).some((f) => padded.includes(` ${f} `));
}
