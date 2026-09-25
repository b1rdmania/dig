import { afterEach, describe, it, expect, vi } from "vitest";
import { runAgenticLoop } from "../routes/v1/ask/loop.js";
import type { BoreConfig } from "../routes/v1/ask/bore.js";
import { isRetrievalFailure, thrownToolError, toolError, toolErrorCause } from "../routes/v1/ask/tool-error.js";

/**
 * Tool failures tell the model what kind of failure it was and whether a
 * retry can help; only failures to run a lookup degrade the response mode;
 * and the Anthropic path caches its prompt prefix across rounds.
 */

describe("tool errors", () => {
  it("marks only transient errors retryable", () => {
    expect(toolError("transient", "x").error.retryable).toBe(true);
    expect(toolError("not_found", "x").error.retryable).toBe(false);
    expect(toolError("invalid_input", "x").error.retryable).toBe(false);
    expect(toolError("internal", "x").error.retryable).toBe(false);
  });

  it("classifies a statement timeout as transient and hides the driver message", () => {
    const err = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    const out = thrownToolError(err);
    expect(out.error.kind).toBe("transient");
    expect(JSON.stringify(out)).not.toContain("canceling statement");
    expect(toolErrorCause(out)).toContain("canceling statement");
  });

  it("classifies an unknown throw as internal", () => {
    expect(thrownToolError(new TypeError("x is undefined")).error.kind).toBe("internal");
  });

  it("counts transient and internal as retrieval failures, not bad IDs", () => {
    expect(isRetrievalFailure(toolError("transient", ""))).toBe(true);
    expect(isRetrievalFailure(toolError("internal", ""))).toBe(true);
    expect(isRetrievalFailure(toolError("not_found", ""))).toBe(false);
    expect(isRetrievalFailure({ results: [] })).toBe(false);
  });
});

const TOOL = {
  name: "get_artist",
  description: "d",
  input_schema: { type: "object" as const, properties: {}, required: [] },
};

const boreReturning = (result: unknown) => ({
  slug: "record",
  name: "Test",
  systemPrompt: "persona",
  tools: [TOOL],
  executeTool: async () => result,
  progressLabel: () => "",
  scrubAnswer: (a: string) => a,
  looksUnchecked: () => false,
  backToTheRacks: "",
  stopLooking: "stop",
  handover: () => "",
  emptyAnswer: "empty",
  evidenceKey: () => "",
  publicMaxRounds: 3,
  publicMaxTokens: 256,
  quotaKey: "test",
}) as BoreConfig;

// Anthropic wire: round 1 asks for a tool, round 2 answers.
function anthropicFetch() {
  const bodies: any[] = [];
  let call = 0;
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    call++;
    const payload = call === 1
      ? { model: "m", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "get_artist", input: { discogs_id: 1 } }], usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 900 } }
      : { model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "answer" }], usage: { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 900 } };
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return bodies;
}

const run = (bore: BoreConfig, maxRounds?: number) =>
  runAgenticLoop({
    db: {} as never,
    bore,
    question: "q",
    history: [],
    model: "m",
    maxTokens: 256,
    maxRounds,
    provider: "anthropic",
    apiKey: "k",
    log: () => {},
  });

afterEach(() => vi.unstubAllGlobals());

describe("loop handling of tool errors", () => {
  it("flags the tool_result as an error and treats a bad ID as an empty answer, not a degraded one", async () => {
    const bodies = anthropicFetch();
    const out = await run(boreReturning(toolError("not_found", "No artist with ID 1.")));
    const toolResult = bodies[1].messages.at(-1).content[0];
    expect(toolResult.is_error).toBe(true);
    expect(JSON.parse(toolResult.content).error.kind).toBe("not_found");
    expect(out.mode).toBe("grounded_empty");
  });

  it("reports a degraded answer when a lookup failed to run", async () => {
    anthropicFetch();
    const out = await run(boreReturning(toolError("transient", "timed out")));
    expect(out.mode).toBe("timeout_degraded");
  });

  it("does not flag a successful result", async () => {
    const bodies = anthropicFetch();
    await run(boreReturning({ results: [] }));
    expect(bodies[1].messages.at(-1).content[0].is_error).toBeUndefined();
  });
});

describe("Anthropic prompt caching", () => {
  it("pins the system prompt and auto-caches the conversation tail", async () => {
    const bodies = anthropicFetch();
    const out = await run(boreReturning({ results: [] }));
    expect(bodies[0].system).toEqual([{ type: "text", text: "persona", cache_control: { type: "ephemeral" } }]);
    expect(bodies[0].cache_control).toEqual({ type: "ephemeral" });
    expect(out.rounds[1].usage).toMatchObject({ cached_tokens: 900 });
  });

  it("keeps the tool list on the last round and blocks calls with tool_choice none", async () => {
    const bodies = anthropicFetch();
    await run(boreReturning({ results: [] }), 2);
    expect(bodies[0].tool_choice).toBeUndefined();
    expect(bodies[1].tools).toEqual([TOOL]);
    expect(bodies[1].tool_choice).toEqual({ type: "none" });
  });
});
