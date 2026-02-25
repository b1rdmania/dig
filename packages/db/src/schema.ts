/**
 * Kysely database type definitions.
 * Tables are added here as migrations create them.
 * This is the single source of truth for DB types across the monorepo.
 */

import type { Generated, ColumnType } from "kysely";

// --- Auth (designed in Phase 0A, enforced in Phase 5) ---

export interface UsersTable {
  id: Generated<string>;
  email: string;
  role: "public" | "developer" | "curator" | "admin";
  created_at: Generated<Date>;
}

export interface ApiKeysTable {
  id: Generated<string>;
  user_id: string;
  key_hash: string;
  label: string | null;
  rate_limit_tier: "public" | "developer";
  active: Generated<boolean>;
  created_at: Generated<Date>;
}

// --- Ingest ---

export interface DumpBatchesTable {
  id: Generated<string>;
  dump_date: string;
  status: "pending" | "importing" | "qa" | "active" | "active_fallback" | "superseded" | "failed";
  started_at: ColumnType<Date, Date | undefined, Date | undefined>;
  completed_at: ColumnType<Date, Date | undefined, Date | undefined>;
  stats: ColumnType<unknown, unknown | undefined, unknown | undefined>;
  created_at: Generated<Date>;
}

export interface RawEntitiesTable {
  id: Generated<string>;
  batch_id: string;
  entity_type: "artist" | "label" | "master" | "release";
  discogs_id: number;
  raw_payload: unknown;
  created_at: Generated<Date>;
}

// --- Database interface ---

export interface Database {
  "auth.users": UsersTable;
  "auth.api_keys": ApiKeysTable;
  "ingest.dump_batches": DumpBatchesTable;
  "ingest.raw_entities": RawEntitiesTable;
}
