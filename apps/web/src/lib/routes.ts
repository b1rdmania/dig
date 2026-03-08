/**
 * Centralized route helpers for entity link construction.
 *
 * Rule: master/canonical → /release/:id
 *       release/pressing → /version/:id
 *
 * Never build release/version hrefs inline — always use these helpers.
 */

import type { TraversalLink, SearchResult, ArtistCreditLink } from "@/lib/types";

/** Canonical master/album page. */
export function hrefForMasterId(id: number | string): string {
  return `/release/${id}`;
}

/** Specific pressing/version page. */
export function hrefForReleaseId(id: number | string): string {
  return `/version/${id}`;
}

/**
 * Href for a TraversalLink — dispatches on link.type.
 * master → /release/:id
 * release → /version/:id
 * artist/label → their own routes
 */
export function hrefForTraversalLink(link: TraversalLink): string {
  switch (link.type) {
    case "master":
      return `/release/${link.discogs_id}`;
    case "release":
      return `/version/${link.discogs_id}`;
    case "artist":
      return `/artist/${link.discogs_id}`;
    case "label":
      return `/label/${link.discogs_id}`;
  }
}

/**
 * Href for an ArtistCreditLink — credits always reference pressing IDs
 * from catalog.release_credits, so they always go to /version/.
 */
export function hrefForArtistCredit(credit: ArtistCreditLink): string {
  return `/version/${credit.release_discogs_id}`;
}

/**
 * Href for a SearchResult — mirrors ResultCard logic, centralised here.
 * release with master_discogs_id → canonical master page
 * release without master_discogs_id → version page
 * master → /release/:id
 * artist/label → their own routes
 */
export function hrefForSearchResult(result: SearchResult): string | null {
  if (result.type === "release") {
    if (result.master_discogs_id) return `/release/${result.master_discogs_id}`;
    return `/version/${result.discogs_id}`;
  }
  if (result.type === "master") return `/release/${result.discogs_id}`;
  if (result.type === "artist") return `/artist/${result.discogs_id}`;
  if (result.type === "label") return `/label/${result.discogs_id}`;
  return null;
}
