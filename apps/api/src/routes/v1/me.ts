// ---------------------------------------------------------------------------
// /v1/me - Discogs sign-in for Record Bore.
//
//   GET    /v1/me/discogs/login?return=/recordbore   → 302 to Discogs
//   GET    /v1/me/discogs/callback                   → 302 back to the web page
//   GET    /v1/me                                    → who, counts, sync state
//   POST   /v1/me/sync                               → re-pull both lists
//   POST   /v1/me/logout                             → end this session
//   DELETE /v1/me                                    → forget the account
//
// The dig session travels as "Authorization: Bearer <token>". The web page
// receives it once, in the URL fragment of the callback redirect (fragments
// never reach a server or a log), and keeps it in localStorage. dig-api and
// app.dig.baby are different sites, so a cookie would be third-party and
// Safari would drop it.
//
// Off unless DISCOGS_CONSUMER_KEY, DISCOGS_CONSUMER_SECRET and USER_TOKEN_KEY
// are all set: every route then answers 404 and the page hides the link.
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { AUTHORIZE_URL, consumerFromEnv, getAccessToken, getIdentity, getRequestToken } from "../../users/discogs.js";
import {
  bearer, createSession, customerForToken, deleteAccount, endSession, isSignInConfigured, isStale, syncCrates, upsertAccount,
  type Customer,
} from "../../users/store.js";

const WEB_ORIGIN = (process.env.WEB_ORIGIN ?? "https://app.dig.baby").replace(/\/$/, "");
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL ?? "https://dig-api.fly.dev").replace(/\/$/, "");
const PENDING_TTL_MS = 15 * 60_000;

/**
 * Private until SIGNIN_OPEN=on: only the Discogs usernames in SIGNIN_ALLOWLIST
 * (comma-separated, any case) can finish signing in. Anyone else is sent back
 * before an account row exists; their username goes to the log so it can be
 * added.
 */
export function mayFinishSignIn(username: string, env = process.env): boolean {
  if (String(env.SIGNIN_OPEN ?? "").trim().toLowerCase() === "on") return true;
  const allowed = String(env.SIGNIN_ALLOWLIST ?? "").split(",").map((u) => u.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(username.trim().toLowerCase());
}

/** Only a path on the web origin, optionally ?signin=1: never "//evil" or a full URL. */
export function safeReturnPath(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return /^\/(?!\/)[A-Za-z0-9/_-]{0,80}(\?signin=1)?$/.test(s) ? s : "/recordbore";
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found", details: null } });
}

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Not signed in", details: null } });
}

export function publicCustomer(c: Customer) {
  return {
    username: c.username,
    wants: c.wants,
    collection: c.collection,
    synced_at: c.syncedAt,
    syncing: !c.syncedAt && !c.syncError,
    sync_failed: Boolean(c.syncError),
  };
}

export function registerMeRoutes(app: FastifyInstance, db: Kysely<Database>) {
  const enabled = () => {
    const consumer = consumerFromEnv();
    return consumer && isSignInConfigured() ? consumer : null;
  };
  const log = (req: FastifyRequest) => (msg: string, extra?: Record<string, unknown>) => req.log.info({ event: msg, ...extra });

  app.get("/v1/me/discogs/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (req: FastifyRequest<{ Querystring: { return?: string } }>, reply) => {
    const consumer = enabled();
    if (!consumer) return notFound(reply);
    await db.deleteFrom("users.oauth_pending").where("created_at", "<", new Date(Date.now() - PENDING_TTL_MS)).execute();
    try {
      const rt = await getRequestToken(consumer, `${API_PUBLIC_URL}/v1/me/discogs/callback`);
      await db.insertInto("users.oauth_pending").values({
        request_token: rt.token,
        request_secret: rt.secret,
        return_to: safeReturnPath(req.query?.return),
      }).execute();
      return reply.redirect(`${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(rt.token)}`);
    } catch (err: any) {
      log(req)("users:login_failed", { error: String(err?.message ?? err) });
      return reply.redirect(`${WEB_ORIGIN}${safeReturnPath(req.query?.return)}#dig_signin=failed`);
    }
  });

  app.get("/v1/me/discogs/callback", async (
    req: FastifyRequest<{ Querystring: { oauth_token?: string; oauth_verifier?: string; denied?: string } }>,
    reply,
  ) => {
    const consumer = enabled();
    if (!consumer) return notFound(reply);
    const requestToken = String(req.query?.oauth_token ?? req.query?.denied ?? "");
    const pending = requestToken
      ? await db.deleteFrom("users.oauth_pending").where("request_token", "=", requestToken)
        .where("created_at", ">", new Date(Date.now() - PENDING_TTL_MS))
        .returningAll().executeTakeFirst()
      : undefined;
    const back = pending?.return_to ?? "/recordbore";
    // "Cancel" on Discogs comes back as ?denied=<token>.
    if (!pending || req.query?.denied || !req.query?.oauth_verifier) {
      return reply.redirect(`${WEB_ORIGIN}${back}#dig_signin=cancelled`);
    }
    try {
      const access = await getAccessToken(consumer, pending.request_token, pending.request_secret, String(req.query.oauth_verifier));
      const identity = await getIdentity(consumer, access.token, access.secret);
      if (!mayFinishSignIn(identity.username)) {
        log(req)("users:signin_not_allowed", { discogs_username: identity.username });
        return reply.redirect(`${WEB_ORIGIN}${back}#dig_signin=closed`);
      }
      const accountId = await upsertAccount(db, identity, access);
      const session = await createSession(db, accountId);
      // Pull the crates after the redirect: the page polls /v1/me meanwhile.
      void syncCrates(db, consumer, accountId, log(req));
      log(req)("users:signed_in", {});
      return reply.redirect(`${WEB_ORIGIN}${back}#dig_session=${session}`);
    } catch (err: any) {
      log(req)("users:callback_failed", { error: String(err?.message ?? err) });
      return reply.redirect(`${WEB_ORIGIN}${back}#dig_signin=failed`);
    }
  });

  app.get("/v1/me", async (req, reply) => {
    const consumer = enabled();
    if (!consumer) return notFound(reply);
    const customer = await customerForToken(db, bearer(req.headers));
    if (!customer) return unauthorized(reply);
    if (isStale(customer) && customer.syncedAt) void syncCrates(db, consumer, customer.accountId, log(req));
    reply.header("cache-control", "no-store");
    return reply.send(publicCustomer(customer));
  });

  app.post("/v1/me/sync", {
    config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const consumer = enabled();
    if (!consumer) return notFound(reply);
    const customer = await customerForToken(db, bearer(req.headers));
    if (!customer) return unauthorized(reply);
    void syncCrates(db, consumer, customer.accountId, log(req));
    return reply.status(202).send({ syncing: true });
  });

  app.post("/v1/me/logout", async (req, reply) => {
    if (!enabled()) return notFound(reply);
    const token = bearer(req.headers);
    if (token) await endSession(db, token);
    return reply.status(204).send();
  });

  app.delete("/v1/me", async (req, reply) => {
    if (!enabled()) return notFound(reply);
    const customer = await customerForToken(db, bearer(req.headers));
    if (!customer) return unauthorized(reply);
    await deleteAccount(db, customer.accountId);
    log(req)("users:account_deleted", {});
    return reply.status(204).send();
  });
}
