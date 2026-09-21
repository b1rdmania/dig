/**
 * build-grape-synonyms.ts - write scripts/wine/grape-synonyms.json from VIVC.
 *
 * Reads:  data/wine/raw/grapes-catalogues/vivc/vivc-cultivar-names.csv  (fetch-vivc-names.py; every prime name and synonym)
 *         data/wine/raw/grapes-catalogues/vivc/vivc-wine-grape-passport-data.csv (colour, origin, parents)
 *         data/wine/raw/wikidata/03_grape_varieties.csv
 * Writes: scripts/wine/grape-synonyms.json
 *
 * The raw folder is gitignored, so the JSON is the committed, reviewable form
 * of what VIVC says about the varieties Wine Bore holds. load-grapes.ts reads
 * only the JSON.
 *
 * Two jobs:
 * 1. `assigned` - a VIVC number for each Wikidata item that has none. 1,000+
 *    items came into Wikidata from the Italian national register with no VIVC
 *    id, no colour and "Italy" as origin ("Chenin", "Meunier", "Sylvaner
 *    Verde"). A label that equals one VIVC prime name, or a label that VIVC
 *    lists under exactly one variety, identifies the item. Two candidates and
 *    no colour to split them: not assigned.
 * 2. `varieties` - for every VIVC number in use: prime name, colour, country
 *    of origin, parents, and every synonym VIVC lists.
 *
 * `manual` (raw_norm -> QID) is kept from the existing file. It is for
 * register spellings no source lists, checked by hand.
 *
 *   pnpm exec tsx scripts/wine/build-grape-synonyms.ts
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { vivcColour, vivcForms, wikidataColour } from "./grape-rules";
import { RAW, na, norm, readCsv, readJson } from "./lib";

const OUT = resolve(__dirname, "grape-synonyms.json");
const NAMES = resolve(RAW, "grapes-catalogues", "vivc", "vivc-cultivar-names.csv");
const PASSPORT = resolve(RAW, "grapes-catalogues", "vivc", "vivc-wine-grape-passport-data.csv");
const WIKIDATA = resolve(RAW, "wikidata", "03_grape_varieties.csv");

const vivcNorms = (label: string) => vivcForms(label, norm);

export interface VivcVariety {
  prime: string;
  colour: string | null;
  country: string | null;
  parents: string[];
  pedigree_confirmed: boolean;
  synonyms: string[];
}

export interface SynonymFile {
  generated: string;
  source: string;
  manual: Record<string, string>;
  assigned: Record<string, { vivc: string; via: "prime" | "synonym" | "synonym+colour" }>;
  varieties: Record<string, VivcVariety>;
}

const split = (v: string | undefined) => (na(v) ?? "").split("|").map((s) => s.trim()).filter(Boolean);

async function main() {
  if (!existsSync(NAMES)) throw new Error(`${NAMES} is missing. Run: python3 scripts/wine/fetch-vivc-names.py`);
  const previous = existsSync(OUT) ? readJson<Partial<SynonymFile> & Record<string, unknown>>(OUT) : {};
  // The old file was a bare raw_norm -> QID map.
  const manual: Record<string, string> = previous.manual && typeof previous.manual === "object"
    ? previous.manual as Record<string, string>
    : Object.fromEntries(Object.entries(previous).filter(([, v]) => typeof v === "string" && /^Q\d+$/.test(v as string))) as Record<string, string>;

  // ---- VIVC names: number -> names, name -> numbers ----------------------
  const byNumber = new Map<string, { prime: string; colour: string | null; country: string | null; names: Set<string> }>();
  const numbersByNorm = new Map<string, Set<string>>();
  const primeByNorm = new Map<string, Set<string>>();
  let nameRows = 0;
  for await (const r of readCsv(NAMES)) {
    const id = na(r.vivc_number);
    const name = na(r.cultivar_name);
    const prime = na(r.prime_name);
    if (!id || !name || !prime) continue;
    nameRows++;
    let v = byNumber.get(id);
    if (!v) { v = { prime, colour: na(r.colour), country: na(r.country), names: new Set() }; byNumber.set(id, v); }
    v.names.add(name);
    const nn = norm(name);
    if (!nn) continue;
    if (!numbersByNorm.has(nn)) numbersByNorm.set(nn, new Set());
    (numbersByNorm.get(nn) as Set<string>).add(id);
    if (name === prime) {
      if (!primeByNorm.has(nn)) primeByNorm.set(nn, new Set());
      (primeByNorm.get(nn) as Set<string>).add(id);
    }
  }

  // ---- passport: parents --------------------------------------------------
  const passport = new Map<string, { parents: string[]; confirmed: boolean; colour: string | null; country: string | null }>();
  for await (const r of readCsv(PASSPORT)) {
    const id = na(r["VIVC number"]);
    if (!id) continue;
    passport.set(id, {
      // VIVC prints "?" for an unknown parent; load-grapes.ts drops a half-known pedigree.
      // The pedigree column holds a "view" link when markers confirm it.
      parents: [na(r.Parent1), na(r.Parent2)].filter((p): p is string => !!p),
      confirmed: na(r["Confirmed pedigree"]) === "view",
      colour: na(r["Color of berry skin"]),
      country: na(r["Country/region of origin"]),
    });
  }

  // ---- Wikidata items -----------------------------------------------------
  const inUse = new Set<string>();
  const assigned: SynonymFile["assigned"] = {};
  const stats = { items: 0, with_vivc: 0, assigned_prime: 0, assigned_synonym: 0, assigned_colour: 0, ambiguous: 0, no_hit: 0 };
  const ambiguousSamples: string[] = [];
  const seen = new Set<string>();
  for await (const r of readCsv(WIKIDATA)) {
    const item = na(r.item);
    if (!item) continue;
    const qid = item.split("/").pop() as string;
    if (seen.has(qid)) continue;
    seen.add(qid);
    stats.items++;
    const ids = split(r.vivcIds);
    if (ids.length) { stats.with_vivc++; ids.forEach((i) => inUse.add(i)); continue; }

    const labels = ["en", "fr", "it", "es", "de"].map((l) => na(r[`itemLabel_${l}`])).filter((x): x is string => !!x);
    const labelNorms = [...new Set(labels.flatMap(vivcNorms))];
    const primeHits = new Set(labelNorms.flatMap((n) => [...(primeByNorm.get(n) ?? [])]));
    if (primeHits.size === 1) {
      const id = [...primeHits][0];
      assigned[qid] = { vivc: id, via: "prime" }; inUse.add(id); stats.assigned_prime++; continue;
    }
    const hits = new Set(labelNorms.flatMap((n) => [...(numbersByNorm.get(n) ?? [])]));
    if (hits.size === 1) {
      const id = [...hits][0];
      assigned[qid] = { vivc: id, via: "synonym" }; inUse.add(id); stats.assigned_synonym++; continue;
    }
    if (hits.size > 1) {
      const want = wikidataColour(r.colours);
      const byColour = want === "unknown" ? [] : [...hits].filter((id) => vivcColour(byNumber.get(id)?.colour) === want);
      if (byColour.length === 1) {
        assigned[qid] = { vivc: byColour[0], via: "synonym+colour" }; inUse.add(byColour[0]); stats.assigned_colour++; continue;
      }
      stats.ambiguous++;
      if (ambiguousSamples.length < 25) ambiguousSamples.push(`${labels[0]} -> ${[...hits].map((id) => byNumber.get(id)?.prime).join(" / ")}`);
      continue;
    }
    stats.no_hit++;
  }

  // ---- varieties in use ----------------------------------------------------
  const varieties: Record<string, VivcVariety> = {};
  for (const id of [...inUse].sort((a, b) => Number(a) - Number(b))) {
    const v = byNumber.get(id);
    const p = passport.get(id);
    if (!v && !p) continue;
    varieties[id] = {
      prime: v?.prime ?? "",
      colour: v?.colour ?? p?.colour ?? null,
      country: v?.country ?? p?.country ?? null,
      parents: p?.parents ?? [],
      pedigree_confirmed: p?.confirmed ?? false,
      synonyms: v ? [...v.names].filter((n) => n !== v.prime).sort() : [],
    };
  }

  const file: SynonymFile = {
    generated: new Date().toISOString().slice(0, 10),
    source: "VIVC cultivar-name search and wine-grape passport data (www.vivc.de), joined to Wikidata items",
    manual, assigned, varieties,
  };
  // One variety per line: reviewable in a diff, a third the size of pretty JSON.
  const lines = [
    "{",
    `"generated": ${JSON.stringify(file.generated)},`,
    `"source": ${JSON.stringify(file.source)},`,
    `"manual": ${JSON.stringify(manual, null, 1).replace(/\n/g, "\n")},`,
    `"assigned": {`,
    Object.entries(assigned).map(([q, a]) => `${JSON.stringify(q)}: ${JSON.stringify(a)}`).join(",\n"),
    "},",
    `"varieties": {`,
    Object.entries(varieties).map(([id, v]) => `${JSON.stringify(id)}: ${JSON.stringify(v)}`).join(",\n"),
    "}",
    "}",
  ];
  writeFileSync(OUT, lines.join("\n") + "\n");
  const synonymCount = Object.values(varieties).reduce((a, v) => a + v.synonyms.length, 0);
  console.log(JSON.stringify({ vivc_name_rows: nameRows, vivc_varieties: byNumber.size, ...stats, varieties_written: Object.keys(varieties).length, synonyms_written: synonymCount }, null, 1));
  console.log("ambiguous samples:", ambiguousSamples);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
