import Link from "next/link";
import { Sticker } from "./Sticker";
import styles from "./CatalogSpine.module.css";

export interface SpineRow {
  position: number;
  master_discogs_id: number;
  title: string | null;
  artist: string | null;
  year: number | null;
  format: string | null;
  catalog_number: string | null;
  /** Out-of-scope rows render greyed (informational placeholder, not interactive). */
  in_scope?: boolean;
}

interface Props {
  rows: SpineRow[];
  /** Optional empty-state copy when the spine is empty (long-tail label / 0 in-scope masters). */
  emptyMessage?: string;
}

/**
 * The catalog spine — the vertical chronological timeline of a label's
 * releases, rendered as numbered mono-aligned rows. The defining
 * component of the redesign.
 *
 * Decade markers are inserted automatically when the year column rolls
 * over into a new decade (e.g. 1989 → 1990 inserts a thin "1990s" tag in
 * the gutter).
 */
export function CatalogSpine({ rows, emptyMessage = "No in-scope releases for this label." }: Props) {
  if (rows.length === 0) {
    return <div className={styles.empty}>{emptyMessage}</div>;
  }

  let lastDecade: number | null = null;

  return (
    <div className={styles.spine}>
      <div className={styles.headerRow}>
        <span className={styles.colNum} />
        <span className={styles.colYear} />
        <span className={styles.colTitle}>Title</span>
        <span className={styles.colArtist}>Artist</span>
      </div>
      <div className={styles.rule} aria-hidden />
      {rows.map((row) => {
        const decade = row.year != null ? Math.floor(row.year / 10) * 10 : null;
        const decadeMarker = decade !== null && decade !== lastDecade;
        if (decade !== null) lastDecade = decade;

        const positionStr = row.position.toString().padStart(2, "0");
        const inScope = row.in_scope !== false;

        return (
          <div key={`spine-${row.master_discogs_id}-${row.position}`}>
            {decadeMarker && (
              <div className={styles.decadeMarker} aria-hidden>
                <span className={styles.decadeLabel}>{decade}s</span>
                <span className={styles.decadeRule} />
              </div>
            )}
            <div className={`${styles.row} ${inScope ? "" : styles.outOfScope}`}>
              <span className={styles.colNum}>{positionStr}</span>
              <span className={styles.colYear}>{row.year ?? "—"}</span>
              <span className={styles.colTitle}>
                {inScope ? (
                  <Link href={`/master/${row.master_discogs_id}`} className={styles.titleLink}>
                    {row.title ?? "(untitled)"}
                  </Link>
                ) : (
                  <span>{row.title ?? "(untitled)"}</span>
                )}
                {row.catalog_number && (
                  <span className={styles.catalogNumber}>
                    <Sticker tone="label" size="sm">{row.catalog_number}</Sticker>
                  </span>
                )}
              </span>
              <span className={styles.colArtist}>
                {row.artist ?? <span className={styles.dim}>—</span>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
