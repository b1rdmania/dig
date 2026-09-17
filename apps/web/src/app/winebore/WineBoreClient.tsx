"use client";

// Wine Bore is Record Bore by subtraction: the same counter conversation,
// the same four states (prompt, working, answer, on the counter), no videos,
// no bag, no sleeves. What the tools returned renders under the answer as the
// bottles on the counter, each with a "find it" handoff - the shop has
// nothing in stock and says so.

import { useEffect, useRef, useState } from "react";
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
  /** Object URL of the photo behind a wine-list turn, for the transcript only. */
  image?: string;
  evidence?: Bottle[];
  error?: boolean;
  shopShut?: boolean;
  mode?: ResponseMode;
}

// Longest side 1600px, JPEG 0.82: a phone photo lands well under 1 MB and
// the text on a list is still legible to the model.
async function shrinkImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

function normalDashes(value: string): string {
  return value.replace(/[–—]/g, "-");
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
// The page is deliberately bare: no suggested questions. The favourite-bottle
// challenge still works if the customer types it.

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const howRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => setActivityLine((prev) => randomFiller(prev)), 7000);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (messages.length > 0) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  async function ask(question?: string, image?: string) {
    const q = (question ?? input).trim();
    if (!q || loading) return;
    const next: Turn[] = [...messages, { role: "user", content: q, image }];
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
      inputRef.current?.focus();
    }
  }

  // A photo of a wine list: shrink it in the browser, have the API read it to
  // text, then send that text through the ordinary ask so every name gets
  // looked up. The photo itself only ever appears on this page.
  async function readList(file: File) {
    if (loading) return;
    setLoading(true);
    setActivityLine("Squinting at somebody's wine list…");
    const preview = URL.createObjectURL(file);
    try {
      const dataUrl = await shrinkImage(file);
      const res = await fetch(`${API_URL}/v1/wine/read-list`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json().catch(() => null) as { list?: string | null; error?: { message: string } } | null;
      if (!res.ok) {
        const shopShut = res.status === 429 && !!data?.error?.message;
        setMessages((prev) => [...prev, { role: "assistant", content: data?.error?.message ?? "Couldn't read that. Try a straighter photo.", error: !shopShut, shopShut }]);
        return;
      }
      if (!data?.list) {
        setMessages((prev) => [...prev, { role: "user", content: "(a photo)", image: preview }, { role: "assistant", content: "That's not a wine list. I've seen wine lists." }]);
        return;
      }
      setLoading(false);
      await ask(`Here's a wine list:\n${data.list}\nWhat do you make of it?`, preview);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Couldn't read that. Try again.", error: true }]);
    } finally {
      setLoading(false);
      setActivityLine("");
    }
  }

  return (
    <div className={`${s.wrap} ${w.wrap}`}>
      <main className={`${s.col} ${w.col}`}>
        <div className={w.masthead}>
          {/* eslint-disable-next-line @next/next/no-img-element -- hand-drawn line art; optimisation would soften it */}
          <img className={w.face} src="/winebore-face.png" alt="" width={482} height={512} />
          <h1 className={w.title}><b>Wine Bore<span className={s.dot}>.</span></b> Ask. I&rsquo;ll correct you.</h1>
        </div>

        <div className={`${s.bore} ${s.openerBlock} ${w.opener}`}><p>{normalDashes(opener)}</p></div>

        {(messages.length > 0 || loading) && (
          <section className={`${s.turns} ${w.turns}`} aria-label="Conversation">
            {messages.map((m, i) => (
              m.role === "user" ? (
                <div key={i} className={`${s.turn} ${s.userTurn}`}>
                  <p className={s.turnLabel}>You</p>
                  {m.image && (
                    // eslint-disable-next-line @next/next/no-img-element -- object URL from the customer's own photo
                    <img className={w.listPhoto} src={m.image} alt="" />
                  )}
                  <p className={`${s.youText} ${m.image ? w.listText : ""}`}>{normalDashes(m.content)}</p>
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
                <p className={w.workingLine}>
                  <span className={s.workingMark} aria-hidden="true" />
                  {normalDashes((activityLine || FILLERS[0]).replace(/[.…]+$/, ""))}
                </p>
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


          <p className={w.listLine}>
            <input ref={fileRef} type="file" accept="image/*" className={s.srOnly} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readList(f); }} />
            <button type="button" className={w.listBtn} disabled={loading} onClick={() => fileRef.current?.click()}>Upload a wine list. I&rsquo;ll insult it.</button>
          </p>

          <p className={s.cap}>
            <button type="button" className={w.howLink} onClick={() => howRef.current?.showModal()}>How we built this</button>
          </p>
        </section>

        <dialog ref={howRef} className={w.how} onClick={(e) => { if (e.target === howRef.current) howRef.current?.close(); }}>
          <div className={w.howBody}>
            <button type="button" className={w.howClose} onClick={() => howRef.current?.close()} aria-label="Close">&times;</button>
            <h2>How we built this</h2>
            <p>An experiment, after Record Bore. Can you give a language model taste? Not knowledge. Opinions about one narrow thing, backed by facts you can check. The model on its own has read everything and believes nothing, so the data came first.</p>

            <h3>The data</h3>
            <p>The spine is Liv-ex&rsquo;s LWIN list: 190,479 wines, 34,466 producers. On top, the EU register of protected names, 1,688 appellations with their yield caps and planting rules, and the actual rulebooks for 953 of them: the cahiers des charges, disciplinari and pliegos. That&rsquo;s where the rules live, and the rules are what he&rsquo;s right about.</p>
            <p>Then the joining up. 55,971 rows of which grapes are allowed where, matched to 2,211 varieties. Producer websites from Wikidata, 41 trade bodies and an <a href="https://exa.ai" target="_blank" rel="noopener noreferrer">Exa</a> sweep of the 500 biggest houses. 96% of the live European wines land on a register entry, which is how Chablis knows it&rsquo;s Chardonnay only.</p>
            <p>Taste is the bit we&rsquo;ve only started. Each rulebook says what the wine has to look, smell and taste like, and he can quote it. Beyond that, 536 notes from the Swedish state monopoly and nothing from growers yet.</p>

            <h3>How he answers</h3>
            <p>One character file and six lookups: the cellar, an appellation and its rules, a producer, a wine, a grape, a shelf. Every fact has to come from a lookup made in that turn. If he names something the lookups didn&rsquo;t return, he&rsquo;s sent back to the book once. If it&rsquo;s still not there, he says so.</p>

            <h3>Where it goes next</h3>
            <p>The same shape would take a merchant&rsquo;s own stock list, or a taste much narrower than Europe. The more opinion you feed in, the more he sounds like a person. A thousand voice notes on a thousand wines would turn him into somebody specific. That&rsquo;s the next experiment, not this one.</p>

            <h3>What it isn&rsquo;t</h3>
            <p>No review sites, no scraped tasting notes, no Vivino.</p>
          </div>
        </dialog>
      </main>
    </div>
  );
}
