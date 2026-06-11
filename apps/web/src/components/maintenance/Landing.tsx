import Link from "next/link";
import styles from "./Landing.module.css";

/**
 * Maintenance-window landing page. Rendered at "/" while MAINTENANCE_MODE
 * is true (src/lib/maintenance.ts); the wall homepage takes over at relaunch.
 */
export function MaintenanceLanding() {
  return (
    <section className={styles.maintenance}>
      <div className={styles.heroGrid}>
        <div className={styles.hero}>
          <div className={styles.eyebrow}>[ dig ] · rebuild transmission</div>
          <div className={styles.kicker}>House and techno, 1988-2008. Smaller, sharper, still opinionated.</div>
          <h1 className={styles.heading}>Database paused, upgrades happening.</h1>
          <p className={styles.lede}>
            Dig is in an intentional rebuild window while the catalog is cut down,
            reshaped, and prepared for a cleaner relaunch.
          </p>
          <div className={styles.actions}>
            <Link href="/search" className={styles.primaryAction}>
              Search preview
            </Link>
            <Link href="/progress" className={styles.secondaryAction}>
              How We Built It
            </Link>
            <a
              href="https://github.com/b1rdmania/dig"
              target="_blank"
              rel="noreferrer"
              className={styles.tertiaryAction}
            >
              GitHub
            </a>
          </div>
        </div>

        <aside className={styles.statusPanel}>
          <div className={styles.panelLabel}>Current state</div>
          <div className={styles.statusRow}>
            <span>Catalog database</span>
            <strong>Paused</strong>
          </div>
          <div className={styles.statusRow}>
            <span>Search page</span>
            <strong>Preview live</strong>
          </div>
          <div className={styles.statusRow}>
            <span>How We Built It</span>
            <strong>Live</strong>
          </div>
          <div className={styles.statusRow}>
            <span>Return window</span>
            <strong>15 June 2026</strong>
          </div>
        </aside>
      </div>

      <div className={styles.programGrid}>
        <article className={styles.programCard}>
          <div className={styles.cardLabel}>[ 01 ]</div>
          <h2 className={styles.cardTitle}>Search still has a front door.</h2>
          <p className={styles.cardText}>
            The live API is asleep, but the search surface stays visible so people can
            understand the product and the shape of the relaunch.
          </p>
          <Link href="/search" className={styles.cardLink}>
            Open search preview
          </Link>
        </article>

        <article className={styles.programCard}>
          <div className={styles.cardLabel}>[ 02 ]</div>
          <h2 className={styles.cardTitle}>How We Built It stays public.</h2>
          <p className={styles.cardText}>
            The build log, benchmarks, and implementation notes remain up for anyone who
            lands here and wants the technical story behind Dig.
          </p>
          <Link href="/progress" className={styles.cardLink}>
            Read the build page
          </Link>
        </article>

        <article className={styles.programCard}>
          <div className={styles.cardLabel}>[ 03 ]</div>
          <h2 className={styles.cardTitle}>Back online on 15 June.</h2>
          <p className={styles.cardText}>
            Until then, artist, label, master, and scene pages stay offline while the data
            layer is paused to keep costs under control during the rebuild.
          </p>
          <a
            href="https://github.com/b1rdmania/dig/issues"
            target="_blank"
            rel="noreferrer"
            className={styles.cardLink}
          >
            Leave a note
          </a>
        </article>
      </div>
    </section>
  );
}
