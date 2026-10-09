"use client";

// Record Bore is a small, standalone counter conversation. The UI keeps four
// states distinct: prompt, working, answer, and records. Personality belongs
// in the writing; interface state should never have to pretend to be dialogue.

import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { extractYouTubeId } from "@/lib/media";
import {
  linkifyPlainUrls,
  type MediaItem,
  type Message,
  type ResponseMode,
} from "../llm-beta/LlmBetaClient";
import s from "./recordbore.module.css";
import { DiscogsLine, sessionHeaders } from "./DiscogsLine";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";

function normalDashes(value: string): string {
  return value.replace(/[\u2013\u2014]/g, "-");
}

function recordNameDashes(value: string): string {
  return normalDashes(value).replace(/ - /g, " – ");
}

function recordLinkDashes(children: ReactNode): ReactNode {
  if (typeof children === "string") return recordNameDashes(children);
  if (Array.isArray(children)) return children.map(recordLinkDashes);
  return children;
}

async function getQuestionsLeft(): Promise<number | null> {
  try {
    const res = await fetch(`${API_URL}/v1/ask/quota`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json() as { remaining?: number };
    return Number.isFinite(data.remaining) ? Math.max(0, Number(data.remaining)) : null;
  } catch {
    return null;
  }
}

// The Bore's own shop life. Keep this separate from the generic LLM fillers:
// backend progress is functional, but this line belongs to the character.
// While he digs, the shop carries on: customers to argue with, biscuits,
// Hard Wax stories. One line at a time, held long enough to read twice.
const BORE_FILLERS = [
  "Telling a new customer we haven't got any Nirvana…",
  "Still explaining about the Nirvana. It's a house shop…",
  "He's asking if we've got any Oasis now. Closing the shop…",
  "Popped out for biscuits. Back…",
  "Biscuit break. Earned…",
  "Dunking a digestive…",
  "Out of teabags. Serious situation…",
  "Waiting for the kettle. It knows what it did…",
  "Telling the Hard Wax story again. The long version…",
  "Remembering the Hard Wax years. Nobody smiled. It was perfect…",
  "Hard Wax would've had this filed by now. Standards…",
  "Quoting Hard Wax rules at nobody…",
  "On the phone to a man in Osaka about a test pressing…",
  "Signing for a parcel from Berlin…",
  "The postman's brought something I've waited months for. One sec…",
  "Turning down a trade-in. All Ministry compilations…",
  "Pricing up a box from a divorce…",
  "Refusing to sell someone the shop copy…",
  "Explaining why the good copy costs more. Because it's the good copy…",
  "Explaining that 'rare' and 'good' aren't the same word…",
  "Talking someone out of a picture disc…",
  "Talking someone out of a bootleg. Slowly…",
  "Explaining the difference between garage and garage…",
  "Someone just said 'EDM' in my shop…",
  "Recovering from someone saying 'EDM'…",
  "Someone's asking if we buy CDs. We don't buy CDs…",
  "Being asked if this is 'the vinyl shop'. It's a record shop…",
  "Watching a customer file R&S under R…",
  "Refiling everything a school trip touched…",
  "A student's asking for 'anything Balearic'. Sitting them down…",
  "Arguing about whether '92 was better than '93. It was '93…",
  "Telling the story about the Basic Channel rep. Again…",
  "Remembering what this sounded like at The End…",
  "Remembering a night at Lost I never talk about…",
  "Thinking about Detroit. Give me a minute…",
  "Reading a run-out etching under the lamp…",
  "Steaming a stubborn price sticker…",
  "Peeling fifteen years of stickers off a sleeve…",
  "Playing the intro again just to be sure…",
  "Checking the ledger for who bought the last one. Won't say…",
  "Ignoring an email from a streaming service…",
  "Ignoring a man selling card machines…",
  "The rep from the distributor's here. Hiding…",
  "The cat's on the Chicago section again…",
  "Moving the cat. She only likes electro…",
  "Locking the door so I can think…",
  "Turned the sign round. It lies…",
  "Someone's whistling in the shop. Dealing with it…",
  "Confiscating a coffee from above the racks…",
  "Moving a pint glass off the counter. Not mine…",
  "Telling a customer the record they want is 'in the back'. It isn't…",
  "In the cellar. If I'm not back in five, buy something…",
  "Found a record I forgot I loved. Give me a moment…",
  "Having a moment with a B-side…",
  "Straightening the Theo Parrish divider. It earns it…",
  "Arguing with the delivery man about where the boxes go…",
  "Someone's parked a pram against the 12-inches…",
  "Explaining we don't do requests. Taking the request…",
  "Writing 'NOT FOR SALE' on something in biro…",
];

function randomBoreFiller(previous = ""): string {
  let next = previous;
  while (next === previous) {
    next = BORE_FILLERS[Math.floor(Math.random() * BORE_FILLERS.length)];
  }
  return next;
}

type RBMessage = Message & { shopShut?: boolean; stopped?: boolean };
const STORAGE = "recordbore-conversation";

interface RecMeta {
  // Canonical record name - media items arrive titled by their YouTube
  // caption ("Substance - Relish (Dub Edit)"), not the record.
  title: string | null;
  artist: string | null;
  label: string | null;
  year: number | null;
  cover: string | null;
}

// Media items are one-per-video; the crate is one-per-record. First video wins
// (it's the one the answer's citation bound first).
function dedupeByMaster(media: MediaItem[]): MediaItem[] {
  const seen = new Set<number>();
  return media.filter((m) => !seen.has(m.discogs_id) && seen.add(m.discogs_id));
}

function CrateRow({ item, meta }: { item: MediaItem; meta?: RecMeta }) {
  const [playing, setPlaying] = useState(false);
  const artist = (meta?.artist ?? item.artist)?.replace(/\s+\(\d+\)$/, "");
  const title = meta?.title ?? item.title;
  const sub = [meta?.label, meta?.year].filter(Boolean).join(" · ");
  const ytId = extractYouTubeId(item.youtube_url);
  // Sleeve sources in order: the cover, then the video still, then the black
  // block. A cover that 404s falls through to the still rather than a blank.
  const ytThumb = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : null;
  const sleeves = [meta?.cover, ytThumb].filter((u): u is string => Boolean(u));
  const [failed, setFailed] = useState<string[]>([]);
  const sleeveSrc = sleeves.find((u) => !failed.includes(u)) ?? null;
  return (
    <>
      <div className={s.record}>
        <button
          type="button"
          className={s.sleeveBtn}
          onClick={() => ytId && setPlaying((p) => !p)}
          aria-label={playing ? `Stop ${title}` : `Play ${title}`}
          disabled={!ytId}
        >
          <span className={s.sleeve}>
            {sleeveSrc && (
              // eslint-disable-next-line @next/next/no-img-element -- external CAA/YouTube image, next/image can't optimise it
              <img
                key={sleeveSrc}
                className={`${s.sleeveImg} ${sleeveSrc === ytThumb ? s.sleeveYt : ""}`}
                src={sleeveSrc}
                alt=""
                loading="lazy"
                onError={() => setFailed((f) => [...f, sleeveSrc])}
              />
            )}
          </span>
        </button>
        <div className={s.recMeta}>
          <span className={s.recTitle}>{recordNameDashes(artist ? `${artist} - ${title}` : title)}</span>
          {sub && <span className={s.recSub}>{sub}</span>}
        </div>
        <span className={s.recActs}>
          {ytId && (
            <button type="button" className={s.recAct} onClick={() => setPlaying((p) => !p)}>
              {playing ? "stop" : "listen"}
            </button>
          )}
          <a
            className={s.recAct}
            href={`https://www.discogs.com/sell/list?master_id=${item.discogs_id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            on Discogs &rarr;
          </a>
        </span>
      </div>
      {playing && ytId && (
        <div className={s.playerRow}>
          <iframe
            className={s.player}
            src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1`}
            allow="autoplay; encrypted-media"
            allowFullScreen
            title={title}
          />
        </div>
      )}
    </>
  );
}

export function RecordBoreClient() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<RBMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [activityLine, setActivityLine] = useState<string>("");
  // Answer text as it streams in. Reset whenever a status event follows it:
  // that text was the model talking before a lookup, not the answer.
  const [draft, setDraft] = useState<string>("");
  const [bagOpen, setBagOpen] = useState(false);
  const [recMeta, setRecMeta] = useState<Record<number, RecMeta>>({});
  const [questionsLeft, setQuestionsLeft] = useState<number | null>(null);

  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserRef = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const draftRef = useRef("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const howRef = useRef<HTMLDialogElement>(null);
  const fetchedIds = useRef(new Set<number>());

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE) || "[]");
      if (Array.isArray(saved)) setMessages(saved.filter((m): m is RBMessage =>
        !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
      ).slice(-40).map((m) => ({ ...m, media: Array.isArray(m.media) ? m.media.filter((item) =>
        !!item && Number.isInteger(item.discogs_id) && typeof item.title === "string" &&
        typeof item.artist === "string" && typeof item.youtube_url === "string"
      ) : [] })));
    } catch { /* Unavailable storage must not prevent a conversation. */ }
    setReady(true);
    return () => { controller.current?.abort(); if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);

  useEffect(() => {
    if (!ready || loading) return;
    try { localStorage.setItem(STORAGE, JSON.stringify(messages.slice(-40))); }
    catch { /* Conversation remains usable when storage is full or disabled. */ }
  }, [messages, ready, loading]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [input]);

  useEffect(() => {
    void getQuestionsLeft().then(setQuestionsLeft);
  }, []);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setActivityLine((prev) => randomBoreFiller(prev));
    }, 12000);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (messages.at(-1)?.role === "user") lastUserRef.current?.scrollIntoView({ block: "start" });
  }, [messages]);

  function trackScroll() {
    const el = scrollRef.current;
    if (el) setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
  }

  useEffect(trackScroll, [messages, draft, loading, bagOpen]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(trackScroll);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [messages.length, bagOpen]);

  // Crate rows want label · year · sleeve; media items carry none of it.
  // Backfill from the master detail + cover endpoints as answers arrive.
  useEffect(() => {
    for (const m of messages) {
      for (const item of m.media ?? []) {
        const id = item.discogs_id;
        if (fetchedIds.current.has(id)) continue;
        fetchedIds.current.add(id);
        (async () => {
          try {
            const detail = await fetch(`${API_URL}/v1/masters/${id}`).then((r) => (r.ok ? r.json() : null)) as
              { master?: { title?: string; year?: number; main_release_discogs_id?: number; primary_artist?: { name?: string }; primary_label?: { name?: string } } } | null;
            const master = detail?.master;
            let cover: string | null = null;
            if (master?.main_release_discogs_id) {
              const c = await fetch(`${API_URL}/v1/releases/${master.main_release_discogs_id}/cover`)
                .then((r) => (r.ok ? r.json() : null)) as { cover?: { url?: string | null } | null } | null;
              cover = c?.cover?.url ?? null;
            }
            setRecMeta((prev) => ({
              ...prev,
              [id]: {
                title: master?.title ?? null,
                artist: master?.primary_artist?.name ?? null,
                label: master?.primary_label?.name ?? null,
                year: master?.year ?? null,
                cover,
              },
            }));
          } catch { /* black sleeve block stays - the mock's own fallback */ }
        })();
      }
    }
  }, [messages]);

  async function ask(question?: string, base: RBMessage[] = messages) {
    const q = (question ?? input).trim();
    if (!q || locked.current || !ready) return;
    locked.current = true;
    const abort = new AbortController();
    controller.current = abort;
    draftRef.current = "";
    setDraft(""); setNotice("");

    const nextMessages: RBMessage[] = [...base, { role: "user", content: q }];
    setMessages(nextMessages);
    if (question === undefined) setInput("");
    setActivityLine(randomBoreFiller());
    setLoading(true);

    let sawTerminal = false;
    const finish = (answer: RBMessage) => {
      if (sawTerminal) return;
      sawTerminal = true;
      setMessages([...nextMessages, answer]);
    };
    try {
      const history = base.filter((m) => !m.error && !m.shopShut && !m.stopped)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch(`${API_URL}/v1/ask/stream`, {
        method: "POST",
        signal: abort.signal,
        headers: { "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({ question: q, history }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null) as { error?: { message: string }; mode?: ResponseMode } | null;
        const shopShut = res.status === 429 && !!data?.error?.message;
        finish({
          role: "assistant",
          content: data?.error?.message ?? "Till's jammed. Try again in a minute.",
          error: !shopShut,
          shopShut,
          mode: data?.mode,
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleLine = (line: string) => {
        if (!line.trim() || sawTerminal) return;
        let evt: {
          type: "status" | "delta" | "result" | "error";
          label?: string;
          text?: string;
          answer?: string;
          media?: MediaItem[];
          mode?: ResponseMode;
          error?: { code: string; message: string };
        };
        try {
          evt = JSON.parse(line);
        } catch {
          return;
        }
        if (evt.type === "delta") {
          draftRef.current += evt.text ?? "";
          setDraft(draftRef.current);
        } else if (evt.type === "status") {
          draftRef.current = "";
          setDraft("");
        } else if (evt.type === "result") {
          finish({
            role: "assistant",
            content: evt.answer ?? "",
            media: evt.media ?? [],
            mode: evt.mode,
          });
        } else if (evt.type === "error") {
          finish({ role: "assistant", content: evt.error?.message ?? "Something went wrong.", error: true, mode: evt.mode });
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
      buffer += decoder.decode();
      if (buffer.trim()) handleLine(buffer);

      if (!sawTerminal) {
        finish({ role: "assistant", content: "The connection dropped mid-answer - try again.", error: true });
      }
    } catch {
      finish(abort.signal.aborted
        ? { role: "assistant", content: draftRef.current, stopped: true }
        : { role: "assistant", content: "Request failed - check your network.", error: true });
    } finally {
      locked.current = false;
      controller.current = null;
      draftRef.current = "";
      setLoading(false);
      setDraft("");
      setActivityLine("");
      void getQuestionsLeft().then(setQuestionsLeft);
    }
  }

  async function copyAnswer(content: string, index: number) {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(index);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1800);
    } catch { setNotice("Couldn't copy automatically. Select the answer to copy it."); }
  }

  function reset() {
    if (locked.current) return;
    setMessages([]); setInput(""); setNotice(""); setBagOpen(false); setCopied(null);
    inputRef.current?.focus();
  }

  const bagItems = dedupeByMaster(messages.flatMap((m) => m.media ?? []));
  const bagVideoIds = bagItems
    .map((item) => extractYouTubeId(item.youtube_url))
    .filter((id): id is string => Boolean(id));
  const playlistUrl = bagVideoIds.length > 0
    ? `https://www.youtube.com/watch_videos?video_ids=${bagVideoIds.join(",")}`
    : null;
  return (
    <div className={`${s.wrap} ${messages.length > 0 ? s.chatting : ""}`}>
      <main className={s.col}>
        <div className={s.scrollArea} ref={scrollRef} onScroll={trackScroll}>
        <div className={s.masthead}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 215px hand-drawn PNG; next/image optimisation would only soften the linework */}
          <img className={s.face} src="/recordbore-face.png" alt="" width={215} height={235} />
          <h1 className={s.title}><b>Record Bore<span className={s.dot}>.</span></b> Ask. <span className={s.scope}>House and techno, 1988-2008.</span></h1>
        </div>

        {/* Only mount the transcript once a real turn exists. */}
        {(messages.length > 0 || loading) && (
        <section className={s.turns} aria-label="Conversation">
          {messages.map((m, i) => (
            m.role === "user" ? (
              <div key={i} ref={i === messages.length - 1 ? lastUserRef : undefined} className={`${s.turn} ${s.userTurn}`}>
                <p className={s.turnLabel}>You</p>
                <p className={s.youText}>{normalDashes(m.content)}</p>
              </div>
            ) : (
              <article key={i} className={`${s.turn} ${s.boreTurn}`}>
                <p className={s.turnLabel}>Record Bore</p>
                {m.shopShut && (
                  // eslint-disable-next-line @next/next/no-img-element -- the face punctuates the daily-limit response
                  <img className={s.shutFace} src="/recordbore-face.png" alt="" width={56} height={61} />
                )}
                <div className={s.bore}>
                {m.error ? (
                  <p className={s.plain}>{normalDashes(m.content)}</p>
                ) : (
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">{recordLinkDashes(children)}</a>
                      ),
                    }}
                  >
                    {linkifyPlainUrls(normalDashes(m.content))}
                  </ReactMarkdown>
                )}
                </div>
                {(m.media?.length ?? 0) > 0 && (
                  <div className={s.crate}>
                    {dedupeByMaster(m.media!).map((item) => (
                      <CrateRow key={item.discogs_id} item={item} meta={recMeta[item.discogs_id]} />
                    ))}
                  </div>
                )}
                {m.stopped && <p className={s.cap}>Response stopped.</p>}
                <div className={s.answerActions}>
                  {m.content && !m.error && !m.shopShut && <button type="button" onClick={() => void copyAnswer(m.content, i)}>{copied === i ? "Copied" : "Copy"}</button>}
                  {i === messages.length - 1 && messages[i - 1]?.role === "user" && !m.shopShut && (
                    <button type="button" disabled={loading} onClick={() => void ask(messages[i - 1].content, messages.slice(0, i - 1))}>Retry</button>
                  )}
                </div>
              </article>
            )
          ))}

          {loading && draft && (
            <article className={`${s.turn} ${s.boreTurn}`} aria-live="polite">
              <p className={s.turnLabel}>Record Bore</p>
              <div className={s.bore}>
                <ReactMarkdown
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">{recordLinkDashes(children)}</a>
                    ),
                  }}
                >
                  {linkifyPlainUrls(normalDashes(draft))}
                </ReactMarkdown>
              </div>
            </article>
          )}

          {loading && !draft && (
            <div className={`${s.turn} ${s.working}`} role="status" aria-live="polite">
              <p className={s.workingLine}>
                {normalDashes((activityLine || BORE_FILLERS[0]).replace(/[.…]+$/, ""))}
              </p>
            </div>
          )}

          <div ref={bottomRef} />
        </section>
        )}

        {bagItems.length > 0 && (
          <div className={s.bagWrap}>
            <button
              type="button"
              className={s.bagToggle}
              onClick={() => setBagOpen((open) => !open)}
              aria-expanded={bagOpen}
              aria-controls="record-bore-bag"
            >
              {bagOpen ? "Put the bag away" : `Bag it up - ${bagItems.length} record${bagItems.length === 1 ? "" : "s"}`}
            </button>
            {bagOpen && (
              <section id="record-bore-bag" className={s.bag} aria-label="Records from this conversation">
                <div className={s.bagHead}>
                  <span>Records / {String(bagItems.length).padStart(2, "0")}</span>
                  {playlistUrl && (
                    <a href={playlistUrl} target="_blank" rel="noopener noreferrer">
                      play the lot
                    </a>
                  )}
                </div>
                <div className={s.bagList}>
                  {bagItems.map((item, index) => {
                    const meta = recMeta[item.discogs_id];
                    const artist = (meta?.artist ?? item.artist)?.replace(/\s+\(\d+\)$/, "");
                    const title = meta?.title ?? item.title;
                    const ytId = extractYouTubeId(item.youtube_url);
                    return (
                      <p key={item.discogs_id}>
                        <span className={s.bagName}>
                          <span className={s.bagIndex}>{String(index + 1).padStart(2, "0")}</span>
                          <a href={`/master/${item.discogs_id}`} target="_blank" rel="noopener noreferrer">
                            {recordNameDashes(artist ? `${artist} - ${title}` : title)}
                          </a>
                        </span>
                        <span>
                          {ytId && (
                            <a href={`https://www.youtube.com/watch?v=${ytId}`} target="_blank" rel="noopener noreferrer">
                              listen
                            </a>
                          )}
                          <a
                            href={`https://www.discogs.com/sell/list?master_id=${item.discogs_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            buy
                          </a>
                        </span>
                      </p>
                    );
                  })}
                </div>
                <p className={s.bagFoot}>No returns. Obviously.</p>
              </section>
            )}
          </div>
        )}

        </div>
        <section className={s.askPanel} aria-labelledby="record-bore-ask-label">
          {messages.length > 0 && <div className={s.conversationActions}>
            <button type="button" disabled={loading} onClick={reset}>New conversation</button>
            {!nearBottom && <button type="button" onClick={() => bottomRef.current?.scrollIntoView({ block: "end" })}>Latest reply ↓</button>}
          </div>}
          {notice && <p className={s.cap} role="status">{notice}</p>}
          <label id="record-bore-ask-label" className={s.srOnly} htmlFor="record-bore-question">Ask</label>
          <div className={s.composer}>
            <textarea
              id="record-bore-question"
              ref={inputRef}
              className={s.input}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(); } }}
              placeholder={messages.length > 0 ? "Ask another stupid question." : "Go on then."}
              disabled={!ready}
              autoCapitalize="sentences"
              autoCorrect="off"
              spellCheck={false}
            />
            {loading ? (
              <button className={s.send} onClick={() => controller.current?.abort()} type="button" aria-label="Stop response"><span aria-hidden="true">■</span></button>
            ) : (
              <button className={s.send} onClick={() => void ask()} disabled={!ready || !input.trim()} type="button">
                <span className={s.srOnly}>Ask</span><span aria-hidden="true">&rarr;</span>
              </button>
            )}
          </div>

          {questionsLeft !== null && questionsLeft <= 5 && (
            <p className={s.cap}>
              {`${questionsLeft} question${questionsLeft === 1 ? "" : "s"} left.`}
            </p>
          )}
          <DiscogsLine />
          <p className={s.cap}>
            <button type="button" className={s.howLink} onClick={() => howRef.current?.showModal()}>How we built this</button>
          </p>
        </section>

        <dialog ref={howRef} className={s.how} aria-labelledby="record-bore-about-title" onClick={(e) => { if (e.target === howRef.current) howRef.current?.close(); }}>
          <div className={s.howBody}>
            <button type="button" className={s.howClose} onClick={() => howRef.current?.close()} aria-label="Close">&times;</button>
            <h2 id="record-bore-about-title">How we built this</h2>
            <p>Dig started as a rebuild of Discogs&rsquo; open data for house and techno. Record Bore is the shop counter on top of it: a narrow point of view, backed by records you can check.</p>

            <h3>The data</h3>
            <p>Discogs publishes its whole catalogue every month under a CC0 licence. We take the February 2026 release and keep house, techno and the scenes around them: 252,167 records, 149,807 artists and 226,387 labels.</p>
            <p>On top of that: 966,913 credits (who produced, engineered and remixed what), 1.98 million video links across 209,728 records, 15 hand-drawn scenes, and the essential run for 98 labels.</p>

            <h3>How he answers</h3>
            <p>A character file and a few lookups across records, credits, labels and scenes. Every record he names is a link to one he just looked up. If he didn&rsquo;t look it up, the link comes off, and he says when he&rsquo;s going from memory.</p>

            <h3>What it isn&rsquo;t</h3>
            <p>No reviews, no blogs, no prices.</p>
            <p className={s.aboutCredit}>Made by b1rdmania · <a href="https://github.com/b1rdmania" target="_blank" rel="noopener noreferrer">GitHub</a> · <a href="https://x.com/b1rdmania" target="_blank" rel="noopener noreferrer">X</a></p>
          </div>
        </dialog>

      </main>
    </div>
  );
}
