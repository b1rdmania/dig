"use client";

import { useEffect, useMemo, useRef } from "react";
import type { SearchResponse, SearchResult } from "@/lib/types";
import { trackSearchSubmitted, trackSearchResultClicked } from "@/lib/analytics";
import { hrefForSearchResult } from "@/lib/routes";
import { TerminalListing, type TerminalRow } from "@/components/design";
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

  // Master-first dedupe: collapse releases whose master already appears.
  const { rows, collapsedReleaseCount } = useMemo(() => {
    const masters = data.results.filter((r) => r.type === "master");
    const releases = data.results.filter((r) => r.type === "release");
    const others = data.results.filter((r) => r.type === "artist" || r.type === "label");

    const masterIds = new Set(masters.map((m) => m.discogs_id));
    const dedupedReleases = releases.filter((r) => {
      if (r.master_discogs_id && masterIds.has(r.master_discogs_id)) return false;
      return true;
    });
    const collapsedReleaseCount = releases.length - dedupedReleases.length;

    // Master-first ordering: masters → artists → labels → orphan releases.
    // Within each bucket the API has already ranked them.
    const ordered: SearchResult[] = [
      ...masters,
      ...others.filter((r) => r.type === "artist"),
      ...others.filter((r) => r.type === "label"),
      ...dedupedReleases,
    ];

    const rows: TerminalRow[] = ordered
      .map((r): TerminalRow | null => {
        const href = hrefForSearchResult(r);
        if (!href) return null;
        return {
          type: r.type,
          href,
          id: `${r.type}-${r.discogs_id}`,
          title:
            r.type === "artist" || r.type === "label"
              ? r.name
              : r.title,
          artist: r.primary_artist ?? null,
          label: r.primary_label ?? null,
          year: r.year,
          country: r.country,
          confidence: r.relevance,
          onClick: () =>
            trackSearchResultClicked(data.meta.query, r.type, r.discogs_id, ordered.indexOf(r)),
        };
      })
      .filter((r): r is TerminalRow => r !== null);

    return { rows, collapsedReleaseCount };
  }, [data]);

  const total =
    data.pagination.total_estimate != null
      ? `~${data.pagination.total_estimate.toLocaleString()} results`
      : `${data.results.length} results`;
  const meta = `${total} · ${data.meta.elapsed_ms}ms`;

  return (
    <div className={styles.list}>
      {data.meta.degraded && (
        <div className={styles.degraded}>
          Results may be incomplete{data.meta.hint ? ` — ${data.meta.hint}` : ""}
        </div>
      )}
      <TerminalListing
        rows={rows}
        meta={meta}
        emptyMessage="No results."
      />
      {collapsedReleaseCount > 0 && (
        <div className={styles.collapsed}>
          + {collapsedReleaseCount} version{collapsedReleaseCount !== 1 ? "s" : ""} collapsed under matching releases
        </div>
      )}
    </div>
  );
}
