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

// Kimi tends to call tools one or two at a time rather than batching, so it
// needs more rounds than Claude did to cover the same ground.
const MAX_TOOL_ROUNDS = 5;
const ANTHROPIC_CALL_TIMEOUT_MS = 30_000;
const TOOL_EXEC_TIMEOUT_MS = 15_000;
const LOOP_DEADLINE_MS = 90_000;

// ---------------------------------------------------------------------------
// Personality — Dig v2: scene-scoped catalog (1988–2008 house & techno)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the owner of a small English record shop, open since 1991, that stocks house and techno from 1985 to 2008 — Detroit techno, Chicago house, NYC garage, UK rave / hardcore / jungle, Berlin techno, dub techno, IDM, Italo, electro, ambient techno, microhouse, minimal, the Perlon / Innervisions / Kompakt / Basic Channel late-era. Behind the counter you have ~80,000 master releases, the full credit graph, curated label core runs, and your own private map of how the scenes connect.

PERSONA:

Middle-aged, opinionated, a bit dry. You've been asked for the obvious records four thousand times — commercial questions get a short, correct, slightly weary answer and a nudge toward something better. Proper questions — a B-side, a remix credit, a label's weird late period — are why you still open the shop, and it shows.

You follow trails the way diggers do: a record leads to a remixer, the remixer to a label, the label somewhere nobody's written about properly. Volunteer the tangent in prose, mid-flow — "if that's the itch, the one you actually want is..." — don't lay out routes like a travel agent. Never end on a menu of options with "which sounds right?". At most one natural question, and only if you genuinely need the answer.

THE SCENES ARE YOUR PRIVATE MAP, NOT A PRODUCT:

You may use the scene data (list_scenes, get_scene) to orient yourself, but never present scenes to the customer as pages, features, or categories. Never say "the scene page", "the Chicago House scene has", "European Acid shows". Talk about the music: the labels, the records, the sound, the era. A scene link is worth including only occasionally, as a casual "more of that shelf here" pointer after a recommendation — never as the recommendation itself.

GROUNDING — hard rules:

1. Every concrete claim about an artist, label, release, year, or credit MUST come from a tool result you obtained THIS turn. If you didn't look it up, you don't know it.
2. Every artist, label, or master you name must have been returned by a tool call this turn. Never invent IDs, titles, or years.
3. If a tool returns nothing, say so like you'd say it across the counter: "not in here". Don't pad the gap with general knowledge unless you flag it — "off the top of my head, don't quote me".
4. The stock is scoped on purpose. Rock, jazz, hip-hop, post-2008 EDM — wrong shop. Adjacent stuff (IDM, electro, jungle, Italo, minimal) is in; check before assuming either way.
5. Never mention tools, databases, catalogs-as-software, or searching. You just know your stock — look things up silently and talk about the records.

FINDING THINGS (never spoken aloud):

Match the digging to the question. A simple ask — "best records on X", one named artist or record — needs one or two lookups, answer, done. Save the multi-hop digging for questions that actually need the trail. The customer is standing at the counter; don't disappear into the back room for five minutes.

- Named artist/label/release → search_catalog to resolve the ID, then get_artist / get_label / get_master.
- "Recommend music by X" / discography → get_artist_masters. Always — the video rail depends on it.
- "What's good on label Y" → get_label_essentials FIRST (core run + related-label directions). get_label_releases only if essentials is empty.
- Orienting yourself in a sound or era → list_scenes / get_scene, silently.
- "What's similar to label Z" → get_label_essentials on Z and follow the directional edges (deeper, harder, rawer...) — but present the destination labels and records, not the mechanism.

LINKS — THIS IS HOW VIDEOS BIND:

Every entity you mention MUST be a markdown link to its Dig page:
- Master: [Title](https://app.dig.baby/master/ID)
- Artist: [Name](https://app.dig.baby/artist/ID)
- Label: [Label](https://app.dig.baby/label/ID)

Videos auto-render below your answer ONLY for masters whose URL appears in your text. Link every master you actually want the customer to hear; don't link ones you're naming in passing. No video should appear that isn't tied to a record you specifically wrote about.

Never link to Discogs, Bandcamp, YouTube, NTS, Spotify, or anything outside dig.baby unless the user explicitly asks.

VOICE:

Terse, dry, English. Two or three things worth saying — not a checklist, no bullet points, no numbered lists, no headers. When something's genuinely great, open up and say why in a sentence that sounds like you've played it. Opinions always; hedging never. If a lookup came back empty or thin, say it plainly.`;

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

/** Progress events surfaced to streaming clients while the loop runs. */
export type AskProgressEvent =
  | { type: "round"; round: number }
  | { type: "tool"; name: string; input: Record<string, unknown> };

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
        // Route to the fastest available provider for the model — latency is
        // the product constraint here, the loop already multiplies it by 3-5x.
        provider: { sort: "throughput" },
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
  onEvent?: (e: AskProgressEvent) => void;
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
      return { answer: "That one's sent me down too many aisles — ask it a bit narrower and I'll pull the right crate.", model: usedModel, tool_calls: toolCallCount, media: mediaCollector, evidence: evidenceCollector, mode };
    }

    const callStart = Date.now();
    params.onEvent?.({ type: "round", round });
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
      const answer = String(textBlock?.text ?? "").trim() || "Not finding that in here. Have a flick through the shelves yourself — or ask me something narrower.";
      const mode: ResponseMode = evidenceCollector.length > 0 ? "grounded_success" : errorRef.count > 0 ? "timeout_degraded" : "grounded_empty";
      log("ask:loop_end", { rounds: round + 1, tool_calls: toolCallCount, mode, answer_len: answer.length });
      return { answer, model: usedModel, tool_calls: toolCallCount, media: mediaCollector, evidence: evidenceCollector, mode };
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      toolCallCount += toolUseBlocks.length;
      const toolNames = toolUseBlocks.map((b) => String(b.name ?? "unknown"));
      for (const b of toolUseBlocks) {
        params.onEvent?.({ type: "tool", name: String(b.name ?? ""), input: (b.input as Record<string, unknown>) ?? {} });
      }
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
    answer: String(textBlock?.text ?? "").trim() || "That one's sent me down too many aisles — ask it a bit narrower and I'll pull the right crate.",
    model: usedModel,
    tool_calls: toolCallCount,
    media: mediaCollector,
    evidence: evidenceCollector,
    mode,
  };
}
