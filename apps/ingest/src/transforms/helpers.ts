/**
 * Shared helpers for extracting values from parsed XML nodes (XmlNode trees).
 *
 * XmlNode structure:
 *   { "@attr"?: { ... }, "#text"?: "...", "childTag"?: XmlNode[], ... }
 */

import type { Kysely, Database } from "@dig/db";
import type { XmlNode } from "../parser.js";

/**
 * Max rows per INSERT to stay under Postgres 65535 parameter limit.
 * Conservative: 500 rows × up to 12 cols = 6000 params (well under limit).
 */
const CHUNK_SIZE = 500;

/**
 * Chunked bulk insert that stays under Postgres parameter limits.
 * Splits rows into chunks and inserts each chunk separately.
 */
export async function chunkedInsert<T extends keyof Database & string>(
  db: Kysely<Database>,
  table: T,
  rows: Array<Record<string, unknown>>,
  onConflict: (oc: any) => any,
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await (db.insertInto(table) as any).values(chunk).onConflict(onConflict).execute();
  }
}

/** Get child nodes by tag name, always returns an array */
export function children(node: XmlNode, key: string): XmlNode[] {
  const val = node[key];
  return Array.isArray(val) ? val : [];
}

/** Get text content of the first child with given tag name */
export function childText(node: XmlNode, key: string): string {
  const kids = children(node, key);
  return kids.length > 0 ? (kids[0]["#text"] as string ?? "") : "";
}

/** Get text content from a node's #text field */
export function text(node: XmlNode): string {
  return (node["#text"] as string) ?? "";
}

/** Get an attribute value from a node */
export function attr(node: XmlNode, key: string): string {
  return (node["@attr"] as Record<string, string>)?.[key] ?? "";
}

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

/** Parse an integer, returning null for non-numeric or out-of-int32-range values */
export function parseInt_safe(value: string): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  if (isNaN(n) || n > INT32_MAX || n < INT32_MIN) return null;
  return n;
}

/** Parse boolean from string ("true"/"false"), null if empty */
export function parseBool(value: string): boolean | null {
  if (!value) return null;
  return value.toLowerCase() === "true";
}

/**
 * Parse a Discogs date string into year/month/day components.
 *
 * Patterns handled:
 *   "1995-03-14" → { year: 1995, month: 3, day: 14 }
 *   "1995-03-00" → { year: 1995, month: 3, day: null }
 *   "1995-00-00" → { year: 1995, month: null, day: null }
 *   "1995"       → { year: 1995, month: null, day: null }
 *   ""           → { year: null, month: null, day: null }
 */
export function parseDate(raw: string): {
  year: number | null;
  month: number | null;
  day: number | null;
} {
  if (!raw || !raw.trim()) return { year: null, month: null, day: null };

  const trimmed = raw.trim();

  // Try YYYY-MM-DD pattern
  const full = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) {
    const year = parseInt(full[1], 10);
    const month = parseInt(full[2], 10);
    const day = parseInt(full[3], 10);
    return {
      year: year === 0 ? null : year,
      month: month === 0 ? null : month,
      day: day === 0 ? null : day,
    };
  }

  // Try YYYY-MM pattern
  const ym = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (ym) {
    const year = parseInt(ym[1], 10);
    const month = parseInt(ym[2], 10);
    return {
      year: year === 0 ? null : year,
      month: month === 0 ? null : month,
      day: null,
    };
  }

  // Try bare YYYY
  const y = trimmed.match(/^(\d{4})$/);
  if (y) {
    const year = parseInt(y[1], 10);
    return { year: year === 0 ? null : year, month: null, day: null };
  }

  // Fallback: try to extract a 4-digit year from free text
  const yearMatch = trimmed.match(/(\d{4})/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 1900 && year <= 2100) {
      return { year, month: null, day: null };
    }
  }

  return { year: null, month: null, day: null };
}

/**
 * Parse a duration string into total seconds.
 *
 * Patterns: "3:45" → 225, "1:02:30" → 3750, "" → null
 */
export function parseDuration(raw: string): number | null {
  if (!raw || !raw.trim()) return null;

  const parts = raw.trim().split(":").map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return null;

  let seconds: number | null = null;
  if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (seconds !== null && (seconds > INT32_MAX || seconds < 0)) return null;
  return seconds;
}
