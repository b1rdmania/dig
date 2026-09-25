/**
 * Bore persona loader.
 *
 * Each bore's character lives in ONE versioned file - bores/<slug>/persona.md -
 * loaded here by the /v1/ask loop. The Dig MCP deliberately keeps its own
 * catalogue instructions and does not load a character. Surface-specific
 * machinery (tool routing, link discipline) stays outside the persona file.
 *
 * The md file's header (everything above the first `---` rule) is editor
 * documentation, not prompt text, and is stripped on load.
 *
 * Fails soft: if the file is missing from a deploy image, the embedded
 * fallback keeps the Bore in character rather than blanking the persona.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type BorePersonaSlug = "record-bore" | "wine-bore";

const FALLBACK: Record<BorePersonaSlug, string> = {
  "record-bore": `You are the Record Bore: the owner of a small English record shop, open since 1991, that stocks house and techno from 1988 to 2008. Middle-aged, opinionated, a bit dry. Never introduce yourself; never ask permission to talk; never say AI, LLM, model, or assistant. Every opinion is grounded in the stock - if it's not in the racks, say "not in here". Commercial asks get a weary correct answer and a nudge toward something better. Terse, dry, English; no bullet points, no headers; opinions always, hedging never.`,
  "wine-bore": `You are the Wine Bore: the owner of a small independent wine shop, open since 1994. Middle-aged, dry, sceptical of scores and of anyone who says "smooth". Never introduce yourself; never ask permission to talk; never say AI, LLM, model, or assistant. Every opinion is grounded in the register and the cellar book - if it's not there, say "never heard of it". Commercial asks get a weary correct answer and a nudge toward something better. Nothing is in stock; say so. Terse, dry, English; no bullet points, no headers; opinions always, hedging never.`,
};

const cached = new Map<BorePersonaSlug, string>();

function personaPath(slug: BorePersonaSlug): string {
  return fileURLToPath(new URL(`../../../bores/${slug}/persona.md`, import.meta.url));
}

export function loadBorePersona(slug: BorePersonaSlug): string {
  const hit = cached.get(slug);
  if (hit) return hit;
  let body: string;
  try {
    const raw = readFileSync(personaPath(slug), "utf8");
    // Strip the documentation header: prompt text starts after the first ---.
    const cut = raw.indexOf("\n---\n");
    body = (cut >= 0 ? raw.slice(cut + 5) : raw).trim();
    if (body.length === 0) body = FALLBACK[slug];
  } catch {
    body = FALLBACK[slug];
  }
  cached.set(slug, body);
  return body;
}

/**
 * A bore's data pack file (bores/<slug>/pack/<file>, JSON), read once. Fails
 * soft to null: a pack that didn't make it into the image costs the bore its
 * pictures, never its answers.
 */
const packs = new Map<string, unknown>();
export function loadBorePack<T>(slug: BorePersonaSlug, file: string): T | null {
  const key = `${slug}/${file}`;
  if (!packs.has(key)) {
    try {
      const path = fileURLToPath(new URL(`../../../bores/${slug}/pack/${file}`, import.meta.url));
      packs.set(key, JSON.parse(readFileSync(path, "utf8")));
    } catch {
      packs.set(key, null);
    }
  }
  return packs.get(key) as T | null;
}

/** Record Bore's original entry point; kept so nothing else moves. */
export function loadRecordBorePersona(): string {
  return loadBorePersona("record-bore");
}
