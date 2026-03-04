/**
 * Label linkout import CLI (Bandcamp + Instagram) from Discogs label URLs.
 *
 * Deterministic, high-confidence-only extractor:
 * - Reads catalog.label_urls from the active/qa batch
 * - Extracts provider/profile handles for bandcamp/instagram URLs
 * - Upserts to enrich.label_linkouts
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @dig/ingest label-linkouts
 *   DATABASE_URL=... pnpm --filter @dig/ingest label-linkouts -- --limit 50000 --offset 0 --dry-run
 */

import { createDb, sql } from "@dig/db";
import { extractLabelLinkout, type LinkoutCandidate, type LinkProvider } from "./linkout-matchers";

interface UrlRow {
  label_discogs_id: number;
  url: string;
}

interface ParsedArgs {
  databaseUrl: string;
  limit: number;
  offset: number;
  dryRun: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let limit = 200000;
  let offset = 0;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10);
    if (args[i] === "--offset" && args[i + 1]) offset = parseInt(args[++i], 10);
    if (args[i] === "--dry-run") dryRun = true;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  return { databaseUrl, limit, offset, dryRun };
}

async function createBatch(db: ReturnType<typeof createDb>, sourceBatchKey: string): Promise<number> {
  const { rows } = await sql<{ id: number }>`
    INSERT INTO enrich.ingest_batches (source, source_batch_key, status, started_at)
    VALUES ('linkout', ${sourceBatchKey}, 'importing', now())
    ON CONFLICT (source, source_batch_key)
    DO UPDATE SET status = 'importing', started_at = now(), completed_at = NULL
    RETURNING id
  `.execute(db);

  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to create enrichment batch");
  return id;
}

async function finalizeBatch(
  db: ReturnType<typeof createDb>,
  batchId: number,
  stats: Record<string, unknown>,
): Promise<void> {
  await sql`
    UPDATE enrich.ingest_batches
    SET status = 'active',
        completed_at = now(),
        stats = ${JSON.stringify(stats)}::jsonb
    WHERE id = ${batchId}
  `.execute(db);
}

async function latestBatchId(db: ReturnType<typeof createDb>): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    SELECT id
    FROM ingest.dump_batches
    WHERE status IN ('active', 'qa')
    ORDER BY created_at DESC
    LIMIT 1
  `.execute(db);

  const id = rows[0]?.id;
  if (!id) throw new Error("No active/qa ingest batch found");
  return id;
}

function selectBest(candidates: LinkoutCandidate[]): LinkoutCandidate {
  return candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.url.length - b.url.length;
  })[0]!;
}

async function main() {
  const args = parseArgs();
  const db = createDb(args.databaseUrl);
  const t0 = Date.now();

  try {
    const batchId = await latestBatchId(db);
    console.log(`[label-linkouts] using ingest batch: ${batchId}`);

    const { rows } = await sql<UrlRow>`
      SELECT label_discogs_id, url
      FROM catalog.label_urls
      WHERE batch_id = ${batchId}
      ORDER BY label_discogs_id, id
      OFFSET ${args.offset}
      LIMIT ${args.limit}
    `.execute(db);

    console.log(`[label-linkouts] source rows: ${rows.length.toLocaleString()}`);

    const grouped = new Map<string, LinkoutCandidate[]>();
    let parsed = 0;
    for (const row of rows) {
      const candidate = extractLabelLinkout(row.url);
      if (!candidate) continue;
      parsed++;
      const key = `${row.label_discogs_id}:${candidate.provider}`;
      const list = grouped.get(key) ?? [];
      list.push(candidate);
      grouped.set(key, list);
    }

    const winners: Array<{
      labelDiscogsId: number;
      provider: LinkProvider;
      url: string;
      handle: string | null;
      confidence: number;
      matchMethod: string;
    }> = [];

    for (const [key, candidates] of grouped.entries()) {
      const [idStr, provider] = key.split(":");
      const best = selectBest(candidates);
      winners.push({
        labelDiscogsId: Number(idStr),
        provider: provider as LinkProvider,
        url: best.url,
        handle: best.handle,
        confidence: best.confidence,
        matchMethod: best.matchMethod,
      });
    }

    const byProvider = winners.reduce<Record<string, number>>((acc, row) => {
      acc[row.provider] = (acc[row.provider] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`[label-linkouts] parsed candidates: ${parsed.toLocaleString()}`);
    console.log(`[label-linkouts] deduped winners: ${winners.length.toLocaleString()}`);
    console.log(`[label-linkouts] provider counts: ${JSON.stringify(byProvider)}`);

    if (args.dryRun || winners.length === 0) {
      console.log(`[label-linkouts] dry-run=${args.dryRun}. no writes.`);
      return;
    }

    const sourceBatchKey = `label-linkouts-${new Date().toISOString().slice(0, 10)}`;
    const enrichBatchId = await createBatch(db, sourceBatchKey);

    const WRITE_BATCH = 500;
    let written = 0;
    for (let i = 0; i < winners.length; i += WRITE_BATCH) {
      const chunk = winners.slice(i, i + WRITE_BATCH);
      const values = chunk.map((r) => {
        const isVerified = r.provider === "bandcamp";
        return sql`(
          ${r.labelDiscogsId},
          ${r.provider},
          ${r.url},
          ${r.handle},
          ${r.confidence},
          ${r.matchMethod},
          ${isVerified},
          ${enrichBatchId}
        )`;
      });

      await sql`
        INSERT INTO enrich.label_linkouts
          (discogs_label_id, provider, url, handle, confidence, match_method, is_verified, source_batch_id)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT (discogs_label_id, provider) DO UPDATE SET
          url = EXCLUDED.url,
          handle = EXCLUDED.handle,
          confidence = EXCLUDED.confidence,
          match_method = EXCLUDED.match_method,
          is_verified = EXCLUDED.is_verified,
          source_batch_id = EXCLUDED.source_batch_id,
          updated_at = now()
      `.execute(db);

      written += chunk.length;
      if (written % 50000 === 0 || written === winners.length) {
        console.log(`[label-linkouts] written ${written.toLocaleString()} / ${winners.length.toLocaleString()}`);
      }
    }

    await finalizeBatch(db, enrichBatchId, {
      source_rows: rows.length,
      parsed_candidates: parsed,
      winners: winners.length,
      by_provider: byProvider,
      offset: args.offset,
      limit: args.limit,
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[label-linkouts] done in ${elapsed}s`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error("[label-linkouts] fatal:", err);
  process.exit(1);
});
