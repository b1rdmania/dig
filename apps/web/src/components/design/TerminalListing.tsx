"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./TerminalListing.module.css";

export interface TerminalRow {
  type: "master" | "artist" | "label" | "release";
  href: string;
  title: string | null;
  artist: string | null;
  label: string | null;
  year: number | null;
  country: string | null;
  /** Relevance dots — 0 to 4. */
  confidence?: number | null;
  /** Optional click handler for analytics. */
  onClick?: () => void;
  /** Stable key. */
  id: string | number;
}

interface Props {
  rows: TerminalRow[];
  emptyMessage?: ReactNode;
  /** A short suffix shown next to the row count, e.g. "23 results · 187ms". */
  meta?: string;
}

/**
 * The search-results listing — mimics terminal `ls -la` output. All rows
 * use the same column structure regardless of entity type, with a `type`
 * label as the leftmost column. Confidence is rendered as a faint mono
 * dot pattern (●●●○) on the right.
 */
export function TerminalListing({ rows, emptyMessage, meta }: Props) {
  if (rows.length === 0 && emptyMessage) {
    return <div className={styles.empty}>{emptyMessage}</div>;
  }

  return (
    <div className={styles.listing}>
      {meta && <div className={styles.meta}>{meta}</div>}
      <div className={styles.headerRow}>
        <span className={styles.colType}>type</span>
        <span className={styles.colTitle}>title</span>
        <span className={styles.colArtist}>artist</span>
        <span className={styles.colLabel}>label</span>
        <span className={styles.colYear}>year</span>
        <span className={styles.colCountry}>cc</span>
        <span className={styles.colConfidence}>match</span>
      </div>
      <div className={styles.rule} aria-hidden />
      {rows.map((row) => (
        <Link
          key={`${row.type}-${row.id}`}
          href={row.href}
          className={styles.row}
          onClick={row.onClick}
          prefetch={false}
        >
          <span className={`${styles.colType} ${styles[`type-${row.type}`]}`}>{row.type}</span>
          <span className={styles.colTitle}>{row.title ?? <span className={styles.dim}>—</span>}</span>
          <span className={styles.colArtist}>
            {row.artist ?? <span className={styles.dim}>—</span>}
          </span>
          <span className={styles.colLabel}>
            {row.label ?? <span className={styles.dim}>—</span>}
          </span>
          <span className={styles.colYear}>
            {row.year ?? <span className={styles.dim}>—</span>}
          </span>
          <span className={styles.colCountry}>
            {row.country ?? <span className={styles.dim}>—</span>}
          </span>
          <span className={styles.colConfidence}>
            <ConfidenceDots value={row.confidence ?? null} />
          </span>
        </Link>
      ))}
    </div>
  );
}

function ConfidenceDots({ value }: { value: number | null }) {
  // Map 0..1 (or relevance score >1) into a 0..4 dot scale by clamping.
  let buckets = 0;
  if (value != null) {
    if (value >= 0.95) buckets = 4;
    else if (value >= 0.7) buckets = 3;
    else if (value >= 0.4) buckets = 2;
    else if (value >= 0.15) buckets = 1;
    else buckets = 0;
  }
  return (
    <span aria-label={value != null ? `match confidence ${(value * 100).toFixed(0)}%` : "match confidence unknown"}>
      <span className={styles.dotActive}>{"●".repeat(buckets)}</span>
      <span className={styles.dotInactive}>{"○".repeat(Math.max(0, 4 - buckets))}</span>
    </span>
  );
}
