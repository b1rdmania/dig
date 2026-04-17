import styles from "./Rule.module.css";

interface Props {
  variant?: "default" | "bold" | "accent";
  /** Top + bottom margin; default 0 (caller controls spacing). */
  spacing?: "none" | "sm" | "md" | "lg";
}

/**
 * A horizontal hairline. Three weights only:
 *   default — 1px, var(--rule). Standard divider.
 *   bold    — 1px, var(--rule-bold). Stamped emphasis under section heads.
 *   accent  — 2px, var(--label-accent). Used once at the top of a label page.
 */
export function Rule({ variant = "default", spacing = "none" }: Props) {
  return (
    <hr className={`${styles.rule} ${styles[variant]} ${styles[`spacing-${spacing}`]}`} />
  );
}
