import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

import type { Database } from "./schema.js";

export { sql } from "kysely";
export type { Kysely } from "kysely";
export type { Database } from "./schema.js";

export function createDb(connectionString: string): Kysely<Database> {
  const pool = new pg.Pool({ connectionString });
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
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}
