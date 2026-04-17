import type { ReactNode } from "react";
import styles from "./LinerNotes.module.css";

interface Props {
  children: ReactNode;
  /** Optional eyebrow above the block — defaults to "LINER NOTES". */
  eyebrow?: string | null;
}

interface SectionProps {
  label: string;
  children: ReactNode;
}

/**
 * A bordered block styled to look like the back-cover credits panel of an
 * LP. Inside: tighter type, mono headings (PROFILE, ALSO KNOWN AS, URLS),
 * sans body for facts, serif for the editorial blurb.
 *
 * Compose via <LinerNotes.Section label="PROFILE">…</LinerNotes.Section>.
 */
export function LinerNotes({ children, eyebrow = "LINER NOTES" }: Props) {
  return (
    <div className={styles.notes}>
      {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
      {children}
    </div>
  );
}

LinerNotes.Section = function Section({ label, children }: SectionProps) {
  return (
    <section className={styles.section}>
      <h4 className={styles.label}>{label}</h4>
      <div className={styles.body}>{children}</div>
    </section>
  );
};
