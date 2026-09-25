// ---------------------------------------------------------------------------
// /v1/ask - Fastify route registration
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import type { AnthropicMessage, MediaItem, ResponseMode } from "./types.js";
import type { BoreConfig } from "./bore.js";
import { requirePrivateKey } from "./auth.js";
import { checkPublicAsk, isPublicAskEnabled, publicAskRemaining, recordPublicAsk } from "./public.js";
import { runAgenticLoop, type LlmProvider } from "./loop.js";
import { bindMediaToCitations, dedupeMedia, extractCitedMasterIds } from "./binding.js";
import { getBore } from "./bores.js";

export type { MediaItem, EvidenceItem, ResponseMode } from "./types.js";

// Provider selection: set OPENROUTER_API_KEY to run server-side via OpenRouter
// (Kimi by default); otherwise falls back to the original BYO-Anthropic-key flow.
const PROVIDER: LlmProvider =
  (process.env.LLM_PROVIDER as LlmProvider | undefined) ??
  (process.env.OPENROUTER_API_KEY ? "openrouter" : "anthropic");
const DEFAULT_MODEL =
  process.env.LLM_MODEL ?? (PROVIDER === "openrouter" ? "moonshotai/kimi-k3" : "claude-sonnet-4-6");
const MAX_HISTORY_TURNS = 6;
// The page shows only what the answer names, so a generous pool costs
// nothing - a tight one let a flood of same-surname search hits push the
// actual picks (and the appellations) off the end.
const MAX_EVIDENCE = 40;
// The after-answer lookups (videos, the wine counter) run once the answer is
// written, so they add straight to the wait. Fail open: a slow lookup costs
// pictures, never the answer.
const AFTER_ANSWER_TIMEOUT_MS = 4_000;

/** The evidence the response carries, with the bore's after-answer detail. */
async function afterAnswer<E>(
  bore: BoreConfig<E>,
  db: Kysely<Database>,
  answer: string,
  evidence: E[],
  media: MediaItem[],
  log: (msg: string, extra?: Record<string, unknown>) => void,
): Promise<E[]> {
  const shown = dedupeBy(evidence, bore.evidenceKey).slice(0, MAX_EVIDENCE);
  if (!bore.fillMedia && !bore.enrichEvidence) return shown;
  const start = Date.now();
  const before = media.length;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.all([
    bore.fillMedia?.(db, answer, evidence, media).catch((err) => log("ask:media_fill_error", { error: String(err?.message ?? err) })),
    bore.enrichEvidence?.(db, shown).catch((err) => log("ask:enrich_error", { error: String(err?.message ?? err) })),
  ]);
  await Promise.race([work, new Promise((resolve) => { timer = setTimeout(resolve, AFTER_ANSWER_TIMEOUT_MS); })])
    .finally(() => clearTimeout(timer));
  log("ask:after_answer", { videos_added: media.length - before, elapsed_ms: Date.now() - start });
  return shown;
}

interface AskBody {
  /** Which shop: "record" (default) or "wine". Picks persona, tools, till. */
  bore?: string;
  question?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  max_tokens?: number;
  /**
   * Key holders only: run on the public page's house budgets (model, rounds,
   * tokens) so an eval measures what visitors get without spending the
   * public till. Ignored for keyless asks, which always run on them.
   */
  house?: boolean;
}

function pickBore(raw: unknown) {
  const slug = String(raw ?? "record").trim().toLowerCase();
  return getBore(slug === "wine" ? "wine" : "record");
}

function dedupeBy<E>(items: E[], key: (e: E) => string): E[] {
  const seen = new Set<string>();
  return items.filter((e) => { const k = key(e); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Aborts when the connection closes before the response has been written, so
// the loop stops paying for model calls nobody will read.
export function clientGone(reply: FastifyReply): AbortSignal {
  const gone = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) gone.abort(new Error("client disconnected"));
  });
  return gone.signal;
}

export function registerAskRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.get("/v1/ask/quota", async (req: FastifyRequest<{ Querystring: { bore?: string } }>, reply) => {
    if (!isPublicAskEnabled()) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found", details: null } });
    }
    const bore = pickBore(req.query?.bore);
    return reply.send({ remaining: publicAskRemaining(req, bore.quotaKey) });
  });

  app.post("/v1/ask", {
    config: {
      // Ask is expensive (LLM + DB). 10 req/min per IP regardless of key.
      // Private-key holders are trusted but still bounded to prevent runaway loops.
      rateLimit: { max: 10, timeWindow: "1 minute" },
    },
  }, async (req: FastifyRequest<{ Body: AskBody }>, reply) => {
    // Key holders pass as before; keyless visitors go through the public
    // (Record Bore) gate, which is off unless ASK_PUBLIC=on.
    const bore = pickBore(req.body?.bore);
    let isPublic = false;
    const auth = requirePrivateKey(req);
    if (!auth.ok) {
      if (!isPublicAskEnabled()) return reply.status(auth.status).send(auth.body);
      const pub = await checkPublicAsk(req, db, bore.quotaKey);
      if (!pub.ok) return reply.status(pub.status).send(pub.body);
      isPublic = true;
    }

    let apiKey: string;
    if (PROVIDER === "openrouter") {
      apiKey = String(process.env.OPENROUTER_API_KEY ?? "").trim();
      if (!apiKey) {
        return reply.status(503).send({
          error: { code: "CONFIG_ERROR", message: "LLM provider is not configured", details: null },
        });
      }
    } else {
      apiKey = String(req.headers["x-anthropic-api-key"] ?? "").trim();
      if (!apiKey) {
        return reply.status(503).send({
          error: { code: "CONFIG_ERROR", message: "x-anthropic-api-key header is required", details: null },
        });
      }
    }

    const body = req.body ?? {};
    const question = String(body.question ?? "").trim();
    if (question.length < 1 || question.length > 1000) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "question must be 1-1000 characters", details: null },
      });
    }

    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history: AnthropicMessage[] = rawHistory
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }));

    // Public asks run on the house defaults only - letting a stranger pick
    // the model or token budget on the shop's key is how the till empties.
    const house = isPublic || body.house === true;
    const maxTokens = house ? bore.publicMaxTokens : Math.min(Math.max(Number(body.max_tokens ?? 1600), 256), 2000);
    const maxRounds = house ? bore.publicMaxRounds : undefined;
    const model = house ? DEFAULT_MODEL : String(body.model ?? DEFAULT_MODEL);
    const started = Date.now();
    const log = (msg: string, extra?: Record<string, unknown>) =>
      req.log.info({ event: msg, ...extra });

    if (isPublic) await recordPublicAsk(db, bore.quotaKey);
    const signal = clientGone(reply);
    try {
      const { answer, model: usedModel, tool_calls, media, evidence, mode, rounds } = await runAgenticLoop({
        db,
        bore,
        question,
        history,
        model,
        maxTokens,
        maxRounds,
        provider: PROVIDER,
        apiKey,
        signal,
        log,
      });

      const shownEvidence = await afterAnswer(bore, db, answer, evidence, media, log);
      const dedupedMedia = dedupeMedia(media);

      // Citation-bound media: only return videos for masters whose dig.baby URL
      // appears in the assistant's answer text. See binding.ts for the rationale.
      const boundMedia = bindMediaToCitations(dedupedMedia, answer);

      log("ask:media_bind", {
        media_total: dedupedMedia.length,
        media_cited: boundMedia.length,
        masters_cited: extractCitedMasterIds(answer).size,
      });

      return reply.send({
        answer,
        bore: bore.slug,
        media: boundMedia,
        mode,
        evidence: shownEvidence,
        meta: {
          model: usedModel,
          elapsed_ms: Date.now() - started,
          tool_calls,
          rounds,
        },
      });
    } catch (err: any) {
      if (signal.aborted) {
        // Nobody is reading; the status only reaches the request log.
        log("ask:client_gone", { elapsed_ms: Date.now() - started });
        return reply.status(499).send();
      }
      log("ask:request_failed", { elapsed_ms: Date.now() - started, error: String(err?.message ?? err), status: err?.status });
      // 401 passthrough only makes sense on the BYO-key flow; with a
      // server-side OpenRouter key, upstream auth failures are our config
      // problem, not the client's.
      const isClientAuth = PROVIDER === "anthropic" && err?.status === 401;
      const status = isClientAuth ? 401 : 502;
      return reply.status(status).send({
        error: {
          code: isClientAuth ? "ANTHROPIC_AUTH_ERROR" : "LLM_UPSTREAM_ERROR",
          message: isClientAuth
            ? "Invalid Anthropic API key"
            : "Failed to generate response",
          // Upstream error detail goes to the structured log above, not to
          // clients - provider messages can leak internals.
          details: null,
        },
        mode: "upstream_error" as ResponseMode,
      });
    }
  });

  // -------------------------------------------------------------------------
  // /v1/ask/stream - same contract as /v1/ask but responds as NDJSON:
  //   {type:"status", label}   one per loop round / tool call, as they happen
  //   {type:"delta", text}     answer text as it streams; a status event after
  //                            deltas means that text was pre-tool chatter
  //   {type:"result", ...}     the final /v1/ask response body
  //   {type:"error", error, mode}  terminal error, same shape as /v1/ask errors
  // The reply is hijacked, so CORS + rate-limit headers from the plugins
  // don't apply - CORS is set manually (API is open-CORS by design).
  // -------------------------------------------------------------------------
  app.post("/v1/ask/stream", {
    config: {
      rateLimit: { max: 10, timeWindow: "1 minute" },
    },
  }, async (req: FastifyRequest<{ Body: AskBody }>, reply) => {
    const bore = pickBore(req.body?.bore);
    let isPublic = false;
    const auth = requirePrivateKey(req);
    if (!auth.ok) {
      if (!isPublicAskEnabled()) return reply.status(auth.status).send(auth.body);
      const pub = await checkPublicAsk(req, db, bore.quotaKey);
      if (!pub.ok) return reply.status(pub.status).send(pub.body);
      isPublic = true;
    }

    let apiKey: string;
    if (PROVIDER === "openrouter") {
      apiKey = String(process.env.OPENROUTER_API_KEY ?? "").trim();
      if (!apiKey) {
        return reply.status(503).send({
          error: { code: "CONFIG_ERROR", message: "LLM provider is not configured", details: null },
        });
      }
    } else {
      apiKey = String(req.headers["x-anthropic-api-key"] ?? "").trim();
      if (!apiKey) {
        return reply.status(503).send({
          error: { code: "CONFIG_ERROR", message: "x-anthropic-api-key header is required", details: null },
        });
      }
    }

    const body = req.body ?? {};
    const question = String(body.question ?? "").trim();
    if (question.length < 1 || question.length > 1000) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "question must be 1-1000 characters", details: null },
      });
    }

    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history: AnthropicMessage[] = rawHistory
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }));

    const house = isPublic || body.house === true;
    const maxTokens = house ? bore.publicMaxTokens : Math.min(Math.max(Number(body.max_tokens ?? 1600), 256), 2000);
    const maxRounds = house ? bore.publicMaxRounds : undefined;
    const model = house ? DEFAULT_MODEL : String(body.model ?? DEFAULT_MODEL);
    const started = Date.now();
    const log = (msg: string, extra?: Record<string, unknown>) =>
      req.log.info({ event: msg, ...extra });

    if (isPublic) await recordPublicAsk(db, bore.quotaKey);
    const signal = clientGone(reply);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "access-control-allow-origin": "*",
    });
    const write = (obj: unknown) => {
      try {
        reply.raw.write(`${JSON.stringify(obj)}\n`);
      } catch { /* client gone - the close handler aborts the loop */ }
    };

    try {
      const { answer, model: usedModel, tool_calls, media, evidence, mode, rounds } = await runAgenticLoop({
        db,
        bore,
        question,
        history,
        model,
        maxTokens,
        maxRounds,
        provider: PROVIDER,
        apiKey,
        signal,
        log,
        onEvent: (e) => {
          if (e.type === "delta") {
            write({ type: "delta", text: e.text });
            return;
          }
          write({
            type: "status",
            label: bore.progressLabel(e),
            // Raw workings for the UI's drop-down - actual tool + args.
            detail: e.type === "round"
              ? `round ${e.round + 1}`
              : `${e.name} ${JSON.stringify(e.input ?? {})}`.slice(0, 160),
          });
        },
      });

      const shownEvidence = await afterAnswer(bore, db, answer, evidence, media, log);
      const boundMedia = bindMediaToCitations(dedupeMedia(media), answer);
      log("ask:media_bind", {
        media_total: media.length,
        media_cited: boundMedia.length,
        masters_cited: extractCitedMasterIds(answer).size,
      });

      write({
        type: "result",
        answer,
        bore: bore.slug,
        media: boundMedia,
        mode,
        evidence: shownEvidence,
        meta: { model: usedModel, elapsed_ms: Date.now() - started, tool_calls, rounds },
      });
    } catch (err: any) {
      if (signal.aborted) {
        log("ask:client_gone", { elapsed_ms: Date.now() - started, stream: true });
        return;
      }
      log("ask:request_failed", { elapsed_ms: Date.now() - started, error: String(err?.message ?? err), status: err?.status, stream: true });
      const isClientAuth = PROVIDER === "anthropic" && err?.status === 401;
      write({
        type: "error",
        error: {
          code: isClientAuth ? "ANTHROPIC_AUTH_ERROR" : "LLM_UPSTREAM_ERROR",
          message: isClientAuth ? "Invalid Anthropic API key" : "Failed to generate response",
          details: null,
        },
        mode: "upstream_error" as ResponseMode,
      });
    } finally {
      reply.raw.end();
    }
  });
}
