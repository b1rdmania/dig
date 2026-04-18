import Link from "next/link";
import { Sticker } from "./Sticker";
import type { SearchTopMatch } from "@/lib/types";
import styles from "./TopMatchCard.module.css";

interface Props {
  match: SearchTopMatch;
  /** Optional click handler for analytics (e.g. trackTopMatchClicked). */
  onClick?: () => void;
}

/**
 * Pinned card shown above the search listing when the query is an exact
 * (case-insensitive trim) name match for a label or artist. The whole
 * surface is a Link so a single tap navigates to the entity page.
 *
 * Tier-1 labels render with the editorial palette as background — the
 * card looks "right" for that label (R&S yellow, Tresor cobalt, etc.).
 * Non-tier-1 labels and all artists render in standard ink-on-paper.
 */
export function TopMatchCard({ match, onClick }: Props) {
  const href = match.type === "label" ? `/label/${match.discogs_id}` : `/artist/${match.discogs_id}`;
  const isTinted = match.type === "label" && !!match.palette;

  const cardStyle =
    isTinted && match.palette
      ? ({
          ["--label-accent" as string]: match.palette.accent,
          ["--label-accent-ink" as string]: match.palette.accent_ink,
        } as React.CSSProperties)
      : undefined;

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`${styles.card} ${isTinted ? styles.cardWithPalette : ""}`}
      style={cardStyle}
      aria-label={`Open ${match.type} page for ${match.name}`}
    >
      <div className={styles.eyebrow}>
        <span>{match.type === "label" ? "EXACT MATCH · LABEL" : "EXACT MATCH · ARTIST"}</span>
        <span className={styles.eyebrowSep}>·</span>
        <span>#{match.discogs_id}</span>
      </div>
      <h2 className={styles.title}>
        <span>{match.name}</span>
        {match.tier === "tier1" && (
          <Sticker tone="ink" size="sm" title="Canonical scene label">
            Tier 1
          </Sticker>
        )}
      </h2>
      {match.blurb && <p className={styles.blurb}>“{match.blurb}”</p>}
      <span className={styles.cta}>
        <span className={styles.arrow}>→</span>
        <span>{match.type === "label" ? "Open label page" : "Open artist page"}</span>
      </span>
    </Link>
  );
}
