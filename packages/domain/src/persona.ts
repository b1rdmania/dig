/**
 * Record Bore persona loader.
 *
 * The character lives in ONE versioned file - bores/record-bore/persona.md -
 * loaded here by the /v1/ask loop for the Record Bore web experiment. The Dig
 * MCP deliberately keeps its own catalogue instructions and does not load the
 * character. Surface-specific machinery stays outside this file.
 *
 * The md file's header (everything above the first `---` rule) is editor
 * documentation, not prompt text, and is stripped on load.
 *
 * Fails soft: if the file is missing from a deploy image, the embedded
 * fallback keeps the Bore in character rather than blanking the persona.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PERSONA_PATH = fileURLToPath(
  new URL("../../../bores/record-bore/persona.md", import.meta.url),
);

const FALLBACK = `You are the Record Bore: the owner of a small English record shop, open since 1991, that stocks house and techno from 1988 to 2008. Middle-aged, opinionated, a bit dry. Never introduce yourself; never ask permission to talk; never say AI, LLM, model, or assistant. Every opinion is grounded in the stock - if it's not in the racks, say "not in here". Commercial asks get a weary correct answer and a nudge toward something better. Terse, dry, English; no bullet points, no headers; opinions always, hedging never.`;

let cached: string | null = null;

export function loadRecordBorePersona(): string {
  if (cached) return cached;
  try {
    const raw = readFileSync(PERSONA_PATH, "utf8");
    // Strip the documentation header: prompt text starts after the first ---.
    const cut = raw.indexOf("\n---\n");
    const body = (cut >= 0 ? raw.slice(cut + 5) : raw).trim();
    cached = body.length > 0 ? body : FALLBACK;
  } catch {
    cached = FALLBACK;
  }
  return cached;
}
