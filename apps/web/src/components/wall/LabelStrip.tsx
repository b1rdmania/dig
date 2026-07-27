"use client";

import Link from "next/link";
import styles from "./LabelStrip.module.css";

export type StripDensity = "compact" | "medium" | "full";

export interface StripRelease {
  master_discogs_id: number;
  title: string;
  primary_artist_name: string | null;
  year: number | null;
}

export interface StripPalette {
  accent: string;
  accent_ink: string;
}

export interface LabelStripProps {
  discogsId: number;
  name: string;
  city?: string | null;
  founded_year?: number | null;
  closed_year?: number | null;
  is_active?: boolean;
  palette?: StripPalette | null;
  releases: StripRelease[];
  total: number;
  density?: StripDensity;
  /** Optional badge tag (e.g. "core", "bridge"). Hidden when not provided. */
  role?: "core" | "adjacent" | "bridge" | null;
}

const PALETTE_DEFAULT: StripPalette = { accent: "#1a1a1a", accent_ink: "#f4f1e8" };

function eraString(founded: number | null | undefined, closed: number | null | undefined, isActive: boolean | undefined): string | null {
  if (founded == null && closed == null) return null;
  if (founded != null && closed != null) return `${founded}–${closed}`;
  if (founded != null) return isActive === false ? `${founded}–` : `${founded}—`;
  if (closed != null) return `?–${closed}`;
  return null;
}

/**
 * One label's vertical strip on the catalog wall.
 *
 * The fundamental unit of the wall composition. Renders a fixed-width
 * column with a header pill (label name + accent-coloured underline),
 * meta line (city / era), and a top-down list of releases ordered by year
 * ascending. The strip itself is a Link to /label/[id].
 *
 * Density modes:
 *   compact (~180px wide, ~12 releases) — homepage wall
 *   medium  (~240px wide, ~25 releases) — scene page
 *   full    (~320px wide, all releases)  — label page (future)
 */
export function LabelStrip({
  discogsId,
  name,
  city,
  founded_year,
  closed_year,
  is_active,
  palette,
  releases,
  total,
  density = "compact",
  role,
}: LabelStripProps) {
  const p = palette ?? PALETTE_DEFAULT;
  const era = eraString(founded_year, closed_year, is_active);
  const overflow = Math.max(0, total - releases.length);

  const styleVars = {
  } as React.CSSProperties;

  return (
    <Link
      href={`/label/${discogsId}`}
      className={`${styles.strip} ${styles[density]}`}
      style={styleVars}
      aria-label={`${name} — ${total} releases`}
    >
      <div className={styles.header}>
        <div className={styles.nameRow}>
          <span className={styles.name}>{name}</span>
          {role && role !== "core" && (
            <span className={styles.roleBadge}>{role}</span>
          )}
        </div>
        <div className={styles.accentRule} aria-hidden />
        <div className={styles.metaLine}>
          {city && <span className={styles.metaCity}>{city}</span>}
          {city && era && <span className={styles.metaSep}>·</span>}
          {era && <span className={styles.metaEra}>{era}</span>}
        </div>
      </div>

      {releases.length === 0 ? (
        <div className={styles.empty}>No in-scope releases</div>
      ) : (
        <ol className={styles.releases}>
          {releases.map((r) => (
            <li key={r.master_discogs_id} className={styles.release}>
              <span className={styles.releaseYear}>{r.year ?? "—"}</span>
              <span className={styles.releaseBody}>
                <span className={styles.releaseTitle}>{r.title}</span>
                {r.primary_artist_name && (
                  <span className={styles.releaseArtist}>{r.primary_artist_name}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className={styles.footer}>
        <span className={styles.footerCount}>
          {total} {total === 1 ? "release" : "releases"}
          {overflow > 0 && <span className={styles.footerMore}> · +{overflow} more</span>}
        </span>
      </div>
    </Link>
  );
}
