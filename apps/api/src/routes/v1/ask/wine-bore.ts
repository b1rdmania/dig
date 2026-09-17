// ---------------------------------------------------------------------------
// Wine Bore - the second bore. Persona from bores/wine-bore/persona.md, six
// tools over the `wine` schema (@dig/domain wine.ts). Grounding here is by
// evidence, not links: there are no wine entity pages, so the answer carries
// no links at all and the page renders what the tools returned ("on the
// counter") under the text. Anything the model links is unlinked; a bottle
// named with no lookup sends him back to the cellar book once.
// ---------------------------------------------------------------------------

import {
  loadBorePersona,
  searchWine,
  getAppellation,
  getWineProducer,
  getWine,
  getGrape,
  getShelf,
  listShelves,
  findUrl,
  type WineEntityType,
} from "@dig/domain";
import type { BoreConfig, ProgressEvent, ToolContext, ToolDef } from "./bore.js";

export interface WineEvidence {
  type: WineEntityType | "shelf";
  id: number | string;
  title: string;
  subtitle: string | null;
  /** Search handoff - the act surface until a merchant licenses the shop. */
  find_url: string | null;
}

const RULES = `
GROUNDING - hard rules:

1. Every concrete claim about an appellation rule, a grape, a producer, a wine, a classification or a vintage MUST come from a tool result you obtained THIS turn. If you didn't look it up, you don't know it.
2. Every producer, wine, appellation or grape you name as a recommendation must have been returned by a tool call this turn. Never invent names, cuvées or years.
3. If a tool returns nothing, say so across the counter: "never heard of it". Don't pad the gap with general knowledge unless you flag it - "off the top of my head, don't quote me".
4. The register beats everything. When you state what grapes an appellation permits, its yield, or what a term legally means, that comes from get_appellation. If the register and your instinct disagree, the register wins and you say so.
5. Never mention tools, databases, registers-as-software, or searching. You know your cellar book - look things up silently and talk about the wine.
6. NEVER narrate looking things up. No "one sec", "let me check", "be right back". Any text you write IS the finished answer.
7. Not every turn is a lookup. When the customer pushes back, corrects you, or steers - that's conversation. Answer it in voice: own the miss, sharpen your read, re-aim. Never respond to feedback with silence.
8. Nothing is in stock, and you only say so if the customer actually asks to buy, asks a price, or asks what is on the shelf. Otherwise never mention stock, suppliers, or what you have in - just name the bottle to go and find. Never pretend to have a price or a shelf.
9. No links. Never write a URL or a markdown link; the page shows the bottles you named under your answer.

FINDING THINGS (never spoken aloud):

Match the digging to the question. A simple ask - one appellation, one producer, one grape - needs one or two lookups, then the answer. The customer is standing at the counter; don't disappear into the cellar for five minutes.

- A named appellation, producer, wine or grape → search_cellar to resolve the ID, then the matching get_ call. Batch both in one round when you can.
- "What grapes can X use", "what does Riserva / Kabinett / Grand Cru mean here", "how much can they crop" → get_appellation. Pass a q (e.g. "cépages", "rendement", "vitigni", "variedades") to pull the clause from the cahier des charges when the customer wants the letter of the rule.
- "Who makes good X", "what's the producer's range" → get_producer; its wines list is the range, the classification column says which are the serious cuvées.
- A specific bottle → get_wine: grapes, appellation, and any listings with a tasting text. The taste text is a monopoly's own note, in Swedish - read it, don't quote it verbatim.
- "What is Trousseau", "where is Mencía grown" → get_grape: synonyms, and which appellations permit it.
- Orienting yourself in a region or style → get_shelf, silently, using the shelf map below. Shelves are your private map, never a menu for the customer.
- Rounds are few. Several tool calls in one round is normal.

THE OPENING EXCHANGE:

A broad first ask - "something nice for dinner", "a good red", "what should I drink" - is someone walking in off the street. Size them up first, in voice: one sharp question about what they already rate - a bottle, a region, a grape, a price they'd pay. One taster on the counter to anchor it is fine (one lookup, one bottle), but the proper dig waits until they've given you a name or an edge.

SHELVES (slug - name):
{{SHELVES}}
`;

export const WINE_TOOLS: ToolDef[] = [
  {
    name: "search_cellar",
    description:
      "Search the cellar book: appellations (EU register), producers and wines (LWIN), grapes (Wikidata). Use to resolve any name to an ID before a get_ call. Returns type, id, name, one line of context.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Name or words - appellation, producer, wine, grape" },
        type: { type: "string", enum: ["appellation", "producer", "wine", "grape"], description: "Restrict to one entity type. Omit to search all." },
        country: { type: "string", description: "ISO-2 country code to narrow (FR, IT, ES, DE, AT, PT, US...)" },
        limit: { type: "number", description: "Results (1-12, default 8)" },
      },
      required: ["q"],
    },
  },
  {
    name: "get_appellation",
    description:
      "The register entry for a protected name: type (PDO/PGI), permitted grapes with colour codes, yield and density limits, other spellings, protection date, the producers with most wines under it, and up to three official rule documents (cahier des charges / disciplinare / pliego). Pass q to get the matching clause from those documents.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Appellation ID from search_cellar" },
        q: { type: "string", description: "Words to pull from the rule document, e.g. 'cépages', 'rendement', 'élevage', 'vitigni', 'invecchiamento', 'variedades'" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_producer",
    description:
      "A producer's card: country, region, website, founding year, UK importer where known, outside identities (Wikidata, consorzio directory, monopoly), and their wines (LWIN) with appellation and classification.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number", description: "Producer ID from search_cellar" } },
      required: ["id"],
    },
  },
  {
    name: "get_wine",
    description:
      "One wine (LWIN-7): producer, appellation, colour, classification, vintage span, grapes where known, and any catalogue listings with vintage, price and a tasting note.",
    input_schema: {
      type: "object",
      properties: { lwin: { type: "number", description: "LWIN-7 id from search_cellar or a producer's wine list" } },
      required: ["lwin"],
    },
  },
  {
    name: "get_grape",
    description:
      "A grape variety: colour, synonyms, parentage, countries of origin, and which appellations permit it (with counts).",
    input_schema: {
      type: "object",
      properties: { id: { type: "number", description: "Grape ID from search_cellar" } },
      required: ["id"],
    },
  },
  {
    name: "get_shelf",
    description:
      "One of the shop's private shelves (your map of a region or style): its producers, appellations and wines in the order you'd put them on the counter, with the shop's one-line opinion on each, and the directions to neighbouring shelves (deeper, cleaner, wilder, earlier, cheaper, grander). Never present a shelf to the customer as a thing.",
    input_schema: {
      type: "object",
      properties: { slug: { type: "string", description: "Shelf slug from the map in your instructions" } },
      required: ["slug"],
    },
  },
];

function ev(ctx: ToolContext<WineEvidence>, e: WineEvidence) {
  ctx.evidenceCollector.push(e);
}

export async function executeWineTool(name: string, input: Record<string, unknown>, ctx: ToolContext<WineEvidence>): Promise<unknown> {
  const db = ctx.db as any;
  try {
    if (name === "search_cellar") {
      const q = String(input.q ?? "").slice(0, 200);
      const type = input.type ? (String(input.type) as WineEntityType) : undefined;
      const country = input.country ? String(input.country) : undefined;
      const limit = Math.min(Math.max(Number(input.limit ?? 8), 1), 12);
      const hits = await searchWine(db, { q, type, country, limit });
      for (const h of hits) ev(ctx, { type: h.type, id: h.id, title: h.name, subtitle: h.context, find_url: h.type === "wine" ? findUrl(h.name) : null });
      return { results: hits.map((h) => ({ type: h.type, id: h.id, name: h.name, context: h.context })), total: hits.length };
    }
    if (name === "get_appellation") {
      const d = await getAppellation(db, Number(input.id), input.q ? String(input.q) : undefined);
      if (!d) { ctx.errorRef.count++; return { error: "Appellation not found" }; }
      ev(ctx, { type: "appellation", id: d.id, title: d.name, subtitle: `${d.country} · ${d.gi_type}`, find_url: null });
      for (const p of d.producers) ev(ctx, { type: "producer", id: p.id, title: p.name, subtitle: d.name, find_url: null });
      return {
        id: d.id, name: d.name, country: d.country, type: d.gi_type, protected_since: d.protection_date, status: d.status,
        other_names: d.other_names, categories: d.categories,
        permitted_grapes: d.grapes.map((g) => `${g.name}${g.colour_code ? ` (${g.colour_code})` : ""}${g.kind === "other" ? " [secondary]" : ""}`),
        max_yield_hl_per_ha: d.max_yield_hl, max_yield_kg_per_ha: d.max_yield_kg, min_vines_per_ha: d.min_planting_density,
        legal_instrument: d.legal_instrument,
        rule_documents: d.documents.map((x) => ({ type: x.doc_type, title: x.title, clause: x.excerpt })),
        wines_in_book: d.wine_count,
        leading_producers: d.producers,
        source: `${d.source} ${d.source_ref}`,
      };
    }
    if (name === "get_producer") {
      const d = await getWineProducer(db, Number(input.id));
      if (!d) { ctx.errorRef.count++; return { error: "Producer not found" }; }
      ev(ctx, { type: "producer", id: d.id, title: d.name, subtitle: [d.region, d.country_name].filter(Boolean).join(", ") || null, find_url: null });
      for (const w of d.wines) ev(ctx, { type: "wine", id: w.lwin, title: w.name, subtitle: w.appellation, find_url: findUrl(w.name) });
      return {
        id: d.id, name: d.name, country: d.country_name, region: d.region, website: d.website, founded: d.founded_year,
        uk_importer: d.uk_importer, known_elsewhere: d.links.map((l) => `${l.kind}: ${l.name_as_found}`),
        wines: d.wines.map((w) => ({ lwin: w.lwin, name: w.name, colour: w.colour, appellation: w.appellation, classification: w.classification })),
        wine_count: d.wine_count, catalogue_listings: d.listing_count, source: `${d.source} ${d.source_ref}`,
      };
    }
    if (name === "get_wine") {
      const d = await getWine(db, Number(input.lwin));
      if (!d) { ctx.errorRef.count++; return { error: "Wine not found" }; }
      ev(ctx, { type: "wine", id: d.lwin, title: d.name, subtitle: d.appellation?.name ?? d.sub_region ?? d.region, find_url: d.find_url });
      if (d.producer) ev(ctx, { type: "producer", id: d.producer.id, title: d.producer.name, subtitle: d.region, find_url: null });
      if (d.appellation) ev(ctx, { type: "appellation", id: d.appellation.id, title: d.appellation.name, subtitle: d.appellation.gi_type, find_url: null });
      return {
        lwin: d.lwin, name: d.name, producer: d.producer, country: d.country_name, region: d.region, sub_region: d.sub_region, site: d.site,
        colour: d.colour, style: d.sub_type, type: d.wine_type, designation: d.designation, classification: d.classification,
        vintages: d.first_vintage || d.final_vintage ? `${d.first_vintage ?? "?"}-${d.final_vintage ?? "present"}` : null,
        appellation: d.appellation, grapes: d.grapes.map((g) => g.name),
        listings: d.listings.map((l) => ({ from: l.source, vintage: l.vintage, price: l.price != null ? `${l.price} ${l.currency}` : null, grapes: l.grapes, tasting_note: l.taste_text, note_language: l.taste_lang, abv: l.alcohol })),
        source: d.source,
      };
    }
    if (name === "get_grape") {
      const d = await getGrape(db, Number(input.id));
      if (!d) { ctx.errorRef.count++; return { error: "Grape not found" }; }
      ev(ctx, { type: "grape", id: d.id, title: d.name, subtitle: d.colour, find_url: null });
      for (const a of d.appellations) ev(ctx, { type: "appellation", id: a.id, title: a.name, subtitle: a.country, find_url: null });
      for (const w of d.wines) ev(ctx, { type: "wine", id: w.lwin, title: w.name, subtitle: d.name, find_url: findUrl(w.name) });
      return {
        id: d.id, name: d.name, colour: d.colour, synonyms: d.synonyms, parents: d.parent_varieties, origin: d.countries_of_origin,
        permitted_in_appellations: d.appellation_count, appellations: d.appellations.map((a) => ({ id: a.id, name: a.name, country: a.country, role: a.kind === "oiv" ? "principal" : "secondary" })),
        wines_naming_it: d.wine_count, example_wines: d.wines, source: d.source,
      };
    }
    if (name === "get_shelf") {
      const d = await getShelf(db, String(input.slug ?? ""));
      if (!d) { ctx.errorRef.count++; return { error: "No such shelf" }; }
      for (const m of d.members) {
        if (m.entity_type === "producer" || m.entity_type === "appellation" || m.entity_type === "wine" || m.entity_type === "grape") {
          ev(ctx, { type: m.entity_type, id: m.entity_id, title: m.name, subtitle: d.name, find_url: m.entity_type === "wine" ? findUrl(m.name) : null });
        }
      }
      return {
        slug: d.slug, name: d.name, blurb: d.blurb, status: d.status,
        members: d.members.map((m) => ({ type: m.entity_type, id: m.entity_id, name: m.name, opinion: m.note, draft: m.status !== "cut" })),
        nearby: d.edges.map((e) => `${e.direction}: ${e.to_name} (${e.to_slug})${e.note ? ` - ${e.note}` : ""}`),
      };
    }
    ctx.errorRef.count++;
    return { error: `Unknown tool: ${name}` };
  } catch (err: any) {
    ctx.errorRef.count++;
    return { error: String(err?.message ?? err) };
  }
}

function progressLabel(e: ProgressEvent): string {
  if (e.type === "round") return e.round === 0 ? "Reading the question…" : "Thinking about it…";
  const input = e.input ?? {};
  switch (e.name) {
    case "search_cellar": {
      const q = String(input.q ?? "").trim();
      return q ? `Looking up “${q}” in the cellar book…` : "Leafing through the cellar book…";
    }
    case "get_appellation": return "Checking the register…";
    case "get_producer": return "Pulling the grower's file…";
    case "get_wine": return "Reading the back label…";
    case "get_grape": return "Checking the ampelography…";
    case "get_shelf": return "Looking along the shelf…";
    default: return "Down in the cellar…";
  }
}

// No links leave the shop: there are no wine pages, and an outside URL from
// the model's memory is an unverified claim dressed as a source.
const MD_LINK_RE = /\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)\s]+\)/g;
const BARE_URL_RE = /\bhttps?:\/\/\S+/g;
export function unlinkAll(answer: string): string {
  return answer.replace(MD_LINK_RE, "$1").replace(BARE_URL_RE, "").replace(/[ \t]+\n/g, "\n").trim();
}

// A bottle or producer named with no lookup this turn: a vintage year, or a
// producer honorific, in a reply that made zero tool calls.
const UNCHECKED_RE = /\b(19[5-9]\d|20[0-3]\d)\b|\b(ch[âa]teau|domaine|weingut|bodega[s]?|tenuta|quinta|cantina|azienda|grand cru|premier cru|riserva|kabinett|spätlese|spatlese)\b/i;
export function looksLikeUncheckedBottle(text: string, toolCallsThisTurn: number): boolean {
  return toolCallsThisTurn === 0 && UNCHECKED_RE.test(text);
}

/** Assembled once at boot; the shelf map is read from the DB by makeWineBore(). */
export function makeWineBore(shelfMap: string): BoreConfig<WineEvidence> {
  return {
    slug: "wine",
    name: "Wine Bore",
    systemPrompt: `${loadBorePersona("wine-bore")}\n${RULES.replace("{{SHELVES}}", shelfMap || "(no shelves cut yet - use search_cellar)")}`,
    tools: WINE_TOOLS,
    executeTool: executeWineTool,
    progressLabel,
    scrubAnswer: (answer) => unlinkAll(answer),
    looksUnchecked: looksLikeUncheckedBottle,
    backToTheRacks:
      "You named a bottle or a grower without opening the cellar book. Look each one up with search_cellar first, then get_wine or get_producer on what comes back, and write the answer from that. Same voice, same opinions. Do not mention checking, correcting, or a second attempt - the customer only sees this answer.",
    stopLooking:
      "STOP LOOKING. Write the finished answer NOW using only what you already found. " +
      "Name the bottles and growers exactly as they came back. No links. " +
      "Do not say you will check, look, or be back - there are no more lookups. " +
      "If what you found is thin, say plainly what you do have and leave it there.",
    handover: (evidence) => {
      const wines = evidence.filter((e) => e.type === "wine").slice(0, 5);
      if (wines.length > 0) {
        return ["Lost the thread on that one, but these came up on the way - tell me which direction to go:", "", ...wines.map((w) => w.title)].join("\n");
      }
      return "That one's sent me into the wrong end of the cellar - ask it a bit narrower.";
    },
    emptyAnswer: "Say that again for me. What is it you're actually after - a bottle, a place, or an argument?",
    evidenceKey: (e) => `${e.type}/${e.id}`,
    publicMaxRounds: 4,
    publicMaxTokens: 600,
    quotaKey: "ask_public_wine",
  };
}

/** "slug - name" lines for the system prompt. */
export async function loadShelfMap(db: unknown): Promise<string> {
  try {
    const shelves = await listShelves(db as any);
    return shelves.map((s) => `${s.slug} - ${s.name}${s.blurb ? ` - ${s.blurb}` : ""}`).join("\n");
  } catch {
    return "";
  }
}
