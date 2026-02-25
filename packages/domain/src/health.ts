import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "@dig/db";

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  postgres: boolean;
  timestamp: string;
}

export async function healthCheck(db: Kysely<Database>): Promise<HealthStatus> {
  let postgres = false;

  try {
    await sql`SELECT 1`.execute(db);
    postgres = true;
  } catch {
    // postgres unreachable
  }

  return {
    status: postgres ? "ok" : "down",
    postgres,
    timestamp: new Date().toISOString(),
  };
}
