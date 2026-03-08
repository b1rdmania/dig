"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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

interface Source {
  type: string;
  discogs_id: number;
  title_or_name: string;
}

interface AskMeta {
  model?: string;
  elapsed_ms?: number;
  entities_extracted?: string[];
  sources_found?: number;
  off_topic?: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  meta?: AskMeta;
  error?: boolean;
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

    const userMsg: Message = { role: "user", content: q };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      // Build history for API (exclude last user msg — it's the current question)
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
        sources?: Source[];
        meta?: AskMeta;
        error?: { code: string; message: string };
      };

      if (data.error) {
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: data.error!.message,
          error: true,
        }]);
      } else {
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: data.answer ?? "",
          sources: data.sources ?? [],
          meta: data.meta,
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
        <h1 className={styles.title}>Ask dig.</h1>
        <p className={styles.lede}>
          An intelligent music assistant with access to 24 million Discogs records.
          Your Anthropic key is never saved server-side.
        </p>
      </section>

      {!hasKey && (
        <section className={styles.keySection}>
          <label className={styles.label} htmlFor="anthropic-key">Anthropic API Key to get started</label>
          <div className={styles.keyRow}>
            <input
              id="anthropic-key"
              className={styles.input}
              type="password"
              value={anthropicKey}
              onChange={(e) => updateAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              autoFocus
            />
          </div>
          <p className={styles.help}>Stored in this browser session only. Cleared when tab closes.</p>
        </section>
      )}

      {hasKey && (
        <>
          {messages.length === 0 && (
            <div className={styles.emptyState}>
              <p className={styles.emptyHint}>Try: "Key albums by Talk Talk" · "Chicago house labels" · "Who produced Loveless?"</p>
            </div>
          )}

          <div className={styles.thread}>
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? styles.userMsg : styles.assistantMsg}>
                {m.role === "user" ? (
                  <p className={styles.userText}>{m.content}</p>
                ) : (
                  <div className={styles.assistantContent}>
                    <p className={m.error ? styles.errorText : styles.answerText}>{m.content}</p>

                    {m.sources && m.sources.length > 0 && (
                      <div className={styles.sources}>
                        {m.sources.map((s) => (
                          <Link
                            key={`${s.type}-${s.discogs_id}`}
                            href={`/${ENTITY_PATHS[s.type] ?? s.type}/${s.discogs_id}`}
                            className={styles.sourceLink}
                          >
                            {s.title_or_name}
                            <span className={styles.sourceType}>{s.type}</span>
                          </Link>
                        ))}
                      </div>
                    )}

                    {m.meta && (
                      <p className={styles.metaLine}>
                        {m.meta.model && <span>{m.meta.model}</span>}
                        {m.meta.elapsed_ms && <span>{m.meta.elapsed_ms}ms</span>}
                      </p>
                    )}
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
