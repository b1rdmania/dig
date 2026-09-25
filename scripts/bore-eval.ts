#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Bore eval - a fixed question set run against /v1/ask, checked two ways:
//
//   1. Deterministic checks (always): the persona's hard rules that code can
//      see - no narrating the lookup, no tool talk, links only to dig.baby
//      (Record Bore) or no links at all (Wine Bore) - plus each case's own
//      expectations (tool calls made, links, a question back on a broad
//      opening, names that should come up).
//   2. An independent judge (--judge): a separate Claude call that never saw
//      the Bore's reasoning grades the answer against the persona file and
//      the case's rubric. A fresh reviewer catches what self-review misses.
//
// Run it by hand after a persona or prompt change, and compare with the run
// before (--compare). Asks go through a beta key with house=true, so they
// run on the public page's budgets without touching the public till.
//
//   DIG_EVAL_KEY=<LLM_BETA_KEYS entry> pnpm exec tsx scripts/bore-eval.ts
//     --bore record|wine|all      default all
//     --only id1,id2              run a subset
//     --repeat N                  ask each question N times (answers vary)
//     --judge                     grade with Claude (needs ANTHROPIC_API_KEY)
//     --judge-model <id>          default claude-opus-5
//     --base <url>                default https://dig-api.fly.dev
//     --concurrency N             default 2 (ask is rate-limited 10/min/IP)
//     --compare <results.json>    show cases that flipped since that run
//
// Results land in scripts/bore-eval/results/ (gitignored).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const setDir = path.join(here, "bore-eval");
const resultsDir = path.join(setDir, "results");

// --- args ------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const BASE = (opt("base", process.env.DIG_EVAL_BASE ?? "https://dig-api.fly.dev") as string).replace(/\/$/, "");
const KEY = process.env.DIG_EVAL_KEY ?? "";
const BORES = (opt("bore", "all") === "all" ? ["record", "wine"] : [opt("bore") as string]) as Array<"record" | "wine">;
const ONLY = opt("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const REPEAT = Math.max(1, Number(opt("repeat", "1")));
const CONCURRENCY = Math.max(1, Number(opt("concurrency", "2")));
const JUDGE = flag("judge");
const JUDGE_MODEL = opt("judge-model", "claude-opus-5") as string;
const COMPARE = opt("compare");

if (!KEY) {
  console.error("DIG_EVAL_KEY is required: one of the LLM_BETA_KEYS values on dig-api.");
  process.exit(1);
}
if (JUDGE && !process.env.ANTHROPIC_API_KEY) {
  console.error("--judge needs ANTHROPIC_API_KEY.");
  process.exit(1);
}

// --- types -----------------------------------------------------------------

interface Expect {
  mode?: string;
  min_tool_calls?: number;
  min_links?: number;
  max_links?: number;
  min_evidence?: number;
  asks_question?: boolean;
  mentions_any?: string[];
  not_matches?: string[];
  min_words?: number;
  max_words?: number;
}

interface Case {
  id: string;
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  expect?: Expect;
  judge?: string;
}

interface AskResult {
  answer: string;
  mode: string;
  evidence: Array<{ title?: string; type?: string }>;
  meta: {
    elapsed_ms: number;
    tool_calls: number;
    rounds?: Array<{ tools: string[]; usage?: { input_tokens: number; cached_tokens: number } }>;
  };
}

interface Grade {
  grounded: number;
  answers_question: number;
  voice: number;
  verdict: "pass" | "fail";
  reason: string;
}

interface CaseRun {
  bore: string;
  id: string;
  attempt: number;
  ok: boolean;
  failures: string[];
  answer: string;
  mode: string;
  tool_calls: number;
  links: number;
  seconds: number;
  input_tokens: number;
  cached_tokens: number;
  tools: string[];
  grade?: Grade;
  error?: string;
}

// --- deterministic checks ----------------------------------------------------

// Rule 6 in both Bores: no narrating the lookup, no announcing the find.
const NARRATION = /\b(one sec|let me (check|look|see|dig|pull)|be right back|bear with me|here we go|pulling (those|them|that) (now|out)|checking (the|my) (stock|shelves|racks|book|cellar)|here's what the (shelves|racks|book|card) say|the card (holds|says))\b/i;
// Rule 5: no talk of tools, databases or searching.
const TOOL_TALK = /\b(database|tool call|search results?|my tools|the api|in the catalog(ue)? (data|system)|get_\w+|search_(catalog|cellar))\b/i;
// A question back can be an imperative: "tell me what you already rate".
const ASKS_BACK = /\?|\b(tell me|give me a name|say (so|which)|what do you)\b/i;
const MD_LINK = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;

function linksIn(answer: string): string[] {
  return [...answer.matchAll(MD_LINK)].map((m) => m[1]);
}

function words(answer: string): number {
  return answer.replace(MD_LINK, " x ").split(/\s+/).filter(Boolean).length;
}

function check(bore: "record" | "wine", c: Case, r: AskResult): string[] {
  const f: string[] = [];
  const a = r.answer ?? "";
  const links = linksIn(a);
  const e = c.expect ?? {};

  if (!a.trim()) f.push("empty answer");
  if (NARRATION.test(a)) f.push(`narrates the lookup: "${a.match(NARRATION)?.[0]}"`);
  if (TOOL_TALK.test(a)) f.push(`talks about tools: "${a.match(TOOL_TALK)?.[0]}"`);
  if (bore === "record") {
    const offsite = links.filter((u) => !/^https:\/\/app\.dig\.baby\/(master|artist|label|scene)\//.test(u));
    if (offsite.length) f.push(`links off dig.baby: ${offsite.join(", ")}`);
  } else if (/https?:\/\//.test(a)) {
    f.push("writes a URL (Wine Bore never links)");
  }

  // Voice rule in both personas: prose at the counter, no lists or headers.
  if (/^\s*([-*•]|\d+[.)])\s+\S/m.test(a) || /^#{1,6}\s/m.test(a)) f.push("uses a list or header instead of prose");

  if (e.mode && r.mode !== e.mode) f.push(`mode ${r.mode}, expected ${e.mode}`);
  if (e.min_tool_calls != null && r.meta.tool_calls < e.min_tool_calls) f.push(`${r.meta.tool_calls} lookups, expected >= ${e.min_tool_calls}`);
  if (e.min_links != null && links.length < e.min_links) f.push(`${links.length} links, expected >= ${e.min_links}`);
  if (e.max_links != null && links.length > e.max_links) f.push(`${links.length} links, expected <= ${e.max_links}`);
  if (e.min_evidence != null && r.evidence.length < e.min_evidence) f.push(`${r.evidence.length} on the counter, expected >= ${e.min_evidence}`);
  if (e.asks_question && !ASKS_BACK.test(a)) f.push("doesn't ask the customer anything back");
  if (e.mentions_any?.length && !e.mentions_any.some((m) => a.toLowerCase().includes(m.toLowerCase()))) {
    f.push(`mentions none of: ${e.mentions_any.join(", ")}`);
  }
  for (const re of e.not_matches ?? []) {
    const m = a.match(new RegExp(re, "i"));
    if (m) f.push(`contains "${m[0]}"`);
  }
  if (e.min_words != null && words(a) < e.min_words) f.push(`${words(a)} words, expected >= ${e.min_words}`);
  if (e.max_words != null && words(a) > e.max_words) f.push(`${words(a)} words, expected <= ${e.max_words}`);
  return f;
}

// --- the ask -------------------------------------------------------------------

async function ask(bore: string, c: Case): Promise<AskResult> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/v1/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": KEY },
        body: JSON.stringify({ bore, question: c.question, history: c.history ?? [], house: true }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (err) {
      // A cold dig-api drops the first connections while Fly wakes it.
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 5_000));
        continue;
      }
      throw new Error(`${(err as Error).message}${cause ? ` (${cause.code ?? cause.message})` : ""}`, { cause: err });
    }
    // The route allows 10 asks a minute per IP; wait out a burst once.
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 30_000));
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify((body as { error?: unknown }).error ?? body).slice(0, 200)}`);
    return body as AskResult;
  }
}

// --- the judge -------------------------------------------------------------------

const anthropic = JUDGE ? new Anthropic() : null;
const personas = new Map<string, string>();
const persona = (bore: string) => {
  if (!personas.has(bore)) personas.set(bore, fs.readFileSync(path.join(root, "bores", `${bore}-bore`, "persona.md"), "utf8"));
  return personas.get(bore)!;
};

const GRADE_TOOL: Anthropic.Tool = {
  name: "grade",
  description: "Record the grade for this answer.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      grounded: { type: "integer", description: "1-5. 5 = every specific record/bottle/fact named was returned by a lookup (see evidence) or is openly flagged as from memory." },
      answers_question: { type: "integer", description: "1-5. 5 = does exactly what this customer needed, per the case rubric." },
      voice: { type: "integer", description: "1-5. 5 = unmistakably the persona: terse, dry, opinionated, no narration, right length for the counter." },
      verdict: { type: "string", enum: ["pass", "fail"] },
      reason: { type: "string", description: "One sentence: the main thing that decided the verdict." },
    },
    required: ["grounded", "answers_question", "voice", "verdict", "reason"],
    additionalProperties: false,
  },
};

async function grade(bore: string, c: Case, r: AskResult): Promise<Grade> {
  const evidence = r.evidence.map((e) => `- ${e.type ?? ""}: ${e.title ?? ""}`).join("\n") || "(nothing)";
  const tools = (r.meta.rounds ?? []).flatMap((x) => x.tools).join(", ") || "(none)";
  const history = (c.history ?? []).map((m) => `${m.role}: ${m.content}`).join("\n");
  const prompt = [
    `You are grading one answer from a shop-counter chat persona. You did not write it.`,
    `<persona>\n${persona(bore)}\n</persona>`,
    history ? `<earlier_turns>\n${history}\n</earlier_turns>` : "",
    `<customer_question>\n${c.question}\n</customer_question>`,
    `<answer>\n${r.answer}\n</answer>`,
    `<what_the_lookups_returned>\n${evidence}\n</what_the_lookups_returned>`,
    `<lookups_made>${tools}</lookups_made>`,
    `<what_a_good_answer_does>\n${c.judge ?? "Answers the question in the persona's voice, grounded in the lookups."}\n</what_a_good_answer_does>`,
    `The evidence list is capped at 20 items, so a linked record missing from it is not proof of invention. Judge grounding on whether claims look invented. Fail the answer if a real customer would be misled or badly served. Otherwise pass it, even if the scores are imperfect.`,
  ].filter(Boolean).join("\n\n");

  const res = await anthropic!.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 2000,
    tools: [GRADE_TOOL],
    tool_choice: { type: "tool", name: "grade" },
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error("judge refused");
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("judge returned no grade");
  return block.input as Grade;
}

// --- run ---------------------------------------------------------------------------

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
  }));
}

async function runCase(bore: "record" | "wine", c: Case, attempt: number): Promise<CaseRun> {
  const base = { bore, id: c.id, attempt };
  let r: AskResult;
  try {
    r = await ask(bore, c);
  } catch (err) {
    return { ...base, ok: false, failures: ["request failed"], answer: "", mode: "error", tool_calls: 0, links: 0, seconds: 0, input_tokens: 0, cached_tokens: 0, tools: [], error: String((err as Error).message ?? err) };
  }
  const failures = check(bore, c, r);
  const rounds = r.meta.rounds ?? [];
  const run: CaseRun = {
    ...base,
    ok: failures.length === 0,
    failures,
    answer: r.answer,
    mode: r.mode,
    tool_calls: r.meta.tool_calls,
    links: linksIn(r.answer).length,
    seconds: Math.round(r.meta.elapsed_ms / 100) / 10,
    input_tokens: rounds.reduce((s, x) => s + (x.usage?.input_tokens ?? 0), 0),
    cached_tokens: rounds.reduce((s, x) => s + (x.usage?.cached_tokens ?? 0), 0),
    tools: rounds.flatMap((x) => x.tools),
  };
  if (JUDGE) {
    try {
      run.grade = await grade(bore, c, r);
      if (run.grade.verdict === "fail") {
        run.ok = false;
        run.failures.push(`judge: ${run.grade.reason}`);
      }
    } catch (err) {
      run.failures.push(`judge error: ${String((err as Error).message ?? err)}`);
    }
  }
  return run;
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

async function main() {
  const runs: CaseRun[] = [];
  const started = new Date();
  for (const bore of BORES) {
    const set = JSON.parse(fs.readFileSync(path.join(setDir, `${bore}.json`), "utf8")) as { cases: Case[] };
    const cases = set.cases.filter((c) => !ONLY || ONLY.includes(c.id));
    const jobs = cases.flatMap((c) => Array.from({ length: REPEAT }, (_, i) => ({ c, i })));
    console.log(`\n${bore} bore - ${cases.length} cases x ${REPEAT} against ${BASE}${JUDGE ? `, judged by ${JUDGE_MODEL}` : ""}\n`);
    await pool(jobs, CONCURRENCY, async ({ c, i }) => {
      const run = await runCase(bore, c, i);
      runs.push(run);
      const tag = run.ok ? "PASS" : "FAIL";
      const g = run.grade ? `  g${run.grade.grounded}/a${run.grade.answers_question}/v${run.grade.voice}` : "";
      console.log(`${tag}  ${c.id}${REPEAT > 1 ? ` #${i + 1}` : ""}  ${run.seconds}s  ${run.tool_calls} lookups  ${run.links} links${g}`);
      for (const f of run.failures) console.log(`        - ${f}`);
      if (run.error) console.log(`        ${run.error}`);
    });
  }

  // Summary
  console.log("\n--- summary ---");
  for (const bore of BORES) {
    const rs = runs.filter((r) => r.bore === bore && r.mode !== "error");
    const all = runs.filter((r) => r.bore === bore);
    if (!all.length) continue;
    const secs = rs.map((r) => r.seconds);
    const input = rs.reduce((s, r) => s + r.input_tokens, 0);
    const cached = rs.reduce((s, r) => s + r.cached_tokens, 0);
    const graded = rs.filter((r) => r.grade);
    const avg = (k: "grounded" | "answers_question" | "voice") =>
      graded.length ? (graded.reduce((s, r) => s + (r.grade![k] ?? 0), 0) / graded.length).toFixed(1) : "-";
    console.log(
      `${bore}: ${all.filter((r) => r.ok).length}/${all.length} pass (${pct(all.filter((r) => r.ok).length, all.length)})` +
      `  median ${median(secs)}s  slowest ${Math.max(0, ...secs)}s` +
      `  prompt cache ${input ? pct(cached, input) : "not reported"}` +
      (graded.length ? `  judge g${avg("grounded")} a${avg("answers_question")} v${avg("voice")}` : "") +
      (all.length - rs.length ? `  ${all.length - rs.length} request errors` : ""),
    );
  }

  if (COMPARE) {
    const prev = JSON.parse(fs.readFileSync(COMPARE, "utf8")) as { runs: CaseRun[] };
    const key = (r: CaseRun) => `${r.bore}/${r.id}`;
    const passRate = (rs: CaseRun[]) => {
      const m = new Map<string, { ok: number; n: number }>();
      for (const r of rs) {
        const v = m.get(key(r)) ?? { ok: 0, n: 0 };
        v.n++; if (r.ok) v.ok++;
        m.set(key(r), v);
      }
      return m;
    };
    const before = passRate(prev.runs);
    const after = passRate(runs);
    console.log(`\n--- vs ${path.basename(COMPARE)} ---`);
    let changed = 0;
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.ok / b.n !== a.ok / a.n) {
        changed++;
        console.log(`${a.ok / a.n > b.ok / b.n ? "better" : "WORSE "}  ${k}  ${b.ok}/${b.n} -> ${a.ok}/${a.n}`);
      }
    }
    if (!changed) console.log("no case changed");
  }

  fs.mkdirSync(resultsDir, { recursive: true });
  const stamp = started.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = path.join(resultsDir, `${BORES.join("+")}-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ base: BASE, started: started.toISOString(), repeat: REPEAT, judge: JUDGE ? JUDGE_MODEL : null, runs }, null, 2));
  console.log(`\nresults: ${path.relative(root, out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
