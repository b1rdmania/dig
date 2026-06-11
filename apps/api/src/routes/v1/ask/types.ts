// ---------------------------------------------------------------------------
// Shared types for the /v1/ask route
// ---------------------------------------------------------------------------

export interface MediaItem {
  discogs_id: number;
  title: string;
  artist: string;
  youtube_url: string;
}

export interface EvidenceItem {
  type: "artist" | "label" | "master";
  discogs_id: number;
  title: string;
  dig_url: string;
}

export type ResponseMode = "grounded_success" | "grounded_empty" | "timeout_degraded" | "upstream_error";

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: string;
  [key: string]: unknown;
}
