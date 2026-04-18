import Link from "next/link";
import type { SublabelLink } from "@/lib/types";
import styles from "./SublabelTree.module.css";

interface Props {
  /** The current/parent label. Renders as the root node. */
  parent: { discogs_id: number; name: string };
  /** This label's parent (if it's itself a sublabel). Renders above the root. */
  grandParent?: { discogs_id: number; name: string } | null;
  /** Direct children of `parent`. */
  children: SublabelLink[];
  /** Show at most this many children inline, with a "+N more" footer. */
  maxVisible?: number;
}

/**
 * Typewriter-style sublabel/parent tree for the label page. When this
 * label has a parent, it prints above. Children print below as a
 * mono-aligned tree using ├ │ └ glyphs.
 *
 * Renders nothing if there's neither a parent nor any children — caller
 * is responsible for hiding the surrounding section in that case.
 */
export function SublabelTree({ parent, grandParent, children, maxVisible = 12 }: Props) {
  if (!grandParent && children.length === 0) return null;

  const visible = children.slice(0, maxVisible);
  const overflow = children.length - visible.length;

  return (
    <div className={styles.tree} aria-label="Label family tree">
      {grandParent && (
        <div className={styles.parentRow}>
          <span className={styles.glyph}>┌</span>
          <Link href={`/label/${grandParent.discogs_id}`} className={styles.parentLink}>
            {grandParent.name}
          </Link>
        </div>
      )}
      <div className={styles.parentRow}>
        <span className={styles.glyph}>{grandParent ? "└" : "■"}</span>
        <span className={styles.parentLabel}>{parent.name}</span>
      </div>
      {visible.length > 0 && (
        <ul className={styles.children}>
          {visible.map((child, idx) => {
            const isLast = idx === visible.length - 1 && overflow === 0;
            return (
              <li className={styles.child} key={child.discogs_id}>
                <span className={styles.glyph} aria-hidden>
                  {"   "}
                  {isLast ? "└──" : "├──"}
                </span>
                <Link href={`/label/${child.discogs_id}`} className={styles.childLink}>
                  {child.name}
                </Link>
              </li>
            );
          })}
          {overflow > 0 && (
            <li className={styles.child}>
              <span className={styles.glyph} aria-hidden>{"   └── "}</span>
              <span className={styles.empty}>+{overflow} more sublabel{overflow === 1 ? "" : "s"}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
