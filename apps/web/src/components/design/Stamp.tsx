import type { ReactNode } from "react";
import styles from "./Stamp.module.css";

interface Props {
  children: ReactNode;
  title?: string;
}

/**
 * The bracketed inline tag — `[ MAIN ]`, `[ TIER 1 ]`, `[ LP ]`. All-caps
 * mono with literal square brackets that imply a typewritten stamp.
 * Used for inline metadata cues that don't deserve a full sticker.
 */
export function Stamp({ children, title }: Props) {
  return (
    <span className={styles.stamp} title={title}>
      <span className={styles.bracket}>[</span>
      <span className={styles.body}>{children}</span>
      <span className={styles.bracket}>]</span>
    </span>
  );
}
