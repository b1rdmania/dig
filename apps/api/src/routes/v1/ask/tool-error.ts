// ---------------------------------------------------------------------------
// Tool errors the model can act on. A flat "Artist not found" and a database
// timeout used to look identical to the model, so it retried bad IDs and
// gave up on lookups that would have worked a second time. Every failed tool
// result now says what kind of failure it was and whether trying again can
// help. A lookup that ran and matched nothing is NOT an error: tools return
// an empty list for that.
//
//   not_found     - the ID or slug does not exist. Retrying it never helps;
//                   search for a real one.
//   invalid_input - the call itself was wrong (missing or unknown argument,
//                   an ID not established this turn). Fix the call.
//   transient     - timeout or connection trouble. One retry may work.
//   internal      - a bug on our side. Retrying the same call won't help.
//
// Only transient and internal count as retrieval failures for the response
// mode (loop.ts): a bad ID is the model's mistake, not a degraded answer.
// ---------------------------------------------------------------------------

export type ToolErrorKind = "not_found" | "invalid_input" | "transient" | "internal";

export interface ToolError {
  error: { kind: ToolErrorKind; retryable: boolean; message: string };
}

export function toolError(kind: ToolErrorKind, message: string): ToolError {
  return { error: { kind, retryable: kind === "transient", message } };
}

export function isToolError(v: unknown): v is ToolError {
  const e = (v as { error?: { kind?: unknown } } | null)?.error;
  return typeof e === "object" && e !== null && typeof e.kind === "string";
}

/** A failure that means the lookup didn't run, as opposed to a bad call. */
export function isRetrievalFailure(v: unknown): boolean {
  return isToolError(v) && (v.error.kind === "transient" || v.error.kind === "internal");
}

// Postgres SQLSTATEs that mean "try again": query_canceled (statement
// timeout), too_many_connections, and the whole connection-exception class.
const TRANSIENT_PG = /^(57014|53300|08\w{3})$/;
const TRANSIENT_MSG = /timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|connection terminated/i;

/**
 * Classify an exception thrown inside a tool. The raw message stays out of
 * what the model reads (driver errors leak internals and help no one pick
 * the next call) but rides along, non-enumerable, for the request log.
 */
export function thrownToolError(err: unknown): ToolError {
  const e = err as { code?: unknown; cause?: { code?: unknown }; message?: unknown };
  const code = String(e?.code ?? e?.cause?.code ?? "");
  const message = String(e?.message ?? err);
  const out = TRANSIENT_PG.test(code) || TRANSIENT_MSG.test(message) || TRANSIENT_MSG.test(code)
    ? toolError("transient", "The lookup timed out. Try it once more, or answer from what you already have.")
    : toolError("internal", "That lookup failed on our side. Don't retry it; use another tool or answer from what you have.");
  Object.defineProperty(out, "cause", { value: message.slice(0, 300), enumerable: false });
  return out;
}

/** The underlying exception message, if this error came from a throw. */
export function toolErrorCause(v: unknown): string | undefined {
  return (v as { cause?: string } | null)?.cause;
}
