import type { ReactNode } from "react";
import styles from "./PageHeading.module.css";

interface Props {
  title: string;
  lede?: ReactNode;
  /** Optional row under the lede — nav links, page-level asides. */
  children?: ReactNode;
}

/**
 * The locked top-of-page heading. Every top-level page (home, scenes,
 * beta, FAQ) renders its title through this so the wordmark position,
 * face, and weight never drift between routes. Entity pages (label,
 * artist, master) keep their own identity treatments.
 */
export function PageHeading({ title, lede, children }: Props) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {lede && <p className={styles.lede}>{lede}</p>}
      {children}
    </header>
  );
}
