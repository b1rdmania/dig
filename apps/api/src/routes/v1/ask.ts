import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import {
  search,
  getArtist,
  getLabel,
  getMaster,
  getRelease,
  getBatchForTable,
  type SearchEntityType,
} from "@dig/domain";

interface AskBody {
  question?: string;
  model?: string;
  max_tokens?: number;
}

const DEFAULT_MODEL = process.env.LLM_MODEL ?? "claude-3-5-sonnet-latest";
const PRIVATE_KEYS = new Set(
  (process.env.LLM_BETA_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function requirePrivateKey(req: FastifyRequest): { ok: true } | { ok: false; status: number; body: unknown } {
  if (PRIVATE_KEYS.size === 0) {
    return {
      ok: false,
      status: 503,
      body: {
        error: {
          code: "CONFIG_ERROR",
          message: "LLM beta keys are not configured",
          details: null,
        },
      },
    };
  }
  const key = String(req.headers["x-api-key"] ?? "").trim();
  if (!key || !PRIVATE_KEYS.has(key)) {
    return {
      ok: false,
      status: 401,
      body: {
        error: {
          code: "UNAUTHORIZED",
          message: "Private beta key required",
          details: null,
        },
      },
    };
  }
  return { ok: true };
}

async function getBatchForEntityType(db: Kysely<Database>, type: SearchEntityType) {
  if (type === "artist") return getBatchForTable(db, "catalog.artists");
  if (type === "label") return getBatchForTable(db, "catalog.labels");
  if (type === "master") return getBatchForTable(db, "catalog.masters");
  return getBatchForTable(db, "catalog.releases");
}

async function getEntityDetail(
  db: Kysely<Database>,
  type: SearchEntityType,
  discogsId: number,
): Promise<unknown | null> {
  const { batchId, dumpDate } = await getBatchForEntityType(db, type);
  if (type === "artist") return getArtist(db, discogsId, batchId, dumpDate);
  if (type === "label") return getLabel(db, discogsId, batchId, dumpDate);
  if (type === "master") return getMaster(db, discogsId, batchId, dumpDate);
  return getRelease(db, discogsId, batchId, dumpDate);
}

function summarizeEntity(type: SearchEntityType, detail: any): string {
  if (!detail) return `${type}: unavailable`;
  if (type === "artist") {
    return `artist ${detail.discogs_id}: ${detail.name}; real_name=${detail.real_name ?? "unknown"}`;
  }
  if (type === "label") {
    return `label ${detail.discogs_id}: ${detail.name}; parent=${detail.parent_label?.name ?? "none"}`;
  }
  if (type === "master") {
    return `release(master) ${detail.discogs_id}: ${detail.title}; year=${detail.year ?? "unknown"}`;
  }
  return `version(release) ${detail.discogs_id}: ${detail.title}; year=${detail.release_year ?? "unknown"}; country=${detail.country ?? "unknown"}`;
}

async function callAnthropic(params: {
  model: string;
  question: string;
  contextLines: string[];
  maxTokens: number;
  anthropicApiKey: string;
}) {
  const system = [
    "You are Dig Assistant for music catalog retrieval.",
    "Use only the provided catalog context.",
    "If context is insufficient, say so explicitly.",
    "Return concise factual answer and list citations as Discogs IDs.",
  ].join("\n");

  const user = [
    `Question: ${params.question}`,
    "",
    "Catalog context:",
    ...params.contextLines,
    "",
    "Output JSON with keys: answer (string), confidence (0-1), citations (array of {type,discogs_id,title_or_name}).",
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": params.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      temperature: 0.1,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

export function registerAskRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.post("/v1/ask", async (req: FastifyRequest<{ Body: AskBody }>, reply) => {
    const auth = requirePrivateKey(req);
    if (!auth.ok) return reply.status(auth.status).send(auth.body);

    const anthropicApiKey = String(req.headers["x-anthropic-api-key"] ?? "").trim();
    if (!anthropicApiKey) {
      return reply.status(503).send({
        error: {
          code: "CONFIG_ERROR",
          message: "x-anthropic-api-key header is required",
          details: null,
        },
      });
    }

    const body = req.body ?? {};
    const question = String(body.question ?? "").trim();
    if (question.length < 3 || question.length > 1000) {
      return reply.status(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "question must be between 3 and 1000 characters",
          details: null,
        },
      });
    }

    const maxTokens = Math.min(Math.max(Number(body.max_tokens ?? 800), 128), 1500);
    const model = String(body.model ?? DEFAULT_MODEL);
    const started = Date.now();

    try {
      const sr = await search(db, { q: question, limit: 8 });
      const top = sr.results.slice(0, 4);

      const details = await Promise.all(
        top.map(async (r) => {
          const detail = await getEntityDetail(db, r.type, r.discogs_id);
          return {
            type: r.type,
            discogs_id: r.discogs_id,
            title_or_name: r.name ?? r.title ?? String(r.discogs_id),
            summary: summarizeEntity(r.type, detail),
          };
        }),
      );

      const contextLines = [
        ...top.map((r, i) => `result_${i + 1}: ${r.type} ${r.discogs_id} ${r.name ?? r.title ?? ""}`),
        ...details.map((d) => `detail: ${d.summary}`),
      ];

      const modelResp: any = await callAnthropic({
        model,
        question,
        contextLines,
        maxTokens,
        anthropicApiKey,
      });
      const rawText = String(modelResp?.content?.[0]?.text ?? "").trim();

      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = {
          answer: rawText,
          confidence: 0.5,
          citations: details.map((d) => ({
            type: d.type,
            discogs_id: d.discogs_id,
            title_or_name: d.title_or_name,
          })),
        };
      }

      return reply.send({
        answer: parsed.answer ?? rawText,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        meta: {
          model,
          elapsed_ms: Date.now() - started,
          search_results_used: top.length,
          request_id: (req as any).requestId ?? null,
        },
      });
    } catch (err: any) {
      return reply.status(502).send({
        error: {
          code: "LLM_UPSTREAM_ERROR",
          message: "Failed to generate LLM response",
          details: { reason: String(err?.message ?? err) },
        },
      });
    }
  });
}
