import type { ReactNode } from "react";
import styles from "./Stamp.module.css";

interface Props {
  children: ReactNode;
  title?: string;
}

/**
 * Inline metadata tag — `MAIN`, `TIER 1`, `LP`. Small all-caps text for
 * inline cues that don't deserve a full sticker.
 */
export function Stamp({ children, title }: Props) {
  return (
    <span className={styles.stamp} title={title}>
      <span className={styles.body}>{children}</span>
    </span>
  );
}
