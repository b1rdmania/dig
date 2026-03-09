/**
 * Entitlement resolver for Clerk + Stripe user plans.
 * Source of truth: auth.user_entitlements (DB), populated by Stripe webhook.
 * Precedence: DB row > active subscription mapping > default free.
 */

import type { Kysely } from "kysely";
import type { Database } from "@dig/db";

export type Plan = "free" | "early_access" | "team";

export interface Entitlements {
  plan: Plan;
  llmBetaAccess: boolean;
  monthlyRequestLimit: number;
  rpmLimit: number;
  features: {
    favorites: boolean;
    wantlist: boolean;
    advanced_search: boolean;
    mcp_high_limit: boolean;
  };
}

const PLAN_DEFAULTS: Record<Plan, Entitlements> = {
  free: {
    plan: "free",
    llmBetaAccess: false,
    monthlyRequestLimit: 500,
    rpmLimit: 20,
    features: { favorites: false, wantlist: false, advanced_search: false, mcp_high_limit: false },
  },
  early_access: {
    plan: "early_access",
    llmBetaAccess: true,
    monthlyRequestLimit: 10000,
    rpmLimit: 120,
    features: { favorites: true, wantlist: true, advanced_search: true, mcp_high_limit: true },
  },
  team: {
    plan: "team",
    llmBetaAccess: true,
    monthlyRequestLimit: 50000,
    rpmLimit: 500,
    features: { favorites: true, wantlist: true, advanced_search: true, mcp_high_limit: true },
  },
};

/** Look up entitlements for a Clerk user ID. Returns free defaults if no row exists. */
export async function getEntitlementsByClerkId(
  db: Kysely<Database>,
  clerkUserId: string,
): Promise<Entitlements & { userId: string | null }> {
  const row = await db
    .selectFrom("auth.user_profiles as p")
    .innerJoin("auth.users as u", "u.id", "p.user_id")
    .leftJoin("auth.user_entitlements as e", "e.user_id", "p.user_id")
    .select([
      "u.id as userId",
      "e.plan",
      "e.llm_beta_access",
      "e.monthly_request_limit",
      "e.rpm_limit",
      "e.features",
    ])
    .where("p.clerk_user_id", "=", clerkUserId)
    .executeTakeFirst();

  if (!row) {
    return { ...PLAN_DEFAULTS.free, userId: null };
  }

  const plan = (row.plan ?? "free") as Plan;
  const defaults = PLAN_DEFAULTS[plan] ?? PLAN_DEFAULTS.free;
  const features = (row.features ?? defaults.features) as Entitlements["features"];

  return {
    userId: row.userId,
    plan,
    llmBetaAccess: row.llm_beta_access ?? defaults.llmBetaAccess,
    monthlyRequestLimit: row.monthly_request_limit ?? defaults.monthlyRequestLimit,
    rpmLimit: row.rpm_limit ?? defaults.rpmLimit,
    features,
  };
}

/** Upsert auth.users + auth.user_profiles from Clerk JWT claims. */
export async function upsertUserFromClerk(
  db: Kysely<Database>,
  clerkUserId: string,
  email: string,
  displayName?: string,
  avatarUrl?: string,
): Promise<string> {
  // Upsert into auth.users
  const user = await db
    .insertInto("auth.users")
    .values({ email, clerk_user_id: clerkUserId, role: "public" })
    .onConflict((oc) =>
      oc.column("clerk_user_id").doUpdateSet({ email })
    )
    .returning("id")
    .executeTakeFirstOrThrow();

  const userId = user.id;

  // Upsert profile
  await db
    .insertInto("auth.user_profiles")
    .values({
      user_id: userId,
      clerk_user_id: clerkUserId,
      display_name: displayName ?? null,
      avatar_url: avatarUrl ?? null,
    })
    .onConflict((oc) =>
      oc.column("user_id").doUpdateSet({
        display_name: displayName ?? null,
        avatar_url: avatarUrl ?? null,
        updated_at: new Date(),
      })
    )
    .execute();

  // Ensure entitlement row exists (default free)
  await db
    .insertInto("auth.user_entitlements")
    .values({
      user_id: userId,
      plan: "free",
      llm_beta_access: false,
      monthly_request_limit: 500,
      rpm_limit: 20,
      features: { favorites: false, wantlist: false, advanced_search: false, mcp_high_limit: false },
    })
    .onConflict((oc) => oc.column("user_id").doNothing())
    .execute();

  return userId;
}

/** Apply a Stripe event to update subscription + entitlements. Idempotent. */
export async function applyStripeEvent(
  db: Kysely<Database>,
  stripeEventId: string,
  eventType: string,
  payload: unknown,
  stripeCustomerId: string,
  subscriptionId: string | null,
  subscriptionStatus: string | null,
  priceId: string | null,
  periodStart: Date | null,
  periodEnd: Date | null,
  cancelAtPeriodEnd: boolean,
): Promise<void> {
  // Idempotency check
  const existing = await db
    .selectFrom("auth.billing_events")
    .select("id")
    .where("provider_event_id", "=", stripeEventId)
    .executeTakeFirst();

  if (existing) return; // already processed

  // Record event
  await db
    .insertInto("auth.billing_events")
    .values({
      provider_event_id: stripeEventId,
      event_type: eventType,
      payload: payload as any,
    })
    .execute();

  // Find user by stripe_customer_id
  const user = await db
    .selectFrom("auth.users")
    .select("id")
    .where("stripe_customer_id", "=", stripeCustomerId)
    .executeTakeFirst();

  if (!user) {
    // Mark processed (can't apply without user)
    await db
      .updateTable("auth.billing_events")
      .set({ processed_at: new Date() })
      .where("provider_event_id", "=", stripeEventId)
      .execute();
    return;
  }

  const userId = user.id;

  // Upsert subscription row
  if (subscriptionId && subscriptionStatus && priceId) {
    await db
      .insertInto("auth.subscriptions")
      .values({
        user_id: userId,
        provider_customer_id: stripeCustomerId,
        provider_subscription_id: subscriptionId,
        status: subscriptionStatus,
        price_id: priceId,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        cancel_at_period_end: cancelAtPeriodEnd,
      })
      .onConflict((oc) =>
        oc.column("provider_subscription_id").doUpdateSet({
          status: subscriptionStatus,
          price_id: priceId,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          cancel_at_period_end: cancelAtPeriodEnd,
          updated_at: new Date(),
        })
      )
      .execute();
  }

  // Recompute entitlements from subscription status
  const PRICE_EARLY_ACCESS = process.env.STRIPE_PRICE_EARLY_ACCESS_GBP_MONTHLY ?? "";
  const isActive = subscriptionStatus === "active" || subscriptionStatus === "trialing";
  const isEarlyAccess = isActive && priceId === PRICE_EARLY_ACCESS;
  const plan: Plan = isEarlyAccess ? "early_access" : "free";
  const defaults = PLAN_DEFAULTS[plan];

  await db
    .insertInto("auth.user_entitlements")
    .values({
      user_id: userId,
      plan,
      llm_beta_access: defaults.llmBetaAccess,
      monthly_request_limit: defaults.monthlyRequestLimit,
      rpm_limit: defaults.rpmLimit,
      features: defaults.features,
    })
    .onConflict((oc) =>
      oc.column("user_id").doUpdateSet({
        plan,
        llm_beta_access: defaults.llmBetaAccess,
        monthly_request_limit: defaults.monthlyRequestLimit,
        rpm_limit: defaults.rpmLimit,
        features: defaults.features,
        updated_at: new Date(),
      })
    )
    .execute();

  // Also update plan on auth.users
  await db
    .updateTable("auth.users")
    .set({ plan, plan_expires_at: isActive ? periodEnd : null })
    .where("id", "=", userId)
    .execute();

  // Mark billing event processed
  await db
    .updateTable("auth.billing_events")
    .set({ processed_at: new Date() })
    .where("provider_event_id", "=", stripeEventId)
    .execute();
}

/** Increment LLM quota atomically and check if over limit. Returns { allowed, current, limit }. */
export async function checkAndIncrementLlmQuota(
  db: Kysely<Database>,
  userId: string,
  monthlyLimit: number,
): Promise<{ allowed: boolean; current: number; limit: number }> {
  const { sql } = await import("kysely");
  const periodMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Atomic upsert: INSERT ... ON CONFLICT DO UPDATE SET llm_request_count = llm_request_count + 1
  const result = await sql<{ llm_request_count: number }>`
    INSERT INTO auth.usage_quotas (user_id, period_month, llm_request_count)
    VALUES (${userId}, ${periodMonth}, 1)
    ON CONFLICT (user_id, period_month) DO UPDATE
      SET llm_request_count = auth.usage_quotas.llm_request_count + 1,
          updated_at = now()
    RETURNING llm_request_count
  `.execute(db);

  const current = result.rows[0]?.llm_request_count ?? 1;
  return { allowed: current <= monthlyLimit, current, limit: monthlyLimit };
}
