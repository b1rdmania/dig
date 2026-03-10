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

export function ShareBar({ url, entityType, entityId }: Props) {
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

  const label =
    copyState === "success" ? "Link copied" :
    copyState === "error" ? "Couldn't copy link" :
    "Copy link";

  const shareUrl = encodeURIComponent(url);
  const xHref = `https://x.com/intent/tweet?url=${shareUrl}`;
  const waHref = `https://wa.me/?text=${shareUrl}`;

  const handleNativeShare = useCallback(async () => {
    if (!navigator.share) return;
    try { trackShareClicked(entityType ?? null, entityId ?? null, "native"); } catch { /* no-op */ }
    try {
      await navigator.share({ url });
    } catch {
      // cancelled/unsupported
    }
  }, [url, entityType, entityId]);

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={`${styles.btn}${copyState !== "idle" ? ` ${styles.feedback}` : ""}`}
        onClick={handleCopy}
        aria-label="Copy link to clipboard"
      >
        {label}
      </button>
      <a
        href={xHref}
        target="_blank"
        rel="noreferrer"
        className={styles.btn}
        onClick={() => {
          try { trackShareClicked(entityType ?? null, entityId ?? null, "x"); } catch { /* no-op */ }
        }}
      >
        X
      </a>
      <a
        href={waHref}
        target="_blank"
        rel="noreferrer"
        className={styles.btn}
        onClick={() => {
          try { trackShareClicked(entityType ?? null, entityId ?? null, "whatsapp"); } catch { /* no-op */ }
        }}
      >
        WhatsApp
      </a>
      {typeof navigator !== "undefined" && "share" in navigator ? (
        <button type="button" className={styles.btn} onClick={handleNativeShare}>
          Share...
        </button>
      ) : null}
    </div>
  );
}
