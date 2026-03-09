import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // Extend auth.users with Clerk + Stripe linkage
  await sql`
    ALTER TABLE auth.users
      ADD COLUMN IF NOT EXISTS clerk_user_id TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ
  `.execute(db);

  // User profiles (display info from Clerk)
  await sql`
    CREATE TABLE IF NOT EXISTS auth.user_profiles (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      clerk_user_id TEXT UNIQUE NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_profiles_clerk_user_id
    ON auth.user_profiles (clerk_user_id)
  `.execute(db);

  // Stripe subscriptions
  await sql`
    CREATE TABLE IF NOT EXISTS auth.subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'stripe',
      provider_customer_id TEXT NOT NULL,
      provider_subscription_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL,
      price_id TEXT NOT NULL,
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
    ON auth.subscriptions (user_id, status)
  `.execute(db);

  // User entitlements (authoritative plan state)
  await sql`
    CREATE TABLE IF NOT EXISTS auth.user_entitlements (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL DEFAULT 'free',
      llm_beta_access BOOLEAN NOT NULL DEFAULT false,
      monthly_request_limit INTEGER NOT NULL DEFAULT 500,
      rpm_limit INTEGER NOT NULL DEFAULT 20,
      features JSONB NOT NULL DEFAULT '{}'::jsonb,
      effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  // Per-user monthly quota tracking
  await sql`
    CREATE TABLE IF NOT EXISTS auth.usage_quotas (
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      period_month TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      llm_request_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, period_month)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_usage_quotas_period
    ON auth.usage_quotas (period_month, user_id)
  `.execute(db);

  // Billing events (webhook idempotency log)
  await sql`
    CREATE TABLE IF NOT EXISTS auth.billing_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL DEFAULT 'stripe',
      provider_event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_provider_event_id
    ON auth.billing_events (provider_event_id)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS auth.billing_events`.execute(db);
  await sql`DROP TABLE IF EXISTS auth.usage_quotas`.execute(db);
  await sql`DROP TABLE IF EXISTS auth.user_entitlements`.execute(db);
  await sql`DROP TABLE IF EXISTS auth.subscriptions`.execute(db);
  await sql`DROP TABLE IF EXISTS auth.user_profiles`.execute(db);
  await sql`
    ALTER TABLE auth.users
      DROP COLUMN IF EXISTS clerk_user_id,
      DROP COLUMN IF EXISTS stripe_customer_id,
      DROP COLUMN IF EXISTS plan,
      DROP COLUMN IF EXISTS plan_expires_at
  `.execute(db);
}
