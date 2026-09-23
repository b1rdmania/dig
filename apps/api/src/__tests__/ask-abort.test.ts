import { EventEmitter } from "node:events";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { FastifyReply } from "fastify";
import { clientGone } from "../routes/v1/ask/index.js";
import { runAgenticLoop } from "../routes/v1/ask/loop.js";
import type { BoreConfig } from "../routes/v1/ask/bore.js";

/**
 * An ask stops spending when nobody is waiting for it: a client disconnect
 * aborts the model call in flight and no further round starts, and a stalled
 * upstream stream is cut by the idle timer instead of running forever.
 */

const bore = {
  slug: "record",
  name: "Test",
  systemPrompt: "",
  tools: [],
  executeTool: async () => ({}),
  progressLabel: () => "",
  scrubAnswer: (a: string) => a,
  looksUnchecked: () => false,
  backToTheRacks: "",
  stopLooking: "",
  handover: () => "",
  emptyAnswer: "",
  evidenceKey: () => "",
  publicMaxRounds: 3,
  publicMaxTokens: 256,
  quotaKey: "test",
} as BoreConfig;

const loop = (provider: "openrouter" | "anthropic", signal?: AbortSignal) =>
  runAgenticLoop({
    db: {} as never,
    bore,
    question: "q",
    history: [],
    model: "m",
    maxTokens: 256,
    provider,
    apiKey: "k",
    signal,
    log: () => {},
  });

// A 200 SSE response whose body sends `chunks` and then goes quiet. Aborting
// the fetch signal errors the body, as undici does.
function stallingFetch(chunks: string[]) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
        init.signal?.addEventListener("abort", () => c.error(init.signal?.reason));
      },
    });
    return new Response(body, { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("clientGone", () => {
  const fakeReply = () => {
    const raw = Object.assign(new EventEmitter(), { writableFinished: false });
    return { raw, reply: { raw } as unknown as FastifyReply };
  };

  it("aborts when the connection closes before the response is written", () => {
    const { raw, reply } = fakeReply();
    const signal = clientGone(reply);
    raw.emit("close");
    expect(signal.aborted).toBe(true);
  });

  it("does not abort on the normal close after the response is written", () => {
    const { raw, reply } = fakeReply();
    const signal = clientGone(reply);
    raw.writableFinished = true;
    raw.emit("close");
    expect(signal.aborted).toBe(false);
  });
});

describe("runAgenticLoop abort", () => {
  it("makes no model call once the client has gone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(loop("openrouter", AbortSignal.abort())).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts the OpenRouter stream in flight when the client goes", async () => {
    const fetchMock = stallingFetch([": OPENROUTER PROCESSING\n"]);
    vi.stubGlobal("fetch", fetchMock);
    const gone = new AbortController();
    const run = loop("openrouter", gone.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    gone.abort(new Error("client disconnected"));
    await expect(run).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes the client signal to the Anthropic call", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }));
    vi.stubGlobal("fetch", fetchMock);
    const gone = new AbortController();
    const run = loop("anthropic", gone.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    gone.abort(new Error("client disconnected"));
    await expect(run).rejects.toThrow("client disconnected");
  });

  it("cuts an OpenRouter stream that goes quiet", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", stallingFetch([`data: ${JSON.stringify({ choices: [{ delta: { content: "hal" } }] })}\n`]));
    const run = loop("openrouter");
    const settled = expect(run).rejects.toThrow(/idle/);
    await vi.advanceTimersByTimeAsync(30_000);
    await settled;
  });
});
