import type { Release } from "@/lib/types";
import { artistNames, formatDescriptions } from "@/lib/format";
import styles from "./ReleaseHero.module.css";

interface Props {
  release: Release;
}

export function ReleaseHero({ release }: Props) {
  const format = release.formats[0];

  return (
    <section className={styles.hero}>
      <h1 className={styles.title}>{release.title}</h1>
      <div className={styles.artists}>{artistNames(release.artists)}</div>
      <div className={styles.details}>
        {release.release_year && (
          <span className={styles.detail}>{release.release_year}</span>
        )}
        {release.country && (
          <span className={styles.detail}>{release.country}</span>
        )}
        {format && (
          <span className={styles.detail}>
            {format.name}
            {format.descriptions.length > 0 &&
              ` \u2014 ${formatDescriptions(format.descriptions)}`}
          </span>
        )}
        {release.labels.map((l) => (
          <span key={l.discogs_id} className={styles.detail}>
            {l.name}
            {l.catalog_number && ` [${l.catalog_number}]`}
          </span>
        ))}
      </div>
      {(release.genres.length > 0 || release.styles.length > 0) && (
        <div className={styles.tags}>
          {release.genres.map((g) => (
            <span key={g} className={styles.tag}>
              {g}
            </span>
          ))}
          {release.styles.map((s) => (
            <span key={s} className={styles.tag}>
              {s}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
