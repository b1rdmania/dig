// ---------------------------------------------------------------------------
// /v1/ask — Fastify route registration
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import type { AnthropicMessage, ResponseMode } from "./types.js";
import { requirePrivateKey } from "./auth.js";
import { runAgenticLoop, type LlmProvider } from "./loop.js";
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

    const maxTokens = Math.min(Math.max(Number(body.max_tokens ?? 1200), 256), 2000);
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
}
