/**
 * Shared auth utilities for API routes.
 * Resolves Clerk JWT → internal user ID + entitlements.
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
  } catch {
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
  } catch {
    return null;
  }
}
