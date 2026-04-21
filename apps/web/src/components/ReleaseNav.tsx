import Link from "next/link";
import { digFetch } from "@/lib/api";
import { isTraversalResponse, type TraversalResponse } from "@/lib/types";
import styles from "./ReleaseNav.module.css";

interface Props {
  artistId: number;
  currentMasterId: number | null;
}

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

/** Async version — fetches its own data. Use only when a nested Suspense is acceptable. */
export async function ReleaseNav({ artistId, currentMasterId }: Props) {
  if (!currentMasterId) return null;

  const fallback: TraversalResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "artist", source_discogs_id: artistId, link_type: "masters", elapsed_ms: 0 },
  };

  const data = await digFetch<TraversalResponse>(
    // Chronological so the prev/next arrows read left=earlier, right=later
    // — matches the timeline mental model on the artist page itself.
    `/v1/artists/${artistId}/masters?sort=oldest&limit=500`,
    { revalidate: 300 },
  )
    .then((d) => (isTraversalResponse(d) ? d : fallback))
    .catch(() => fallback);

  return <ReleaseNavRenderer masters={data.links} currentMasterId={currentMasterId} />;
}
