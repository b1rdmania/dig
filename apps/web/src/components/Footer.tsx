import Link from "next/link";
import { Wordmark } from "@/components/design";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <Wordmark size="sm" />
            <span className={styles.tagline}>Maintenance mode, but still worth landing on.</span>
          </div>
          <nav className={styles.links} aria-label="Footer">
            <Link href="/" prefetch={false} className={styles.link}>Home</Link>
            <Link href="/search" prefetch={false} className={styles.link}>Search preview</Link>
            <Link href="/progress" prefetch={false} className={styles.link}>How We Built It</Link>
            <a
              href="https://github.com/b1rdmania/dig"
              target="_blank"
              rel="noreferrer"
              className={styles.link}
            >
              GitHub
            </a>
            <a
              href="https://github.com/b1rdmania/dig/issues"
              target="_blank"
              rel="noreferrer"
              className={styles.link}
            >
              Report an issue
            </a>
          </nav>
        </div>
        <div className={styles.attribution}>
          Catalog data from <a href="https://www.discogs.com/data/" target="_blank" rel="noreferrer">Discogs</a> (CC0).
          Cover art from <a href="https://coverartarchive.org/" target="_blank" rel="noreferrer">Cover Art Archive</a>.
          Crosswalk data from <a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">MusicBrainz</a> (CC0).
          Editorial classifications by dig — independent, opinionated, fixable.
        </div>
      </div>
    </footer>
  );
}
