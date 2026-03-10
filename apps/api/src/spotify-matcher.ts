/**
 * Spotify track matcher.
 * Conservative strategy: requires both artist AND title to match well.
 * Threshold: ≥0.80 for auto-accept, else unmatched.
 * Returns match_confidence and match_method per track.
 */

import { searchTrack, type SpotifyTrack } from "./spotify-client.js";

export type MatchMethod = "artist_title" | "title_only" | "unmatched";

export interface TrackMatchResult {
  track_id: string;         // our internal mixtape_tracks.id
  name: string | null;
  artist: string | null;
  matched: boolean;
  spotify_track_id: string | null;
  spotify_track_uri: string | null;
  spotify_track_name: string | null;
  spotify_artist_name: string | null;
  match_confidence: number;
  match_method: MatchMethod;
}

const MATCH_THRESHOLD = 0.80;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Simple token-based similarity: intersection / union of word sets. */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;
  const wa = new Set(na.split(" ").filter(Boolean));
  const wb = new Set(nb.split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / (wa.size + wb.size - intersection);
}

function scoreCandidate(
  candidate: SpotifyTrack,
  targetTitle: string,
  targetArtist: string | null,
): { confidence: number; method: MatchMethod } {
  const titleSim = similarity(candidate.name, targetTitle);

  if (targetArtist) {
    // Score against all artists on the Spotify track
    const bestArtistSim = Math.max(
      ...candidate.artists.map((a) => similarity(a.name, targetArtist)),
    );
    const combined = titleSim * 0.6 + bestArtistSim * 0.4;
    if (combined >= MATCH_THRESHOLD) {
      return { confidence: combined, method: "artist_title" };
    }
  }

  // Fallback: title-only (lower confidence ceiling)
  if (titleSim >= MATCH_THRESHOLD) {
    return { confidence: titleSim * 0.7, method: "title_only" };
  }

  return { confidence: Math.max(titleSim * 0.5, 0), method: "unmatched" };
}

export async function matchTrack(
  accessToken: string,
  trackId: string,
  name: string | null,
  artist: string | null,
): Promise<TrackMatchResult> {
  const base: TrackMatchResult = {
    track_id: trackId,
    name,
    artist,
    matched: false,
    spotify_track_id: null,
    spotify_track_uri: null,
    spotify_track_name: null,
    spotify_artist_name: null,
    match_confidence: 0,
    match_method: "unmatched",
  };

  if (!name) return base;

  // Build query — artist + title gives best results
  const query = artist ? `artist:${artist} track:${name}` : name;

  let candidates = await searchTrack(accessToken, query);

  // If artist-qualified search returns nothing, fallback to title only
  if (candidates.length === 0 && artist) {
    candidates = await searchTrack(accessToken, name);
  }

  if (candidates.length === 0) return base;

  // Score all candidates, take best
  let bestScore = { confidence: 0, method: "unmatched" as MatchMethod };
  let bestCandidate: SpotifyTrack | null = null;

  for (const c of candidates) {
    const score = scoreCandidate(c, name, artist);
    if (score.confidence > bestScore.confidence) {
      bestScore = score;
      bestCandidate = c;
    }
  }

  const matched = bestScore.confidence >= MATCH_THRESHOLD;

  return {
    ...base,
    matched,
    spotify_track_id: matched ? (bestCandidate?.id ?? null) : null,
    spotify_track_uri: matched ? (bestCandidate?.uri ?? null) : null,
    spotify_track_name: matched ? (bestCandidate?.name ?? null) : null,
    spotify_artist_name: matched ? (bestCandidate?.artists[0]?.name ?? null) : null,
    match_confidence: Math.round(bestScore.confidence * 100) / 100,
    match_method: matched ? bestScore.method : "unmatched",
  };
}
