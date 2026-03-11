import type { SearchResult, TraversalLink, ReleaseVideo } from "@/lib/types";
import { formatDuration } from "@/lib/format";
import { youtubeThumbUrl } from "@/lib/media";

export function hrefForSearchResult(result: SearchResult): string {
  if (result.type === "artist") return `/design-lab/live-v2/artist/${result.discogs_id}`;
  if (result.type === "label") return `/design-lab/live-v2/label/${result.discogs_id}`;
  if (result.type === "master") return `/design-lab/live-v2/release/${result.discogs_id}`;
  return `/design-lab/live-v2/version/${result.discogs_id}`;
}

export function hrefForTraversalLink(link: TraversalLink): string {
  if (link.type === "artist") return `/design-lab/live-v2/artist/${link.discogs_id}`;
  if (link.type === "label") return `/design-lab/live-v2/label/${link.discogs_id}`;
  if (link.type === "master") return `/design-lab/live-v2/release/${link.discogs_id}`;
  return `/design-lab/live-v2/version/${link.discogs_id}`;
}

export function summarizeResultLine(result: SearchResult): string {
  const bits: string[] = [];
  if (result.type) bits.push(result.type);
  if (result.year) bits.push(String(result.year));
  if (result.country) bits.push(result.country);
  return bits.join(" • ");
}

export function topVideos(videos: ReleaseVideo[] | undefined, limit = 6) {
  if (!videos || videos.length === 0) return [];
  return videos
    .map((v) => {
      const thumb = youtubeThumbUrl(v.url);
      if (!thumb) return null;
      return {
        url: v.url,
        title: v.title || "Untitled video",
        thumb,
        duration: formatDuration(v.duration_seconds),
      };
    })
    .filter((v): v is { url: string; title: string; thumb: string; duration: string } => Boolean(v))
    .slice(0, limit);
}
