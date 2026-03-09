"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { extractYouTubeId } from "@/lib/media";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";
const KEY_STORAGE = "dig.llm_beta.anthropic_key";
const DIG_BETA_KEY = "dig-alpha-001";

const ENTITY_PATHS: Record<string, string> = {
  artist: "artist",
  label: "label",
  master: "release",
  release: "version",
};

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
        <Link href={`/release/${item.discogs_id}`} className={styles.videoTitle} target="_blank" rel="noopener noreferrer">
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
  const [anthropicKey, setAnthropicKey] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(KEY_STORAGE);
      if (saved) setAnthropicKey(saved);
    } catch { /* no-op */ }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function updateAnthropicKey(value: string) {
    setAnthropicKey(value);
    try {
      if (value.trim()) window.sessionStorage.setItem(KEY_STORAGE, value.trim());
      else window.sessionStorage.removeItem(KEY_STORAGE);
    } catch { /* no-op */ }
  }

  async function ask() {
    const q = input.trim();
    if (!q || !anthropicKey.trim() || loading) return;

    const nextMessages: Message[] = [...messages, { role: "user", content: q }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const history = nextMessages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch(`${API_URL}/v1/ask`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": DIG_BETA_KEY,
          "x-anthropic-api-key": anthropicKey.trim(),
        },
        body: JSON.stringify({ question: q, history }),
      });

      const data = await res.json() as {
        answer?: string;
        media?: MediaItem[];
        mode?: ResponseMode;
        evidence?: EvidenceItem[];
        meta?: { tool_calls?: number };
        error?: { code: string; message: string };
      };

      if (data.error) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.error!.message, error: true, mode: data.mode }]);
      } else {
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: data.answer ?? "",
          media: data.media ?? [],
          mode: data.mode,
          evidence: data.evidence ?? [],
          tool_calls: data.meta?.tool_calls ?? 0,
        }]);
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "Request failed — check your network or API key.",
        error: true,
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  }

  const hasKey = anthropicKey.trim().length > 0;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Private Beta</p>
        <h1 className={styles.title}>Ask Dig.</h1>
        <p className={styles.lede}>An intelligent music assistant.</p>
        <p className={styles.lede}>Your Anthropic key is never saved server-side.</p>
      </section>

      {!hasKey && (
        <section className={styles.keySection}>
          <label className={styles.label} htmlFor="anthropic-key">Anthropic API Key to get started</label>
          <input
            id="anthropic-key"
            className={styles.input}
            type="password"
            value={anthropicKey}
            onChange={(e) => updateAnthropicKey(e.target.value)}
            placeholder="sk-ant-..."
            autoFocus
          />
          <p className={styles.help}>Stored in this browser session only. Cleared when tab closes.</p>
        </section>
      )}

      {hasKey && (
        <>
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
                            {m.content}
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
                <p className={styles.thinking}>thinking...</p>
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
              placeholder="Ask about any artist, release, label, or genre..."
              rows={1}
              disabled={loading}
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
            <button className={styles.clearKey} type="button" onClick={() => { updateAnthropicKey(""); setMessages([]); }}>
              Clear key + history
            </button>
          </div>
        </>
      )}
    </div>
  );
}
