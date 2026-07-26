"use client";

import Link from "next/link";
import { LabelStrip, type StripDensity, type StripPalette, type StripRelease } from "./LabelStrip";
import styles from "./CatalogWall.module.css";

export interface WallSceneLabel {
  discogs_id: number;
  name: string;
  role: "core" | "adjacent" | "bridge";
  rank: number;
  palette: StripPalette | null;
  founded_year: number | null;
  closed_year: number | null;
  is_active: boolean;
  location: string | null;
  total_masters: number;
  releases: StripRelease[];
}

export interface WallScene {
  slug: string;
  name: string;
  city: string | null;
  era_start: number | null;
  era_end: number | null;
  axis: string;
  blurb: string | null;
  palette: StripPalette | null;
  labels: WallSceneLabel[];
}

export interface CatalogWallProps {
  scenes: WallScene[];
  density?: StripDensity;
  /** Show the document-style title block in the top-right */
  showTitleBlock?: boolean;
  showSceneHeaders?: boolean;
  /** Optional title block content overrides */
  titleBlock?: {
    title?: string;
    subtitle?: string;
    edition?: string;
    note?: string;
  };
}

const AXIS_LABEL: Record<string, string> = {
  geography: "scene",
  cluster: "cluster",
  sound: "sound",
  era: "era",
  bridge: "bridge",
  micro: "micro",
};

function formatEra(start: number | null, end: number | null): string | null {
  if (start == null && end == null) return null;
  if (start != null && end != null) return `${start}–${end}`;
  if (start != null) return `${start}–`;
  if (end != null) return `?–${end}`;
  return null;
}

/**
 * The catalog wall — many vertical LabelStrips clustered horizontally
 * by scene. Each cluster opens with a scene header (city, era, axis tag,
 * label count) and is followed by its strips arranged in rank order.
 *
 * On desktop: scene clusters flow horizontally; strips within a scene
 * sit side-by-side. On mobile: scenes stack vertically; strips inside
 * each scene scroll horizontally with snap.
 *
 * The title block (top-right) renders the document framing without
 * copying any external schematic — title, subtitle, edition, and a
 * one-line note. Disable with showTitleBlock={false} for pages that
 * embed the wall in a different chrome.
 */
export function CatalogWall({
  scenes,
  density = "compact",
  showTitleBlock = true,
  showSceneHeaders = true,
  titleBlock,
}: CatalogWallProps) {
  const totalLabels = scenes.reduce((acc, s) => acc + s.labels.length, 0);
  const totalReleases = scenes.reduce(
    (acc, s) => acc + s.labels.reduce((aa, l) => aa + l.total_masters, 0),
    0,
  );

  const tb = {
    title: titleBlock?.title ?? "DIG · CATALOG WALL",
    subtitle: titleBlock?.subtitle ?? "House and techno · 1988–2008",
    edition: titleBlock?.edition ?? `Edition v0.1 · ${new Date().getFullYear()}`,
    note: titleBlock?.note ?? `${scenes.length} scenes · ${totalLabels} labels · ${totalReleases.toLocaleString()} masters`,
  };

  return (
    <div className={styles.wallContainer}>
      {showTitleBlock && (
        <aside className={styles.titleBlock} aria-label="Catalog wall edition info">
          <div className={styles.titleBlockTitle}>{tb.title}</div>
          <div className={styles.titleBlockSubtitle}>{tb.subtitle}</div>
          <div className={styles.titleBlockMeta}>
            <span>{tb.edition}</span>
            <span>{tb.note}</span>
          </div>
        </aside>
      )}

      <div className={styles.wall}>
        {scenes.map((scene) => {
          const accent = scene.palette?.accent ?? "#1a1a1a";
          const sceneStyle = {
            "--scene-accent": accent,
          } as React.CSSProperties;
          const era = formatEra(scene.era_start, scene.era_end);

          return (
            <section
              key={scene.slug}
              className={styles.scene}
              style={sceneStyle}
              aria-label={scene.name}
            >
              {showSceneHeaders && (
              <header className={styles.sceneHeader}>
                <Link href={`/scene/${scene.slug}`} className={styles.sceneHeading}>
                  <span className={styles.sceneAxis}>{AXIS_LABEL[scene.axis] ?? scene.axis}</span>
                  <span className={styles.sceneName}>{scene.name}</span>
                </Link>
                <div className={styles.sceneMeta}>
                  {scene.city && <span className={styles.sceneCity}>{scene.city}</span>}
                  {scene.city && era && <span className={styles.metaSep}>·</span>}
                  {era && <span className={styles.sceneEra}>{era}</span>}
                  <span className={styles.metaSep}>·</span>
                  <span className={styles.sceneCount}>{scene.labels.length} labels</span>
                </div>
              </header>
              )}

              <div className={styles.strips}>
                {scene.labels.length === 0 ? (
                  <div className={styles.sceneEmpty}>No labels in this scene yet.</div>
                ) : (
                  scene.labels.map((l) => (
                    <LabelStrip
                      key={`${scene.slug}-${l.discogs_id}`}
                      discogsId={l.discogs_id}
                      name={l.name}
                      city={l.location}
                      founded_year={l.founded_year}
                      closed_year={l.closed_year}
                      is_active={l.is_active}
                      palette={l.palette}
                      releases={l.releases}
                      total={l.total_masters}
                      density={density}
                      role={l.role}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
