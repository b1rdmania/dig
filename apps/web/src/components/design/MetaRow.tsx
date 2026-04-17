import type { ReactNode } from "react";
import styles from "./MetaRow.module.css";

interface Props {
  /**
   * The values rendered between separators. Falsy entries (null, undefined,
   * empty string, false) are filtered out so callers can write them inline
   * without conditionals.
   */
  children: ReactNode;
  separator?: ReactNode;
  className?: string;
}

/**
 * A single mono row of `value · value · value` metadata. Used for years,
 * formats, country codes, durations, counts. Renders compact at all
 * viewports. Wraps cleanly on mobile.
 */
export function MetaRow({ children, separator = "·", className }: Props) {
  // Filter out falsy children so consumers can write `{year && <span>{year}</span>}`
  // without ending up with double-separators.
  const items = (Array.isArray(children) ? children : [children]).filter((c) => {
    if (c === null || c === undefined || c === false || c === "") return false;
    return true;
  });
  return (
    <div className={`${styles.row}${className ? ` ${className}` : ""}`}>
      {items.map((item, idx) => (
        <span key={idx} className={styles.cell}>
          {idx > 0 && <span className={styles.sep} aria-hidden>{separator}</span>}
          <span>{item}</span>
        </span>
      ))}
    </div>
  );
}
