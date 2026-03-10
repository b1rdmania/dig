/**
 * Spotify OAuth + export routes.
 * Feature-flagged: SPOTIFY_EXPORT_ENABLED=true required.
 *
 * GET    /v1/auth/spotify                           — start OAuth (redirect to Spotify)
 * GET    /v1/auth/spotify/callback                  — OAuth callback
 * DELETE /v1/auth/spotify                           — disconnect
 * GET    /v1/auth/spotify/status                    — connected? (for frontend)
 *
 * POST   /v1/me/mixtapes/:id/export                 — start async Spotify export
 * GET    /v1/me/mixtapes/:id/export/:jobId           — poll job status
 * GET    /v1/me/mixtapes/:id/exports                 — list recent jobs
 */

import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely, Database } from "@dig/db";
import type Redis from "ioredis";
import { resolveUser, resolveClerkUserId } from "../../auth.js";
import { encryptToken, decryptToken } from "../../spotify-crypto.js";
import {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  getSpotifyUserId,
  createPlaylist,
  addTracksToPlaylist,
} from "../../spotify-client.js";
import { matchTrack } from "../../spotify-matcher.js";
import {
  upsertSpotifyToken,
  getSpotifyToken,
  deleteSpotifyToken,
  isTokenExpired,
  createExportJob,
  getExportJob,
  listExportJobs,
  updateExportJob,
} from "@dig/domain";
import { listTracks } from "@dig/domain";

const ENABLED = process.env.SPOTIFY_EXPORT_ENABLED === "true";
const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? "https://app.dig.baby";
const PKCE_TTL = 600; // 10 minutes in seconds

function notEnabled(reply: any) {
  return reply.status(501).send({ error: { code: "NOT_IMPLEMENTED", message: "Spotify export is not yet enabled.", details: null } });
}
function unauthorized(reply: any) {
  return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Sign in required.", details: null } });
}
function planRequired(reply: any) {
  return reply.status(403).send({ error: { code: "PLAN_UPGRADE_REQUIRED", message: "Spotify export requires an Early Access plan.", details: null } });
}

function requireEarlyAccess(user: Awaited<ReturnType<typeof resolveUser>>, reply: any): boolean {
  const plan = user?.entitlements.plan;
  if (plan !== "early_access" && plan !== "team") { planRequired(reply); return false; }
  return true;
}

/** PKCE: generate verifier + S256 challenge */
function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Get a valid access token, refreshing if needed. */
async function getValidAccessToken(
  db: Kysely<Database>,
  userId: string,
): Promise<string | null> {
  const stored = await getSpotifyToken(db, userId);
  if (!stored) return null;

  if (!isTokenExpired(stored)) {
    return decryptToken(stored.accessTokenEnc);
  }

  // Refresh
  try {
    const refreshToken = decryptToken(stored.refreshTokenEnc);
    const tokens = await refreshAccessToken(refreshToken);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    await upsertSpotifyToken(
      db,
      userId,
      encryptToken(tokens.access_token),
      tokens.refresh_token ? encryptToken(tokens.refresh_token) : stored.refreshTokenEnc,
      tokens.token_type,
      tokens.scope ?? stored.scopes,
      expiresAt,
    );
    return tokens.access_token;
  } catch {
    return null;
  }
}

/** Fire-and-forget export runner — called after 202 response is sent. */
async function runSpotifyExport(
  db: Kysely<Database>,
  jobId: string,
  userId: string,
  mixtapeId: string,
  mixtapeTitle: string,
): Promise<void> {
  await updateExportJob(db, jobId, { status: "running" });

  try {
    const accessToken = await getValidAccessToken(db, userId);
    if (!accessToken) {
      await updateExportJob(db, jobId, {
        status: "failed",
        error_message: "Spotify account not connected or token expired. Reconnect and try again.",
      });
      return;
    }

    const tracks = await listTracks(db, userId, mixtapeId);
    if (!tracks || tracks.length === 0) {
      await updateExportJob(db, jobId, {
        status: "failed",
        error_message: "Mixtape has no tracks.",
      });
      return;
    }

    // Match all tracks
    const matchResults = await Promise.all(
      tracks.map((t) => matchTrack(accessToken, t.id, t.name, t.artist)),
    );

    const matched = matchResults.filter((r) => r.matched);
    const uris = matched.map((r) => r.spotify_track_uri!);

    // Create playlist on Spotify
    const spotifyUserId = await getSpotifyUserId(accessToken);
    const playlist = await createPlaylist(accessToken, spotifyUserId, mixtapeTitle);

    if (uris.length > 0) {
      await addTracksToPlaylist(accessToken, playlist.id, uris);
    }

    await updateExportJob(db, jobId, {
      status: "succeeded",
      platform_playlist_id: playlist.id,
      platform_playlist_url: playlist.external_urls.spotify,
      tracks_matched: matched.length,
      tracks_total: tracks.length,
      track_results: matchResults,
    });
  } catch (err) {
    await updateExportJob(db, jobId, {
      status: "failed",
      error_message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export function registerSpotifyRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  redis: Redis | null,
): void {
  // ── OAuth ─────────────────────────────────────────────────────────────────

  // GET /v1/auth/spotify — redirect to Spotify consent screen
  app.get("/v1/auth/spotify", async (req: FastifyRequest, reply) => {
    if (!ENABLED) return notEnabled(reply);
    const clerkUserId = await resolveClerkUserId(req.headers.authorization);
    if (!clerkUserId) return unauthorized(reply);

    if (!redis) {
      return reply.status(503).send({ error: { code: "INTERNAL_ERROR", message: "OAuth state store unavailable.", details: null } });
    }

    const { verifier, challenge } = generatePkce();
    const state = randomBytes(16).toString("hex");

    // Store verifier keyed by state, TTL 10 min
    await redis.set(`spotify:pkce:${state}`, JSON.stringify({ verifier, clerkUserId }), "EX", PKCE_TTL);

    const authUrl = buildAuthUrl(state, challenge);
    return reply.redirect(authUrl);
  });

  // GET /v1/auth/spotify/callback
  app.get("/v1/auth/spotify/callback", async (
    req: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>,
    reply,
  ) => {
    if (!ENABLED) return notEnabled(reply);

    const { code, state, error } = req.query;

    if (error || !code || !state) {
      return reply.redirect(`${WEB_URL}/account?spotify=cancelled`);
    }

    if (!redis) {
      return reply.redirect(`${WEB_URL}/account?spotify=error`);
    }

    const stored = await redis.get(`spotify:pkce:${state}`);
    if (!stored) {
      return reply.redirect(`${WEB_URL}/account?spotify=error&reason=state_expired`);
    }

    let verifier: string;
    let clerkUserId: string;
    try {
      const parsed = JSON.parse(stored) as { verifier: string; clerkUserId: string };
      verifier = parsed.verifier;
      clerkUserId = parsed.clerkUserId;
    } catch {
      return reply.redirect(`${WEB_URL}/account?spotify=error`);
    }

    await redis.del(`spotify:pkce:${state}`);

    // Resolve internal userId
    const user = await resolveUser(db, undefined);
    // We only have clerkUserId here — use domain directly
    const { upsertUserFromClerk, getEntitlementsByClerkId } = await import("@dig/domain");
    const userId = await upsertUserFromClerk(db, clerkUserId, "", undefined, undefined);
    const entitlements = await getEntitlementsByClerkId(db, clerkUserId);
    const plan = entitlements.plan;
    if (plan !== "early_access" && plan !== "team") {
      return reply.redirect(`${WEB_URL}/account?spotify=error&reason=plan_required`);
    }

    try {
      const tokens = await exchangeCode(code, verifier);
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      await upsertSpotifyToken(
        db,
        userId,
        encryptToken(tokens.access_token),
        encryptToken(tokens.refresh_token),
        tokens.token_type,
        tokens.scope,
        expiresAt,
      );
      return reply.redirect(`${WEB_URL}/account?spotify=connected`);
    } catch {
      return reply.redirect(`${WEB_URL}/account?spotify=error`);
    }
  });

  // DELETE /v1/auth/spotify — disconnect
  app.delete("/v1/auth/spotify", async (req: FastifyRequest, reply) => {
    if (!ENABLED) return notEnabled(reply);
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return unauthorized(reply);
    await deleteSpotifyToken(db, user.userId);
    return reply.status(204).send();
  });

  // GET /v1/auth/spotify/status
  app.get("/v1/auth/spotify/status", async (req: FastifyRequest, reply) => {
    if (!ENABLED) return reply.send({ connected: false, enabled: false });
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return unauthorized(reply);
    const token = await getSpotifyToken(db, user.userId);
    return reply.send({ connected: !!token, enabled: true, scopes: token?.scopes ?? null });
  });

  // ── Export jobs ───────────────────────────────────────────────────────────

  // POST /v1/me/mixtapes/:id/export — start export
  app.post("/v1/me/mixtapes/:id/export", async (
    req: FastifyRequest<{ Params: { id: string }; Body: { platform?: string } }>,
    reply,
  ) => {
    if (!ENABLED) return notEnabled(reply);
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return unauthorized(reply);
    if (!requireEarlyAccess(user, reply)) return;

    const platform = req.body?.platform ?? "spotify";
    if (platform !== "spotify") {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "Only spotify platform supported.", details: null } });
    }

    // Verify mixtape ownership
    const { getMixtape } = await import("@dig/domain");
    const mixtape = await getMixtape(db, user.userId, req.params.id);
    if (!mixtape) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Mixtape not found.", details: null } });
    }

    // Check Spotify connected
    const token = await getSpotifyToken(db, user.userId);
    if (!token) {
      return reply.status(422).send({ error: { code: "SPOTIFY_NOT_CONNECTED", message: "Connect your Spotify account first.", details: null } });
    }

    const job = await createExportJob(db, user.userId, req.params.id, "spotify");

    // Respond immediately, run export async
    reply.status(202).send({ job });

    setImmediate(() => {
      runSpotifyExport(db, job.id, user.userId, req.params.id, mixtape.title).catch(() => {});
    });
  });

  // GET /v1/me/mixtapes/:id/export/:jobId — poll status
  app.get("/v1/me/mixtapes/:id/export/:jobId", async (
    req: FastifyRequest<{ Params: { id: string; jobId: string } }>,
    reply,
  ) => {
    if (!ENABLED) return notEnabled(reply);
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return unauthorized(reply);
    if (!requireEarlyAccess(user, reply)) return;

    const job = await getExportJob(db, user.userId, req.params.jobId);
    if (!job) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Export job not found.", details: null } });
    }
    return reply.send({ job });
  });

  // GET /v1/me/mixtapes/:id/exports — list recent jobs
  app.get("/v1/me/mixtapes/:id/exports", async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => {
    if (!ENABLED) return notEnabled(reply);
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return unauthorized(reply);
    if (!requireEarlyAccess(user, reply)) return;

    const jobs = await listExportJobs(db, user.userId, req.params.id);
    return reply.send({ jobs });
  });
}
