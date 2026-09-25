// ---------------------------------------------------------------------------
// LLM agentic loop with native tool use.
// Two providers behind one internal contract (Anthropic content blocks):
//   - anthropic: api.anthropic.com/v1/messages, BYO key from the client
//   - openrouter: openrouter.ai chat-completions (Kimi etc.), server-side key
// ---------------------------------------------------------------------------

import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import type { AnthropicMessage, AnthropicContentBlock, MediaItem, ResponseMode } from "./types.js";
import type { BoreConfig, ToolDef } from "./bore.js";
import { isRetrievalFailure, isToolError, toolError, toolErrorCause } from "./tool-error.js";

// Default round budget for private (BYO-key / llm-beta) asks. The public
// Record Bore page passes a tighter budget (see index.ts): a live ask on
// 2026-09-03 spent all five rounds on Kimi (one lookup fetched twice) and then
// paid a sixth forced "STOP LOOKING" call - 43s of an 88s answer. The last
// round in the budget now runs with no tools, so the model has to write.
const DEFAULT_MAX_ROUNDS = 5;
const ANTHROPIC_CALL_TIMEOUT_MS = 30_000;
const TOOL_EXEC_TIMEOUT_MS = 15_000;
// Backstop only. Per-call timeouts above bound the worst honest run to
// ~225s (5 rounds × 30s call + 15s tools), so this should never cut off
// a real dig - it exists to kill a pathological one. The 90s version was
// truncating legitimate credit-graph digs ("Retrieval partial").
// Kimi reasoning effort on OpenRouter. LOW = 1-2s a round and still calls
// tools; OFF skips tools and invents IDs; MEDIUM costs seconds but follows the
// check-the-stock rule more reliably. Env-switchable so it can be measured.
const REASONING_EFFORT = (["low", "medium", "high"].includes(String(process.env.LLM_REASONING_EFFORT))
  ? String(process.env.LLM_REASONING_EFFORT)
  : "low") as "low" | "medium" | "high";
const LOOP_DEADLINE_MS = 240_000;
// Once an OpenRouter stream is open, the longest it may go without a byte.
// OpenRouter sends ": OPENROUTER PROCESSING" keep-alives, so a quiet stream
// this long is stalled, not thinking.
const STREAM_IDLE_TIMEOUT_MS = 30_000;

// One abort for a model call: the caller's signal (client gone) or our own
// timer, whichever fires first.
function callSignal(controller: AbortController, caller?: AbortSignal): AbortSignal {
  return caller ? AbortSignal.any([caller, controller.signal]) : controller.signal;
}


async function callAnthropic(params: {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools: ToolDef[];
  /** Last round: tools stay declared (so the cache holds) but can't be called. */
  noTools?: boolean;
  maxTokens: number;
  anthropicApiKey: string;
  signal?: AbortSignal;
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
      // Prompt caching. Every round resends tools + persona + the turn so
      // far; caching makes rounds 2+ read that prefix at ~0.1x instead of
      // paying for it again. The explicit marker pins tools + system (the
      // big static part); top-level cache_control moves a second breakpoint
      // to the end of the growing conversation each round. The last round
      // keeps the tool list and sets tool_choice "none" instead of dropping
      // the tools: changing the tool list rebuilds the whole cache, and
      // tool_choice only invalidates the messages tier.
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens,
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
        tools: params.tools,
        ...(params.noTools && params.tools.length > 0 ? { tool_choice: { type: "none" } } : {}),
        messages: params.messages,
      }),
      signal: callSignal(controller, params.signal),
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

/** Token accounting for one call, normalised across providers. */
export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  /** Prompt tokens served from the provider's cache. */
  cached_tokens: number;
  /** Anthropic only: tokens written to the cache this call. */
  cache_write_tokens?: number;
}

function anthropicUsage(u: Record<string, unknown> | undefined): LlmUsage | undefined {
  if (!u) return undefined;
  const n = (k: string) => Number(u[k] ?? 0) || 0;
  return {
    input_tokens: n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens"),
    output_tokens: n("output_tokens"),
    cached_tokens: n("cache_read_input_tokens"),
    cache_write_tokens: n("cache_creation_input_tokens"),
  };
}

interface LlmResponse {
  id?: string;
  model: string;
  /** Upstream host that served the call (OpenRouter reports it per chunk). */
  provider?: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  content: AnthropicContentBlock[];
  /** Raw on the Anthropic wire; normalised by callModel. */
  usage?: Record<string, unknown> | LlmUsage;
}

export type LlmProvider = "anthropic" | "openrouter";

/** Progress events surfaced to streaming clients while the loop runs. */
export type AskProgressEvent =
  | { type: "round"; round: number }
  | { type: "tool"; name: string; input: Record<string, unknown> }
  // Streamed answer text as it is generated. A later "round"/"tool" event
  // means the text so far was pre-tool chatter, not the answer - discard it.
  | { type: "delta"; text: string };

/** One model call, as it happened: how long, which host, what it asked for. */
export interface AskRoundTrace {
  round: number;
  ms: number;
  provider: string | null;
  tools: string[];
  /** Absent when the provider didn't report usage. */
  usage?: LlmUsage;
}

// ---------------------------------------------------------------------------
// OpenRouter - OpenAI chat-completions wire format, translated to and from
// the internal Anthropic-block contract so the loop logic stays unchanged.
// ---------------------------------------------------------------------------

function toOpenAiTools(tools: ToolDef[]) {
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

// Provider routing on OpenRouter. LLM_PROVIDER_ORDER (comma-separated
// provider slugs, e.g. "fireworks/fast,moonshotai") pins hosts explicitly;
// otherwise anthropic/* models go straight to Anthropic and everything else
// takes OpenRouter's throughput sort. The 2026-09-03 timing showed the same
// Kimi call bouncing between 1s and 23s hosts under "throughput" alone.
// LLM_PROVIDER_IGNORE lists hosts a fallback may never land on. The round
// trace (meta.rounds) is how you find them: on 2026-09-03 every 10-23s
// answer-writing round was Makora; Parasail wrote the same in 2-3s.
export function providerPreference(model: string): Record<string, unknown> {
  const list = (name: string) => String(process.env[name] ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const pinned = list("LLM_PROVIDER_ORDER");
  const ignored = list("LLM_PROVIDER_IGNORE");
  const ignore = ignored.length > 0 ? { ignore: ignored } : {};
  if (pinned.length > 0) return { order: pinned, allow_fallbacks: true, ...ignore };
  if (model.startsWith("anthropic/")) return { order: ["anthropic"], allow_fallbacks: true, ...ignore };
  return { sort: "throughput", ...ignore };
}

async function callOpenRouter(params: {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools: ToolDef[];
  maxTokens: number;
  apiKey: string;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<LlmResponse> {
  const controller = new AbortController();
  // The timer bounds time-to-first-byte; once the stream is open it becomes
  // an idle timer (below): a long answer must not be cut, a stalled one must.
  let timer = setTimeout(() => controller.abort(), ANTHROPIC_CALL_TIMEOUT_MS);

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
        // Keep the params minimal: Moonshot's own endpoint rejects
        // frequency_penalty, and k3 has no full-precision hosts so a
        // quantization pin 404s.
        provider: providerPreference(params.model),
        temperature: 0.6,
        stream: true,
        // OpenRouter enables full reasoning by default on Kimi K3, and that was
        // the 2026-09-03 slowness: 250-625 thinking tokens per round, 10-23s a
        // call, and under a tight max_tokens the thinking ate the budget
        // before any tool call (finish=length, no tools). Reasoning fully OFF
        // is worse: Kimi then never calls a tool and answers from memory with
        // invented IDs (0/3 grounded in the probe). LOW keeps the lookups
        // (3/3, 12-70 thinking tokens, 1-2s a round). Reasoning tokens count
        // toward max_tokens, so keep this LOW whenever the budget is small.
        reasoning: { effort: REASONING_EFFORT },
      }),
      signal: callSignal(controller, params.signal),
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

  // SSE: "data: {chunk}\n\n" lines, terminated by "data: [DONE]". Text
  // deltas go straight to the caller; tool calls arrive as fragments keyed
  // by index and are stitched back together here.
  let model = params.model;
  let provider: string | undefined;
  let text = "";
  let finish = "stop";
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();
  let streamError: { message?: string; code?: number } | null = null;
  let usage: LlmUsage | undefined;

  const handleChunk = (raw: string) => {
    let data: {
      model?: string;
      provider?: string;
      error?: { message?: string; code?: number };
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
      choices?: Array<{
        finish_reason?: string | null;
        delta?: {
          content?: string | null;
          tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (data.error) {
      streamError = data.error;
      return;
    }
    if (data.usage) {
      // OpenRouter sends usage on the final chunk; cached_tokens is how we
      // find out whether the host (e.g. Moonshot) cached the prompt prefix.
      usage = {
        input_tokens: Number(data.usage.prompt_tokens ?? 0) || 0,
        output_tokens: Number(data.usage.completion_tokens ?? 0) || 0,
        cached_tokens: Number(data.usage.prompt_tokens_details?.cached_tokens ?? 0) || 0,
      };
    }
    if (data.model) model = String(data.model);
    if (data.provider) provider = String(data.provider);
    const choice = data.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string" && delta.content.length > 0) {
      text += delta.content;
      params.onDelta?.(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const idx = Number(tc.index ?? 0);
      const cur = toolCalls.get(idx) ?? { id: "", name: "", args: "" };
      if (tc.id) cur.id = String(tc.id);
      if (tc.function?.name) cur.name += String(tc.function.name);
      if (tc.function?.arguments) cur.args += String(tc.function.arguments);
      toolCalls.set(idx, cur);
    }
    if (choice.finish_reason) finish = String(choice.finish_reason);
  };

  const reader = res.body?.getReader();
  if (!reader) throw new Error("OpenRouter error: empty stream body");
  const decoder = new TextDecoder();
  let buffer = "";
  // Aborting the fetch controller errors the pending read.
  const idle = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error(`OpenRouter stream idle for ${STREAM_IDLE_TIMEOUT_MS}ms`)),
      STREAM_IDLE_TIMEOUT_MS,
    );
  };
  try {
    for (;;) {
      idle();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue; // comments (": OPENROUTER PROCESSING") and blanks
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        handleChunk(payload);
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (buffer.startsWith("data:")) {
    const payload = buffer.slice(5).trim();
    if (payload && payload !== "[DONE]") handleChunk(payload);
  }

  // OpenRouter can return 200 with an error chunk (provider outage, key cap).
  if (streamError) {
    const se = streamError as { message?: string; code?: number };
    const err = new Error(`OpenRouter error: ${String(se.message ?? "unknown").slice(0, 400)}`) as Error & { status?: number };
    err.status = Number(se.code) || 502;
    throw err;
  }

  const content: AnthropicContentBlock[] = [];
  if (text.length > 0) content.push({ type: "text", text });
  for (const [, tc] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
    let input: unknown;
    try {
      input = JSON.parse(tc.args || "{}");
    } catch {
      input = {};
    }
    content.push({ type: "tool_use", id: tc.id, name: tc.name, input });
  }

  const stop_reason: LlmResponse["stop_reason"] =
    finish === "tool_calls" || toolCalls.size > 0 ? "tool_use" : finish === "length" ? "max_tokens" : "end_turn";

  return { model, provider, stop_reason, content, usage };
}

export async function runAgenticLoop<E>(params: {
  db: Kysely<Database>;
  bore: BoreConfig<E>;
  question: string;
  history: AnthropicMessage[];
  model: string;
  maxTokens: number;
  provider: LlmProvider;
  apiKey: string;
  /** Model calls in total; the last one runs with no tools so it must answer. */
  maxRounds?: number;
  /** Aborts when the client disconnects: no further model calls are paid for. */
  signal?: AbortSignal;
  log: (msg: string, extra?: Record<string, unknown>) => void;
  onEvent?: (e: AskProgressEvent) => void;
}): Promise<{ answer: string; model: string; tool_calls: number; media: MediaItem[]; evidence: E[]; mode: ResponseMode; rounds: AskRoundTrace[] }> {
  const { log, bore } = params;
  const rounds: AskRoundTrace[] = [];
  const maxRounds = Math.max(2, params.maxRounds ?? DEFAULT_MAX_ROUNDS);

  const callModel = async (messages: AnthropicMessage[], lastRound: boolean): Promise<LlmResponse> => {
    if (params.provider === "openrouter") {
      return callOpenRouter({
        model: params.model,
        system: bore.systemPrompt,
        messages,
        tools: lastRound ? [] : bore.tools,
        maxTokens: params.maxTokens,
        apiKey: params.apiKey,
        onDelta: (text) => params.onEvent?.({ type: "delta", text }),
        signal: params.signal,
      });
    }
    const res = await callAnthropic({ model: params.model, system: bore.systemPrompt, messages, tools: bore.tools, noTools: lastRound, maxTokens: params.maxTokens, anthropicApiKey: params.apiKey, signal: params.signal });
    return { ...res, usage: anthropicUsage(res.usage as Record<string, unknown> | undefined) };
  };
  const messages: AnthropicMessage[] = [
    ...params.history,
    { role: "user", content: params.question },
  ];

  let usedModel = params.model;
  let toolCallCount = 0;
  let sentBack = false;
  const mediaCollector: MediaItem[] = [];
  const evidenceCollector: E[] = [];
  // Lookups that failed to run (timeouts, bugs) - not bad IDs. Decides
  // whether an answer with no evidence was "nothing there" or "degraded".
  let retrievalFailures = 0;
  const scratch = new Map<string, unknown>();
  const deadline = Date.now() + LOOP_DEADLINE_MS;

  log("ask:loop_start", { model: params.model, history_turns: params.history.length, question_len: params.question.length });

  // When the loop runs out of road (deadline or rounds) and the model still
  // hasn't written an answer, hand over whatever the tools actually found
  // rather than shrugging.
  const evidenceHandover = (): string => bore.handover(evidenceCollector);

  const stopLooking = bore.stopLooking;

  for (let round = 0; round < maxRounds; round++) {
    // Nobody is waiting for the answer: stop before paying for another call.
    params.signal?.throwIfAborted();
    if (Date.now() > deadline) {
      log("ask:deadline_exceeded", { round, tool_calls: toolCallCount });
      const mode: ResponseMode = evidenceCollector.length > 0 ? "timeout_degraded" : "grounded_empty";
      return { answer: evidenceHandover(), model: usedModel, tool_calls: toolCallCount, media: mediaCollector, evidence: evidenceCollector, mode, rounds };
    }

    // Last round in the budget: no tools, and a nudge if we got here via a
    // tool round. This replaces the old sixth "forced final" call.
    const lastRound = round === maxRounds - 1;
    if (lastRound && round > 0) {
      log("ask:max_rounds_reached", { tool_calls: toolCallCount });
      messages.push({ role: "user", content: stopLooking });
    }

    const callStart = Date.now();
    params.onEvent?.({ type: "round", round });
    log("ask:llm_call", { round, provider: params.provider, messages_in_context: messages.length, tools: !lastRound });

    let response: LlmResponse;
    try {
      response = await callModel(messages, lastRound);
    } catch (err: any) {
      log("ask:llm_error", { round, provider: params.provider, elapsed_ms: Date.now() - callStart, error: String(err?.message ?? err) });
      throw err;
    }

    const callMs = Date.now() - callStart;
    const roundTools = response.content.filter((b) => b.type === "tool_use").map((b) => String(b.name ?? ""));
    const usage = response.usage as LlmUsage | undefined;
    rounds.push({ round, ms: callMs, provider: response.provider ?? null, tools: roundTools, ...(usage ? { usage } : {}) });
    log("ask:llm_response", { round, elapsed_ms: callMs, stop_reason: response.stop_reason, model: response.model, provider: response.provider ?? null, tools: roundTools, ...(usage ?? {}) });

    usedModel = response.model ?? params.model;

    if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
      const textBlock = response.content.find((b) => b.type === "text");
      if (!sentBack && !lastRound && bore.looksUnchecked(String(textBlock?.text ?? ""), toolCallCount)) {
        sentBack = true;
        log("ask:unchecked_recommendation", { round });
        params.onEvent?.({ type: "round", round: round + 1 });
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: bore.backToTheRacks });
        continue;
      }
      const answer = bore.scrubAnswer(String(textBlock?.text ?? "").trim(), evidenceCollector) || bore.emptyAnswer;
      const mode: ResponseMode = evidenceCollector.length > 0 ? "grounded_success" : retrievalFailures > 0 ? "timeout_degraded" : "grounded_empty";
      log("ask:loop_end", { rounds: round + 1, tool_calls: toolCallCount, mode, answer_len: answer.length });
      return { answer, model: usedModel, tool_calls: toolCallCount, media: mediaCollector, evidence: evidenceCollector, mode, rounds };
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
          let timer: ReturnType<typeof setTimeout> | undefined;
          const toolTimeout = new Promise<unknown>((resolve) => {
            timer = setTimeout(
              () => resolve(toolError("transient", `${toolName} timed out. Try it once more, or answer from what you already have.`)),
              TOOL_EXEC_TIMEOUT_MS,
            );
          });
          const result = await Promise.race([
            bore.executeTool(toolName, (block.input as Record<string, unknown>) ?? {}, { db: params.db, mediaCollector, evidenceCollector, scratch }),
            toolTimeout,
          ]).finally(() => clearTimeout(timer));
          if (isRetrievalFailure(result)) retrievalFailures++;
          const failed = isToolError(result);
          log("ask:tool_result", {
            tool: toolName,
            elapsed_ms: Date.now() - toolStart,
            ...(failed ? { error_kind: result.error.kind, error_cause: toolErrorCause(result) } : {}),
          });
          return {
            type: "tool_result" as const,
            tool_use_id: String(block.id ?? ""),
            content: JSON.stringify(result),
            // Anthropic reads is_error; OpenRouter's translation drops it and
            // the model reads the same fact from error.kind in the content.
            ...(failed ? { is_error: true } : {}),
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
      answer: bore.scrubAnswer(String(textBlock?.text ?? "Something went wrong.").trim(), evidenceCollector),
      model: usedModel,
      tool_calls: toolCallCount,
      media: mediaCollector,
      evidence: evidenceCollector,
      mode,
      rounds,
    };
  }

  // Unreachable in practice: the last round runs without tools and every
  // non-tool response returns above. Hand over the evidence if we do land here.
  log("ask:max_rounds_exceeded", { tool_calls: toolCallCount });
  const mode: ResponseMode = evidenceCollector.length > 0 ? "timeout_degraded" : "grounded_empty";
  return {
    answer: evidenceHandover(),
    model: usedModel,
    tool_calls: toolCallCount,
    media: mediaCollector,
    evidence: evidenceCollector,
    mode,
    rounds,
  };
}
