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

  return (
    <button
      type="button"
      className={`${styles.btn}${copyState !== "idle" ? ` ${styles.feedback}` : ""}`}
      onClick={handleCopy}
      aria-label="Copy link to clipboard"
    >
      {label}
    </button>
  );
}
