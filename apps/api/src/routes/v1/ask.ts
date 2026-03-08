import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import {
  search,
  getArtist,
  getLabel,
  getMaster,
  getBatchForTable,
  type SearchEntityType,
} from "@dig/domain";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ANSWER_MODEL = process.env.LLM_MODEL ?? "claude-sonnet-4-6";
const INTENT_MODEL = "claude-haiku-4-5-20251001"; // fast + cheap for intent extraction

const PRIVATE_KEYS = new Set(
  (process.env.LLM_BETA_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// ---------------------------------------------------------------------------
// System prompt — personality, not instructions
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Dig music assistant. Dig is a music discovery platform built on 24 million records from the Discogs catalog.

You are deeply knowledgeable about music across all genres and eras — artists, labels, releases, scenes, movements, and connections between them. You understand what people actually mean when they ask about music: that "Prince" means the artist, that "Blue Note" means the jazz label, that "classic Chicago house" means a genre and era.

Your job is to help people discover music. You:
- Understand vague or conversational questions and find what the person actually wants
- Lead with well-known, important, or acclaimed artists and releases when relevant — surface the good stuff first
- Are concise but not terse — you give people what they need without padding
- Guide naturally: if the context doesn't fully answer the question, you say so and suggest what they might search for instead
- Draw connections — if someone asks about one artist you might mention a related one if it genuinely helps
- Are honest about what you don't know or what isn't in the catalog

You do not hallucinate release titles, dates, or facts. If the catalog context is insufficient or clearly wrong (mismatched results), say so plainly.

You only discuss music, artists, labels, releases, and music history. If asked about anything unrelated to music, respond with exactly this and nothing else: "I can only help with music and the Dig catalog."

When catalog data is provided, reference it naturally. Don't force citation lists — mention things where they add value. Keep your response conversational.`;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function requirePrivateKey(req: FastifyRequest): { ok: true } | { ok: false; status: number; body: unknown } {
  if (PRIVATE_KEYS.size === 0) return { ok: true };
  const key = String(req.headers["x-api-key"] ?? "").trim();
  if (!key || !PRIVATE_KEYS.has(key)) {
    return {
      ok: false,
      status: 401,
      body: { error: { code: "UNAUTHORIZED", message: "Private beta key required", details: null } },
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Anthropic API call
// ---------------------------------------------------------------------------

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

async function callAnthropic(params: {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  maxTokens: number;
  anthropicApiKey: string;
}): Promise<{ text: string; model: string }> {
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
      temperature: 0.3,
      system: params.system,
      messages: params.messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    const error = new Error(`Anthropic error ${res.status}: ${text.slice(0, 400)}`) as Error & {
      status?: number;
      body?: string;
    };
    error.status = res.status;
    error.body = text;
    throw error;
  }

  const data = await res.json() as { content: Array<{ text: string }>; model: string };
  return { text: String(data?.content?.[0]?.text ?? "").trim(), model: data.model ?? params.model };
}

function isModelNotFoundError(err: unknown): boolean {
  const e = err as { status?: number; body?: string; message?: string };
  return e?.status === 404 && !!(e?.body?.includes("not_found_error") || e?.message?.includes("not_found_error"));
}

async function callAnthropicWithFallback(params: {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  maxTokens: number;
  anthropicApiKey: string;
}): Promise<{ text: string; model: string }> {
  const candidates = [params.model, "claude-sonnet-4-6", "claude-3-5-sonnet-20241022"]
    .filter((v, i, a) => v && a.indexOf(v) === i);

  let lastError: unknown = null;
  for (const model of candidates) {
    try {
      return await callAnthropic({ ...params, model });
    } catch (err) {
      lastError = err;
      if (!isModelNotFoundError(err)) throw err;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Step 1: Intent extraction — what entities is the user asking about?
// ---------------------------------------------------------------------------

interface ExtractedEntity {
  name: string;
  type: "artist" | "label" | "release" | "any";
}

interface IntentResult {
  entities: ExtractedEntity[];
  off_topic: boolean;
}

async function extractIntent(
  question: string,
  anthropicApiKey: string,
  history: AnthropicMessage[],
): Promise<IntentResult> {
  const system = `You help identify what a user is looking for in a music catalog conversation.

Given the conversation history and the latest message, extract:
1. Specific artists, labels, or releases to search for (resolve pronouns like "his", "their", "it" using context)
2. Whether the message is completely unrelated to music (cooking, finance, weather, etc.)

Be permissive: casual follow-ups, meta-questions about the conversation, slang, or questions about the assistant itself are NOT off_topic. Only flag genuinely non-music subjects.

Examples:
"What are key releases by Prince?" → {"entities":[{"name":"Prince","type":"artist"}],"off_topic":false}
"what's his most popular release?" (after talking about Kasra V) → {"entities":[{"name":"Kasra V","type":"artist"}],"off_topic":false}
"classic Chicago house" → {"entities":[{"name":"Chicago house","type":"any"}],"off_topic":false}
"why are you so constrained?" → {"entities":[],"off_topic":false}
"hmmm" → {"entities":[],"off_topic":false}
"What's the weather in Paris?" → {"entities":[],"off_topic":true}
"how do I make pasta?" → {"entities":[],"off_topic":true}

Return JSON only. No explanation.`;

  // Pass last 4 history messages for pronoun resolution context
  const contextMessages: AnthropicMessage[] = [
    ...history.slice(-4),
    { role: "user", content: question },
  ];

  try {
    const { text } = await callAnthropic({
      model: INTENT_MODEL,
      system,
      messages: contextMessages,
      maxTokens: 200,
      anthropicApiKey,
    });

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as IntentResult;
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      off_topic: parsed.off_topic === true,
    };
  } catch {
    // If intent extraction fails, fall back to treating the question as a general search
    return { entities: [{ name: question, type: "any" }], off_topic: false };
  }
}

// ---------------------------------------------------------------------------
// Step 2: Catalog search — targeted by extracted entities
// ---------------------------------------------------------------------------

interface CatalogSource {
  type: SearchEntityType;
  discogs_id: number;
  title_or_name: string;
  summary: string;
}

async function gatherCatalogContext(
  db: Kysely<Database>,
  question: string,
  entities: ExtractedEntity[],
): Promise<CatalogSource[]> {
  const sources: CatalogSource[] = [];
  const seen = new Set<string>();

  const addResult = async (q: string, type?: SearchEntityType) => {
    try {
      const sr = await search(db, { q, limit: 4, ...(type ? { type } : {}) });
      for (const r of sr.results.slice(0, 3)) {
        const key = `${r.type}-${r.discogs_id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        let summary = "";
        try {
          const { batchId, dumpDate } = await getBatchForTable(
            db,
            r.type === "artist" ? "catalog.artists" : r.type === "label" ? "catalog.labels" : "catalog.masters",
          );
          if (r.type === "artist") {
            const d = await getArtist(db, r.discogs_id, batchId, dumpDate) as any;
            summary = d ? `artist: ${d.name}; genres=${d.genres?.join(", ") ?? "unknown"}; real_name=${d.real_name ?? ""}` : `artist: ${r.name}`;
          } else if (r.type === "label") {
            const d = await getLabel(db, r.discogs_id, batchId, dumpDate) as any;
            summary = d ? `label: ${d.name}; parent=${d.parent_label?.name ?? "none"}` : `label: ${r.name}`;
          } else if (r.type === "master") {
            const d = await getMaster(db, r.discogs_id, batchId, dumpDate) as any;
            summary = d ? `release: ${d.title}; year=${d.year ?? "unknown"}; artist=${d.artists?.[0]?.name ?? "unknown"}` : `release: ${r.title}`;
          } else {
            summary = `release: ${r.title ?? r.name}`;
          }
        } catch {
          summary = `${r.type}: ${r.name ?? r.title ?? String(r.discogs_id)}`;
        }

        sources.push({
          type: r.type as SearchEntityType,
          discogs_id: r.discogs_id,
          title_or_name: r.name ?? r.title ?? String(r.discogs_id),
          summary,
        });
      }
    } catch {
      // skip failed searches
    }
  };

  // Search each extracted entity with its guessed type
  await Promise.all(
    entities.map((e) =>
      addResult(e.name, e.type !== "any" ? (e.type as SearchEntityType) : undefined),
    ),
  );

  // If entity searches yielded nothing, fall back to the raw question
  if (sources.length === 0) {
    await addResult(question);
  }

  return sources;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

interface AskBody {
  question?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  max_tokens?: number;
}

export function registerAskRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.post("/v1/ask", async (req: FastifyRequest<{ Body: AskBody }>, reply) => {
    const auth = requirePrivateKey(req);
    if (!auth.ok) return reply.status(auth.status).send(auth.body);

    const anthropicApiKey = String(req.headers["x-anthropic-api-key"] ?? "").trim();
    if (!anthropicApiKey) {
      return reply.status(503).send({
        error: { code: "CONFIG_ERROR", message: "x-anthropic-api-key header is required", details: null },
      });
    }

    const body = req.body ?? {};
    const question = String(body.question ?? "").trim();
    if (question.length < 2 || question.length > 1000) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "question must be between 2 and 1000 characters", details: null },
      });
    }

    // Sanitise history: max 10 turns, valid roles only
    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history: AnthropicMessage[] = rawHistory
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

    const maxTokens = Math.min(Math.max(Number(body.max_tokens ?? 1000), 128), 2000);
    const requestedModel = String(body.model ?? ANSWER_MODEL);
    const started = Date.now();

    try {
      // Step 1: Extract intent (pass history for pronoun resolution)
      const intent = await extractIntent(question, anthropicApiKey, history);

      // Guardrail: off-topic
      if (intent.off_topic) {
        return reply.send({
          answer: "I can only help with music and the Dig catalog.",
          sources: [],
          meta: {
            model: INTENT_MODEL,
            elapsed_ms: Date.now() - started,
            off_topic: true,
          },
        });
      }

      // Step 2: Gather catalog context with targeted searches
      const sources = await gatherCatalogContext(db, question, intent.entities);

      // Step 3: Build messages for the answer call
      const contextBlock = sources.length > 0
        ? `Catalog context (from Dig database):\n${sources.map((s) => `- [${s.type} #${s.discogs_id}] ${s.summary}`).join("\n")}`
        : "No catalog results found for this query.";

      const userMessage = `${question}\n\n${contextBlock}`;

      const messages: AnthropicMessage[] = [
        ...history,
        { role: "user", content: userMessage },
      ];

      // Step 4: Get answer
      const { text: answer, model: usedModel } = await callAnthropicWithFallback({
        model: requestedModel,
        system: SYSTEM_PROMPT,
        messages,
        maxTokens,
        anthropicApiKey,
      });

      return reply.send({
        answer,
        sources: sources.map((s) => ({
          type: s.type,
          discogs_id: s.discogs_id,
          title_or_name: s.title_or_name,
        })),
        meta: {
          model: usedModel,
          elapsed_ms: Date.now() - started,
          entities_extracted: intent.entities.map((e) => e.name),
          sources_found: sources.length,
        },
      });
    } catch (err: any) {
      return reply.status(502).send({
        error: {
          code: "LLM_UPSTREAM_ERROR",
          message: "Failed to generate response",
          details: { reason: String(err?.message ?? err) },
        },
      });
    }
  });
}
