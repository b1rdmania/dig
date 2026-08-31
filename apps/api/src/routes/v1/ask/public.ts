// ---------------------------------------------------------------------------
// Public access gate for /v1/ask — the Record Bore shop window.
//
// Enabled with ASK_PUBLIC=on. Visitors without a beta key get in, bounded two
// ways so the till can't be drained:
//   - per-visitor daily cap (ASK_PUBLIC_DAILY_PER_IP, default 20) — in-memory,
//     which is sound only while dig-api runs a single machine
//   - global monthly cap (ASK_PUBLIC_MONTHLY_MAX, default 400 asks) — durable,
//     stored in enrich.usage_counters so restarts and deploys don't reset it
// Refusals speak in voice; the shop is shut, not "rate limited".
// ---------------------------------------------------------------------------

import type { FastifyRequest } from "fastify";
import { sql } from "@dig/db";
import type { Kysely, Database } from "@dig/db";

// Read per-request (unlike auth.ts's load-time keys) so tests can flip the
// gate without module-cache surgery.
const publicEnabled = () => (process.env.ASK_PUBLIC ?? "").trim() === "on";
const dailyPerIp = () => Math.max(1, Number(process.env.ASK_PUBLIC_DAILY_PER_IP ?? 20));
const monthlyMax = () => Math.max(1, Number(process.env.ASK_PUBLIC_MONTHLY_MAX ?? 400));

// Fly terminates the connection at its proxy, so req.ip is the proxy, not the
// visitor. fly-client-ip is set by the platform and not spoofable through it.
export function clientIp(req: FastifyRequest): string {
  const fly = String(req.headers["fly-client-ip"] ?? "").trim();
  if (fly) return fly;
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return fwd || req.ip;
}

interface DailyEntry { day: string; count: number }
const dailyCounts = new Map<string, DailyEntry>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(): string {
  return `ask_public_${new Date().toISOString().slice(0, 7)}`;
}

export type PublicGateResult =
  | { ok: true }
  | { ok: false; status: number; body: unknown };

function shut(message: string): PublicGateResult {
  return {
    ok: false,
    status: 429,
    body: { error: { code: "RATE_LIMITED", message, details: null } },
  };
}

export function isPublicAskEnabled(): boolean {
  return publicEnabled();
}

/**
 * Admit or refuse a keyless ask. Call only after the private-key check has
 * failed; on admit the caller MUST follow with recordPublicAsk().
 */
export async function checkPublicAsk(
  req: FastifyRequest,
  db: Kysely<Database>,
): Promise<PublicGateResult> {
  if (!publicEnabled()) {
    return {
      ok: false,
      status: 401,
      body: { error: { code: "UNAUTHORIZED", message: "Private beta key required", details: null } },
    };
  }

  const day = today();
  // Yesterday's tallies are dead weight the moment the date rolls over.
  if (dailyCounts.size > 10_000) {
    for (const [k, v] of dailyCounts) if (v.day !== day) dailyCounts.delete(k);
  }

  const ip = clientIp(req);
  const entry = dailyCounts.get(ip);
  const count = entry && entry.day === day ? entry.count : 0;
  if (count >= dailyPerIp()) {
    return shut("That's your lot for today. Shop's shut to you — come back tomorrow.");
  }

  let spent: number;
  try {
    const row = await sql<{ counter_value: string }>`
      SELECT counter_value FROM enrich.usage_counters WHERE counter_key = ${monthKey()}
    `.execute(db);
    spent = Number(row.rows[0]?.counter_value ?? 0);
  } catch {
    // Counter table unreachable — fail closed rather than run an unmetered
    // month on the shop's key.
    return shut("Till's playing up. Shop's shut for a bit — come back later.");
  }
  if (spent >= monthlyMax()) {
    return shut("Shop's shut — till's empty for the month. Come back on the 1st.");
  }

  dailyCounts.set(ip, { day, count: count + 1 });
  return { ok: true };
}

/** Count an admitted public ask against the monthly till. */
export async function recordPublicAsk(db: Kysely<Database>): Promise<void> {
  try {
    await sql`
      INSERT INTO enrich.usage_counters (counter_key, counter_value)
      VALUES (${monthKey()}, 1)
      ON CONFLICT (counter_key)
      DO UPDATE SET
        counter_value = enrich.usage_counters.counter_value + 1,
        updated_at = now()
    `.execute(db);
  } catch {
    // The admit already checked the cap; losing one increment is better than
    // failing the answer the visitor is now waiting on.
  }
}

// Test hook: reset the in-memory daily state.
export function __resetPublicAskState(): void {
  dailyCounts.clear();
}
