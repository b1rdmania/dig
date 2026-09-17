"use client";

// Wine Bore is Record Bore by subtraction: the same counter conversation,
// the same four states (prompt, working, answer, on the counter), no videos,
// no bag, no sleeves. What the tools returned renders under the answer as the
// bottles on the counter, each with a "find it" handoff - the shop has
// nothing in stock and says so.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import type { ResponseMode } from "../llm-beta/LlmBetaClient";
import s from "../recordbore/recordbore.module.css";
import w from "./winebore.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";

interface Bottle {
  type: "appellation" | "producer" | "wine" | "grape" | "shelf";
  id: number | string;
  title: string;
  subtitle: string | null;
  find_url: string | null;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  evidence?: Bottle[];
  error?: boolean;
  shopShut?: boolean;
  mode?: ResponseMode;
}

function normalDashes(value: string): string {
  return value.replace(/[–—]/g, "-");
}

async function getQuestionsLeft(): Promise<number | null> {
  try {
    const res = await fetch(`${API_URL}/v1/ask/quota?bore=wine`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json() as { remaining?: number };
    return Number.isFinite(data.remaining) ? Math.max(0, Number(data.remaining)) : null;
  } catch {
    return null;
  }
}

// The shop carries on while he reads. One line at a time.
const FILLERS = [
  "Telling someone we don't do Prosecco. We do, but not for them…",
  "Someone's said 'smooth'. Composing myself…",
  "Explaining that a Grand Cru in Alsace is not a Grand Cru in Bordeaux. Again…",
  "Refusing to chill a Beaujolais for a man who called it 'Beaujolais Nouveau'…",
  "Reading a cahier des charges under the lamp. The yield clause. Riveting…",
  "Being asked for 'a Chablis but not Chardonnay'…",
  "On the phone to a grower in the Jura who doesn't answer the phone…",
  "Turning down a case of supermarket Malbec. Politely…",
  "Explaining Kabinett to someone who wants it 'dry'. It is dry. Mostly…",
  "Steaming a price sticker off a bottle I'm not selling…",
  "The rep from a big Napa house is here. Hiding in the cellar…",
  "Arguing about whether 2010 was better than 2009. It was 2010…",
  "Decanting something I'm not going to share…",
  "Telling a customer Riserva means older, not better…",
  "Someone's asking for 'natural'. Asking which fault they'd like…",
  "Looking for the corkscrew. It's in my pocket…",
  "Kettle's on. Wine shop, but still…",
  "Correcting the pronunciation of Montrachet. There is no T…",
  "Ignoring an email about 'orange wine season'…",
  "Finding the page. The book's older than you…",
];

function randomFiller(previous = ""): string {
  let next = previous;
  while (next === previous) next = FILLERS[Math.floor(Math.random() * FILLERS.length)];
  return next;
}

// A suggestion either asks (q) or hands the counter over (fill).
const SUGGESTIONS: Array<{ t: string; q?: string; fill?: string }> = [
  { t: "What can go in a Chablis?", q: "What grapes is a Chablis actually allowed to be made from?" },
  { t: "Riserva - older or better?", q: "Does Riserva on a Chianti mean it's better, or just older?" },
  { t: "Name your favourite bottle", fill: "My favourite wine is " },
];

// Evidence arrives as everything the tools returned; the counter shows the
// bottles and growers, deduped, wines first.
// Only what he actually named goes on the counter: a bottle stays if its
// producer (the part before the first comma) or its whole title appears in
// the answer. If he named nothing the counter is empty.
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").toLowerCase();
function named(answer: string, b: Bottle): boolean {
  const a = fold(answer);
  const parts = b.title.split(",").map((p) => fold(p).trim()).filter((p) => p.length > 2);
  if (parts.length === 0) return false;
  // He says "Overnoy", the book says "Maison Pierre Overnoy": the surname
  // (last word of the house) as a whole word is enough for a producer.
  const house = parts[0];
  const surname = house.split(" ").filter((w) => w.length > 3).pop() ?? house;
  const houseNamed = a.includes(house) || new RegExp(`\\b${surname}\\b`).test(a);
  if (b.type === "producer") return houseNamed;
  if (b.type !== "wine") return a.includes(fold(b.title).trim());
  // A wine needs its house and, when the title carries one, its cuvée.
  const cuvee = parts[parts.length - 1];
  return houseNamed && (parts.length === 1 || a.includes(cuvee));
}
function onTheCounter(evidence: Bottle[] | undefined, answer: string): Bottle[] {
  if (!evidence) return [];
  const seen = new Set<string>();
  const order: Record<Bottle["type"], number> = { wine: 0, producer: 1, appellation: 2, grape: 3, shelf: 9 };
  return evidence
    .filter((b) => b.type !== "shelf")
    .filter((b) => named(answer, b))
    .filter((b) => { const k = `${b.type}/${b.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => order[a.type] - order[b.type])
    .slice(0, 8);
}

export function WineBoreClient({ opener }: { opener: string }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [activityLine, setActivityLine] = useState("");
  const [draft, setDraft] = useState("");
  const [questionsLeft, setQuestionsLeft] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void getQuestionsLeft().then(setQuestionsLeft); }, []);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => setActivityLine((prev) => randomFiller(prev)), 7000);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (messages.length > 0) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  async function ask(question?: string) {
    const q = (question ?? input).trim();
    if (!q || loading) return;
    const next: Turn[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setActivityLine(randomFiller());
    setLoading(true);

    try {
      const history = [
        { role: "assistant" as const, content: opener },
        ...next.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
      ];
      const res = await fetch(`${API_URL}/v1/ask/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bore: "wine", question: q, history }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null) as { error?: { message: string }; mode?: ResponseMode } | null;
        const shopShut = res.status === 429 && !!data?.error?.message;
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: data?.error?.message ?? "Till's jammed. Try again in a minute.",
          error: !shopShut,
          shopShut,
          mode: data?.mode,
        }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawTerminal = false;
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        let evt: { type: "status" | "delta" | "result" | "error"; text?: string; answer?: string; evidence?: Bottle[]; mode?: ResponseMode; error?: { message: string } };
        try { evt = JSON.parse(line); } catch { return; }
        if (evt.type === "delta") setDraft((prev) => prev + (evt.text ?? ""));
        else if (evt.type === "status") setDraft("");
        else if (evt.type === "result") {
          sawTerminal = true;
          setMessages((prev) => [...prev, { role: "assistant", content: evt.answer ?? "", evidence: evt.evidence ?? [], mode: evt.mode }]);
        } else if (evt.type === "error") {
          sawTerminal = true;
          setMessages((prev) => [...prev, { role: "assistant", content: evt.error?.message ?? "Something went wrong.", error: true, mode: evt.mode }]);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
      }
      if (buffer.trim()) handleLine(buffer);
      if (!sawTerminal) {
        setMessages((prev) => [...prev, { role: "assistant", content: "The connection dropped mid-answer - try again.", error: true }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Request failed - check your network.", error: true }]);
    } finally {
      setLoading(false);
      setDraft("");
      setActivityLine("");
      setQuestionsLeft(await getQuestionsLeft());
      inputRef.current?.focus();
    }
  }

  return (
    <div className={`${s.wrap} ${w.wrap}`}>
      <main className={`${s.col} ${w.col}`}>
        <div className={s.topline}>
          <Link className={s.home} href="/">&larr; home</Link>
        </div>
        <div className={w.masthead}>
          {/* eslint-disable-next-line @next/next/no-img-element -- hand-drawn line art; optimisation would soften it */}
          <img className={w.face} src="/winebore-face.png" alt="" width={482} height={512} />
          <h1 className={w.title}>Wine Bore<span className={s.dot}>.</span></h1>
          <p className={w.tagline}>Ask about wine. I&rsquo;ll correct you.</p>
        </div>

        <div className={`${s.bore} ${s.openerBlock} ${w.opener}`}><p>{normalDashes(opener)}</p></div>

        {(messages.length > 0 || loading) && (
          <section className={`${s.turns} ${w.turns}`} aria-label="Conversation">
            {messages.map((m, i) => (
              m.role === "user" ? (
                <div key={i} className={`${s.turn} ${s.userTurn}`}>
                  <p className={s.turnLabel}>You</p>
                  <p className={s.youText}>{normalDashes(m.content)}</p>
                </div>
              ) : (
                <article key={i} className={`${s.turn} ${s.boreTurn}`}>
                  <p className={s.turnLabel}>Wine Bore</p>
                  <div className={s.bore}>
                    {m.error ? (
                      <p className={s.plain}>{normalDashes(m.content)}</p>
                    ) : (
                      <ReactMarkdown>{normalDashes(m.content)}</ReactMarkdown>
                    )}
                  </div>
                  {onTheCounter(m.evidence, m.content).length > 0 && (
                    <div className={w.counter}>
                      <p className={w.counterHead}>On the counter</p>
                      {onTheCounter(m.evidence, m.content).map((b) => (
                        <div key={`${b.type}/${b.id}`} className={w.bottle}>
                          <span>
                            <span className={w.bottleName}>{normalDashes(b.title)}</span>
                            {b.subtitle && <span className={w.bottleSub}>{normalDashes(b.subtitle)}</span>}
                          </span>
                          {b.find_url && (
                            <a className={w.bottleAct} href={b.find_url} target="_blank" rel="noopener noreferrer">find it &rarr;</a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              )
            ))}

            {loading && draft && (
              <article className={`${s.turn} ${s.boreTurn}`} aria-live="polite">
                <p className={s.turnLabel}>Wine Bore</p>
                <div className={s.bore}><ReactMarkdown>{normalDashes(draft)}</ReactMarkdown></div>
              </article>
            )}

            {loading && !draft && (
              <div className={`${s.turn} ${s.working}`} role="status" aria-live="polite">
                <div className={s.workingHead}>
                  <span className={s.workingMark} aria-hidden="true" />
                  <span>Opening the cellar book</span>
                </div>
                <p className={s.activity}>{normalDashes((activityLine || FILLERS[0]).replace(/[.…]+$/, ""))}</p>
              </div>
            )}
            <div ref={bottomRef} />
          </section>
        )}

        <section className={`${s.askPanel} ${w.askPanel}`} aria-labelledby="wine-bore-ask-label">
          <label id="wine-bore-ask-label" className={s.srOnly} htmlFor="wine-bore-question">Ask</label>
          <div className={s.composer}>
            <input
              id="wine-bore-question"
              ref={inputRef}
              className={s.input}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } }}
              placeholder={messages.length > 0 ? "Go on, another one." : "Go on then."}
              disabled={loading}
              autoCapitalize="sentences"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className={s.send} onClick={() => ask()} disabled={loading || !input.trim()} type="button">
              <span className={s.srOnly}>Ask</span><span aria-hidden="true">&rarr;</span>
            </button>
          </div>

          {messages.length === 0 && (
            <div className={s.suggest}>
              <span className={s.suggestLead}>Try:</span>
              {SUGGESTIONS.map((sug, index) => (
                <span key={sug.t}>
                  <button
                    type="button"
                    onClick={() => {
                      if (sug.fill) { setInput(sug.fill); inputRef.current?.focus(); } else ask(sug.q);
                    }}
                  >
                    {sug.t}
                  </button>
                  {index < SUGGESTIONS.length - 1 && <span aria-hidden="true">{" · "}</span>}
                </span>
              ))}
            </div>
          )}

          <p className={s.cap}>
            {questionsLeft === null ? "Limited questions." : `${questionsLeft} left.`} Nothing&rsquo;s for sale. He may be wrong.
          </p>
        </section>
      </main>
    </div>
  );
}
