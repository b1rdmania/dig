# Implementation Plan: Clerk + Stripe + Entitlements v1

Status: `READY_FOR_IMPLEMENTATION`
Owner: `handoff-agent`
Reviewer: `codex`
Date: `2026-03-09`

## 0) Objective

Ship account login, paid plan gating, and LLM beta access control without touching catalog/enrichment data paths.

What this unlocks:

1. User login on web.
2. Tiered limits/features (`free`, `early_access`, `team`) enforced server-side.
3. Paid upgrades (e.g. `GBP 5/month` Early Access) via Stripe.
4. LLM beta access tied to entitlement flags.
5. Optional API key issuance tied to plan.

Non-goals for v1:

1. No Discogs OAuth sync yet (collections/wantlist deferred).
2. No custom auth provider; Clerk is canonical identity.
3. No breaking change to existing anonymous API behavior.

---

## 1) Current Baseline (confirmed)

Existing DB auth schema already exists:

- `auth.users`
- `auth.api_keys`

Current API keyed behavior is header-based and not yet user-entitlement-aware.

Implication: we extend the current auth schema; do not introduce a second parallel user store.

---

## 2) Design Principles (non-negotiable)

1. Additive DB only. Do not modify `catalog.*` or `enrich.*` semantics.
2. Server-side enforcement is source of truth (never trust frontend flags).
3. Fail-safe for billing/auth outages:
   - Existing public/anonymous behavior remains available unless explicitly gated.
4. Idempotent webhooks with replay safety.
5. Every entitlement decision is explainable from DB rows.

---

## 3) Target Architecture

1. Clerk handles identity/session.
2. Stripe handles subscription lifecycle.
3. Dig DB stores entitlement state keyed by Clerk user ID.
4. API/MCP read entitlements and enforce:
   - feature access
   - rate limits
   - LLM beta access
5. Web renders plan state and upgrade actions from server-fetched entitlement state.

High-level flow:

1. User signs in with Clerk.
2. `auth.users` row is upserted from Clerk claims.
3. User upgrades via Stripe Checkout.
4. Stripe webhook writes subscription state.
5. Entitlement projector updates `auth.user_entitlements`.
6. API/MCP gates immediately use updated entitlements.

---

## 4) DB Changes (Migration 018)

Create additive auth tables (keep existing `auth.users` and `auth.api_keys`):

1. `auth.user_profiles`
   - `user_id uuid PK references auth.users(id)`
   - `clerk_user_id text unique not null`
   - `display_name text null`
   - `avatar_url text null`
   - `created_at timestamptz default now()`
   - `updated_at timestamptz default now()`

2. `auth.subscriptions`
   - `id uuid PK`
   - `user_id uuid not null references auth.users(id)`
   - `provider text not null default 'stripe'`
   - `provider_customer_id text not null`
   - `provider_subscription_id text unique not null`
   - `status text not null` (`trialing|active|past_due|canceled|incomplete|incomplete_expired|unpaid`)
   - `price_id text not null`
   - `current_period_start timestamptz null`
   - `current_period_end timestamptz null`
   - `cancel_at_period_end boolean default false`
   - `created_at timestamptz default now()`
   - `updated_at timestamptz default now()`

3. `auth.user_entitlements`
   - `user_id uuid PK references auth.users(id)`
   - `plan text not null default 'free'` (`free|early_access|team`)
   - `llm_beta_access boolean not null default false`
   - `monthly_request_limit integer not null default 500`
   - `rpm_limit integer not null default 20`
   - `features jsonb not null default '{}'::jsonb`
   - `effective_at timestamptz default now()`
   - `updated_at timestamptz default now()`

4. `auth.usage_quotas`
   - `user_id uuid not null references auth.users(id)`
   - `period_month text not null` (`YYYY-MM`)
   - `request_count integer not null default 0`
   - `llm_request_count integer not null default 0`
   - `created_at timestamptz default now()`
   - `updated_at timestamptz default now()`
   - PK `(user_id, period_month)`

5. `auth.billing_events`
   - `id uuid PK`
   - `provider text not null default 'stripe'`
   - `provider_event_id text unique not null`
   - `event_type text not null`
   - `payload jsonb not null`
   - `processed_at timestamptz null`
   - `created_at timestamptz default now()`

Indexes:

1. `idx_user_profiles_clerk_user_id`
2. `idx_subscriptions_user_status`
3. `idx_usage_quotas_period`
4. `idx_billing_events_provider_event_id` unique

Notes:

1. Keep `auth.api_keys` as-is in v1; link via `user_id`.
2. Add migration and schema.ts updates in same commit.

---

## 5) Entitlement Model (v1 defaults)

Plan matrix:

1. `free`
   - `monthly_request_limit=500`
   - `rpm_limit=20`
   - `llm_beta_access=false` (unless allowlisted)
   - features: `{ "favorites": true, "advanced_search": false, "mcp_high_limit": false }`

2. `early_access` (target GBP 5/month)
   - `monthly_request_limit=10000`
   - `rpm_limit=120`
   - `llm_beta_access=true`
   - features: `{ "favorites": true, "advanced_search": true, "mcp_high_limit": true }`

3. `team`
   - staged later; keep mapping but no public purchase flow in v1.

Entitlement resolver precedence:

1. Manual override row (if implemented) >
2. active subscription mapping >
3. default free.

---

## 6) API/MCP Enforcement Plan

### 6.1 New shared auth package logic

Add in `packages/domain` (or `apps/api/src/auth` if preferred):

1. `resolveUserFromClerk(req)`
2. `getUserEntitlements(userId)`
3. `enforceFeature(userId, featureKey)`
4. `enforceRpm(userId, rpmLimit)`
5. `enforceMonthlyQuota(userId, monthlyLimit)`

### 6.2 API route rollout

Phase gate order:

1. Read-only instrumentation phase:
   - resolve entitlements and log decision (no blocking).
2. Soft enforcement phase:
   - return warning headers when limits exceeded.
3. Hard enforcement phase:
   - block with 429/402-style contract for gated endpoints.

Initial gated endpoints:

1. `/v1/ask` (LLM beta access + per-user quotas)
2. Future premium endpoints only.

Do not gate core public search/retrieval in v1 unless explicitly decided.

### 6.3 MCP behavior

1. Keep anonymous MCP for discovery.
2. If MCP client presents user API key (from `auth.api_keys`), apply plan-based limits.
3. Preserve current anonymous safety caps.

---

## 7) Web App Integration (`apps/web`)

### 7.1 Clerk integration

1. Add Clerk SDK and middleware for App Router.
2. Add auth pages:
   - `/sign-in`
   - `/sign-up`
   - `/account` (profile + plan + API key info)

### 7.2 Entitlement-aware UI

1. Add server action/fetch helper for `/v1/me/entitlements`.
2. In LLM beta page:
   - signed out -> sign-in prompt
   - signed in free without beta -> upgrade/waitlist state
   - signed in with beta -> enabled

3. Add small account badge/menu in nav:
   - signed out: `Sign in`
   - signed in: `Account`

### 7.3 Favorites scaffold (v1)

Implement favorites because it is low-risk and visible value:

1. New table `auth.user_favorites`
   - `(user_id, entity_type, discogs_id)` unique.
2. API endpoints:
   - `GET /v1/me/favorites`
   - `POST /v1/me/favorites`
   - `DELETE /v1/me/favorites/:entity_type/:discogs_id`
3. Web button on artist/release/version pages: `Save`.

---

## 8) Stripe Integration

### 8.1 Product setup

1. Create Stripe product `Dig Early Access`.
2. Monthly price in GBP (`£5`).
3. Save `price_id` in env/config mapping.

### 8.2 Endpoints

1. `POST /v1/billing/checkout-session`
   - requires signed-in user
   - creates Stripe checkout for mapped price
2. `POST /v1/billing/webhook`
   - verify signature
   - idempotent via `auth.billing_events.provider_event_id`

### 8.3 Webhook handling contract

Handle at least:

1. `checkout.session.completed`
2. `customer.subscription.created`
3. `customer.subscription.updated`
4. `customer.subscription.deleted`
5. `invoice.payment_failed`

Processing steps:

1. Upsert `auth.subscriptions`.
2. Recompute row in `auth.user_entitlements`.
3. Mark `billing_events.processed_at`.

---

## 9) Security Requirements

1. Never store raw Clerk/Stripe tokens in DB logs.
2. Webhook signature verification required.
3. API keys stored hashed only (`auth.api_keys.key_hash`).
4. LLM provider keys remain session-only on frontend as currently designed.
5. Add structured audit logs for entitlement changes.

---

## 10) Env Vars

Web:

1. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
2. `CLERK_SECRET_KEY`
3. `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
4. `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`

API:

1. `CLERK_ISSUER`
2. `CLERK_JWKS_URL` (or use Clerk SDK verifier)
3. `STRIPE_SECRET_KEY`
4. `STRIPE_WEBHOOK_SECRET`
5. `STRIPE_PRICE_EARLY_ACCESS_GBP_MONTHLY`
6. `BILLING_ENABLED=true`

---

## 11) Rollout Phases

### Phase A: Schema + read path (no gating)

1. Migration 018/019 apply.
2. Add entitlement resolver.
3. Add `/v1/me/entitlements`.
4. Observe logs only.

Gate A pass:

1. Existing public flows unchanged.
2. Entitlement resolver p95 < 20ms.

### Phase B: Clerk web auth

1. Add Clerk middleware + sign-in/up/account pages.
2. Auto-provision `auth.users` + `auth.user_profiles` on first sign-in.

Gate B pass:

1. Sign-in flow works desktop/mobile.
2. No regression on anonymous pages.

### Phase C: Stripe billing + entitlement projection

1. Add checkout + webhook endpoints.
2. Entitlements update on webhook.

Gate C pass:

1. Test purchase updates plan within 10s.
2. Cancel/revoke transitions reflected correctly.

### Phase D: Hard gating

1. Enforce LLM beta access and quotas on `/v1/ask`.
2. Enforce per-user limits for keyed usage.

Gate D pass:

1. Free user blocked from beta as expected.
2. Early Access user allowed and rate limits match plan.

---

## 12) Test Plan

### Unit

1. Entitlement resolver mapping tests.
2. Quota increment/reset tests.
3. Webhook idempotency tests.

### Integration

1. Clerk JWT -> user resolution.
2. Checkout session creation.
3. Webhook event replay (duplicate events ignored).

### End-to-end

1. Sign up -> free plan -> LLM blocked.
2. Upgrade -> LLM enabled.
3. Monthly quota exceeded -> correct error contract.
4. API key request path follows entitlement (self-serve; max 2 active keys/user).

### Regression smoke (must remain green)

1. Search/release/version/artist/label pages.
2. MCP anonymous core tools.
3. Existing usage and SEO endpoints.

---

## 13) Response/Error Contract Additions

New standardized errors:

1. `AUTH_REQUIRED` (401)
2. `PLAN_UPGRADE_REQUIRED` (402/403)
3. `FEATURE_NOT_ENABLED` (403)
4. `QUOTA_EXCEEDED` (429)

Body shape must match existing error contract:

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Monthly quota reached",
    "details": { "limit": 500, "period_month": "2026-03" }
  }
}
```

---

## 14) Rollback Plan

1. Set `BILLING_ENABLED=false` to disable checkout/webhook logic.
2. Disable hard enforcement flag (`ENTITLEMENTS_ENFORCE=false`) to return to observe-only.
3. Keep tables in place (no destructive rollback needed).
4. If Clerk outage, allow anonymous fallback on non-gated endpoints.

---

## 15) Work Breakdown for Handoff Agent

1. Migration + schema updates
   - `018_auth_entitlements.ts`
   - `019_user_favorites.ts`
   - `packages/db/src/schema.ts`

2. API auth/entitlements module
   - resolver + middleware + quota accounting

3. Billing routes
   - checkout + webhook + tests

4. Web integration
   - Clerk setup
   - account page
   - LLM beta gating UI
   - favorites buttons + API calls

5. Contracts/docs
   - update `docs/phase2-response-contracts.md`
   - add runbook entries for billing incident handling

6. Verification
   - typecheck/tests for `@dig/db`, `@dig/api`, `@dig/web`
   - staged deploy order and smoke checks

---

## 16) Confirmed Product Decisions (2026-03-09)

1. Confirm launch pricing: `GBP 5/month` for `early_access`.
2. Confirm LLM beta included in `early_access` by default.
3. Keep core search/retrieval fully free in v1 (yes).
4. API key mode: self-serve in v1 account page (max 2 active keys/user).
5. Billing cadence: monthly-only at launch (no annual in v1).

---

## 17) Implementation Defaults (locked)

1. `early_access = GBP 5/month`
2. `llm_beta_access included in early_access`
3. `core search remains free`
4. `API key self-serve enabled for early_access` (max 2 active keys/user)
5. `monthly billing only`

This keeps launch simple and monetization testable with minimal operational risk.
