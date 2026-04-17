import styles from "./Wordmark.module.css";

interface Props {
  size?: "sm" | "md" | "lg";
  /** Append "alpha" / "beta" stamp after the mark. */
  stamp?: string | null;
}

/**
 * The dig wordmark — `[ dig ]`, mono, lowercase, square brackets. Always
 * ink-on-paper, never coloured per page. The brackets read as a stamped
 * label-tag / catalog-number sticker.
 */
export function Wordmark({ size = "md", stamp = "alpha" }: Props) {
  return (
    <span className={`${styles.mark} ${styles[`size-${size}`]}`}>
      <span className={styles.bracket}>[</span>
      <span className={styles.body}>dig</span>
      <span className={styles.bracket}>]</span>
      {stamp && <span className={styles.stamp}>—— {stamp}</span>}
    </span>
  );
}
