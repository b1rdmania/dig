import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

import type { Database } from "./schema.js";

export { sql } from "kysely";
export type { Kysely } from "kysely";
export type { Database } from "./schema.js";

// Pool size: 20 per machine. 2 API machines × 20 = 40 total connections.
// Fly Postgres flex (shared-cpu-2x) defaults to ~100 max_connections, so 40
// is well within budget. Bumped from 10 to absorb concurrent CI + real traffic.
// connectionTimeoutMillis: 5s — prevents indefinite queuing under bursts.
// idleTimeoutMillis: 30s — reclaims idle connections during low-traffic periods.
const POOL_CONFIG: pg.PoolConfig = {
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
};

interface PoolCountable {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

export function getPoolStats(pool: PoolCountable): { total: number; idle: number; waiting: number } {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export function createDb(connectionString: string): Kysely<Database> & { _pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, ...POOL_CONFIG });
  pool.on("connect", (client) => {
    client.on("error", (err) => {
      // Checked-out clients can emit "error" and crash the process if no
      // listener is attached on the client itself.
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        code: "PG_CLIENT_ERROR",
        message: err.message,
      }));
    });
  });
  pool.on("error", (err) => {
    // Prevent unhandled 'error' event from crashing the Node process.
    // pg emits this when a pooled connection drops unexpectedly (e.g. during
    // a long-running DB operation like CREATE INDEX).
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      code: "POOL_ERROR",
      message: err.message,
    }));
  });
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  }) as Kysely<Database> & { _pool: pg.Pool };
  db._pool = pool;
  return db;
}
