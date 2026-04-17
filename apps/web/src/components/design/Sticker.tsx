import type { ReactNode } from "react";
import styles from "./Sticker.module.css";

export type StickerTone = "label" | "tier1" | "ink" | "ghost";

interface Props {
  children: ReactNode;
  tone?: StickerTone;
  title?: string;
  size?: "sm" | "md";
}

/**
 * The catalog-number sticker. A small inline mono pill, filled with the
 * label accent (or another editorial tone). All-caps, tight letter
 * spacing, slightly rounded corners — the only place rounded corners are
 * permitted in the design system.
 *
 * Tones:
 *   label   — uses var(--label-accent) — for catalog numbers, label badges
 *   tier1   — uses var(--tier1-accent) — for "SCENE CANON" badges
 *   ink     — solid black sticker, paper text — for system tags
 *   ghost   — outline only — for format pills, optional metadata
 */
export function Sticker({ children, tone = "label", title, size = "md" }: Props) {
  return (
    <span
      className={`${styles.sticker} ${styles[tone]} ${styles[`size-${size}`]}`}
      title={title}
    >
      {children}
    </span>
  );
}
