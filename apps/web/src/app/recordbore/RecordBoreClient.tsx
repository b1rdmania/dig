"use client";

// Record Bore is a small, standalone counter conversation. The UI keeps four
// states distinct: prompt, working, answer, and records. Personality belongs
// in the writing; interface state should never have to pretend to be dialogue.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { extractYouTubeId } from "@/lib/media";
import {
  linkifyPlainUrls,
  type MediaItem,
  type Message,
  type ResponseMode,
} from "../llm-beta/LlmBetaClient";
import s from "./recordbore.module.css";

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

type RBMessage = Message & { shopShut?: boolean };

interface RecMeta {
  // Canonical record name - media items arrive titled by their YouTube
  // caption ("Substance - Relish (Dub Edit)"), not the record.
  title: string | null;
  artist: string | null;
  label: string | null;
  year: number | null;
  cover: string | null;
}

// A suggestion either asks (q) or hands the counter to the customer (fill -
// the challenge only works if they name the record themselves).
const SUGGESTIONS: Array<{ t: string; q?: string; fill?: string }> = [
  { t: "Chicago house, 1988", q: "Chicago house, 1988 - what still sounds dangerous?" },
  { t: "Detroit techno, 1992", q: "Detroit techno, 1992 - what belongs in the front rack?" },
  { t: "UK garage, 1997", q: "UK garage, 1997 - the good year. Tuff Jam, Dem 2, what did the reissues miss?" },
];

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
            {meta?.cover && (
              // eslint-disable-next-line @next/next/no-img-element -- external CAA image, next/image can't optimise it
              <img className={s.sleeveImg} src={meta.cover} alt="" loading="lazy" />
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

export function RecordBoreClient({ opener }: { opener: string }) {
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

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchedIds = useRef(new Set<number>());

  useEffect(() => {
    void getQuestionsLeft().then(setQuestionsLeft);
  }, []);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setActivityLine((prev) => randomBoreFiller(prev));
    }, 7000);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (messages.length > 0) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

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

  async function ask(question?: string) {
    const q = (question ?? input).trim();
    if (!q || loading) return;

    const nextMessages: RBMessage[] = [...messages, { role: "user", content: q }];
    setMessages(nextMessages);
    setInput("");
    setActivityLine(randomBoreFiller());
    setLoading(true);

    try {
      // The opener is a real turn of the conversation - the model should know
      // it already spoke first.
      const history = [
        { role: "assistant" as const, content: opener },
        ...nextMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
      ];

      const res = await fetch(`${API_URL}/v1/ask/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, history }),
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
          setDraft((prev) => prev + (evt.text ?? ""));
        } else if (evt.type === "status") {
          setDraft("");
        } else if (evt.type === "result") {
          sawTerminal = true;
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: evt.answer ?? "",
            media: evt.media ?? [],
            mode: evt.mode,
          }]);
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
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "Request failed - check your network.",
        error: true,
      }]);
    } finally {
      setLoading(false);
      setDraft("");
      setActivityLine("");
      setQuestionsLeft(await getQuestionsLeft());
      inputRef.current?.focus();
    }
  }

  const bagItems = dedupeByMaster(messages.flatMap((m) => m.media ?? []));
  const bagVideoIds = bagItems
    .map((item) => extractYouTubeId(item.youtube_url))
    .filter((id): id is string => Boolean(id));
  const playlistUrl = bagVideoIds.length > 0
    ? `https://www.youtube.com/watch_videos?video_ids=${bagVideoIds.join(",")}`
    : null;
  return (
    <div className={s.wrap}>
      <main className={s.col}>
        <div className={s.topline}>
          <Link className={s.home} href="/">&larr; home</Link>
        </div>
        <div className={s.masthead}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 215px hand-drawn PNG; next/image optimisation would only soften the linework */}
          <img className={s.face} src="/recordbore-face.png" alt="" width={54} height={59} />
          <h1 className={s.title}>Record Bore<span className={s.dot}>.</span></h1>
        </div>
        <p className={s.tagline}>Ask about records. I&rsquo;ll probably disagree. In stock: house &amp; techno, 1988-2008.</p>

        <div className={`${s.bore} ${s.openerBlock}`}><p>{normalDashes(opener)}</p></div>

        {/* Only mount the transcript once a real turn exists. */}
        {(messages.length > 0 || loading) && (
        <section className={s.turns} aria-label="Conversation">
          {messages.map((m, i) => (
            m.role === "user" ? (
              <div key={i} className={`${s.turn} ${s.userTurn}`}>
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
              <div className={s.workingHead}>
                <span className={s.workingMark} aria-hidden="true" />
                <span>Looking through the racks</span>
              </div>
              <p className={s.activity}>{normalDashes((activityLine || BORE_FILLERS[0]).replace(/[.…]+$/, ""))}</p>
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

        <section className={s.askPanel} aria-labelledby="record-bore-ask-label">
          <label id="record-bore-ask-label" className={s.srOnly} htmlFor="record-bore-question">Ask</label>
          <div className={s.composer}>
            <input
              id="record-bore-question"
              ref={inputRef}
              className={s.input}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } }}
              placeholder={messages.length > 0 ? "Ask another stupid question." : "Go on then."}
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
                      if (sug.fill) {
                        setInput(sug.fill);
                        inputRef.current?.focus();
                      } else {
                        ask(sug.q);
                      }
                    }}
                  >
                    {sug.t}
                  </button>
                  {index < SUGGESTIONS.length - 1 && <span aria-hidden="true"> · </span>}
                </span>
              ))}
            </div>
          )}

          <p className={s.cap}>
            {questionsLeft === null
              ? "Limited questions. I lose interest after that."
              : `${questionsLeft} question${questionsLeft === 1 ? "" : "s"} left. I lose interest after that.`}
          </p>
        </section>

      </main>
    </div>
  );
}
