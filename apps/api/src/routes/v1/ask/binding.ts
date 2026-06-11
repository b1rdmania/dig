// ---------------------------------------------------------------------------
// Evidence / citation binding — pure functions, no I/O.
//
// Citation-bound media: only return videos for masters whose dig.baby URL
// appears in the assistant's answer text. The system prompt tells the
// model to link every entity it mentions; this binding ensures the rail
// only ever surfaces videos for records the model actually wrote about.
// Strict empty is the right behaviour when the model didn't cite anything
// — better than dumping generic videos for masters it merely fetched.
// ---------------------------------------------------------------------------

import type { MediaItem, EvidenceItem } from "./types.js";

export type { MediaItem, EvidenceItem };

/** Scans answer markdown for `app.dig.baby/master/{id}` URLs. */
export function extractCitedMasterIds(answer: string): Set<number> {
  const citedMasterIds = new Set<number>();
  const masterUrlRe = /app\.dig\.baby\/master\/(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = masterUrlRe.exec(answer)) !== null) {
    const id = Number(match[1]);
    if (Number.isFinite(id)) citedMasterIds.add(id);
  }
  return citedMasterIds;
}

/**
 * Keeps only media whose master ID is cited in the answer text. No fallback —
 * if the model didn't link a master, no video renders for it.
 */
export function bindMediaToCitations(media: MediaItem[], answer: string): MediaItem[] {
  const citedMasterIds = extractCitedMasterIds(answer);
  return media.filter((m) => citedMasterIds.has(m.discogs_id));
}

/** Dedupe media by YouTube URL, keeping first occurrence. */
export function dedupeMedia(media: MediaItem[]): MediaItem[] {
  const seenUrls = new Set<string>();
  return media.filter((m) => {
    if (seenUrls.has(m.youtube_url)) return false;
    seenUrls.add(m.youtube_url);
    return true;
  });
}

/** Dedupe evidence by dig URL, keeping first occurrence. */
export function dedupeEvidence(evidence: EvidenceItem[]): EvidenceItem[] {
  const seenEvidence = new Set<string>();
  return evidence.filter((e) => {
    if (seenEvidence.has(e.dig_url)) return false;
    seenEvidence.add(e.dig_url);
    return true;
  });
}

// ---------------------------------------------------------------------------
// allowedMasterIds guard — server-side defence against the model calling
// get_master with an ID that was never established as a master in this
// conversation (e.g. a release ID). Separate concern from citation binding.
// ---------------------------------------------------------------------------

export const INVALID_MASTER_ID_ERROR =
  "Invalid master ID — this ID was not established as a master in this conversation. Search first, then use the resulting master IDs.";

export function isAllowedMasterId(allowedMasterIds: ReadonlySet<number>, discogsId: number): boolean {
  return allowedMasterIds.has(discogsId);
}
