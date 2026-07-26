// ---------------------------------------------------------------------------
// /v1/ask — Fastify route registration
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import type { AnthropicMessage, ResponseMode } from "./types.js";
import { requirePrivateKey } from "./auth.js";
import { runAgenticLoop, type LlmProvider, type AskProgressEvent } from "./loop.js";
import { bindMediaToCitations, dedupeMedia, dedupeEvidence, extractCitedMasterIds } from "./binding.js";

export type { MediaItem, EvidenceItem, ResponseMode } from "./types.js";

// Provider selection: set OPENROUTER_API_KEY to run server-side via OpenRouter
// (Kimi by default); otherwise falls back to the original BYO-Anthropic-key flow.
const PROVIDER: LlmProvider =
  (process.env.LLM_PROVIDER as LlmProvider | undefined) ??
  (process.env.OPENROUTER_API_KEY ? "openrouter" : "anthropic");
const DEFAULT_MODEL =
  process.env.LLM_MODEL ?? (PROVIDER === "openrouter" ? "moonshotai/kimi-k3" : "claude-sonnet-4-6");
const MAX_HISTORY_TURNS = 6;

interface AskBody {
  question?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  max_tokens?: number;
}

// Shop-owner-voiced labels for the live activity feed. Keyed on tool name;
// some labels pull the query/role out of the input for specificity.
function progressLabel(e: AskProgressEvent): string {
  if (e.type === "round") {
    return e.round === 0 ? "Reading the question…" : "Connecting the dots…";
  }
  const input = e.input ?? {};
  switch (e.name) {
    case "search_catalog": {
      const q = String(input.query ?? "").trim();
      return q ? `Flipping through the crates for “${q}”…` : "Flipping through the crates…";
    }
    case "get_artist": return "Pulling the artist's file…";
    case "get_artist_masters": return "Laying out the discography…";
    case "get_label": return "Reading the label's sleeve notes…";
    case "get_label_releases": return "Going through the label's shelf…";
    case "get_label_essentials": return "Picking out the label's core run…";
    case "list_scenes": return "Scanning the scene map…";
    case "get_scene": return "Reading up on the scene…";
    case "get_master": return "Pulling the record…";
    default: return "Rummaging out back…";
  }
}

export function registerAskRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.post("/v1/ask", {
    config: {
      // Ask is expensive (LLM + DB). 10 req/min per IP regardless of key.
      // Private-key holders are trusted but still bounded to prevent runaway loops.
      rateLimit: { max: 10, timeWindow: "1 minute" },
    },
  }, async (req: FastifyRequest<{ Body: AskBody }>, reply) => {
    const auth = requirePrivateKey(req);
    if (!auth.ok) return reply.status(auth.status).send(auth.body);

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
        error: { code: "INVALID_REQUEST", message: "question must be 1–1000 characters", details: null },
      });
    }

    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history: AnthropicMessage[] = rawHistory
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }));

    const maxTokens = Math.min(Math.max(Number(body.max_tokens ?? 1600), 256), 2000);
    const model = String(body.model ?? DEFAULT_MODEL);
    const started = Date.now();
    const log = (msg: string, extra?: Record<string, unknown>) =>
      req.log.info({ event: msg, ...extra });

    try {
      const { answer, model: usedModel, tool_calls, media, evidence, mode } = await runAgenticLoop({
        db,
        question,
        history,
        model,
        maxTokens,
        provider: PROVIDER,
        apiKey,
        log,
      });

      const dedupedMedia = dedupeMedia(media);
      const dedupedEvidence = dedupeEvidence(evidence);

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
        media: boundMedia,
        mode,
        evidence: dedupedEvidence.slice(0, 20),
        meta: {
          model: usedModel,
          elapsed_ms: Date.now() - started,
          tool_calls,
        },
      });
    } catch (err: any) {
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
          // clients — provider messages can leak internals.
          details: null,
        },
        mode: "upstream_error" as ResponseMode,
      });
    }
  });

  // -------------------------------------------------------------------------
  // /v1/ask/stream — same contract as /v1/ask but responds as NDJSON:
  //   {type:"status", label}   one per loop round / tool call, as they happen
  //   {type:"result", ...}     the final /v1/ask response body
  //   {type:"error", error, mode}  terminal error, same shape as /v1/ask errors
  // The reply is hijacked, so CORS + rate-limit headers from the plugins
  // don't apply — CORS is set manually (API is open-CORS by design).
  // -------------------------------------------------------------------------
  app.post("/v1/ask/stream", {
    config: {
      rateLimit: { max: 10, timeWindow: "1 minute" },
    },
  }, async (req: FastifyRequest<{ Body: AskBody }>, reply) => {
    const auth = requirePrivateKey(req);
    if (!auth.ok) return reply.status(auth.status).send(auth.body);

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
        error: { code: "INVALID_REQUEST", message: "question must be 1–1000 characters", details: null },
      });
    }

    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history: AnthropicMessage[] = rawHistory
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }));

    const maxTokens = Math.min(Math.max(Number(body.max_tokens ?? 1600), 256), 2000);
    const model = String(body.model ?? DEFAULT_MODEL);
    const started = Date.now();
    const log = (msg: string, extra?: Record<string, unknown>) =>
      req.log.info({ event: msg, ...extra });

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
      } catch { /* client gone — loop result is discarded below */ }
    };

    try {
      const { answer, model: usedModel, tool_calls, media, evidence, mode } = await runAgenticLoop({
        db,
        question,
        history,
        model,
        maxTokens,
        provider: PROVIDER,
        apiKey,
        log,
        onEvent: (e) => write({
          type: "status",
          label: progressLabel(e),
          // Raw workings for the UI's drop-down — actual tool + args.
          detail: e.type === "round"
            ? `round ${e.round + 1}`
            : `${e.name} ${JSON.stringify(e.input ?? {})}`.slice(0, 160),
        }),
      });

      const boundMedia = bindMediaToCitations(dedupeMedia(media), answer);
      log("ask:media_bind", {
        media_total: media.length,
        media_cited: boundMedia.length,
        masters_cited: extractCitedMasterIds(answer).size,
      });

      write({
        type: "result",
        answer,
        media: boundMedia,
        mode,
        evidence: dedupeEvidence(evidence).slice(0, 20),
        meta: { model: usedModel, elapsed_ms: Date.now() - started, tool_calls },
      });
    } catch (err: any) {
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
