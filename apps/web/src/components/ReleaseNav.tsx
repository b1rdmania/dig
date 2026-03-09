import Link from "next/link";
import { digFetch } from "@/lib/api";
import { isTraversalResponse, type TraversalResponse } from "@/lib/types";
import styles from "./ReleaseNav.module.css";

interface Props {
  masterId: number;
  currentReleaseId: number | null;
}

/** Prev/Next navigation through pressings of a master release. Server component. */
export async function ReleaseNav({ masterId, currentReleaseId }: Props) {
  const fallback: TraversalResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "master", source_discogs_id: masterId, link_type: "releases", elapsed_ms: 0 },
  };

  const data = await digFetch<TraversalResponse>(
    `/v1/masters/${masterId}/releases?limit=100`,
    { revalidate: 300 },
  )
    .then((d) => (isTraversalResponse(d) ? d : fallback))
    .catch(() => fallback);

  const versions = data.links;
  if (versions.length <= 1) return null;

  let idx = currentReleaseId
    ? versions.findIndex((v) => v.discogs_id === currentReleaseId)
    : 0;
  if (idx === -1) idx = 0;

  const prev = idx > 0 ? versions[idx - 1] : null;
  const next = idx < versions.length - 1 ? versions[idx + 1] : null;

  return (
    <nav className={styles.nav} aria-label="Version navigation">
      {prev ? (
        <Link href={`/version/${prev.discogs_id}`} className={styles.btn} prefetch={false}>
          ← {prev.year ?? prev.discogs_id}
        </Link>
      ) : (
        <span className={styles.btnOff}>←</span>
      )}
      <span className={styles.counter}>{idx + 1} / {versions.length}</span>
      {next ? (
        <Link href={`/version/${next.discogs_id}`} className={styles.btn} prefetch={false}>
          {next.year ?? next.discogs_id} →
        </Link>
      ) : (
        <span className={styles.btnOff}>→</span>
      )}
    </nav>
  );
}
