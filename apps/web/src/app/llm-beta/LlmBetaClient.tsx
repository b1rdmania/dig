"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { extractYouTubeId } from "@/lib/media";
import { PageHeading } from "@/components/design";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";
const KEY_STORAGE = "dig.llm_beta.access_key";

// Between real progress events, the single activity line rotates through
// shop business so it never sits still. In persona, never technical.
// Picked at random; each phrase holds for a while — a shopkeeper doesn't
// change activity every two seconds.
const FILLER_PHRASES = [
  "Riffling the crates…",
  "Checking the back room…",
  "Blowing dust off a sleeve…",
  "Squinting at the runout groove…",
  "Half-listening on the shop headphones…",
  "Flipping past the dividers…",
  "Checking the wants list…",
  "Cueing one up…",
  "Muttering about reissues…",
  "Wiping the stylus…",
  "Straightening the racks…",
  "Consulting the ledger under the till…",
  "Asking Zaf…",
  "Ignoring the phone…",
  "Re-sleeving a 12\"…",
  "Peering over the glasses…",
  "Checking behind the counter…",
  "Going through the new arrivals box…",
  "Sticking the kettle on…",
  "Turning the promo pile over…",
  "Reading the matrix number…",
  "Checking the sold wall…",
  "Having a think…",
  "Weighing up two pressings…",
  "Digging out the box under the stairs…",
  "Checking what came in Tuesday…",
  "Squaring up the display copies…",
  "Looking for the other copy…",
  "Chasing a hunch…",
  "Pulling the divider card…",
  "Flicking to the T section…",
  "Rummaging in the overstock…",
  "Checking the label discography…",
  "Trying to remember the B-side…",
  "Holding it up to the light…",
  "Checking the sleeve for ringwear…",
  "Cross-referencing the wants book…",
  "Tapping the counter…",
  "Frowning at a bootleg…",
  "Refiling something someone left out…",
  "Checking the window display…",
  "Going down the rabbit hole…",
  "Following the thread…",
  "Second-guessing the year…",
  "Pulling the shop copy…",
  "Listening for the intro…",
  "Skipping to the breakdown…",
  "Checking both catalogues…",
  "Remembering who bought the last one…",
  "Looking at the shelf above the singles…",
  "Moving the cat off the box…",
  "Checking the represses…",
  "Dusting the platter…",
  "Dropping the needle for a second…",
  "Marking the page in the ledger…",
  "Sifting the trade-ins…",
  "Comparing sleeves…",
  "Double-checking the pressing plant…",
  "Nipping out the back…",
  "Turning the sign to 'back in 5'…",
  "Thumbing the Chicago section…",
  "Reaching for the top shelf…",
];

interface MediaItem {
  discogs_id: number;
  title: string;
  artist: string;
  youtube_url: string;
}

type ResponseMode = "grounded_success" | "grounded_empty" | "timeout_degraded" | "upstream_error";

interface EvidenceItem {
  type: "artist" | "label" | "master" | "release";
  discogs_id: number;
  title: string;
  dig_url: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  media?: MediaItem[];
  error?: boolean;
  mode?: ResponseMode;
  evidence?: EvidenceItem[];
  tool_calls?: number;
}

function linkifyPlainUrls(text: string): string {
  return text.replace(/(^|\s)(https?:\/\/[^\s]+)/g, (_m, prefix: string, url: string) => {
    return `${prefix}[${url}](${url})`;
  });
}

function VideoCard({ item }: { item: MediaItem }) {
  const ytId = extractYouTubeId(item.youtube_url);
  const [playing, setPlaying] = useState(false);

  if (!ytId) return null;

  return (
    <div className={styles.videoCard}>
      {playing ? (
        <iframe
          className={styles.videoEmbed}
          src={`https://www.youtube.com/embed/${ytId}?autoplay=1`}
          allow="autoplay; encrypted-media"
          allowFullScreen
          title={item.title}
        />
      ) : (
        <button
          className={styles.videoThumb}
          onClick={() => setPlaying(true)}
          type="button"
          aria-label={`Play ${item.title}`}
        >
          <img
            src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`}
            alt={item.title}
            className={styles.videoImg}
          />
          <span className={styles.playBtn}>▶</span>
        </button>
      )}
      <div className={styles.videoMeta}>
        <Link href={`/master/${item.discogs_id}`} className={styles.videoTitle} target="_blank" rel="noopener noreferrer">
          {item.title}
        </Link>
        <span className={styles.videoArtist}>{item.artist}</span>
      </div>
    </div>
  );
}

function VideoRail({ media }: { media: MediaItem[] }) {
  const validMedia = media.filter((m) => extractYouTubeId(m.youtube_url));
  if (validMedia.length === 0) return null;
  return (
    <div className={styles.videoRail}>
      {validMedia.map((m) => (
        <VideoCard key={m.youtube_url} item={m} />
      ))}
    </div>
  );
}

export function LlmBetaClient() {
  const [accessKey, setAnthropicKey] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [activityLine, setActivityLine] = useState<string>("");

  // Rotate the single activity line through random filler phrases while
  // waiting; real progress events (in the stream handler) overwrite it
  // immediately. Each phrase holds for a while — calm, not a slot machine.
  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setActivityLine((prev) => {
        let next = prev;
        while (next === prev) {
          next = FILLER_PHRASES[Math.floor(Math.random() * FILLER_PHRASES.length)];
        }
        return next;
      });
    }, 13000);
    return () => window.clearInterval(id);
  }, [loading]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function resizeComposer() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(KEY_STORAGE);
      if (saved) setAnthropicKey(saved);
    } catch { /* no-op */ }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    resizeComposer();
  }, [input]);

  function updateAccessKey(value: string) {
    setAnthropicKey(value);
    try {
      if (value.trim()) window.sessionStorage.setItem(KEY_STORAGE, value.trim());
      else window.sessionStorage.removeItem(KEY_STORAGE);
    } catch { /* no-op */ }
  }

  async function ask() {
    const q = input.trim();
    if (!q || !accessKey.trim() || loading) return;

    const nextMessages: Message[] = [...messages, { role: "user", content: q }];
    setMessages(nextMessages);
    setInput("");
    setActivityLine(FILLER_PHRASES[Math.floor(Math.random() * FILLER_PHRASES.length)]);
    setLoading(true);

    try {
      const history = nextMessages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch(`${API_URL}/v1/ask/stream`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": accessKey.trim(),
        },
        body: JSON.stringify({ question: q, history }),
      });

      // Pre-stream failures (bad key, rate limit, config) come back as plain
      // JSON with an error status; only a 200 carries the NDJSON stream.
      if (!res.ok || !res.body) {
        if (res.status === 401) {
          // Stale or revoked key restored from a previous session — clear it
          // and drop back to the key screen instead of a dead-end chat.
          updateAccessKey("");
          setMessages([]);
          return;
        }
        const data = await res.json().catch(() => null) as { error?: { message: string }; mode?: ResponseMode } | null;
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: data?.error?.message ?? "Request failed — check your access key.",
          error: true,
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
          evidence?: EvidenceItem[];
          meta?: { tool_calls?: number };
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
            evidence: evt.evidence ?? [],
            tool_calls: evt.meta?.tool_calls ?? 0,
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
        content: "Request failed — check your network or API key.",
        error: true,
      }]);
    } finally {
      setLoading(false);
      setActivityLine("");
      inputRef.current?.focus();
      resizeComposer();
    }
  }

  async function bagItUp() {
    // Compile the session report from records the assistant actually
    // recommended: media rows are already citation-bound, and masters whose
    // dig.baby URL appears in the answer text count even without a video.
    // Evidence alone does NOT qualify — it includes every record the model
    // merely glanced at while searching, which is noise, not the session.
    const seen = new Set<number>();
    const rows: Array<{ id: number; title: string; artist: string | null; ytId: string | null }> = [];
    for (const m of messages) {
      for (const item of m.media ?? []) {
        if (seen.has(item.discogs_id)) continue;
        seen.add(item.discogs_id);
        rows.push({ id: item.discogs_id, title: item.title, artist: item.artist, ytId: extractYouTubeId(item.youtube_url) });
      }
      if (m.role !== "assistant" || m.error) continue;
      const citedIds = [...m.content.matchAll(/app\.dig\.baby\/master\/(\d+)/g)].map((match) => Number(match[1]));
      for (const id of citedIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const ev = (m.evidence ?? []).find((e) => e.type === "master" && e.discogs_id === id);
        rows.push({ id, title: ev?.title ?? `Master ${id}`, artist: null, ytId: null });
      }
    }
    if (rows.length === 0) {
      setMessages((prev) => [...prev, { role: "assistant", content: "Nothing to bag yet — get me to actually recommend some records first.", error: true }]);
      return;
    }

    // Backfill canonical titles for every row (media rows carry YouTube video
    // captions like "Mr. Fingers - Washing Machine [TX127]", not the record's
    // name) and YouTube links for text-cited rows that came without one.
    await Promise.all(rows.map(async (r) => {
      const needsVideo = !r.ytId;
      try {
        const [detailRes, videoRes] = await Promise.all([
          fetch(`${API_URL}/v1/masters/${r.id}`),
          needsVideo ? fetch(`${API_URL}/v1/masters/${r.id}/videos?limit=3`) : Promise.resolve(null),
        ]);
        if (detailRes?.ok) {
          const d = await detailRes.json() as { master?: { title?: string; primary_artist?: { name?: string } } };
          if (d.master?.title) r.title = d.master.title;
          if (d.master?.primary_artist?.name) r.artist = d.master.primary_artist.name;
        }
        if (videoRes?.ok) {
          const data = await videoRes.json() as { videos?: Array<{ url?: string }> };
          for (const v of data.videos ?? []) {
            const vid = extractYouTubeId(String(v.url ?? ""));
            if (vid) { r.ytId = vid; break; }
          }
        }
      } catch { /* leave the fallback label */ }
    }));

    const videoIds = rows.map((r) => r.ytId).filter(Boolean) as string[];
    const lines: string[] = [];
    lines.push(`Right — bagged up, ${rows.length} record${rows.length === 1 ? "" : "s"} from this session.`);
    if (videoIds.length > 0) {
      lines.push("");
      lines.push(`▶ [Play the lot on YouTube](https://www.youtube.com/watch_videos?video_ids=${videoIds.join(",")})`);
    }
    lines.push("");
    for (const r of rows) {
      // Strip Discogs disambiguation suffixes ("Frequency (3)") for display.
      const artist = r.artist?.replace(/\s+\(\d+\)$/, "") ?? null;
      const name = artist ? `${artist} — ${r.title}` : r.title;
      const links = [
        r.ytId ? `[listen](https://www.youtube.com/watch?v=${r.ytId})` : null,
        `[buy](https://www.discogs.com/sell/list?master_id=${r.id})`,
        `[dig](https://app.dig.baby/master/${r.id})`,
      ].filter(Boolean).join(" · ");
      lines.push(`${name} — ${links}`);
      lines.push("");
    }
    setMessages((prev) => [...prev, { role: "assistant", content: lines.join("\n") }]);
  }

  const hasBaggableRecords = messages.some((m) => (m.media?.length ?? 0) > 0 || (m.evidence ?? []).some((e) => e.type === "master"));

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  }

  const hasKey = accessKey.trim().length > 0;

  return (
    <div className={styles.page}>
      <PageHeading title="Dig. Beta." />

      {!hasKey && (
        <section className={styles.keySection}>
          <label className={styles.label} htmlFor="access-key">Access key</label>
          <input
            id="access-key"
            className={styles.input}
            type="password"
            value={accessKey}
            onChange={(e) => updateAccessKey(e.target.value)}
            placeholder="dig-beta-..."
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </section>
      )}

      {hasKey && (
        <div className={styles.chatShell}>
          <div className={styles.thread}>
            {messages.length === 0 && !loading && (
              <p className={styles.thinking}>Go on then — an artist, a label, a sound. Ask.</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? styles.userMsg : styles.assistantMsg}>
                {m.role === "user" ? (
                  <p className={styles.userText}>{m.content}</p>
                ) : (
                  <div className={styles.assistantContent}>
                    {m.error ? (
                      <p className={styles.errorText}>{m.content}</p>
                    ) : (
                      <>
                        {m.mode === "grounded_empty" && (m.tool_calls ?? 0) > 0 && (
                          <p className={styles.modeNote}>Nothing found in Dig for this query.</p>
                        )}
                        {m.mode === "timeout_degraded" && (
                          <p className={styles.modeDegraded}>⚠ Retrieval partial — some data may be missing.</p>
                        )}
                        <div className={styles.markdown}>
                          <ReactMarkdown
                            components={{
                              a: ({ href, children }) => (
                                <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                              ),
                            }}
                          >
                            {linkifyPlainUrls(m.content)}
                          </ReactMarkdown>
                        </div>
                      </>
                    )}
                    {m.media && m.media.length > 0 && <VideoRail media={m.media} />}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className={styles.assistantMsg}>
                <p className={styles.activityLine}>{activityLine || FILLER_PHRASES[0]}</p>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className={styles.inputBar}>
            <textarea
              ref={inputRef}
              className={styles.chatInput}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                window.setTimeout(() => {
                  inputRef.current?.scrollIntoView({ block: "nearest" });
                }, 80);
              }}
              placeholder="Ask about any artist, release, label, or genre..."
              rows={1}
              disabled={loading}
              autoCapitalize="sentences"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              className={styles.sendBtn}
              onClick={ask}
              disabled={loading || !input.trim()}
              type="button"
            >
              {loading ? "..." : "→"}
            </button>
          </div>

          <div className={styles.inputMeta}>
            {hasBaggableRecords && (
              <button className={styles.clearKey} type="button" onClick={bagItUp} disabled={loading}>
                Bag it up ▶
              </button>
            )}
            <button className={styles.clearKey} type="button" onClick={() => { updateAccessKey(""); setMessages([]); }}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
