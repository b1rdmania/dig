/**
 * Data Quality Layer v1
 *
 * Deterministic quality classifier for core Discogs entities.
 * Rules are versioned — quality_version = 1 corresponds to this rule set.
 *
 * Rules (priority order, first match wins):
 *  1. name/title is empty or null        → invalid   / empty_name
 *  2. name/title is purely numeric       → low_value / numeric_name
 *  3. data_quality = Entirely Incorrect  → suppressed / discogs_quality_entirely_incorrect
 *  4. data_quality = Needs Major Changes → low_value / discogs_quality_needs_major_changes
 *  5. otherwise                          → active / default_active
 *
 * Rollback: call search with ?quality=all to bypass the filter.
 */

import type { Kysely } from "kysely";
import type { Database } from "@dig/db";
import type { SearchEntityType } from "./search.js";

export const QUALITY_VERSION = 1;

export type QualityStatus = "active" | "low_value" | "suppressed" | "invalid" | "orphan";

export interface QualityScore {
  quality_status: QualityStatus;
  quality_reason: string;
}

/**
 * Classify a single entity by its name/title and Discogs data_quality field.
 * Deterministic and side-effect-free — safe to call in any context.
 */
export function classifyEntityQuality(
  nameOrTitle: string | null,
  dataQuality: string,
): QualityScore {
  const name = nameOrTitle ?? "";

  if (!name || name.trim() === "") {
    return { quality_status: "invalid", quality_reason: "empty_name" };
  }

  if (/^\d+$/.test(name.trim())) {
    return { quality_status: "low_value", quality_reason: "numeric_name" };
  }

  if (dataQuality === "Entirely Incorrect") {
    return { quality_status: "suppressed", quality_reason: "discogs_quality_entirely_incorrect" };
  }

  if (dataQuality === "Needs Major Changes") {
    return { quality_status: "low_value", quality_reason: "discogs_quality_needs_major_changes" };
  }

  return { quality_status: "active", quality_reason: "default_active" };
}

/**
 * Post-fetch quality filter for search results.
 *
 * Takes a list of (entity_type, discogs_id) pairs and returns a Set of
 * "$type:$id" strings that should be suppressed (quality_status != 'active').
 *
 * Fail-open: if an entity has no quality row (table empty or backfill pending),
 * it is NOT added to the suppressed set — so it passes through.
 */
export async function getSuppressedEntityKeys(
  db: Kysely<Database>,
  entities: Array<{ type: SearchEntityType; discogs_id: number }>,
): Promise<Set<string>> {
  if (entities.length === 0) return new Set();

  // Group by entity type for efficient IN queries
  const byType = new Map<SearchEntityType, number[]>();
  for (const e of entities) {
    const ids = byType.get(e.type) ?? [];
    ids.push(e.discogs_id);
    byType.set(e.type, ids);
  }

  const suppressed = new Set<string>();

  for (const [entityType, ids] of byType) {
    const rows = await db
      .selectFrom("enrich.entity_quality")
      .select(["discogs_id"])
      .where("entity_type", "=", entityType)
      .where("discogs_id", "in", ids)
      .where("quality_status", "!=", "active")
      .execute();

    for (const row of rows) {
      suppressed.add(`${entityType}:${row.discogs_id}`);
    }
  }

  return suppressed;
}
