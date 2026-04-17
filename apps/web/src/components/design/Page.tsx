import type { CSSProperties, ReactNode } from "react";
import styles from "./Page.module.css";

export interface PageAccent {
  /** Label-color identity. Falls back to ink on paper if absent. */
  accent?: string | null;
  /** Readable text colour on top of `accent` (typically near-black or paper-cream). */
  accentInk?: string | null;
}

interface Props extends PageAccent {
  children: ReactNode;
  /** Used by analytics + DOM-level instrumentation. */
  entityType?: "label" | "artist" | "master" | "search" | "static";
  entityId?: string | number;
  className?: string;
}

/**
 * The page container. Wraps a route in the paper backdrop, sets the
 * `--label-accent` / `--label-accent-ink` CSS custom properties from props
 * so all child components automatically pick up the label-color identity
 * without having to pipe colour through prop drilling.
 *
 * Use this on every entity page. Static/marketing pages can omit accents
 * (they get ink-on-paper).
 */
export function Page({
  children,
  accent,
  accentInk,
  entityType,
  entityId,
  className,
}: Props) {
  const style: CSSProperties & Record<string, string> = {};
  if (accent) {
    style["--label-accent"] = accent;
    style["--label-accent-ink"] = accentInk ?? "#f4f1e8";
  }
  return (
    <div
      className={`${styles.page}${className ? ` ${className}` : ""}`}
      style={style}
      data-dig-entity={entityType}
      data-dig-id={entityId}
    >
      {children}
    </div>
  );
}
