export type EnrichmentSource = "musicbrainz" | "wikidata" | "setlistfm";

export type MatchMethod = "exact_id" | "deterministic_metadata" | "heuristic" | "manual_review";

export interface AdapterRecord {
  source: EnrichmentSource;
  source_id: string;
  source_entity_type: "artist" | "label" | "release" | "master" | "external";
  target_entity_type?: "artist" | "label" | "release" | "master" | "external";
  target_discogs_id?: number;
  target_external_id?: string;
  edge_type?: string;
  context_type?: "bio" | "history" | "scene" | "location" | "timeline_note";
  content_json?: unknown;
  confidence: number;
  match_method: MatchMethod;
  raw?: unknown;
}

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function emitNdjson(records: AdapterRecord[]): void {
  for (const record of records) {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }
}

