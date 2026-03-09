/**
 * Billing routes: Stripe checkout + webhook.
 * Phase C of Clerk + Stripe + Entitlements v1.
 *
 * POST /v1/billing/checkout-session  — create Stripe checkout (requires Clerk JWT)
 * POST /v1/billing/webhook           — Stripe event receiver (signature-verified)
 * GET  /v1/billing/status            — current subscription status for caller
 */

import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { createClerkClient, verifyToken as clerkVerifyToken } from "@clerk/backend";
import { applyStripeEvent, upsertUserFromClerk, getEntitlementsByClerkId } from "@dig/domain";
import type { Kysely, Database } from "@dig/db";

const BILLING_ENABLED = process.env.BILLING_ENABLED === "true";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const STRIPE_PRICE_EARLY_ACCESS = process.env.STRIPE_PRICE_EARLY_ACCESS_GBP_MONTHLY ?? "";
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "";
const CLERK_ISSUER = process.env.CLERK_ISSUER ?? "";

function getStripe(): Stripe {
  if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2026-02-25.clover" });
}

/** Extract and verify Clerk JWT from Authorization header. Returns clerkUserId or null. */
async function resolveClerkUser(authHeader: string | undefined): Promise<{
  clerkUserId: string;
  email: string;
  firstName: string | null;
  imageUrl: string | null;
} | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const payload = await clerkVerifyToken(token, {
      secretKey: CLERK_SECRET_KEY,
    });
    const userId = payload.sub;
    const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY });
    const user = await clerk.users.getUser(userId);
    return {
      clerkUserId: userId,
      email: user.emailAddresses[0]?.emailAddress ?? "",
      firstName: user.firstName ?? null,
      imageUrl: user.imageUrl ?? null,
    };
  } catch {
    return null;
  }
}

export function registerBillingRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  if (!BILLING_ENABLED) {
    // Register stubs that return 503 when billing is disabled
    app.post("/v1/billing/checkout-session", async (_req, reply) => {
      return reply.status(503).send({ error: { code: "BILLING_DISABLED", message: "Billing not enabled" } });
    });
    app.post("/v1/billing/webhook", async (_req, reply) => {
      return reply.status(503).send({ error: { code: "BILLING_DISABLED", message: "Billing not enabled" } });
    });
    app.get("/v1/billing/status", async (_req, reply) => {
      return reply.status(503).send({ error: { code: "BILLING_DISABLED", message: "Billing not enabled" } });
    });
    return;
  }

  // POST /v1/billing/checkout-session
  app.post("/v1/billing/checkout-session", async (req, reply) => {
    const clerkUser = await resolveClerkUser(req.headers.authorization);
    if (!clerkUser) {
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in required", details: null } });
    }

    const stripe = getStripe();
    const { clerkUserId, email, firstName, imageUrl } = clerkUser;

    // Upsert user, get internal userId
    const userId = await upsertUserFromClerk(db, clerkUserId, email, firstName ?? undefined, imageUrl ?? undefined);

    // Find or create Stripe customer
    const userRow = await db
      .selectFrom("auth.users")
      .select("stripe_customer_id")
      .where("id", "=", userId)
      .executeTakeFirst();

    let customerId = userRow?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({ email, name: firstName ?? undefined, metadata: { clerk_user_id: clerkUserId } });
      customerId = customer.id;
      await db.updateTable("auth.users").set({ stripe_customer_id: customerId }).where("id", "=", userId).execute();
    }

    const body = req.body as { success_url?: string; cancel_url?: string } | undefined;
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: STRIPE_PRICE_EARLY_ACCESS, quantity: 1 }],
      success_url: body?.success_url ?? `${process.env.WEB_ORIGIN ?? "https://app.dig.baby"}/account?checkout=success`,
      cancel_url: body?.cancel_url ?? `${process.env.WEB_ORIGIN ?? "https://app.dig.baby"}/account?checkout=cancel`,
      allow_promotion_codes: true,
    });

    return reply.send({ url: session.url, session_id: session.id });
  });

  // POST /v1/billing/webhook — raw body required for signature verification
  app.post("/v1/billing/webhook", {
    config: { rawBody: true },
  }, async (req, reply) => {
    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "Missing stripe-signature", details: null } });
    }

    const stripe = getStripe();
    let event: Stripe.Event;
    try {
      const rawBody = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));
      event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: `Webhook signature failed: ${err.message}`, details: null } });
    }

    // Process relevant events
    try {
      await handleStripeEvent(db, event);
    } catch (err) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", code: "WEBHOOK_ERROR", event_type: event.type, event_id: event.id, message: String(err) }));
      return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Webhook processing failed", details: null } });
    }

    return reply.send({ received: true });
  });

  // GET /v1/billing/status
  app.get("/v1/billing/status", async (req, reply) => {
    const clerkUser = await resolveClerkUser(req.headers.authorization);
    if (!clerkUser) {
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in required", details: null } });
    }

    const entitlements = await getEntitlementsByClerkId(db, clerkUser.clerkUserId);
    return reply.send({
      plan: entitlements.plan,
      llm_beta_access: entitlements.llmBetaAccess,
      monthly_request_limit: entitlements.monthlyRequestLimit,
      rpm_limit: entitlements.rpmLimit,
      features: entitlements.features,
    });
  });
}

async function handleStripeEvent(db: Kysely<Database>, event: Stripe.Event): Promise<void> {
  const HANDLED = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
  ]);

  if (!HANDLED.has(event.type)) return;

  let customerId: string | null = null;
  let subscriptionId: string | null = null;
  let subscriptionStatus: string | null = null;
  let priceId: string | null = null;
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  let cancelAtPeriodEnd = false;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    if (session.mode === "subscription" && session.subscription) {
      subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    }
  } else if (event.type.startsWith("customer.subscription.")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = event.data.object as any;
    customerId = typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null);
    subscriptionId = sub.id;
    subscriptionStatus = sub.status;
    const item = sub.items?.data?.[0];
    priceId = item?.price?.id ?? null;
    // In newer Stripe API, period lives on each item; fall back to top-level if present
    const rawStart = item?.period?.start ?? sub.current_period_start ?? null;
    const rawEnd = item?.period?.end ?? sub.current_period_end ?? null;
    periodStart = rawStart ? new Date(rawStart * 1000) : null;
    periodEnd = rawEnd ? new Date(rawEnd * 1000) : null;
    cancelAtPeriodEnd = sub.cancel_at_period_end ?? false;
  } else if (event.type === "invoice.payment_failed") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = event.data.object as any;
    customerId = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null);
    // New Stripe API: invoice.parent.subscription_details.subscription
    const subRef = invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? null;
    subscriptionId = typeof subRef === "string" ? subRef : (subRef?.id ?? null);
    subscriptionStatus = "past_due";
  }

  if (!customerId) return;

  await applyStripeEvent(
    db,
    event.id,
    event.type,
    event.data.object,
    customerId,
    subscriptionId,
    subscriptionStatus,
    priceId,
    periodStart,
    periodEnd,
    cancelAtPeriodEnd,
  );
}
