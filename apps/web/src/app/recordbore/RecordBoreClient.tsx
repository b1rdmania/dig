"use client";

// Record Bore — the shop chat with the counter facing the street. Same thread
// as /llm-beta (shared pieces imported from there) minus the key screen: the
// API's public gate does the bouncing, and its 429s arrive in voice, so they
// render as the Bore talking, not as errors.

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { extractYouTubeId } from "@/lib/media";
import { PageHeading } from "@/components/design";
import {
  ACK_PHRASES,
  FILLER_PHRASES,
  VideoRail,
  linkifyPlainUrls,
  type EvidenceItem,
  type MediaItem,
  type Message,
  type ResponseMode,
} from "../llm-beta/LlmBetaClient";
import styles from "../llm-beta/page.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";

export function RecordBoreClient({ opener }: { opener: string }) {
  const openerMessage: Message = { role: "assistant", content: opener };
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([openerMessage]);
  const [loading, setLoading] = useState(false);
  const [activityLine, setActivityLine] = useState<string>("");

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
    // Don't scroll the opener into view on load — only follow the thread once
    // a conversation exists.
    if (messages.length > 1) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    resizeComposer();
  }, [input]);

  async function ask() {
    const q = input.trim();
    if (!q || loading) return;

    const nextMessages: Message[] = [...messages, { role: "user", content: q }];
    setMessages(nextMessages);
    setInput("");
    setActivityLine(ACK_PHRASES[Math.floor(Math.random() * ACK_PHRASES.length)]);
    setLoading(true);

    try {
      const history = nextMessages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch(`${API_URL}/v1/ask/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null) as { error?: { message: string }; mode?: ResponseMode } | null;
        // The gate's refusals ("Shop's shut…") are the Bore speaking, not a
        // fault — plain message, no error styling.
        const shopShut = res.status === 429 && data?.error?.message;
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: data?.error?.message ?? "Till's jammed. Try again in a minute.",
          error: !shopShut,
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
        content: "Request failed — check your network.",
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

  return (
    <div className={styles.page}>
      <PageHeading
        title="Record Bore."
        lede="House and techno, 1985–2008. He was talking before you walked in."
      />

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
            placeholder="What are you after?"
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
          <button className={styles.clearKey} type="button" onClick={() => setMessages([openerMessage])}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
