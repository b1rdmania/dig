import { digFetch } from "@/lib/api";
import { extractProfileRefs } from "@/components/DiscogsProfile";
import type { ArtistResponse, LabelResponse } from "@/lib/types";

/**
 * Resolve the numeric [a123]/[l123] refs in a Discogs profile to names.
 * Capped (10 artists / 5 labels) — same limits the artist page body uses,
 * and the same URLs, so Next's fetch cache dedupes metadata + body lookups
 * within a request. Out-of-scope refs (404) are simply absent from the map.
 */
export async function resolveProfileNames(profile: string | null | undefined): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  if (!profile) return names;
  const refs = extractProfileRefs(profile);
  await Promise.all([
    ...refs.artists.slice(0, 10).map(async (aid) => {
      try {
        const d = await digFetch<ArtistResponse>(`/v1/artists/${aid}`, { revalidate: 3600 });
        const name = (d as { artist?: { name?: string } } | undefined)?.artist?.name;
        if (name) names[`a${aid}`] = name;
      } catch { /* skip */ }
    }),
    ...refs.labels.slice(0, 5).map(async (lid) => {
      try {
        const d = await digFetch<LabelResponse>(`/v1/labels/${lid}`, { revalidate: 3600 });
        const name = (d as { label?: { name?: string } } | undefined)?.label?.name;
        if (name) names[`l${lid}`] = name;
      } catch { /* skip */ }
    }),
  ]);
  return names;
}
