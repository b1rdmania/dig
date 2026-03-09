import Link from "next/link";
import styles from "./live.module.css";

export const metadata = {
  title: "Design Lab Live — dig",
};

export default function DesignLabLiveHome() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>Design Lab / Live Data</p>
        <h1 className={styles.title}>Variant 3 structure + Variant 5 palette</h1>
        <p className={styles.sub}>Test pages with real Dig API data. Production pages unchanged.</p>
        <div className={styles.links}>
          <Link className={styles.pill} href="/design-lab/live/search?q=kasra%20v">Search</Link>
          <Link className={styles.pill} href="/design-lab/live/artist/4506398">Artist (Kasra V)</Link>
          <Link className={styles.pill} href="/design-lab/live/release/16218">Release sample</Link>
        </div>
      </section>
    </main>
  );
}
