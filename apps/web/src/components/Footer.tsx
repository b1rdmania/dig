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
          </div>
          <nav className={styles.links} aria-label="Footer">
            <Link href="/" prefetch={false} className={styles.link}>Home</Link>
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
          Data from <a href="https://www.discogs.com/data/" target="_blank" rel="noreferrer">Discogs</a> (CC0),{" "}
          <a href="https://coverartarchive.org/" target="_blank" rel="noreferrer">Cover Art Archive</a>, and{" "}
          <a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">MusicBrainz</a>.
        </div>
      </div>
    </footer>
  );
}
