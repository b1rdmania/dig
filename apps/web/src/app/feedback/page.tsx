"use client";

import type { Metadata } from "next";
import { useState } from "react";
import styles from "./page.module.css";

// ─── Google Forms config ───────────────────────────────────────────────────
// 1. Create a Google Form with fields: Type, Description, Email
// 2. Get the form action URL from "Get pre-filled link" → replace /viewform with /formResponse
// 3. Replace the entry IDs below with your actual field entry IDs
const GOOGLE_FORM_ACTION = "https://docs.google.com/forms/d/e/TODO_REPLACE_FORM_ID/formResponse";
const FIELD_TYPE = "entry.TODO_TYPE";
const FIELD_DESCRIPTION = "entry.TODO_DESCRIPTION";
const FIELD_EMAIL = "entry.TODO_EMAIL";
// ──────────────────────────────────────────────────────────────────────────

type FormState = "idle" | "submitting" | "success" | "error";

export default function FeedbackPage() {
  const [type, setType] = useState("bug");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;

    setState("submitting");

    const body = new FormData();
    body.append(FIELD_TYPE, type);
    body.append(FIELD_DESCRIPTION, description.trim());
    if (email.trim()) body.append(FIELD_EMAIL, email.trim());

    try {
      // no-cors: Google Forms doesn't allow cross-origin reads, but the POST goes through.
      await fetch(GOOGLE_FORM_ACTION, { method: "POST", body, mode: "no-cors" });
      setState("success");
    } catch {
      setState("error");
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.eyebrow}>Beta feedback</div>
        <h1 className={styles.title}>Found something? <em>Tell us.</em></h1>
        <p className={styles.lede}>
          Dig is an early beta. The data is real but the product is rough around the edges —
          bugs, missing features, weird results. All feedback is read and appreciated.
        </p>
      </div>

      {state === "success" ? (
        <div className={styles.success}>
          <div className={styles.successTitle}>Thanks — got it.</div>
          <p className={styles.successNote}>
            Feedback received. No reply unless you left an email, but everything is read.
          </p>
          <button className={styles.resetBtn} onClick={() => { setState("idle"); setDescription(""); setEmail(""); }}>
            Send another
          </button>
        </div>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="type">Type</label>
            <select
              id="type"
              className={styles.select}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="bug">Bug</option>
              <option value="suggestion">Suggestion</option>
              <option value="wrong-result">Wrong result</option>
              <option value="missing-data">Missing data</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="description">
              What happened?
            </label>
            <textarea
              id="description"
              className={styles.textarea}
              placeholder="Describe the bug or suggestion. Include a search query or URL if relevant."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Email <span className={styles.optional}>(optional)</span>
            </label>
            <input
              id="email"
              type="email"
              className={styles.input}
              placeholder="only if you want a reply"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {state === "error" && (
            <div className={styles.errorNote}>
              Something went wrong — try again or email directly via{" "}
              <a href="https://x.com/b1rdmania" target="_blank" rel="noreferrer">@b1rdmania</a>.
            </div>
          )}

          <button
            type="submit"
            className={styles.submit}
            disabled={state === "submitting" || !description.trim()}
          >
            {state === "submitting" ? "Sending…" : "Send feedback"}
          </button>
        </form>
      )}
    </div>
  );
}
