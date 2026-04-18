import Link from "next/link";
import type { CoreRunMaster } from "@/lib/types";
import styles from "./CoreRun.module.css";

interface Props {
  rows: CoreRunMaster[];
  /** Optional cap; defaults to all (already capped at the API). */
  maxVisible?: number;
}

/**
 * Five-to-ten essential masters for a label, surfaced above the full catalog
 * spine. Curated entries are decorated with a tiny "★ pick" mark; auto entries
 * are unmarked. Skips render entirely if rows are empty so existing label
 * pages without seed data show no placeholder.
 */
export function CoreRun({ rows, maxVisible }: Props) {
  if (!rows || rows.length === 0) return null;
  const visible = typeof maxVisible === "number" ? rows.slice(0, maxVisible) : rows;

  return (
    <ol className={styles.list} aria-label="Core run — essential listening">
      {visible.map((r, idx) => (
        <li key={r.master_discogs_id} className={styles.item}>
          <Link href={`/master/${r.master_discogs_id}`} className={styles.link}>
            <span className={styles.rank}>
              {String(idx + 1).padStart(2, "0")}
            </span>
            <div className={styles.body}>
              <div className={styles.titleRow}>
                <span className={styles.title}>{r.title}</span>
                {r.source === "curated" && (
                  <span className={styles.pick} title="Editor pick">★ pick</span>
                )}
              </div>
              <div className={styles.metaRow}>
                {r.primary_artist_name && (
                  <span className={styles.artist}>{r.primary_artist_name}</span>
                )}
                {r.year && (
                  <>
                    <span className={styles.sep}>·</span>
                    <span className={styles.year}>{r.year}</span>
                  </>
                )}
              </div>
              {r.note && <p className={styles.note}>{r.note}</p>}
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
