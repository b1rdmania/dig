"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { extractYouTubeId } from "@/lib/media";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";
const KEY_STORAGE = "dig.llm_beta.access_key";

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
  const [activity, setActivity] = useState<string[]>([]);
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
          setActivity((prev) => (prev[prev.length - 1] === evt.label ? prev : [...prev, evt.label!]));
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
      setActivity([]);
      inputRef.current?.focus();
      resizeComposer();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  }

  const hasKey = accessKey.trim().length > 0;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Private Beta</p>
        <h1 className={styles.title}>Ask Dig.</h1>
        <p className={styles.lede}>An intelligent music assistant.</p>
        <p className={styles.lede}>Grounded in the Dig catalog — every answer cites real records.</p>
      </section>

      <section className={styles.supportStrip}>
        <span className={styles.supportLabel}>Need help?</span>
        <Link href="/feedback" className={styles.supportLink}>Report a bug</Link>
        <a href="https://x.com/b1rdmania" target="_blank" rel="noreferrer" className={styles.supportLink}>@b1rdmania</a>
        <a href="https://github.com/b1rdmania/dig" target="_blank" rel="noreferrer" className={styles.supportLink}>GitHub</a>
        <Link href="/about" className={styles.supportLink}>About</Link>
      </section>

      {!hasKey && (
        <section className={styles.keySection}>
          <label className={styles.label} htmlFor="access-key">Beta access key to get started</label>
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
          <p className={styles.help}>Stored in this browser session only. Cleared when tab closes.</p>
        </section>
      )}

      {hasKey && (
        <div className={styles.chatShell}>
          <div className={styles.thread}>
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
                {activity.length === 0 ? (
                  <p className={styles.thinking}>hold on...</p>
                ) : (
                  activity.slice(-4).map((label, i, shown) => (
                    <p
                      key={`${label}-${i}`}
                      className={styles.thinking}
                      style={{ opacity: i === shown.length - 1 ? 1 : 0.45 }}
                    >
                      {label}
                    </p>
                  ))
                )}
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
            <p className={styles.help}>Enter to send · Shift+Enter for new line</p>
            <button className={styles.clearKey} type="button" onClick={() => { updateAccessKey(""); setMessages([]); }}>
              Clear key + history
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
