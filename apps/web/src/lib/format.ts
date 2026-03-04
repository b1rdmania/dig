import type { SearchResult, ReleaseArtist } from "./types";

export function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function displayName(result: SearchResult): string {
  return result.name || result.title || "Untitled";
}

export function artistNames(artists: ReleaseArtist[]): string {
  return artists.map((a) => a.name).join(", ");
}

export function formatDescriptions(descriptions: string[]): string {
  return descriptions.join(", ");
}

export function typeLabel(type: string): string {
  if (type === "master") return "Release";
  if (type === "release") return "Version";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function discogsUrl(type: "artist" | "master" | "release" | "label", discogsId: number): string {
  return `https://www.discogs.com/${type}/${discogsId}`;
}

export function normalizedTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[‘’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Extract a short display label from a URL (e.g. "bandcamp.com", "Instagram"). */
export function urlLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const KNOWN: Record<string, string> = {
      "bandcamp.com": "Bandcamp",
      "instagram.com": "Instagram",
      "facebook.com": "Facebook",
      "twitter.com": "Twitter",
      "x.com": "X",
      "soundcloud.com": "SoundCloud",
      "youtube.com": "YouTube",
      "wikipedia.org": "Wikipedia",
      "en.wikipedia.org": "Wikipedia",
      "myspace.com": "Myspace",
      "last.fm": "Last.fm",
      "rateyourmusic.com": "RYM",
      "wikidata.org": "Wikidata",
      "spotify.com": "Spotify",
      "open.spotify.com": "Spotify",
      "music.apple.com": "Apple Music",
      "tidal.com": "Tidal",
    };
    // Check exact match first, then try parent domain
    if (KNOWN[host]) return KNOWN[host];
    const parts = host.split(".");
    if (parts.length > 2) {
      const parent = parts.slice(-2).join(".");
      if (KNOWN[parent]) return KNOWN[parent];
    }
    // For bandcamp subdomains like "label.bandcamp.com"
    if (host.endsWith(".bandcamp.com")) return "Bandcamp";
    return host;
  } catch {
    return url;
  }
}
