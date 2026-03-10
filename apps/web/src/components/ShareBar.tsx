"use client";

import { useState, useCallback } from "react";
import { trackShareClicked } from "@/lib/analytics";
import styles from "./ShareBar.module.css";

interface Props {
  url: string;
  title: string;
  entityType?: string;
  entityId?: number;
}

export function ShareBar({ url, title, entityType, entityId }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "success" | "error">("idle");

  const handleCopy = useCallback(async () => {
    try { trackShareClicked(entityType ?? null, entityId ?? null, "copy"); } catch { /* no-op */ }
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  }, [url, entityType, entityId]);

  const handleNativeShare = useCallback(async () => {
    try { trackShareClicked(entityType ?? null, entityId ?? null, "native"); } catch { /* no-op */ }
    try {
      await navigator.share({ url, title });
    } catch {
      // User dismissed or API not available — no-op
    }
  }, [url, title, entityType, entityId]);

  const xHref = `https://x.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`;
  const waHref = `https://api.whatsapp.com/send?text=${encodeURIComponent(`${title} ${url}`)}`;

  const copyLabel =
    copyState === "success" ? "Link copied" :
    copyState === "error" ? "Couldn't copy link" :
    "Copy link";

  const supportsNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className={styles.bar} role="group" aria-label="Share options">
      <button
        type="button"
        className={`${styles.btn}${copyState !== "idle" ? ` ${styles.feedback}` : ""}`}
        onClick={handleCopy}
        aria-label="Copy link to clipboard"
      >
        {copyLabel}
      </button>

      <a
        href={xHref}
        target="_blank"
        rel="noreferrer"
        className={styles.btn}
        aria-label="Share on X (Twitter)"
        onClick={() => { try { trackShareClicked(entityType ?? null, entityId ?? null, "x"); } catch { /* no-op */ } }}
      >
        X
      </a>

      <a
        href={waHref}
        target="_blank"
        rel="noreferrer"
        className={styles.btn}
        aria-label="Share on WhatsApp"
        onClick={() => { try { trackShareClicked(entityType ?? null, entityId ?? null, "whatsapp"); } catch { /* no-op */ } }}
      >
        WhatsApp
      </a>

      {supportsNativeShare && (
        <button
          type="button"
          className={styles.btn}
          onClick={handleNativeShare}
          aria-label="Share via system share sheet"
        >
          Share…
        </button>
      )}
    </div>
  );
}
