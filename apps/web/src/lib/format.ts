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
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
