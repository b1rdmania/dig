/**
 * Shared route utilities — single source for Discogs ID parsing,
 * PG statement-timeout transactions, and timeout error mapping.
 * Previously copy-pasted across entities/traversal/enrichment/scenes.
 */
import type { FastifyReply } from "fastify";
import type { Kysely, Database } from "@dig/db";
import { sql } from "@dig/db";

export const PG_INT4_MAX = 2_147_483_647;

export function parseDiscogsId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) || id < 1 || id > PG_INT4_MAX ? null : id;
}

export function isPgTimeout(err: unknown): boolean {
  const e = err as any;
  return e?.code === "57014" || e?.cause?.code === "57014";
}

/**
 * Run fn inside a transaction with a SET LOCAL statement_timeout.
 * timeoutMs is always an internal constant — never user input.
 */
export async function withTimeout<T>(
  db: Kysely<Database>,
  timeoutMs: number,
  fn: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL statement_timeout = ${sql.lit(timeoutMs)}`.execute(trx);
    return fn(trx);
  });
}

export function timeoutReply(reply: FastifyReply, message = "Query exceeded timeout") {
  return reply.status(504).send({
    error: { code: "QUERY_TIMEOUT", message, details: null },
  });
}

export function invalidIdReply(reply: FastifyReply) {
  return reply.status(400).send({
    error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
  });
}

/**
 * CDN-grade caching for catalog data that only moves on dump cycles or
 * seed edits. Safe on any anonymous public GET; per-client headers
 * (rate-limit counters) are advisory only. stale-while-revalidate keeps
 * edges warm across the revalidation window.
 */
export function cachePublic(reply: FastifyReply, sMaxAge = 3600): void {
  reply.header(
    "cache-control",
    `public, s-maxage=${sMaxAge}, stale-while-revalidate=86400`,
  );
}
