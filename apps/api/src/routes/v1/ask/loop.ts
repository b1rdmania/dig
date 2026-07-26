// ---------------------------------------------------------------------------
// LLM agentic loop with native tool use.
// Two providers behind one internal contract (Anthropic content blocks):
//   - anthropic: api.anthropic.com/v1/messages, BYO key from the client
//   - openrouter: openrouter.ai chat-completions (Kimi etc.), server-side key
// ---------------------------------------------------------------------------

import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import type { AnthropicMessage, AnthropicContentBlock, MediaItem, EvidenceItem, ResponseMode } from "./types.js";
import { TOOLS, executeTool } from "./tools.js";

const MAX_TOOL_ROUNDS = 3;
const ANTHROPIC_CALL_TIMEOUT_MS = 30_000;
const TOOL_EXEC_TIMEOUT_MS = 15_000;
const LOOP_DEADLINE_MS = 60_000;

// ---------------------------------------------------------------------------
// Personality — Dig v2: scene-scoped catalog (1988–2008 house & techno)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the librarian for Dig — a curated catalog of house and techno from 1988 to 2008. The scope is Detroit techno, Chicago house, NYC garage, UK rave / hardcore / jungle, Berlin techno, dub techno, IDM, Italo, electro, ambient techno, microhouse, minimal, and the Perlon / Innervisions / Kompakt / Basic Channel late-era. The catalog is ~80,000 master releases plus hand-curated scenes, label "core runs" (essential listening per label), and directional related-label edges (deeper, harder, rawer, cleaner, weirder, poppier, earlier, later).

Your job is to help people find what's in this collection. You are not a music encyclopedia — you are a guide to a specific, opinionated catalog.

GROUNDING — these are hard rules, not preferences:

1. Every concrete claim about an artist, label, release, year, scene, or relationship MUST come from a tool result you obtained THIS turn. Do not answer from memory. If you didn't call a tool, you don't know.
2. Every artist, label, master, or scene you name in your answer must have been returned by a tool call in this turn. Never invent IDs, titles, or years.
3. If a tool returns nothing, say so. "Not in our catalog" or "outside the 1988–2008 window" is the correct answer — don't pad with general knowledge to fill the gap.
4. The catalog is scoped. Rock, jazz, hip-hop, classical, contemporary EDM, post-2008 electronic music — out of scope. Tell the user honestly. Genres adjacent to house/techno (IDM, electro, ambient techno, UK rave/jungle, Italo, minimal/microhouse) are in scope; check before assuming.
5. You access a DATABASE through tools. Never say "I can't access URLs" or "I don't have internet" — you have tools, use them.

WHEN TO USE WHICH TOOL:

- Specific artist/label/release named by the user → search_catalog first to resolve the ID, then get_artist / get_label / get_master.
- "Recommend music by X" or "what's their discography" → get_artist_masters. Always. The video rail depends on this.
- "What's good on label Y" → get_label_essentials FIRST (curated core run + directional related labels). Fall back to get_label_releases only if essentials returns empty.
- "Tell me about Detroit / Berlin / Chicago / dub techno / IDM scene" → list_scenes to find the slug, then get_scene for member labels and bridges.
- "Walk me from X to Y" or "what's similar to label Z" → get_label_essentials on Z and use the directional related edges (deeper, harder, etc.) to chart a path.

LINKS — THIS IS HOW VIDEOS BIND:

Every entity you mention in your answer MUST be a markdown link to its Dig page:
- Master: [Title](https://app.dig.baby/master/ID)
- Artist: [Name](https://app.dig.baby/artist/ID)
- Label: [Label](https://app.dig.baby/label/ID)
- Scene: [Scene name](https://app.dig.baby/scene/SLUG)

Videos auto-render below your answer ONLY for masters whose URL appears in your text. If you mention 4 masters but only link 2, only those 2 videos appear. So link every master you actually want surfaced — and don't link masters you're only naming in passing. No video should ever appear that isn't tied to a record you specifically wrote about.

Never link to Discogs, Bandcamp, YouTube, NTS, Spotify, or anything outside dig.baby unless the user explicitly asks.

VOICE:

Terse. Two or three things worth saying — not a checklist. No bullet points, no numbered lists, no bold headers. Talk like a person who knows the records.

When you find something genuinely good — a deep cut, a connection worth making, a record that matters — open up. Say what's special about it. Opinions are allowed and welcome.

If the question is ambiguous, ask one direct question. Not three. Not an apology.

If a tool errored or the catalog has nothing useful, say it plainly. Don't paper over it.`;

async function callAnthropic(params: {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools: typeof TOOLS;
  maxTokens: number;
  anthropicApiKey: string;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_CALL_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": params.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.system,
        tools: params.tools,
        messages: params.messages,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Anthropic error ${res.status}: ${text.slice(0, 400)}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }

  return res.json() as Promise<LlmResponse>;
}

interface LlmResponse {
  id?: string;
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  content: AnthropicContentBlock[];
}

export type LlmProvider = "anthropic" | "openrouter";

// ---------------------------------------------------------------------------
// OpenRouter — OpenAI chat-completions wire format, translated to and from
// the internal Anthropic-block contract so the loop logic stays unchanged.
// ---------------------------------------------------------------------------

function toOpenAiTools(tools: typeof TOOLS) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: (t as { input_schema?: unknown }).input_schema ?? { type: "object", properties: {} },
    },
  }));
}

function toOpenAiMessages(system: string, messages: AnthropicMessage[]) {
  const out: Array<Record<string, unknown>> = [{ role: "system", content: system }];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }
    if (msg.role === "assistant") {
      const text = msg.content
        .filter((b) => b.type === "text")
        .map((b) => String((b as { text?: unknown }).text ?? ""))
        .join("\n");
      const toolCalls = msg.content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          id: String((b as { id?: unknown }).id ?? ""),
          type: "function" as const,
          function: {
            name: String((b as { name?: unknown }).name ?? ""),
            arguments: JSON.stringify((b as { input?: unknown }).input ?? {}),
          },
        }));
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      for (const b of msg.content) {
        if (b.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: String((b as { tool_use_id?: unknown }).tool_use_id ?? ""),
            content: String((b as { content?: unknown }).content ?? ""),
          });
        } else if (b.type === "text") {
          out.push({ role: "user", content: String((b as { text?: unknown }).text ?? "") });
        }
      }
    }
  }
  return out;
}

async function callOpenRouter(params: {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools: typeof TOOLS;
  maxTokens: number;
  apiKey: string;
}): Promise<LlmResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_CALL_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey}`,
        "http-referer": "https://app.dig.baby",
        "x-title": "Dig",
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens,
        messages: toOpenAiMessages(params.system, params.messages),
        ...(params.tools.length > 0 ? { tools: toOpenAiTools(params.tools) } : {}),
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`OpenRouter error ${res.status}: ${text.slice(0, 400)}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      };
    }>;
    error?: { message?: string; code?: number };
  };

  // OpenRouter can return 200 with an error body (e.g. provider outage, key cap).
  if (data.error) {
    const err = new Error(`OpenRouter error: ${String(data.error.message ?? "unknown").slice(0, 400)}`) as Error & { status?: number };
    err.status = Number(data.error.code) || 502;
    throw err;
  }

  const choice = data.choices?.[0];
  const message = choice?.message ?? {};
  const content: AnthropicContentBlock[] = [];
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  for (const tc of message.tool_calls ?? []) {
    let input: unknown;
    try {
      input = JSON.parse(tc.function?.arguments || "{}");
    } catch {
      input = {};
    }
    content.push({
      type: "tool_use",
      id: String(tc.id ?? ""),
      name: String(tc.function?.name ?? ""),
      input,
    });
  }

  const finish = String(choice?.finish_reason ?? "stop");
  const stop_reason: LlmResponse["stop_reason"] =
    finish === "tool_calls" ? "tool_use" : finish === "length" ? "max_tokens" : "end_turn";

  return { model: String(data.model ?? params.model), stop_reason, content };
}

export async function runAgenticLoop(params: {
  db: Kysely<Database>;
  question: string;
  history: AnthropicMessage[];
  model: string;
  maxTokens: number;
  provider: LlmProvider;
  apiKey: string;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}): Promise<{ answer: string; model: string; tool_calls: number; media: MediaItem[]; evidence: EvidenceItem[]; mode: ResponseMode }> {
  const { log } = params;

  const callModel = (messages: AnthropicMessage[], tools: typeof TOOLS): Promise<LlmResponse> =>
    params.provider === "openrouter"
      ? callOpenRouter({ model: params.model, system: SYSTEM_PROMPT, messages, tools, maxTokens: params.maxTokens, apiKey: params.apiKey })
      : callAnthropic({ model: params.model, system: SYSTEM_PROMPT, messages, tools, maxTokens: params.maxTokens, anthropicApiKey: params.apiKey });
  const messages: AnthropicMessage[] = [
    ...params.history,
    { role: "user", content: params.question },
  ];

  let usedModel = params.model;
  let toolCallCount = 0;
  const mediaCollector: MediaItem[] = [];
  const evidenceCollector: EvidenceItem[] = [];
  const errorRef = { count: 0 };
  const allowedMasterIds = new Set<number>();
  const deadline = Date.now() + LOOP_DEADLINE_MS;

  log("ask:loop_start", { model: params.model, history_turns: params.history.length, question_len: params.question.length });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (Date.now() > deadline) {
      log("ask:deadline_exceeded", { round, tool_calls: toolCallCount });
      const mode: ResponseMode = evidenceCollector.length > 0 ? "timeout_degraded" : "grounded_empty";
      return { answer: "Taking too long — try a more specific question.", model: usedModel, tool_calls: toolCallCount, media: mediaCollector, evidence: evidenceCollector, mode };
    }

    const callStart = Date.now();
    log("ask:llm_call", { round, provider: params.provider, messages_in_context: messages.length });

    let response: LlmResponse;
    try {
      response = await callModel(messages, TOOLS);
    } catch (err: any) {
      log("ask:llm_error", { round, provider: params.provider, elapsed_ms: Date.now() - callStart, error: String(err?.message ?? err) });
      throw err;
    }

    const callMs = Date.now() - callStart;
    log("ask:llm_response", { round, elapsed_ms: callMs, stop_reason: response.stop_reason, model: response.model });

    usedModel = response.model ?? params.model;

    if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
      const textBlock = response.content.find((b) => b.type === "text");
      const answer = String(textBlock?.text ?? "").trim() || "I couldn't find anything relevant — try searching directly on Dig.";
      const mode: ResponseMode = evidenceCollector.length > 0 ? "grounded_success" : errorRef.count > 0 ? "timeout_degraded" : "grounded_empty";
      log("ask:loop_end", { rounds: round + 1, tool_calls: toolCallCount, mode, answer_len: answer.length });
      return { answer, model: usedModel, tool_calls: toolCallCount, media: mediaCollector, evidence: evidenceCollector, mode };
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      toolCallCount += toolUseBlocks.length;
      const toolNames = toolUseBlocks.map((b) => String(b.name ?? "unknown"));
      log("ask:tool_calls", { round, tools: toolNames });

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const toolStart = Date.now();
          const toolName = String(block.name ?? "");
          const toolTimeout = new Promise<{ error: string }>((resolve) =>
            setTimeout(() => resolve({ error: `Tool ${toolName} timed out after ${TOOL_EXEC_TIMEOUT_MS}ms` }), TOOL_EXEC_TIMEOUT_MS)
          );
          const result = await Promise.race([
            executeTool(params.db, toolName, (block.input as Record<string, unknown>) ?? {}, mediaCollector, evidenceCollector, errorRef, allowedMasterIds),
            toolTimeout,
          ]);
          log("ask:tool_result", { tool: toolName, elapsed_ms: Date.now() - toolStart, timed_out: (result as any)?.error?.includes("timed out") ?? false });
          return {
            type: "tool_result" as const,
            tool_use_id: String(block.id ?? ""),
            content: JSON.stringify(result),
          };
        }),
      );

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    const mode: ResponseMode = evidenceCollector.length > 0 ? "grounded_success" : "timeout_degraded";
    log("ask:loop_end_unexpected", { round, stop_reason: response.stop_reason, mode });
    return {
      answer: String(textBlock?.text ?? "Something went wrong.").trim(),
      model: usedModel,
      tool_calls: toolCallCount,
      media: mediaCollector,
      evidence: evidenceCollector,
      mode,
    };
  }

  log("ask:max_rounds_exceeded", { tool_calls: toolCallCount });

  const finalMessages: AnthropicMessage[] = [
    ...messages,
    {
      role: "user",
      content: "Based on what you've found so far, please give your final answer.",
    },
  ];
  const finalCallStart = Date.now();
  const finalResp = await callModel(finalMessages, []);
  log("ask:final_call", { elapsed_ms: Date.now() - finalCallStart, stop_reason: finalResp.stop_reason });
  const textBlock = finalResp.content.find((b) => b.type === "text");
  const mode: ResponseMode = evidenceCollector.length > 0 ? "grounded_success" : "timeout_degraded";
  return {
    answer: String(textBlock?.text ?? "").trim() || "I hit a complexity limit — try a more specific question.",
    model: usedModel,
    tool_calls: toolCallCount,
    media: mediaCollector,
    evidence: evidenceCollector,
    mode,
  };
}
