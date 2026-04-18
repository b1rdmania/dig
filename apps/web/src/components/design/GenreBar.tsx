import type { LabelStyleEntry } from "@/lib/types";
import styles from "./GenreBar.module.css";

interface Props {
  styles: LabelStyleEntry[];
  /** Total tagged masters — printed in the footer. */
  totalTagged: number;
  /** Max bar width (in block characters). 24 reads well at our type scale. */
  maxBlocks?: number;
}

const FILLED = "█";
const EMPTY = "░";

/**
 * ASCII-style genre/style breakdown bar for a label page. Each row shows
 * the style name, a mono bar of filled/empty blocks proportional to the
 * style's share of the label's tagged masters, and the share as a
 * percentage. Designed to look like a printed report rather than a chart.
 *
 * The bar is normalised to the *largest* style on the label rather than
 * to 100% — this gives the eye relative dominance ("techno is 4× ambient
 * here") which is more useful than absolute share for genre-heavy labels.
 * The percentage column still shows the absolute share for precision.
 */
export function GenreBar({ styles: data, totalTagged, maxBlocks = 24 }: Props) {
  if (data.length === 0 || totalTagged === 0) {
    return (
      <p className={styles.foot}>No tagged styles yet on this label's in-scope masters.</p>
    );
  }

  const topShare = data[0]?.share ?? 0;
  const denom = topShare > 0 ? topShare : 1;

  return (
    <div className={styles.bar} role="list" aria-label="Style breakdown">
      {data.map((entry) => {
        const filled = Math.max(1, Math.round((entry.share / denom) * maxBlocks));
        const empty = Math.max(0, maxBlocks - filled);
        const pct = Math.round(entry.share * 100);
        return (
          <div className={styles.row} key={entry.style} role="listitem">
            <span className={styles.style} title={`${entry.master_count} masters`}>
              {entry.style}
            </span>
            <span className={styles.barTrack} aria-hidden>
              {FILLED.repeat(filled)}
              <span className={styles.barTrackInactive}>{EMPTY.repeat(empty)}</span>
            </span>
            <span className={styles.share} aria-label={`${pct} percent`}>
              {pct}%
            </span>
          </div>
        );
      })}
      <p className={styles.foot}>
        Across {totalTagged.toLocaleString()} tagged in-scope master{totalTagged === 1 ? "" : "s"}
      </p>
    </div>
  );
}
