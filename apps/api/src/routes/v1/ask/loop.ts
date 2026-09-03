// ---------------------------------------------------------------------------
// LLM agentic loop with native tool use.
// Two providers behind one internal contract (Anthropic content blocks):
//   - anthropic: api.anthropic.com/v1/messages, BYO key from the client
//   - openrouter: openrouter.ai chat-completions (Kimi etc.), server-side key
// ---------------------------------------------------------------------------

import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { loadRecordBorePersona } from "@dig/domain";
import type { AnthropicMessage, AnthropicContentBlock, MediaItem, EvidenceItem, ResponseMode } from "./types.js";
import { TOOLS, executeTool } from "./tools.js";

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
const LOOP_DEADLINE_MS = 240_000;

// ---------------------------------------------------------------------------
// Personality - the Record Bore, loaded from bores/record-bore/persona.md.
// This character belongs to the web ask loop; operational rules below are
// specific to this surface. The Dig MCP keeps separate instructions.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `${loadRecordBorePersona()}

GROUNDING - hard rules:

1. Every concrete claim about an artist, label, release, year, or credit MUST come from a tool result you obtained THIS turn. If you didn't look it up, you don't know it.
2. Every artist, label, or master you name must have been returned by a tool call this turn. Never invent IDs, titles, or years.
3. If a tool returns nothing, say so like you'd say it across the counter: "not in here". Don't pad the gap with general knowledge unless you flag it - "off the top of my head, don't quote me".
3a. Leaps start in your head and end on the shelf. Thinking of an artist, label, or record the customer didn't mention is exactly what you're for - then check the stock for it before recommending. If it's in, link it like anything else; if it's not, you can still name it as a pointer, flagged honestly ("not one of mine, but that's the thread").
4. The stock is scoped on purpose. Rock, jazz, hip-hop, post-2008 EDM - wrong shop. Adjacent stuff (IDM, electro, jungle, Italo, minimal) is in; check before assuming either way.
5. Never mention tools, databases, catalogs-as-software, or searching. You just know your stock - look things up silently and talk about the records.
6. NEVER narrate looking things up. No "one sec", "let me check", "be right back", "here we go", "pulling those now" - none of it, ever. The customer never sees you fetch. If you need to look, call the tool and say nothing. Any text you write IS the finished answer: records, opinions, links. If a sentence isn't part of the final answer, don't write it.
7. Not every turn is a lookup. When the customer pushes back, complains, corrects you, or steers ("none of these are trippy", "that's not what I meant") - that's conversation. Answer it in voice: own the miss, sharpen your read of what they want, and re-aim. NEVER respond to feedback with silence or a brush-off; silence across the counter is how you lose a customer.

THE OPENING EXCHANGE:

A broad first ask - "unheard-of soulful house", "something underground", "deep techno" - is not a search brief. It's someone walking in off the street and saying "got anything good?". Don't disappear into the racks for it. Size them up first, in voice, grumpy is fine: one sharp question about what they already rate - a record, a label, a night they remember, US or UK, early or late. You can put one taster on the counter to anchor it (one lookup, one record, linked), but the proper dig waits until they've given you a name or an edge to work from. The back-and-forth IS the service; anyone can dump twenty records on a stranger.

FINDING THINGS (never spoken aloud):

Match the digging to the question. A simple ask - "best records on X", one named artist or record - needs one or two lookups, answer, done. Save the multi-hop digging for questions that actually need the trail. The customer is standing at the counter; don't disappear into the back room for five minutes.

When they ask to go DEEPER on an artist - allied stuff, engineers, the weird end - you have two sources and you should use both. The credit graph (get_artist_credits, get_artist_collaborators, get_artist_groups) gives you the documented connections: aliases, remix work, who's actually on the records. And your own knowledge of the scene gives you the leaps a real shop owner makes - the protégé, the label that carried the torch, the record that answers the itch from a different city. Leaps are welcome and encouraged WHEN they're connected: say why this record follows from where the conversation is ("same lineage, pushed further out"), not just that it's canon from the same decade. A list of famous records with no thread back to what the customer asked is the failure mode - not the leap itself.

- Named artist/label/release → search_catalog to resolve the ID, then get_artist / get_label / get_master.
- get_artist is the whole person: every alias with its own ID, record count and years, plus the credit roles they hold. Read it before you dig. An alias ID in get_artist_masters gives that alias alone; include_aliases=true gives the whole person. Never search an alias by name when the card already has its ID.
- "Who engineered / produced / remixed X" → get_artist_credits with role=engineer / produce / remix; the card's credit_roles tells you which roles exist before you ask.
- Era/region/sound asks ("Italian proto-trance around '95") → search_catalog with FILTERS, not keyword guesses: style + country + year_min/year_max, empty or minimal query. One filtered search beats five keyword stabs. Results come back curation-weighted - the top ones are the good ones.
- "Recommend music by X" / discography → get_artist_masters. Always - the video rail depends on it.
- "What's good on label Y" → get_label_essentials FIRST (core run + related-label directions). get_label_releases only if essentials is empty.
- Orienting yourself in a sound or era → list_scenes / get_scene, silently.
- "What's similar to label Z" → get_label_essentials on Z and follow the directional edges (deeper, harder, rawer...) - but present the destination labels and records, not the mechanism.

LINKS - NON-NEGOTIABLE, THE WHOLE SHOP RUNS ON THEM:

Every entity you mention MUST be a markdown link to its Dig page:
- Master: [Title](https://app.dig.baby/master/ID)
- Artist: [Name](https://app.dig.baby/artist/ID)
- Label: [Label](https://app.dig.baby/label/ID)

A record named without its link is a record the customer cannot hear or buy - it's a dead recommendation. Videos render below your answer ONLY for masters whose URL appears in your text, and the customer's session playlist is built ONLY from linked records. If you write "Infinition from '93" as plain text, it does not exist. Before you finish an answer, check: is every record you recommended a [Title](https://app.dig.baby/master/ID) link, using the exact ID a tool returned this turn? Don't link records you're naming only in passing.

Never link to Discogs, Bandcamp, YouTube, NTS, Spotify, or anything outside dig.baby unless the user explicitly asks.
`;

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
  /** Upstream host that served the call (OpenRouter reports it per chunk). */
  provider?: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  content: AnthropicContentBlock[];
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
}

// ---------------------------------------------------------------------------
// OpenRouter - OpenAI chat-completions wire format, translated to and from
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

// Provider routing on OpenRouter. LLM_PROVIDER_ORDER (comma-separated
// provider slugs, e.g. "fireworks/fast,moonshotai") pins hosts explicitly;
// otherwise anthropic/* models go straight to Anthropic and everything else
// takes OpenRouter's throughput sort. The 2026-09-03 timing showed the same
// Kimi call bouncing between 1s and 23s hosts under "throughput" alone.
// LLM_PROVIDER_IGNORE lists hosts a fallback may never land on. The round
// trace (meta.rounds) is how you find them: on 2026-09-03 every 10-23s
// answer-writing round was Makora; Parasail wrote the same in 2-3s.
function providerPreference(model: string): Record<string, unknown> {
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
  tools: typeof TOOLS;
  maxTokens: number;
  apiKey: string;
  onDelta?: (text: string) => void;
}): Promise<LlmResponse> {
  const controller = new AbortController();
  // The timer bounds time-to-first-byte; once the stream is open the
  // per-token cadence is what matters and a long answer must not be cut.
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
        reasoning: { effort: "low" },
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

  // SSE: "data: {chunk}\n\n" lines, terminated by "data: [DONE]". Text
  // deltas go straight to the caller; tool calls arrive as fragments keyed
  // by index and are stitched back together here.
  let model = params.model;
  let provider: string | undefined;
  let text = "";
  let finish = "stop";
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();
  let streamError: { message?: string; code?: number } | null = null;

  const handleChunk = (raw: string) => {
    let data: {
      model?: string;
      provider?: string;
      error?: { message?: string; code?: number };
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
  for (;;) {
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

  return { model, provider, stop_reason, content };
}

export async function runAgenticLoop(params: {
  db: Kysely<Database>;
  question: string;
  history: AnthropicMessage[];
  model: string;
  maxTokens: number;
  provider: LlmProvider;
  apiKey: string;
  /** Model calls in total; the last one runs with no tools so it must answer. */
  maxRounds?: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
  onEvent?: (e: AskProgressEvent) => void;
}): Promise<{ answer: string; model: string; tool_calls: number; media: MediaItem[]; evidence: EvidenceItem[]; mode: ResponseMode; rounds: AskRoundTrace[] }> {
  const { log } = params;
  const rounds: AskRoundTrace[] = [];
  const maxRounds = Math.max(2, params.maxRounds ?? DEFAULT_MAX_ROUNDS);

  const callModel = (messages: AnthropicMessage[], tools: typeof TOOLS): Promise<LlmResponse> =>
    params.provider === "openrouter"
      ? callOpenRouter({
          model: params.model,
          system: SYSTEM_PROMPT,
          messages,
          tools,
          maxTokens: params.maxTokens,
          apiKey: params.apiKey,
          onDelta: (text) => params.onEvent?.({ type: "delta", text }),
        })
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

  // When the loop runs out of road (deadline or rounds) and the model still
  // hasn't written an answer, hand over whatever the tools actually found
  // rather than shrugging.
  const evidenceHandover = (): string => {
    const masters = evidenceCollector.filter((e) => e.type === "master").slice(0, 6);
    if (masters.length > 0) {
      return [
        "Lost the thread on that one, but here's what I pulled out along the way - have a listen and tell me which direction to dig:",
        "",
        ...masters.map((m) => `[${m.title}](${m.dig_url})`),
      ].join("\n");
    }
    return "That one's sent me down too many aisles - ask it a bit narrower and I'll pull the right crate.";
  };

  const stopLooking =
    "STOP LOOKING. Write the finished answer NOW using only what you already found. " +
    "Recommend the records with their [Title](https://app.dig.baby/master/ID) links. " +
    "Do not say you will check, look, dig, or be back - there are no more lookups. " +
    "If what you found is thin, say plainly what you do have and leave it there.";

  for (let round = 0; round < maxRounds; round++) {
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
      response = await callModel(messages, lastRound ? [] : TOOLS);
    } catch (err: any) {
      log("ask:llm_error", { round, provider: params.provider, elapsed_ms: Date.now() - callStart, error: String(err?.message ?? err) });
      throw err;
    }

    const callMs = Date.now() - callStart;
    const roundTools = response.content.filter((b) => b.type === "tool_use").map((b) => String(b.name ?? ""));
    rounds.push({ round, ms: callMs, provider: response.provider ?? null, tools: roundTools });
    log("ask:llm_response", { round, elapsed_ms: callMs, stop_reason: response.stop_reason, model: response.model, provider: response.provider ?? null, tools: roundTools });

    usedModel = response.model ?? params.model;

    if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
      const textBlock = response.content.find((b) => b.type === "text");
      const answer = String(textBlock?.text ?? "").trim() || "Go on - say that again for me. What is it you're actually chasing?";
      const mode: ResponseMode = evidenceCollector.length > 0 ? "grounded_success" : errorRef.count > 0 ? "timeout_degraded" : "grounded_empty";
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
