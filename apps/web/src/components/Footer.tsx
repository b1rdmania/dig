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
            <span className={styles.tagline}>House and techno, 1988–2008.</span>
          </div>
          <nav className={styles.links} aria-label="Footer">
            <Link href="/about" prefetch={false} className={styles.link}>About</Link>
            <Link href="/llm-beta" prefetch={false} className={styles.link}>LLM beta</Link>
            <Link href="/progress" prefetch={false} className={styles.link}>How we built</Link>
            <Link href="/usage" prefetch={false} className={styles.link}>Usage</Link>
            <Link href="/feedback" prefetch={false} className={styles.link}>Report a bug</Link>
            <a
              href="https://github.com/b1rdmania/dig"
              target="_blank"
              rel="noreferrer"
              className={styles.link}
            >
              GitHub
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
