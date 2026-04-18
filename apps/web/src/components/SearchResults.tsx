"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { SearchResponse, SearchResult } from "@/lib/types";
import { trackSearchSubmitted, trackSearchResultClicked } from "@/lib/analytics";
import { hrefForSearchResult } from "@/lib/routes";
import {
  TerminalListing,
  TopMatchCard,
  TypeTabs,
  type TerminalRow,
} from "@/components/design";
import styles from "./SearchResults.module.css";

interface Props {
  data: SearchResponse;
}

/**
 * Renders the search page body: pinned top-match card (when the API
 * surfaced an exact label/artist hit), the type-filter tabs (with per-
 * type counts), the terminal-style result listing, and any degraded /
 * collapsed-version footers.
 *
 * The top match is suppressed when the user has selected a non-default
 * type tab — the tab's typed listing already foregrounds that entity
 * type and the pinned card would feel redundant.
 */
export function SearchResults({ data }: Props) {
  const searchParams = useSearchParams();
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

  const activeType = (() => {
    const t = searchParams.get("type");
    if (t === "label" || t === "artist" || t === "master") return t;
    return "all" as const;
  })();

  // Master-first dedupe: collapse releases whose master already appears.
  // Suppress the top-match entity inside the listing — it's already pinned.
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
    const ordered: SearchResult[] = [
      ...masters,
      ...others.filter((r) => r.type === "artist"),
      ...others.filter((r) => r.type === "label"),
      ...dedupedReleases,
    ];

    // Skip the row that exactly matches the pinned top match.
    const tm = data.top_match;
    const filtered = tm
      ? ordered.filter((r) => !(r.type === tm.type && r.discogs_id === tm.discogs_id))
      : ordered;

    const rows: TerminalRow[] = filtered
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
            trackSearchResultClicked(data.meta.query, r.type, r.discogs_id, filtered.indexOf(r)),
        };
      })
      .filter((r): r is TerminalRow => r !== null);

    return { rows, collapsedReleaseCount };
  }, [data]);

  // Show the pinned card only on the default "all" view — typed views
  // already foreground that entity type.
  const showTopMatch = activeType === "all" && !!data.top_match;

  const total =
    data.pagination.total_estimate != null
      ? `~${data.pagination.total_estimate.toLocaleString()} results`
      : `${data.results.length} results`;
  const meta = `${total} · ${data.meta.elapsed_ms}ms`;

  return (
    <div className={styles.list}>
      {showTopMatch && data.top_match && (
        <div className={styles.topMatchWrap}>
          <TopMatchCard match={data.top_match} />
        </div>
      )}

      {data.meta.type_counts && (
        <TypeTabs active={activeType} counts={data.meta.type_counts} />
      )}

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
