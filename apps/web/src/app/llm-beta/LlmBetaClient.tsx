"use client";

import { useState } from "react";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";

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
  const [apiKey, setApiKey] = useState("");
  const [question, setQuestion] = useState("What are key releases by Aphex Twin?");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string>("Waiting for input…");

  async function ask() {
    const q = question.trim();
    if (!q || !apiKey.trim()) return;

    setLoading(true);
    setOutput("Loading...");

    try {
      const res = await fetch(`${API_URL}/v1/ask`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey.trim(),
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
          Private key-gated tester for <code>/v1/ask</code>. Key stays in local state only and is sent as
          <code> X-API-Key</code> header.
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
              <label className={styles.label} htmlFor="llm-key">Private Beta Key</label>
              <input
                id="llm-key"
                className={styles.input}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="paste X-API-Key value"
              />

              <label className={styles.label} htmlFor="llm-q">Question</label>
              <textarea
                id="llm-q"
                className={styles.textarea}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />

              <div className={styles.row}>
                <button className={styles.btn} disabled={loading || !apiKey.trim() || !question.trim()} onClick={ask} type="button">
                  {loading ? "Asking..." : "Ask"}
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
