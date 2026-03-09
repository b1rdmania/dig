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
        <h1 className={styles.title}>Variant 3 system + Variant 5 palette</h1>
        <p className={styles.sub}>Full functional templates with live Dig API data. Production routes untouched.</p>
        <div className={styles.links}>
          <Link className={styles.pill} href="/design-lab">Back to design variants</Link>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Template Pages</h2>
        <div className={styles.list}>
          <div className={styles.row}>
            <Link className={styles.mainLink} href="/design-lab/live/search?q=kasra%20v">Search</Link>
            <span className={styles.meta}>Live query page</span>
          </div>
          <div className={styles.row}>
            <Link className={styles.mainLink} href="/design-lab/live/artist/4506398">Artist (Kasra V)</Link>
            <span className={styles.meta}>Releases + credits</span>
          </div>
          <div className={styles.row}>
            <Link className={styles.mainLink} href="/design-lab/live/release/22044">Release (master)</Link>
            <span className={styles.meta}>Tracks + versions + media</span>
          </div>
          <div className={styles.row}>
            <Link className={styles.mainLink} href="/design-lab/live/version/9267745">Version (pressing)</Link>
            <span className={styles.meta}>Pressing details</span>
          </div>
          <div className={styles.row}>
            <Link className={styles.mainLink} href="/design-lab/live/label/1">Label</Link>
            <span className={styles.meta}>Catalog + links</span>
          </div>
        </div>
      </section>
    </main>
  );
}
