"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";
const KEY_STORAGE = "dig.llm_beta.anthropic_key";
const DIG_BETA_KEY = "dig-alpha-001";

type AskResponse = {
  answer: string;
  confidence: number;
  citations: Array<{ type: string; discogs_id: number; title_or_name: string }>;
  meta: { model?: string; elapsed_ms?: number; search_results_used?: number; [key: string]: unknown };
};

type ErrorResponse = {
  error: { code: string; message: string; details: unknown };
};

type Result =
  | { ok: true; data: AskResponse }
  | { ok: false; error: ErrorResponse["error"] };

const ENTITY_PATHS: Record<string, string> = {
  artist: "artist",
  label: "label",
  master: "release",
  release: "version",
};

export function LlmBetaClient() {
  const [anthropicKey, setAnthropicKey] = useState("");
  const [question, setQuestion] = useState("What are key releases by Aphex Twin?");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(KEY_STORAGE);
      if (saved) setAnthropicKey(saved);
    } catch {
      // no-op
    }
  }, []);

  function updateAnthropicKey(value: string) {
    setAnthropicKey(value);
    try {
      if (value.trim()) {
        window.sessionStorage.setItem(KEY_STORAGE, value.trim());
      } else {
        window.sessionStorage.removeItem(KEY_STORAGE);
      }
    } catch {
      // no-op
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || !anthropicKey.trim()) return;

    setLoading(true);
    setResult(null);
    setShowRaw(false);

    try {
      const res = await fetch(`${API_URL}/v1/ask`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": DIG_BETA_KEY,
          "x-anthropic-api-key": anthropicKey.trim(),
        },
        body: JSON.stringify({ question: q }),
      });

      const data = await res.json() as AskResponse | ErrorResponse;

      if ("error" in data) {
        setResult({ ok: false, error: (data as ErrorResponse).error });
      } else {
        setResult({ ok: true, data: data as AskResponse });
      }
    } catch (err) {
      setResult({
        ok: false,
        error: { code: "NETWORK_ERROR", message: "Request failed", details: String(err) },
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Private Beta</p>
        <h1 className={styles.title}>Ask dig.</h1>
        <p className={styles.lede}>
          Natural language queries over the Discogs catalog via Claude. Your Anthropic key is stored only in
          this browser session and sent per request — never saved server-side.
        </p>
      </section>

      <section className={styles.panel}>
        <label className={styles.label} htmlFor="anthropic-key">Anthropic API Key (session only)</label>
        <input
          id="anthropic-key"
          className={styles.input}
          type="password"
          value={anthropicKey}
          onChange={(e) => updateAnthropicKey(e.target.value)}
          placeholder="sk-ant-..."
        />
        <p className={styles.help}>Cleared when browser session ends. Dig beta access key is preloaded.</p>

        <label className={styles.label} htmlFor="llm-q">Question</label>
        <textarea
          id="llm-q"
          className={styles.textarea}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />

        <div className={styles.row}>
          <button
            className={styles.btn}
            disabled={loading || !anthropicKey.trim() || !question.trim()}
            onClick={ask}
            type="button"
          >
            {loading ? "Asking..." : "Ask"}
          </button>
          <button
            className={styles.clear}
            type="button"
            onClick={() => updateAnthropicKey("")}
            disabled={loading || !anthropicKey}
          >
            Clear key
          </button>
        </div>

        {result && (
          <div className={styles.resultBox}>
            {result.ok ? (
              <>
                <p className={styles.answer}>{result.data.answer}</p>

                {result.data.citations.length > 0 && (
                  <div className={styles.citations}>
                    <p className={styles.citationsLabel}>Sources</p>
                    {result.data.citations.map((c) => {
                      const path = ENTITY_PATHS[c.type] ?? c.type;
                      return (
                        <Link
                          key={`${c.type}-${c.discogs_id}`}
                          href={`/${path}/${c.discogs_id}`}
                          className={styles.citation}
                        >
                          {c.title_or_name}
                          <span className={styles.citationType}>{c.type}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}

                <p className={styles.metaLine}>
                  {result.data.meta.model && <span>{result.data.meta.model}</span>}
                  {result.data.meta.elapsed_ms && <span>{result.data.meta.elapsed_ms}ms</span>}
                  {typeof result.data.confidence === "number" && (
                    <span>confidence {Math.round(result.data.confidence * 100)}%</span>
                  )}
                </p>

                <button
                  className={styles.rawToggle}
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                >
                  {showRaw ? "Hide raw" : "Show raw JSON"}
                </button>
                {showRaw && (
                  <pre className={styles.raw}>{JSON.stringify(result.data, null, 2)}</pre>
                )}
              </>
            ) : (
              <div className={styles.errorBox}>
                <p className={styles.errorCode}>{result.error.code}</p>
                <p className={styles.errorMsg}>{result.error.message}</p>
                {result.error.details != null && (
                  <pre className={styles.raw}>{JSON.stringify(result.error.details, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        )}

        <p className={styles.help}>
          Endpoint: <code>{API_URL}/v1/ask</code> · Model: claude-sonnet-4-6
        </p>
      </section>
    </div>
  );
}
