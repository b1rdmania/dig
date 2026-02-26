import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

import type { Database } from "./schema.js";

export { sql } from "kysely";
export type { Kysely } from "kysely";
export type { Database } from "./schema.js";

export function createDb(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString }),
    }),
  });
}
