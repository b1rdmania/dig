"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";
const KEY_STORAGE = "dig.llm_beta.anthropic_key";

type AskResponse = {
  answer: string;
  confidence: number;
  citations: Array<{ type: string; discogs_id: number; title_or_name: string }>;
  meta: Record<string, unknown>;
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details: unknown;
  };
};

export function LlmBetaClient() {
  const [open, setOpen] = useState(true);
  const [betaKey, setBetaKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [question, setQuestion] = useState("What are key releases by Aphex Twin?");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string>("Waiting for input...");

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(KEY_STORAGE);
      if (saved) setAnthropicKey(saved);
    } catch {
      // no-op if sessionStorage is unavailable
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
      // no-op if sessionStorage is unavailable
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || !anthropicKey.trim()) return;

    setLoading(true);
    setOutput("Loading...");

    try {
      const res = await fetch(`${API_URL}/v1/ask`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": betaKey.trim(),
          "x-anthropic-api-key": anthropicKey.trim(),
        },
        body: JSON.stringify({ question: q }),
      });

      const data = (await res.json()) as AskResponse | ErrorResponse;
      setOutput(JSON.stringify(data, null, 2));
    } catch (err) {
      setOutput(JSON.stringify({
        error: {
          code: "NETWORK_ERROR",
          message: "Request failed",
          details: String(err),
        },
      }, null, 2));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Private Beta</p>
        <h1 className={styles.title}>LLM test harness.</h1>
        <p className={styles.lede}>
          Stripped-back tester for <code>/v1/ask</code>. Your Anthropic key is stored only in this browser session
          and sent per request in <code>x-anthropic-api-key</code>.
        </p>
        <button className={styles.launcher} onClick={() => setOpen(true)} type="button">
          Open tester
        </button>
      </section>

      {open && (
        <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className={styles.modal}>
            <div className={styles.head}>
              <h2 className={styles.headTitle}>Dig LLM Beta Tester</h2>
              <button className={styles.close} type="button" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className={styles.body}>
              <label className={styles.label} htmlFor="anthropic-key">Anthropic API Key (session only)</label>
              <input
                id="anthropic-key"
                className={styles.input}
                type="password"
                value={anthropicKey}
                onChange={(e) => updateAnthropicKey(e.target.value)}
                placeholder="sk-ant-..."
              />
              <p className={styles.help}>Not saved to server or database. Cleared when browser session ends.</p>

              <label className={styles.label} htmlFor="beta-key">Dig Beta Key (optional if enabled)</label>
              <input
                id="beta-key"
                className={styles.input}
                type="password"
                value={betaKey}
                onChange={(e) => setBetaKey(e.target.value)}
                placeholder="dig-beta-..."
              />

              <label className={styles.label} htmlFor="llm-q">Question</label>
              <textarea
                id="llm-q"
                className={styles.textarea}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />

              <div className={styles.row}>
                <button className={styles.btn} disabled={loading || !anthropicKey.trim() || !question.trim()} onClick={ask} type="button">
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

              <pre className={styles.result}>{output}</pre>
              <p className={styles.help}>
                API endpoint: <code>{API_URL}/v1/ask</code>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
