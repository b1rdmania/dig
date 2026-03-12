/**
 * Shared auth utilities for API routes.
 * Resolves Clerk JWT → internal user ID + entitlements.
 *
 * Fail-open/closed policy:
 * - Public search/retrieval: no auth required — Clerk not invoked.
 * - Paid routes (/v1/me/*, /v1/ask gated): resolveUser returns null on any
 *   auth failure. Callers must return 401. This is fail-CLOSED — correct.
 * - A Clerk outage causes null return (not a crash), so anonymous search
 *   continues unaffected.
 */

import { createClerkClient, verifyToken as clerkVerifyToken } from "@clerk/backend";
import { upsertUserFromClerk, getEntitlementsByClerkId, type Entitlements } from "@dig/domain";
import type { Kysely, Database } from "@dig/db";

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "";

export interface ResolvedUser {
  clerkUserId: string;
  userId: string;
  email: string;
  entitlements: Entitlements;
}

function logAuthEvent(code: string, detail: string): void {
  console.warn(JSON.stringify({
    ts: new Date().toISOString(),
    level: "warn",
    code,
    detail,
  }));
}

/**
 * Verify Clerk Bearer token and return the Clerk user ID.
 * Returns null if missing or invalid — caller decides how to respond.
 */
export async function resolveClerkUserId(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const payload = await clerkVerifyToken(token, { secretKey: CLERK_SECRET_KEY });
    return payload.sub;
  } catch (err: unknown) {
    // Distinguish bad token (expected, frequent) from Clerk provider errors (unexpected).
    const msg = err instanceof Error ? err.message : String(err);
    const isProviderError = msg.includes("network") || msg.includes("ECONNREFUSED") || msg.includes("fetch");
    logAuthEvent(
      isProviderError ? "AUTH_PROVIDER_UNAVAILABLE" : "AUTH_VERIFY_FAILED",
      msg.slice(0, 120),
    );
    return null;
  }
}

/**
 * Full resolution: verify JWT → upsert user in DB → fetch entitlements.
 * Use this for routes that need the internal userId and plan information.
 */
export async function resolveUser(
  db: Kysely<Database>,
  authHeader: string | undefined,
): Promise<ResolvedUser | null> {
  const clerkUserId = await resolveClerkUserId(authHeader);
  if (!clerkUserId) return null;

  try {
    const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY });
    const user = await clerk.users.getUser(clerkUserId);
    const email = user.emailAddresses[0]?.emailAddress ?? "";
    const firstName = user.firstName ?? undefined;
    const imageUrl = user.imageUrl ?? undefined;

    const userId = await upsertUserFromClerk(db, clerkUserId, email, firstName, imageUrl);
    const entitlements = await getEntitlementsByClerkId(db, clerkUserId);

    return { clerkUserId, userId, email, entitlements };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isProviderError = msg.includes("network") || msg.includes("ECONNREFUSED") || msg.includes("fetch");
    logAuthEvent(
      isProviderError ? "AUTH_PROVIDER_UNAVAILABLE" : "AUTH_RESOLUTION_FAILED",
      msg.slice(0, 120),
    );
    return null;
  }
}
