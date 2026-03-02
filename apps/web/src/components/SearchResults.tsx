"use client";

import { useEffect, useRef } from "react";
import type { SearchResponse } from "@/lib/types";
import { trackSearchSubmitted, trackSearchResultClicked } from "@/lib/analytics";
import { ResultCard } from "./ResultCard";
import styles from "./SearchResults.module.css";

interface Props {
  data: SearchResponse;
}

export function SearchResults({ data }: Props) {
  const tracked = useRef(false);
  useEffect(() => {
    if (!tracked.current) {
      tracked.current = true;
      trackSearchSubmitted(
        data.meta.query,
        data.results.length,
        data.meta.elapsed_ms,
        data.meta.degraded,
      );
    }
  }, [data]);
  const masters = data.results.filter((r) => r.type === "master");
  const artists = data.results.filter((r) => r.type === "artist");
  const labels = data.results.filter((r) => r.type === "label");
  const releases = data.results.filter((r) => r.type === "release");

  // Master-first dedupe: collapse releases whose master already appears in results.
  // Use exact FK match (master_discogs_id) for reliable dedup.
  const masterIds = new Set(masters.map((m) => m.discogs_id));
  const dedupedReleases = releases.filter((r) => {
    if (r.master_discogs_id && masterIds.has(r.master_discogs_id)) return false;
    return true;
  });
  const collapsedReleaseCount = releases.length - dedupedReleases.length;

  const sections: Array<{ title: string; items: typeof data.results }> = [
    { title: "Artists", items: artists },
    { title: "Releases", items: masters },
    { title: "Versions", items: dedupedReleases },
    { title: "Labels", items: labels },
  ].filter((s) => s.items.length > 0);

  return (
    <div className={styles.list}>
      <div className={styles.meta}>
        {data.pagination.total_estimate != null
          ? `~${data.pagination.total_estimate.toLocaleString()} results`
          : `${data.results.length} results`}
        {" \u00B7 "}
        {data.meta.elapsed_ms}ms
      </div>
      {data.meta.degraded && (
        <div className={styles.degraded}>
          Results may be incomplete{data.meta.hint ? ` \u2014 ${data.meta.hint}` : ""}
        </div>
      )}
      {collapsedReleaseCount > 0 && (
        <div className={styles.collapsed}>
          {collapsedReleaseCount} version{collapsedReleaseCount !== 1 ? "s" : ""} collapsed under matching releases.
        </div>
      )}
      {sections.map((section) => {
        const MAX_PER_SECTION = 5;
        const shown = section.items.slice(0, MAX_PER_SECTION);
        const overflow = section.items.length - shown.length;
        return (
          <section key={section.title} className={styles.section}>
            <h2 className={styles.sectionHeading}>
              {section.title}
              <span className={styles.sectionCount}>{section.items.length}</span>
            </h2>
            {shown.map((r, idx) => (
              <div
                key={`${r.type}-${r.discogs_id}`}
                onClick={() => trackSearchResultClicked(data.meta.query, r.type, r.discogs_id, idx)}
              >
                <ResultCard result={r} />
              </div>
            ))}
            {overflow > 0 && (
              <div className={styles.overflow}>
                +{overflow} more
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
