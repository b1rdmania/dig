"use client";

// Record Bore — built to the approved mock (~/Documents/record-bore-mock/
// index.html, whitepaper §7 P4). One centred column; the Bore's text sits on
// the page ground, no bubbles, no per-message avatars. The API's public gate
// does the bouncing and its 429s arrive in voice, so they render as the Bore
// talking (with the face — a punctuation moment per P1), not as errors.

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { extractYouTubeId } from "@/lib/media";
import {
  ACK_PHRASES,
  FILLER_PHRASES,
  linkifyPlainUrls,
  type MediaItem,
  type Message,
  type ResponseMode,
} from "../llm-beta/LlmBetaClient";
import s from "./recordbore.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";
const DAILY_ALLOWANCE = 20; // mirrors ASK_PUBLIC_DAILY_PER_IP; display only, server enforces

// The Bore's own shop life, on top of the shared crate-digging fillers.
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

const FILLERS = [...FILLER_PHRASES, ...BORE_FILLERS];

type RBMessage = Message & { shopShut?: boolean };

interface RecMeta {
  // Canonical record name — media items arrive titled by their YouTube
  // caption ("Substance - Relish (Dub Edit)"), not the record.
  title: string | null;
  artist: string | null;
  label: string | null;
  year: number | null;
  cover: string | null;
}

// A card either asks (q) or hands the counter to the customer (fill — the
// challenge only works if they name the record themselves).
const SUGGESTIONS: Array<{ t: string; d: string; q?: string; fill?: string }> = [
  {
    t: "Name your favourite record",
    d: "Go on. I'll tell you what you should have said",
    fill: "My favourite record is ",
  },
  {
    t: "UK garage, 1997, the good year",
    d: "Tuff Jam, Dem 2, and what the reissues missed",
    q: "UK garage, 1997 — the good year. Tuff Jam, Dem 2, what did the reissues miss?",
  },
];

function todayKey(): string {
  return `rb.asks.${new Date().toISOString().slice(0, 10)}`;
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
          <span className={s.recTitle}>{artist ? `${artist} — ${title}` : title}</span>
          {sub && <span className={s.recSub}>{sub}</span>}
        </div>
        <span className={s.recActs}>
          {ytId && (
            <button type="button" className={s.recAct} onClick={() => setPlaying((p) => !p)}>
              {playing ? "stop ■" : "listen ▶"}
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

export function RecordBoreClient({ strip, opener }: { strip: string; opener: string }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<RBMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [activityLine, setActivityLine] = useState<string>("");
  const [left, setLeft] = useState(DAILY_ALLOWANCE);
  const [recMeta, setRecMeta] = useState<Record<number, RecMeta>>({});

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchedIds = useRef(new Set<number>());

  useEffect(() => {
    try {
      const used = Number(window.localStorage.getItem(todayKey()) ?? 0);
      setLeft(Math.max(0, DAILY_ALLOWANCE - used));
    } catch { /* no-op */ }
  }, []);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setActivityLine((prev) => {
        let next = prev;
        while (next === prev) {
          next = FILLERS[Math.floor(Math.random() * FILLERS.length)];
        }
        return next;
      });
    }, 17000);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (messages.length > 0) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
          } catch { /* black sleeve block stays — the mock's own fallback */ }
        })();
      }
    }
  }, [messages]);

  function countAsk() {
    setLeft((prev) => Math.max(0, prev - 1));
    try {
      const key = todayKey();
      window.localStorage.setItem(key, String(Number(window.localStorage.getItem(key) ?? 0) + 1));
    } catch { /* no-op */ }
  }

  async function ask(question?: string) {
    const q = (question ?? input).trim();
    if (!q || loading) return;

    const nextMessages: RBMessage[] = [...messages, { role: "user", content: q }];
    setMessages(nextMessages);
    setInput("");
    setActivityLine(ACK_PHRASES[Math.floor(Math.random() * ACK_PHRASES.length)]);
    setLoading(true);
    countAsk();

    try {
      // The opener is a real turn of the conversation — the model should know
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
        if (shopShut && /come back tomorrow/i.test(data!.error!.message)) setLeft(0);
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
          type: "status" | "result" | "error";
          label?: string;
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
        if (evt.type === "status" && evt.label) {
          setActivityLine(evt.label);
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
        setMessages((prev) => [...prev, { role: "assistant", content: "The connection dropped mid-answer — try again.", error: true }]);
      }
    } catch {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "Request failed — check your network.",
        error: true,
      }]);
    } finally {
      setLoading(false);
      setActivityLine("");
      inputRef.current?.focus();
    }
  }

  return (
    <div className={s.wrap}>
      <header className={`${s.col} ${s.header}`}>
        <a className={s.home} href="/">&larr; home</a>
        <div className={s.masthead}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 215px hand-drawn PNG; next/image optimisation would only soften the linework */}
          <img className={s.face} src="/recordbore-face.png" alt="" width={110} height={120} />
          <h1 className={s.title}>Record Bore<span className={s.dot}>.</span></h1>
          <p className={s.tagline}>Ask me anything. I&rsquo;ll answer something better.</p>
        </div>
      </header>

      <div className={s.strip}>
        <div className={`${s.col} ${s.stripInner}`}>
          <div className={s.dotlive} />
          <span className={s.stripText}>{strip}</span>
        </div>
      </div>

      <main className={s.col}>
        <p className={s.opener}>&ldquo;{opener}&rdquo;</p>

        {/* Only mounted once there's a conversation — empty it just holds a
            dead gap between the opener and the composer. */}
        {(messages.length > 0 || loading) && (
        <div className={s.turns}>
          {messages.map((m, i) => (
            m.role === "user" ? (
              <div key={i} className={s.you}>
                <span className={s.youLabel}>YOU</span>
                <p className={s.youText}>{m.content}</p>
              </div>
            ) : (
              <div key={i} className={s.bore}>
                {m.shopShut && (
                  // eslint-disable-next-line @next/next/no-img-element -- punctuation-moment face per whitepaper §7 P1
                  <img className={s.shutFace} src="/recordbore-face.png" alt="" width={56} height={61} />
                )}
                {m.error ? (
                  <p className={s.plain}>{m.content}</p>
                ) : (
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                      ),
                    }}
                  >
                    {linkifyPlainUrls(m.content)}
                  </ReactMarkdown>
                )}
                {(m.media?.length ?? 0) > 0 && (
                  <div className={s.crate}>
                    {dedupeByMaster(m.media!).map((item) => (
                      <CrateRow key={item.discogs_id} item={item} meta={recMeta[item.discogs_id]} />
                    ))}
                  </div>
                )}
              </div>
            )
          ))}

          {loading && (
            <div className={s.bore}>
              <p className={s.activity}>{activityLine || FILLERS[0]}</p>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
        )}

        <div className={s.composer}>
          <input
            ref={inputRef}
            className={s.input}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } }}
            placeholder="Go on then."
            disabled={loading}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className={s.cRow}>
            <span className={s.counter}>{left} LEFT TODAY</span>
            <button className={s.send} onClick={() => ask()} disabled={loading || !input.trim()} aria-label="Ask" type="button">
              <svg viewBox="0 0 16 16" fill="none" strokeWidth="2" strokeLinecap="round"><path d="M8 13 V3 M3.5 7.5 L8 3 l4.5 4.5" /></svg>
            </button>
          </div>
        </div>

        {messages.length === 0 && (
          <div className={s.suggest}>
            {SUGGESTIONS.map((sug) => (
              <button
                key={sug.t}
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
                <span className={s.sT}>{sug.t}</span>
                <span className={s.sD}>{sug.d}</span>
              </button>
            ))}
          </div>
        )}

        <p className={s.cap}>You&rsquo;ve got {left} questions today. I lose interest after that.</p>
      </main>
    </div>
  );
}
