// ---------------------------------------------------------------------------
// A Bore is a persona file plus a corpus adapter. The ask loop (loop.ts) is
// the engine; everything a specific bore brings - character, tools, how a
// claim is grounded, what the shop says when it runs out of road - lives in
// one BoreConfig. Record Bore (record-bore.ts) is the first; Wine Bore
// (wine-bore.ts) the second. If a bore needs a change to loop.ts to exist,
// that is the finding to write down (docs/wine-bore-build.md).
// ---------------------------------------------------------------------------

import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import type { MediaItem } from "./types.js";

export type BoreSlug = "record" | "wine";

/** Anthropic-shape tool definition (translated for OpenRouter in loop.ts). */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[] };
}

export interface ToolContext<E> {
  db: Kysely<Database>;
  mediaCollector: MediaItem[];
  evidenceCollector: E[];
  errorRef: { count: number };
  /** Per-conversation scratch the tools may use (Record Bore: allowed master IDs). */
  scratch: Map<string, unknown>;
}

export type ProgressEvent =
  | { type: "round"; round: number }
  | { type: "tool"; name: string; input: Record<string, unknown> };

export interface BoreConfig<E = unknown> {
  slug: BoreSlug;
  name: string;
  /** Persona + surface rules, assembled once at boot. */
  systemPrompt: string;
  tools: ToolDef[];
  executeTool: (name: string, input: Record<string, unknown>, ctx: ToolContext<E>) => Promise<unknown>;
  /** Shop-voiced label for the live activity feed. */
  progressLabel: (e: ProgressEvent) => string;
  /**
   * Grounding, enforced after the model writes: remove links (or claims) to
   * anything no tool returned this turn. Text stays, dead references go.
   */
  scrubAnswer: (answer: string, evidence: readonly E[]) => string;
  /** A recommendation written with no lookup this turn - send back once. */
  looksUnchecked: (text: string, toolCallsThisTurn: number) => boolean;
  /** The one-line instruction that sends the model back to the racks. */
  backToTheRacks: string;
  /** Last-round instruction when the tool budget is spent. */
  stopLooking: string;
  /** What the shop hands over when the loop runs out of road entirely. */
  handover: (evidence: readonly E[]) => string;
  /** When the model wrote nothing usable at all. */
  emptyAnswer: string;
  /** Dedupe key for evidence rows in the response. */
  evidenceKey: (e: E) => string;
  /** Public (keyless) budgets for this bore's page. */
  publicMaxRounds: number;
  publicMaxTokens: number;
  /**
   * enrich.usage_counters key prefix for the monthly till. Record Bore keeps
   * the legacy un-prefixed key so the running month's count carries over.
   */
  quotaKey: string;
}
