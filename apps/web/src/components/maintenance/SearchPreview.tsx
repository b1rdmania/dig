import Link from "next/link";
import styles from "./SearchPreview.module.css";

/**
 * Maintenance-window search preview. Rendered at "/search" while
 * MAINTENANCE_MODE is true; the functional search page takes over at relaunch.
 */
export function SearchPreview({ q }: { q: string }) {
  const previewQuery = q || "deepchord";

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.eyebrow}>[ search ] · preview mode</div>
        <h1 className={styles.heading}>Search is still on show.</h1>
        <p className={styles.lede}>
          The live database is paused until <strong>15 June 2026</strong>, but this page
          keeps the front door open and shows the intended search surface.
        </p>
      </header>

      <section className={styles.previewShell}>
        <form action="/search" className={styles.searchForm}>
          <label htmlFor="q" className={styles.searchLabel}>
            Try a query
          </label>
          <div className={styles.searchBar}>
            <span className={styles.searchPrompt} aria-hidden>
              /
            </span>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="moodymann, dance mania, basic channel…"
              className={styles.searchInput}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <button type="submit" className={styles.searchButton}>
              Preview
            </button>
          </div>
        </form>

        <div className={styles.previewCard}>
          <div className={styles.previewLabel}>Queued query</div>
          <div className={styles.previewQuery}>{previewQuery}</div>
          <p className={styles.previewText}>
            Live entity results are paused while the data layer sleeps. When the catalog
            comes back, this search will route into artists, labels, masters, and selected
            releases again.
          </p>
        </div>
      </section>

      <div className={styles.tagRow}>
        {["Chicago house", "Detroit techno", "deepchord", "Maurizio", "Strictly Rhythm"].map((tag) => (
          <Link key={tag} href={`/search?q=${encodeURIComponent(tag)}`} className={styles.tag}>
            {tag}
          </Link>
        ))}
      </div>

      <section className={styles.infoGrid}>
        <article className={styles.infoCard}>
          <div className={styles.infoLabel}>[ surface ]</div>
          <h2 className={styles.infoTitle}>Artists, labels, masters.</h2>
          <p className={styles.infoText}>
            The relaunch stays master-first and scene-aware, with less clutter and a more
            focused 90s-to-00s house and techno lens.
          </p>
        </article>
        <article className={styles.infoCard}>
          <div className={styles.infoLabel}>[ status ]</div>
          <h2 className={styles.infoTitle}>API asleep, interface awake.</h2>
          <p className={styles.infoText}>
            This preview mode keeps the product legible for visitors instead of dropping
            them into a dead end while infra costs stay low.
          </p>
        </article>
        <article className={styles.infoCard}>
          <div className={styles.infoLabel}>[ context ]</div>
          <h2 className={styles.infoTitle}>Want the technical story?</h2>
          <p className={styles.infoText}>
            The build log, benchmarks, and implementation notes are still public while the
            catalog is paused.
          </p>
          <Link href="/progress" className={styles.inlineLink}>
            Open How We Built It
          </Link>
        </article>
      </section>
    </div>
  );
}
