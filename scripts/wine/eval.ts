#!/usr/bin/env npx tsx
/**
 * Wine Bore eval - thirty questions the register can settle.
 *
 * Runs each question through /v1/ask (bore=wine) on a running API, records
 * the answer, mode, tool calls and timing, and scores what a rule can score:
 *   grounded  - the loop returned evidence and every `must` string appears
 *   hedged    - the answer flags itself as unverified ("don't quote me",
 *               "never heard of it", "off the top of my head")
 *   wrong     - a `must_not` string appears, or a `must` string is missing
 *               from a grounded answer
 * Anything a rule cannot settle (the favourite-bottle challenges) is marked
 * `review` for a human read. Output: docs/wine-bore-eval-<date>.md.
 *
 * Usage:
 *   API_URL=http://localhost:3010 pnpm exec tsx scripts/wine/eval.ts        # GROUP=rule|producer|challenge to run one section
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const API_URL = process.env.API_URL ?? "http://localhost:3010";
const OUT = resolve(__dirname, "..", "..", "docs", `wine-bore-eval-${new Date().toISOString().slice(0, 10)}${process.env.GROUP ? `-${process.env.GROUP}` : ""}.md`);

interface Q {
  group: "rule" | "producer" | "challenge";
  q: string;
  /** Strings that must appear (case-insensitive) for a grounded answer to count. "a|b" = either. */
  must?: string[];
  /** Strings that must not appear. */
  must_not?: string[];
  /** The fact the register settles, for the reviewer. */
  truth: string;
}

const QUESTIONS: Q[] = [
  // --- ten appellation rules ---
  { group: "rule", q: "What grapes is a Chablis actually allowed to be made from?", must: ["chardonnay"], must_not: ["sauvignon", "aligoté", "aligote"], truth: "Chardonnay only (PDO-FR-A0925)" },
  { group: "rule", q: "Which grape varieties are permitted in Sancerre?", must: ["sauvignon", "pinot"], must_not: ["chardonnay"], truth: "Sauvignon Blanc (white), Pinot Noir (red/rosé)" },
  { group: "rule", q: "Can a red Chianti Classico contain white grapes?", must: ["sangiovese"], truth: "Sangiovese min 80%; white grapes not permitted since 2006 disciplinare" },
  { group: "rule", q: "What is the maximum yield for Barolo?", must: ["56"], truth: "8 t/ha grapes (56 hl/ha) per disciplinare" },
  { group: "rule", q: "Is Pouilly-Fumé made from the same grape as Pouilly-Fuissé?", must: ["sauvignon", "chardonnay"], truth: "No: Pouilly-Fumé = Sauvignon Blanc (Loire); Pouilly-Fuissé = Chardonnay (Mâconnais)" },
  { group: "rule", q: "What grapes can go into a Rioja red?", must: ["tempranillo"], truth: "Tempranillo, Garnacha Tinta, Graciano, Mazuelo, Maturana Tinta (DOCa Rioja)" },
  { group: "rule", q: "Is Grüner Veltliner allowed in Wachau DAC?", must: ["grüner", "veltliner"], truth: "Yes - Grüner Veltliner and Riesling are the Wachau varieties" },
  { group: "rule", q: "What's the difference between Crémant d'Alsace and Champagne in terms of grapes?", must: ["pinot"], truth: "Crémant d'Alsace: Pinot Blanc, Pinot Gris, Pinot Noir, Riesling, Chardonnay, Auxerrois; Champagne: Chardonnay, Pinot Noir, Meunier (+ Arbane, Petit Meslier, Pinot Blanc, Pinot Gris)" },
  { group: "rule", q: "Can Beaujolais be made from Pinot Noir?", must: ["gamay"], truth: "Gamay is the Beaujolais grape; Pinot Noir was permitted up to 15% under the AOC until the 2024 revision - flag if the register says otherwise" },
  { group: "rule", q: "What grapes are allowed in Châteauneuf-du-Pape?", must: ["grenache", "syrah", "mourv"], truth: "13 varieties incl. Grenache, Syrah, Mourvèdre, Cinsault, Counoise..." },
  // --- ten producer facts ---
  { group: "producer", q: "Who is Domaine Huet and what do they make?", must: ["vouvray"], truth: "Vouvray (Chenin Blanc) - Le Mont, Clos du Bourg, Le Haut-Lieu" },
  { group: "producer", q: "Does Château Léoville-Las Cases make a second wine?", must: ["las cases|léoville|leoville"], truth: "Clos du Marquis / Le Petit Lion (LWIN lists both under the house)" },
  { group: "producer", q: "What appellation is Giacomo Conterno's Monfortino?", must: ["barolo"], truth: "Barolo Riserva" },
  { group: "producer", q: "Where is Egon Müller based and what grape does he grow?", must: ["riesling", "mosel"], truth: "Scharzhofberg, Saar/Mosel - Riesling" },
  { group: "producer", q: "Which producer makes Clos Sainte Hune?", must: ["trimbach"], truth: "Trimbach - Riesling, Alsace Grand Cru Rosacker" },
  { group: "producer", q: "Tell me about Vega Sicilia's wines.", must: ["ribera"], truth: "Ribera del Duero - Único, Valbuena 5°, Alión (separate house)" },
  { group: "producer", q: "What does Domaine de la Romanée-Conti actually own?", must: ["romanée|romanee|tâche|tache"], truth: "Romanée-Conti, La Tâche (monopoles), Richebourg, Romanée-St-Vivant, Grands-Echézeaux, Echézeaux, Montrachet, Corton" },
  { group: "producer", q: "Is Château Musar from Lebanon?", must: ["lebanon", "bekaa"], truth: "Yes - Bekaa Valley, Lebanon" },
  { group: "producer", q: "Who makes Tignanello and is it a DOCG?", must: ["antinori"], truth: "Marchesi Antinori; Toscana IGT, not DOCG" },
  { group: "producer", q: "What does Domaine Tempier make?", must: ["bandol"], truth: "Bandol - Mourvèdre-led reds and rosé (La Tourtine, La Migoua, Cabassaou)" },
  // --- ten favourite-bottle challenges (human review) ---
  { group: "challenge", q: "My favourite wine is Cloudy Bay Sauvignon Blanc.", truth: "Expect respect + one connected counter-bottle (Marlborough or Loire Sauvignon), grounded" },
  { group: "challenge", q: "My favourite wine is Tignanello.", truth: "Counter should be connected: a Chianti Classico Gran Selezione, or Antinori's own Solaia, or a Sangiovese purist" },
  { group: "challenge", q: "My favourite wine is Whispering Angel.", truth: "Commercial ask - weary respect, then a serious Provence/Bandol rosé" },
  { group: "challenge", q: "My favourite wine is Château Margaux 2000.", truth: "Respect earned; counter from the same commune or a Margaux second wine at the price" },
  { group: "challenge", q: "My favourite wine is Egon Müller Scharzhofberger Kabinett.", truth: "Respect; counter a Saar neighbour or the Spätlese" },
  { group: "challenge", q: "My favourite wine is Penfolds Grange.", truth: "Respect; counter a Barossa Shiraz grower or Hill of Grace" },
  { group: "challenge", q: "My favourite wine is Yellow Tail Shiraz.", truth: "Wrong-shop-adjacent; the door politely, then a real Shiraz" },
  { group: "challenge", q: "My favourite wine is Ridge Monte Bello.", truth: "Respect; counter a Santa Cruz Mountains neighbour or Ridge's own Lytton Springs" },
  { group: "challenge", q: "My favourite wine is Vega Sicilia Único.", truth: "Respect; counter Valbuena, Pingus, or a Ribera traditionalist" },
  { group: "challenge", q: "My favourite wine is Prosecco.", truth: "Commercial; Crémant or Franciacorta at the price, grounded" },
];

interface Result extends Q {
  answer: string;
  mode: string;
  tool_calls: number;
  elapsed_ms: number;
  evidence: number;
  verdict: "grounded" | "hedged" | "wrong" | "review" | "error";
  why: string;
}

const HEDGE_RE = /don'?t quote me|off the top of my head|never heard of it|can'?t find|not in the book|book'?s come up blank|haven'?t got it/i;

async function ask(q: string): Promise<{ answer: string; mode: string; tool_calls: number; elapsed_ms: number; evidence: number }> {
  const res = await fetch(`${API_URL}/v1/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bore: "wine", question: q }),
  });
  const data = await res.json() as any;
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  return { answer: data.answer, mode: data.mode, tool_calls: data.meta?.tool_calls ?? 0, elapsed_ms: data.meta?.elapsed_ms ?? 0, evidence: (data.evidence ?? []).length };
}

function score(q: Q, r: { answer: string; mode: string; evidence: number }): { verdict: Result["verdict"]; why: string } {
  // NFC so "Léoville" typed here matches the model's combining-accent form.
  const a = r.answer.normalize("NFC").toLowerCase();
  const has = (m: string) => m.split("|").some((alt) => a.includes(alt.normalize("NFC").toLowerCase()));
  const missing = (q.must ?? []).filter((m) => !has(m));
  const hit = (q.must_not ?? []).filter((m) => a.includes(m.normalize("NFC").toLowerCase()));
  if (q.group === "challenge") return { verdict: "review", why: r.evidence > 0 ? "grounded exchange - read it" : "no evidence returned" };
  if (hit.length > 0) return { verdict: "wrong", why: `names ${hit.join(", ")}` };
  if (HEDGE_RE.test(a) && r.evidence === 0) return { verdict: "hedged", why: "flagged as unverified" };
  if (missing.length > 0) return { verdict: r.evidence > 0 ? "wrong" : "hedged", why: `missing ${missing.join(", ")}` };
  if (r.evidence === 0) return { verdict: "hedged", why: "no evidence; answer unflagged" };
  return { verdict: "grounded", why: "" };
}

async function main() {
  const results: Result[] = [];
  const only = process.env.GROUP as Q["group"] | undefined;
  for (const q of only ? QUESTIONS.filter((x) => x.group === only) : QUESTIONS) {
    process.stdout.write(`${q.group.padEnd(9)} ${q.q.slice(0, 60).padEnd(60)} `);
    try {
      const r = await ask(q.q);
      const { verdict, why } = score(q, r);
      results.push({ ...q, ...r, verdict, why });
      console.log(`${verdict.padEnd(8)} ${r.mode} tools=${r.tool_calls} ${r.elapsed_ms}ms ${why}`);
    } catch (err: any) {
      results.push({ ...q, answer: String(err?.message ?? err), mode: "error", tool_calls: 0, elapsed_ms: 0, evidence: 0, verdict: "error", why: "request failed" });
      console.log(`error    ${String(err?.message ?? err)}`);
    }
  }

  const tally = (v: Result["verdict"]) => results.filter((r) => r.verdict === v).length;
  const lines: string[] = [];
  lines.push(`# Wine Bore eval - ${new Date().toISOString().slice(0, 10)}`, "");
  lines.push(`API: ${API_URL}. ${QUESTIONS.length} questions: 10 appellation rules, 10 producer facts, 10 favourite-bottle challenges.`, "");
  lines.push(`| grounded | hedged | wrong | review | error |`, `|---|---|---|---|---|`, `| ${tally("grounded")} | ${tally("hedged")} | ${tally("wrong")} | ${tally("review")} | ${tally("error")} |`, "");
  lines.push(`Median time: ${median(results.map((r) => r.elapsed_ms))} ms. Mean tool calls: ${(results.reduce((a, r) => a + r.tool_calls, 0) / results.length).toFixed(1)}.`, "");
  lines.push(`"review" rows are the challenges: a rule cannot score them. Read each and mark it grounded / wrong in the table below, then update the tally by hand.`, "");
  for (const r of results) {
    lines.push(`## ${r.group}: ${r.q}`, "");
    lines.push(`- verdict: **${r.verdict}** ${r.why ? `(${r.why})` : ""}`);
    lines.push(`- mode: ${r.mode} · tools: ${r.tool_calls} · evidence: ${r.evidence} · ${r.elapsed_ms} ms`);
    lines.push(`- truth: ${r.truth}`, "");
    lines.push(r.answer.split("\n").map((l) => `> ${l}`).join("\n"), "");
  }
  writeFileSync(OUT, lines.join("\n"));
  console.log(`\nwrote ${OUT}`);
  console.log(`grounded=${tally("grounded")} hedged=${tally("hedged")} wrong=${tally("wrong")} review=${tally("review")} error=${tally("error")}`);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

main().catch((err) => { console.error(err); process.exit(1); });
