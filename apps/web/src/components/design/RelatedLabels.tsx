import Link from "next/link";
import type { RelatedDirection, RelatedLabel } from "@/lib/types";
import styles from "./RelatedLabels.module.css";

interface Props {
  rows: RelatedLabel[];
  /** Optional cap; defaults to all returned by the API. */
  maxVisible?: number;
}

const DIRECTION_GLYPH: Record<RelatedDirection, string> = {
  deeper: "↘",
  harder: "↑",
  rawer: "←",
  cleaner: "→",
  weirder: "↗",
  poppier: "↟",
  earlier: "«",
  later: "»",
};

const DIRECTION_LABEL: Record<RelatedDirection, string> = {
  deeper: "deeper",
  harder: "harder",
  rawer: "rawer",
  cleaner: "cleaner",
  weirder: "weirder",
  poppier: "poppier",
  earlier: "earlier",
  later: "later",
};

/**
 * Directional "if you like this label, go here" — fixed 8-tag vocabulary.
 * Each card carries a glyph + tag, the destination label, and an optional
 * one-line editorial note explaining the connection.
 */
export function RelatedLabels({ rows, maxVisible }: Props) {
  if (!rows || rows.length === 0) return null;
  const visible = typeof maxVisible === "number" ? rows.slice(0, maxVisible) : rows;

  return (
    <ul className={styles.list} aria-label="Related labels">
      {visible.map((r) => {
        const accent = r.palette?.accent;
        return (
          <li
            key={`${r.to_label_id}-${r.direction}`}
            className={styles.item}
            style={accent ? ({ "--card-accent": accent } as React.CSSProperties) : undefined}
          >
            <Link href={`/label/${r.to_label_id}`} className={styles.link}>
              <div className={styles.tag}>
                <span className={styles.glyph} aria-hidden>
                  {DIRECTION_GLYPH[r.direction]}
                </span>
                <span className={styles.dirLabel}>{DIRECTION_LABEL[r.direction]}</span>
              </div>
              <div className={styles.body}>
                <div className={styles.name}>{r.to_label_name}</div>
                {r.blurb && <p className={styles.blurb}>{r.blurb}</p>}
                <div className={styles.foot}>
                  {r.to_label_master_count > 0 && (
                    <span className={styles.count}>
                      {r.to_label_master_count.toLocaleString()} masters
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
