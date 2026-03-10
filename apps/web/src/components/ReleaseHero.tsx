import Link from "next/link";
import type { Release, MarketSnapshot } from "@/lib/types";
import { formatDescriptions, discogsUrl } from "@/lib/format";
import { firstYoutubeThumb } from "@/lib/media";
import { BASE_URL } from "@/lib/seo";
import { OutboundLink } from "./OutboundLink";
import { FavoriteButton } from "./FavoriteButton";
import { ShareBar } from "./ShareBar";
import styles from "./ReleaseHero.module.css";

interface Props {
  release: Release;
  coverUrl?: string | null;
  market?: MarketSnapshot | null;
}

export function ReleaseHero({ release, coverUrl, market }: Props) {
  const heroImage = coverUrl || firstYoutubeThumb(release.videos);
  const format = release.formats[0];

  return (
    <section className={styles.hero}>
      <div className={styles.heroContent}>
        <div className={styles.cover}>
          {heroImage ? (
            <img
              src={heroImage}
              alt={`${release.title} ${coverUrl ? "cover art" : "preview"}`}
              className={styles.coverImg}
              loading="eager"
            />
          ) : (
            <div className={styles.coverPlaceholder}>
              <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.vinylIcon}>
                <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
                <circle cx="24" cy="24" r="15" stroke="currentColor" strokeWidth="0.75" opacity="0.2" />
                <circle cx="24" cy="24" r="8" stroke="currentColor" strokeWidth="0.75" opacity="0.2" />
                <circle cx="24" cy="24" r="3" fill="currentColor" opacity="0.3" />
              </svg>
            </div>
          )}
        </div>
        <div className={styles.info}>
      <h1 className={styles.title}>{release.title}</h1>
      <div className={styles.artists}>
        {release.artists.map((artist, index) => (
          <span key={`${artist.discogs_id}-${index}`}>
            <Link href={`/artist/${artist.discogs_id}`} className={styles.artistLink}>
              {artist.name}
            </Link>
            {index < release.artists.length - 1 ? ", " : ""}
          </span>
        ))}
      </div>
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
            {format.descriptions && format.descriptions.length > 0 &&
              ` \u2014 ${formatDescriptions(format.descriptions)}`}
          </span>
        )}
        {release.labels.map((l) => (
          <span key={l.discogs_id} className={styles.detail}>
            <Link href={`/label/${l.discogs_id}`} className={styles.labelLink}>
              {l.name}
            </Link>
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
      <div className={styles.links}>
        {market?.lowest_price != null && market.lowest_price > 0 && (
          <span className={styles.marketPrice}>
            {market.currency} {market.lowest_price.toFixed(2)}
            {market.num_for_sale ? ` · ${market.num_for_sale} for sale` : ""}
          </span>
        )}
        {release.master_discogs_id ? (
          <Link href={`/release/${release.master_discogs_id}`} className={styles.link}>
            View Release Page
          </Link>
        ) : null}
        <OutboundLink
          href={discogsUrl("release", release.discogs_id)}
          entityType="release"
          entityId={release.discogs_id}
          className={styles.link}
        >
          Open on Discogs
        </OutboundLink>
        <FavoriteButton
          entityType="version"
          discogsId={release.discogs_id}
        />
        <ShareBar
          url={`${BASE_URL}/version/${release.discogs_id}`}
          title={release.title}
          entityType="version"
          entityId={release.discogs_id}
        />
      </div>
        </div>
      </div>
    </section>
  );
}
