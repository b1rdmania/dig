import { type Kysely, sql } from "kysely";

/**
 * Ensure fast lookups by Clerk user ID on auth.users.
 * UNIQUE on clerk_user_id was added in 018, which creates an implicit index,
 * but this migration makes it explicit with a named index for observability.
 * Also adds a covering index for entitlement lookups by user_id.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Named index on auth.users.clerk_user_id (supports upsertUserFromClerk fast path)
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_user_id
    ON auth.users (clerk_user_id)
    WHERE clerk_user_id IS NOT NULL
  `.execute(db);

  // Named index on auth.users.stripe_customer_id (supports webhook lookup)
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_customer_id
    ON auth.users (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL
  `.execute(db);

  // Covering index for entitlement lookups (plan + llm_beta_access most queried)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_entitlements_plan
    ON auth.user_entitlements (user_id, plan)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS auth.idx_users_clerk_user_id`.execute(db);
  await sql`DROP INDEX IF EXISTS auth.idx_users_stripe_customer_id`.execute(db);
  await sql`DROP INDEX IF EXISTS auth.idx_user_entitlements_plan`.execute(db);
}
