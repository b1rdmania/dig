import styles from "./Wordmark.module.css";

interface Props {
  size?: "sm" | "md" | "lg";
  /** Append scene stamp after the mark. Defaults to the current catalog scope. */
  stamp?: string | null;
}

/**
 * The dig wordmark — plain lowercase `dig`, always ink-on-paper, never
 * coloured per page.
 *
 * The stamp (e.g. `house & techno 88–08`) tells the user which slice of the
 * catalog they're in. It's intentionally scope-named rather than a release-
 * phase tag (alpha/beta) — future scopes will ship with their own stamps
 * and this is the signal that they've switched.
 */
export function Wordmark({ size = "md", stamp = "house & techno 88–08" }: Props) {
  return (
    <span className={`${styles.mark} ${styles[`size-${size}`]}`}>
      <span className={styles.body}>dig</span>
      {stamp && <span className={styles.stamp}>{stamp}</span>}
    </span>
  );
}
