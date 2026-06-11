/**
 * Centralized route helpers for entity link construction.
 *
 * Scene-scoped catalog: master is the canonical entity. Per-pressing release
 * pages are no longer served — release IDs resolve to their master via
 * /v1/release_shadow/:id and 301 to /master/:master_id.
 *
 * Routing rules:
 *   master                          → /master/:id
 *   release with master_discogs_id  → /master/:master_id
 *   release without master id       → /master/:release_id (server will look
 *                                      up the shadow and 301 if needed)
 *   artist                          → /artist/:id
 *   label                           → /label/:id
 *
 * Never build entity hrefs inline — always use these helpers.
 */

import type { TraversalLink, SearchResult, ArtistCreditLink } from "@/lib/types";

/** Canonical master / album page. */
export function hrefForMasterId(id: number | string): string {
  return `/master/${id}`;
}

/**
 * Helper for a specific pressing/release ID.
 * The /version route is gone — we route through the master page. If the
 * caller has a master_discogs_id they should use it directly; otherwise we
 * still link to /master/:release_id and let the server-side redirect handle
 * the lookup via release_shadow.
 */
export function hrefForReleaseId(id: number | string, masterDiscogsId?: number | string | null): string {
  if (masterDiscogsId != null) return `/master/${masterDiscogsId}`;
  return `/master/${id}`;
}

/**
 * Href for a TraversalLink — dispatches on link.type.
 * master    → /master/:id
 * release   → /master/:master_id (preferred) or /master/:release_id (fallback redirect)
 * artist    → /artist/:id
 * label     → /label/:id
 */
export function hrefForTraversalLink(link: TraversalLink): string {
  switch (link.type) {
    case "master":
      return `/master/${link.discogs_id}`;
    case "release":
      return link.master_discogs_id
        ? `/master/${link.master_discogs_id}`
        : `/master/${link.discogs_id}`;
    case "artist":
      return `/artist/${link.discogs_id}`;
    case "label":
      return `/label/${link.discogs_id}`;
  }
}

/**
 * Href for an ArtistCreditLink. Per-release credits are no longer served in
 * the scene-scoped catalog, so we route the user to the resolver path which
 * will 301 → /master/:master_id if the release is in scope.
 */
export function hrefForArtistCredit(credit: ArtistCreditLink): string {
  return `/master/${credit.release_discogs_id}`;
}

/**
 * Href for a SearchResult — mirrors ResultCard logic, centralised here.
 * master → /master/:id; artist/label → their own routes.
 */
export function hrefForSearchResult(result: SearchResult): string | null {
  if (result.type === "master") return `/master/${result.discogs_id}`;
  if (result.type === "artist") return `/artist/${result.discogs_id}`;
  if (result.type === "label") return `/label/${result.discogs_id}`;
  return null;
}
