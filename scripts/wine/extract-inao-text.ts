/**
 * extract-inao-text.ts - text for every INAO cahier PDF.
 *
 * The first pull extracted 285 of 394 PDFs. The other 109 were never turned
 * into text, so Sancerre, Hermitage, Cote Rotie, Vosne-Romanee and Pouilly-Fuisse
 * had no cahier. This script fills the gaps with the same command the first
 * pull used (`pdftotext -layout`, byte-identical on chablis.pdf). It never
 * overwrites an existing text file.
 *
 *   pnpm exec tsx scripts/wine/extract-inao-text.ts
 *
 * Needs `pdftotext` (poppler) on PATH. Reads and writes data/wine/raw/inao only.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { RAW } from "./lib";

const pdfDir = resolve(RAW, "inao", "cdc");
const txtDir = resolve(RAW, "inao", "cdc-text");
let made = 0;
const failed: string[] = [];
for (const f of readdirSync(pdfDir).filter((x) => x.endsWith(".pdf")).sort()) {
  const out = resolve(txtDir, f.replace(/\.pdf$/, ".txt"));
  if (existsSync(out)) continue;
  try {
    execFileSync("pdftotext", ["-layout", resolve(pdfDir, f), out], { stdio: "pipe" });
    made++;
  } catch {
    failed.push(f);
  }
}
console.log(`extracted=${made} failed=${failed.length}${failed.length ? ` (${failed.join(", ")})` : ""}`);
