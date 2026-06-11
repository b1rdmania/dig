// ---------------------------------------------------------------------------
// Auth — private beta key gate for /v1/ask
// ---------------------------------------------------------------------------

import type { FastifyRequest } from "fastify";

const PRIVATE_KEYS = new Set(
  (process.env.LLM_BETA_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export function requirePrivateKey(req: FastifyRequest): { ok: true } | { ok: false; status: number; body: unknown } {
  // Fail closed: if no beta keys are configured, the endpoint is unavailable
  // rather than open to everyone.
  if (PRIVATE_KEYS.size === 0) {
    return {
      ok: false,
      status: 503,
      body: { error: { code: "CONFIG_ERROR", message: "Private beta is not configured", details: null } },
    };
  }
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
