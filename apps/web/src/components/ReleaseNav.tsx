import Link from "next/link";
import styles from "./ReleaseNav.module.css";

type NavLink = { discogs_id: number; year?: number | null; title?: string | null };

/** Sync renderer — accepts pre-fetched masters array. Use with parallel data fetching. */
export function ReleaseNavRenderer({
  masters,
  currentMasterId,
}: {
  masters: NavLink[];
  currentMasterId: number | null;
}) {
  if (!currentMasterId || masters.length <= 1) return null;
  const idx = masters.findIndex((m) => m.discogs_id === currentMasterId);
  if (idx === -1) return null;
  const prev = idx > 0 ? masters[idx - 1] : null;
  const next = idx < masters.length - 1 ? masters[idx + 1] : null;

  return (
    <nav className={styles.nav} aria-label="Artist catalogue navigation">
      {prev ? (
        <Link href={`/master/${prev.discogs_id}`} className={styles.btn} prefetch={false}>
          ← {prev.year ?? prev.title ?? prev.discogs_id}
        </Link>
      ) : (
        <span className={styles.btnOff}>←</span>
      )}
      <span className={styles.counter}>{idx + 1} / {masters.length}</span>
      {next ? (
        <Link href={`/master/${next.discogs_id}`} className={styles.btn} prefetch={false}>
          {next.year ?? next.title ?? next.discogs_id} →
        </Link>
      ) : (
        <span className={styles.btnOff}>→</span>
      )}
    </nav>
  );
}

