/**
 * Server-only env access for the Dig API. Single source of truth for the
 * handful of route handlers and helpers that talk to the API directly.
 */
export const API_URL = process.env.DIG_API_URL || "https://dig-api.fly.dev";
export const API_KEY = process.env.DIG_API_KEY || "";

export function apiKeyHeaders(): Record<string, string> {
  return API_KEY ? { "X-API-Key": API_KEY } : {};
}
