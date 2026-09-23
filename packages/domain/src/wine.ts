/**
 * Wine Bore retrieval - the corpus adapter over the `wine` schema
 * (packages/db/migrations/034_wine_schema.ts).
 *
 * Six reads, no writes, no LLM: search, appellation, producer, wine, grape,
 * shelf. Every row returned carries its source so the Bore quotes the
 * register, not the pack. Queries are raw SQL through Kysely's `sql` tag;
 * the wine tables are deliberately not in the catalog Database type.
 */
import { sql, type Kysely } from "kysely";
import { buildTsquery } from "./search.js";

export type WineEntityType = "appellation" | "producer" | "wine" | "grape";

export interface WineSearchHit {
  type: WineEntityType;
  id: number;
  name: string;
  /** One line of context: country + region for a wine, country + gi type for an appellation. */
  context: string | null;
  rank: number;
}

const SEARCH_LIMIT_MAX = 12;

/**
 * The loaders' name_norm (scripts/wine/text.ts norm) - keep the two identical.
 * "Château Léoville-Las Cases" -> "chateau leoville las cases".
 */
export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[’'`´]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Diacritic-stripped 'simple' tsquery: the vectors were built with unaccent(). */
function tsq(q: string) {
  const t = buildTsquery(q.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""));
  return t ? sql`to_tsquery('simple', ${t})` : null;
}

export async function searchWine(
  db: Kysely<any>,
  params: { q: string; type?: WineEntityType; limit?: number; country?: string },
): Promise<WineSearchHit[]> {
  const limit = Math.min(Math.max(params.limit ?? 8, 1), SEARCH_LIMIT_MAX);
  const query = tsq(params.q);
  if (!query) return [];
  const want = (t: WineEntityType) => !params.type || params.type === t;
  const country = params.country ? params.country.toUpperCase().slice(0, 2) : null;
  const perType = params.type ? limit : Math.max(3, Math.ceil(limit / 2));
  const parts: Array<Promise<WineSearchHit[]>> = [];

  if (want("appellation")) {
    parts.push(sql<WineSearchHit>`
      SELECT 'appellation' AS type, id, name, country || ' · ' || gi_type AS context,
             ts_rank(search_vector, ${query}) AS rank
      FROM wine.appellations
      WHERE search_vector @@ ${query}
        ${country ? sql`AND country = ${country}` : sql``}
      ORDER BY rank DESC, name
      LIMIT ${perType}
    `.execute(db).then((r) => r.rows.length > 0 ? r.rows : appellationsNamedIn(db, params.q, country, perType)));
  }
  if (want("producer")) {
    parts.push(sql<WineSearchHit>`
      SELECT 'producer' AS type, id, display_name AS name,
             coalesce(country_name, '') || coalesce(' · ' || region, '') AS context,
             ts_rank(search_vector, ${query}) + least(wine_count, 50) / 100.0 AS rank
      FROM wine.producers
      WHERE search_vector @@ ${query}
        ${country ? sql`AND country = ${country}` : sql``}
      ORDER BY rank DESC, wine_count DESC
      LIMIT ${perType}
    `.execute(db).then((r) => r.rows));
  }
  if (want("wine")) {
    parts.push(sql<WineSearchHit>`
      SELECT 'wine' AS type, lwin AS id, display_name AS name,
             coalesce(country_name, '') || coalesce(' · ' || region, '') || coalesce(' · ' || sub_region, '') AS context,
             ts_rank(search_vector, ${query}) AS rank
      FROM wine.wines
      WHERE search_vector @@ ${query} AND status = 'Live'
        ${country ? sql`AND country = ${country}` : sql``}
      ORDER BY rank DESC, display_name
      LIMIT ${perType}
    `.execute(db).then((r) => r.rows));
  }
  if (want("grape")) {
    parts.push(sql<WineSearchHit>`
      SELECT 'grape' AS type, id, name, coalesce(colour, '') AS context,
             ts_rank(search_vector, ${query}) AS rank
      FROM wine.grapes
      WHERE search_vector @@ ${query}
      ORDER BY rank DESC, name
      LIMIT ${perType}
    `.execute(db).then((r) => r.rows));
  }

  const hits = (await Promise.all(parts)).flat();

  // Thin FTS result: fall back to trigram similarity on the normalised name
  // so a misspelt appellation ("Chabli", "Sancere") or a producer typed from
  // memory still lands. Wines are excluded - 190k rows and no trgm index.
  if (hits.length < 3) {
    const qn = normName(params.q);
    if (qn.length >= 3) {
      const fuzzy: Array<Promise<WineSearchHit[]>> = [];
      if (want("appellation")) {
        fuzzy.push(sql<WineSearchHit>`
          SELECT 'appellation' AS type, a.id, a.name, a.country || ' · ' || a.gi_type AS context, max(similarity(n.name_norm, ${qn})) AS rank
          FROM wine.appellation_names n JOIN wine.appellations a ON a.id = n.appellation_id
          WHERE similarity(n.name_norm, ${qn}) > 0.45 ${country ? sql`AND a.country = ${country}` : sql``}
          GROUP BY a.id, a.name, a.country, a.gi_type ORDER BY rank DESC LIMIT ${perType}
        `.execute(db).then((r) => r.rows));
      }
      if (want("producer")) {
        fuzzy.push(sql<WineSearchHit>`
          SELECT 'producer' AS type, id, display_name AS name, coalesce(country_name, '') || coalesce(' · ' || region, '') AS context,
                 similarity(name_norm, ${qn}) AS rank
          FROM wine.producers WHERE name_norm % ${qn} ${country ? sql`AND country = ${country}` : sql``}
          ORDER BY rank DESC, wine_count DESC LIMIT ${perType}
        `.execute(db).then((r) => r.rows));
      }
      if (want("grape")) {
        fuzzy.push(sql<WineSearchHit>`
          SELECT 'grape' AS type, g.id, g.name, coalesce(g.colour, '') AS context, max(similarity(n.name_norm, ${qn})) AS rank
          FROM wine.grape_names n JOIN wine.grapes g ON g.id = n.grape_id
          WHERE similarity(n.name_norm, ${qn}) > 0.5
          GROUP BY g.id, g.name, g.colour ORDER BY rank DESC LIMIT ${perType}
        `.execute(db).then((r) => r.rows));
      }
      const extra = (await Promise.all(fuzzy)).flat();
      const seen = new Set(hits.map((h) => `${h.type}/${h.id}`));
      for (const h of extra) if (!seen.has(`${h.type}/${h.id}`)) hits.push(h);
    }
  }

  // Exact name hits float above partial ones regardless of type.
  const qn = params.q.trim().toLowerCase();
  hits.sort((a, b) => Number(b.name.toLowerCase() === qn) - Number(a.name.toLowerCase() === qn) || b.rank - a.rank);
  return hits.slice(0, limit).map((h) => ({ ...h, id: Number(h.id), rank: Number(h.rank) }));
}

/**
 * Fallback when no appellation has every term of the query: "Marlborough
 * Sauvignon Blanc" names a place and a grape, so the AND query finds no
 * appellation. Return the appellations whose name (any register spelling)
 * appears whole in the query, longest first - "Chablis Grand Cru" before
 * "Chablis". Rank is the share of the query the name covers.
 */
export async function appellationsNamedIn(
  db: Kysely<any>,
  q: string,
  country: string | null,
  limit: number,
): Promise<WineSearchHit[]> {
  const qn = normName(q);
  if (qn.length < 3) return [];
  const r = await sql<WineSearchHit>`
    SELECT 'appellation' AS type, a.id, a.name, a.country || ' · ' || a.gi_type AS context,
           max(length(n.name_norm))::float / ${qn.length} AS rank
    FROM wine.appellation_names n JOIN wine.appellations a ON a.id = n.appellation_id
    WHERE length(n.name_norm) >= 3
      AND position(' ' || n.name_norm || ' ' IN ${` ${qn} `}) > 0
      ${country ? sql`AND a.country = ${country}` : sql``}
    GROUP BY a.id, a.name, a.country, a.gi_type
    ORDER BY rank DESC, a.name
    LIMIT ${limit}
  `.execute(db);
  return r.rows;
}

export interface AppellationTaste {
  id: number;
  /** The style as the rule text labels it ("Etna rosso riserva", "vins blancs", "VINO TINTO RESERVA"); null when the text does not split. */
  style: string | null;
  colour: "red" | "white" | "rose" | "sparkling" | "sweet" | "fortified" | null;
  language: string;
  clause_text: string;
  min_alcohol: number | null;
  sweetness: string | null;
  document: { id: number | null; doc_type: string | null; title: string | null; source: string; source_ref: string };
}

export interface AppellationDetail {
  id: number;
  name: string;
  country: string;
  gi_type: string;
  eu_file_number: string | null;
  protection_date: string | null;
  status: string | null;
  legal_instrument: string | null;
  register_url: string | null;
  categories: string[];
  max_yield_hl: number | null;
  max_yield_kg: number | null;
  min_planting_density: number | null;
  municipalities_count: number;
  other_names: string[];
  /** named_in_rules: true = the attached rule text names the variety; false = on the register's list only; null = no rule text attached. Named first. */
  grapes: Array<{ name: string; colour_code: string | null; kind: string; categories: string[]; grape_id: number | null; named_in_rules: boolean | null }>;
  /** From the French cahier. null when the cahier gives several pairs (see yield_rules) or did not parse. */
  base_yield_hl: number | null;
  butoir_yield_hl: number | null;
  yield_rules: Array<{ label: string | null; base_hl: number; butoir_hl: number }> | null;
  documents: Array<{ id: number; doc_type: string; title: string; url: string | null; excerpt: string | null }>;
  /** What the rule text says the wine must look, smell and taste like, verbatim in its own language, per style (migration 036). Empty when no clause parsed. */
  taste: AppellationTaste[];
  wine_count: number;
  producers: Array<{ id: number; name: string; wine_count: number }>;
  source: string;
  source_ref: string;
}

export async function getAppellation(db: Kysely<any>, id: number, q?: string): Promise<AppellationDetail | null> {
  const row = (await sql<any>`
    SELECT id, name, country, gi_type, eu_file_number, protection_date::text, status, legal_instrument,
           register_url, categories, max_yield_hl, max_yield_kg, min_planting_density,
           base_yield_hl, butoir_yield_hl, yield_rules,
           coalesce(array_length(municipalities, 1), 0) AS municipalities_count, source, source_ref
    FROM wine.appellations WHERE id = ${id}
  `.execute(db)).rows[0];
  if (!row) return null;

  const [names, grapes, docs, wines, producers, taste] = await Promise.all([
    sql<{ name: string }>`
      SELECT DISTINCT name FROM wine.appellation_names WHERE appellation_id = ${id} AND kind IN ('protected','transcription') AND name <> ${row.name}
      ORDER BY name LIMIT 12
    `.execute(db).then((r) => r.rows.map((x) => x.name)),
    sql<any>`
      SELECT grape_name_raw AS name, colour_code, kind, array_agg(DISTINCT coalesce(category, '')) AS categories, min(grape_id) AS grape_id,
             bool_or(named_in_rules) AS named_in_rules
      FROM wine.appellation_grapes WHERE appellation_id = ${id}
      GROUP BY 1, 2, 3 ORDER BY bool_or(named_in_rules) DESC NULLS LAST, kind, name
    `.execute(db).then((r) => r.rows),
    (async () => {
      const query = q ? tsq(q) : null;
      const r = await sql<any>`
        SELECT id, doc_type, title, url,
               ${query
                 ? sql`ts_headline('simple', unaccent(left(text, 200000)), ${query}, 'MaxFragments=3, MaxWords=60, MinWords=25, FragmentDelimiter=" … "')`
                 : sql`NULL`} AS excerpt
        FROM wine.appellation_documents WHERE appellation_id = ${id}
        ORDER BY doc_type, title LIMIT 3
      `.execute(db);
      return r.rows;
    })(),
    sql<{ n: string }>`SELECT count(*)::text AS n FROM wine.wines WHERE appellation_id = ${id} AND status = 'Live'`.execute(db).then((r) => Number(r.rows[0]?.n ?? 0)),
    sql<any>`
      SELECT p.id, p.display_name AS name, count(*)::int AS wine_count
      FROM wine.wines w JOIN wine.producers p ON p.id = w.producer_id
      WHERE w.appellation_id = ${id} AND w.status = 'Live'
      GROUP BY p.id, p.display_name ORDER BY wine_count DESC, p.display_name LIMIT 8
    `.execute(db).then((r) => r.rows),
    // Base styles (a colour, no mention) first, then riserva / superiore / crianza, then the rest; the loader's order inside each group.
    sql<any>`
      SELECT t.id, t.style, t.colour, t.language, t.clause_text, t.min_alcohol, t.sweetness,
             t.doc_source, t.doc_source_ref, d.id AS document_id, d.doc_type, d.title AS document_title
      FROM wine.appellation_taste t LEFT JOIN wine.appellation_documents d ON d.id = t.source_document_id
      WHERE t.appellation_id = ${id}
      ORDER BY (t.style ~* '(riserva|superiore|reserva|crianza|premier cru|grand cru|vigna|passito|vendemmia tardiva|novello|frizzante|spumante|liquoroso)') , t.id
      LIMIT 12
    `.execute(db).then((r) => r.rows.map((t: any): AppellationTaste => ({
      id: t.id, style: t.style, colour: t.colour, language: t.language, clause_text: t.clause_text,
      min_alcohol: t.min_alcohol == null ? null : Number(t.min_alcohol), sweetness: t.sweetness,
      document: { id: t.document_id ?? null, doc_type: t.doc_type ?? null, title: t.document_title ?? null, source: t.doc_source, source_ref: t.doc_source_ref },
    }))),
  ]);

  return {
    ...row,
    max_yield_hl: row.max_yield_hl == null ? null : Number(row.max_yield_hl),
    max_yield_kg: row.max_yield_kg == null ? null : Number(row.max_yield_kg),
    base_yield_hl: row.base_yield_hl == null ? null : Number(row.base_yield_hl),
    butoir_yield_hl: row.butoir_yield_hl == null ? null : Number(row.butoir_yield_hl),
    yield_rules: row.yield_rules ?? null,
    min_planting_density: row.min_planting_density == null ? null : Number(row.min_planting_density),
    municipalities_count: Number(row.municipalities_count),
    other_names: names,
    grapes: grapes.map((g: any) => ({ ...g, categories: (g.categories as string[]).filter(Boolean) })),
    documents: docs,
    taste,
    wine_count: wines,
    producers,
  };
}

export interface ProducerDetail {
  id: number;
  name: string;
  country: string | null;
  country_name: string | null;
  region: string | null;
  website: string | null;
  founded_year: number | null;
  uk_importer: string | null;
  wikidata_qid: string | null;
  wine_count: number;
  links: Array<{ kind: string; source: string; name_as_found: string; url: string | null }>;
  wines: Array<{ lwin: number; name: string; colour: string | null; appellation: string | null; classification: string | null; first_vintage: number | null }>;
  listing_count: number;
  source: string;
  source_ref: string;
}

export async function getProducer(db: Kysely<any>, id: number): Promise<ProducerDetail | null> {
  const row = (await sql<any>`
    SELECT id, display_name AS name, country, country_name, region, website, founded_year, uk_importer, wikidata_qid, wine_count, source, source_ref
    FROM wine.producers WHERE id = ${id}
  `.execute(db)).rows[0];
  if (!row) return null;
  const [links, wines, listings] = await Promise.all([
    sql<any>`SELECT kind, source, name_as_found, url FROM wine.producer_links WHERE producer_id = ${id} ORDER BY kind, source LIMIT 12`.execute(db).then((r) => r.rows),
    sql<any>`
      SELECT w.lwin, w.display_name AS name, w.colour, a.name AS appellation, w.classification, w.first_vintage
      FROM wine.wines w LEFT JOIN wine.appellations a ON a.id = w.appellation_id
      WHERE w.producer_id = ${id} AND w.status = 'Live'
      ORDER BY (w.classification IS NOT NULL) DESC, w.display_name LIMIT 25
    `.execute(db).then((r) => r.rows.map((w: any) => ({ ...w, lwin: Number(w.lwin) }))),
    sql<{ n: string }>`SELECT count(*)::text AS n FROM wine.listings WHERE producer_id = ${id}`.execute(db).then((r) => Number(r.rows[0]?.n ?? 0)),
  ]);
  return { ...row, links, wines, listing_count: listings };
}

export interface WineDetail {
  lwin: number;
  name: string;
  wine_name: string | null;
  producer: { id: number; name: string } | null;
  country: string | null;
  country_name: string | null;
  region: string | null;
  sub_region: string | null;
  site: string | null;
  colour: string | null;
  sub_type: string | null;
  wine_type: string;
  designation: string | null;
  classification: string | null;
  first_vintage: number | null;
  final_vintage: number | null;
  appellation: { id: number; name: string; gi_type: string } | null;
  grapes: Array<{ name: string; source: string }>;
  listings: Array<{ source: string; vintage: number | null; price: number | null; currency: string | null; grapes: string[]; taste_text: string | null; taste_lang: string | null; alcohol: number | null }>;
  find_url: string;
  source: string;
}

export function findUrl(name: string, vintage?: number | null): string {
  const slug = `${name}${vintage ? ` ${vintage}` : ""}`
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "+").replace(/^\+|\+$/g, "");
  return `https://www.wine-searcher.com/find/${slug}`;
}

export async function getWine(db: Kysely<any>, lwin: number): Promise<WineDetail | null> {
  const row = (await sql<any>`
    SELECT w.lwin, w.display_name AS name, w.wine_name, w.country, w.country_name, w.region, w.sub_region, w.site,
           w.colour, w.sub_type, w.wine_type, w.designation, w.classification, w.first_vintage, w.final_vintage, w.source,
           p.id AS producer_id, p.display_name AS producer_name,
           a.id AS appellation_id, a.name AS appellation_name, a.gi_type AS appellation_type
    FROM wine.wines w
    LEFT JOIN wine.producers p ON p.id = w.producer_id
    LEFT JOIN wine.appellations a ON a.id = w.appellation_id
    WHERE w.lwin = ${lwin}
  `.execute(db)).rows[0];
  if (!row) return null;
  const [grapes, listings] = await Promise.all([
    sql<any>`
      SELECT coalesce(g.name, wg.grape_name_raw) AS name, wg.source
      FROM wine.wine_grapes wg LEFT JOIN wine.grapes g ON g.id = wg.grape_id WHERE wg.lwin = ${lwin}
      ORDER BY 1
    `.execute(db).then((r) => r.rows),
    sql<any>`
      SELECT source, vintage, price, currency, grapes, taste_text, taste_lang, alcohol
      FROM wine.listings WHERE lwin = ${lwin} ORDER BY vintage DESC NULLS LAST LIMIT 6
    `.execute(db).then((r) => r.rows.map((l: any) => ({ ...l, price: l.price == null ? null : Number(l.price), alcohol: l.alcohol == null ? null : Number(l.alcohol) }))),
  ]);
  return {
    lwin: Number(row.lwin),
    name: row.name,
    wine_name: row.wine_name,
    producer: row.producer_id ? { id: row.producer_id, name: row.producer_name } : null,
    country: row.country,
    country_name: row.country_name,
    region: row.region,
    sub_region: row.sub_region,
    site: row.site,
    colour: row.colour,
    sub_type: row.sub_type,
    wine_type: row.wine_type,
    designation: row.designation,
    classification: row.classification,
    first_vintage: row.first_vintage,
    final_vintage: row.final_vintage,
    appellation: row.appellation_id ? { id: row.appellation_id, name: row.appellation_name, gi_type: row.appellation_type } : null,
    grapes,
    listings,
    find_url: findUrl(row.name, listings[0]?.vintage ?? null),
    source: row.source,
  };
}

export interface GrapeDetail {
  id: number;
  name: string;
  colour: string | null;
  synonyms: string[];
  parent_varieties: string[];
  countries_of_origin: string[];
  wikidata_qid: string | null;
  appellation_count: number;
  appellations: Array<{ id: number; name: string; country: string; kind: string }>;
  wine_count: number;
  wines: Array<{ lwin: number; name: string }>;
  source: string;
}

export async function getGrape(db: Kysely<any>, id: number): Promise<GrapeDetail | null> {
  const row = (await sql<any>`
    SELECT id, name, colour, parent_varieties, countries_of_origin, wikidata_qid, source FROM wine.grapes WHERE id = ${id}
  `.execute(db)).rows[0];
  if (!row) return null;
  const [syn, appCount, apps, wineCount, wines] = await Promise.all([
    // Most-used first (grape_names.uses: register rows, wine-list rows and LWIN wine names that spell
    // the grape this way). Alphabetical order buried Spatburgunder under Affenthaler once VIVC's 447 Pinot noir names loaded.
    sql<{ name: string }>`SELECT name FROM wine.grape_names WHERE grape_id = ${id} AND kind <> 'primary' AND name <> ${row.name} ORDER BY uses DESC, (source = 'vivc'), (kind <> 'translation'), name LIMIT 15`.execute(db).then((r) => r.rows.map((x) => x.name)),
    sql<{ n: string }>`SELECT count(DISTINCT appellation_id)::text AS n FROM wine.appellation_grapes WHERE grape_id = ${id}`.execute(db).then((r) => Number(r.rows[0]?.n ?? 0)),
    sql<any>`
      SELECT DISTINCT a.id, a.name, a.country, min(ag.kind) AS kind
      FROM wine.appellation_grapes ag JOIN wine.appellations a ON a.id = ag.appellation_id
      WHERE ag.grape_id = ${id}
      GROUP BY a.id, a.name, a.country ORDER BY kind, a.country, a.name LIMIT 14
    `.execute(db).then((r) => r.rows),
    sql<{ n: string }>`SELECT count(DISTINCT lwin)::text AS n FROM wine.wine_grapes WHERE grape_id = ${id}`.execute(db).then((r) => Number(r.rows[0]?.n ?? 0)),
    sql<any>`
      SELECT w.lwin, w.display_name AS name FROM wine.wine_grapes wg JOIN wine.wines w ON w.lwin = wg.lwin
      WHERE wg.grape_id = ${id} AND w.status = 'Live' ORDER BY w.display_name LIMIT 10
    `.execute(db).then((r) => r.rows.map((w: any) => ({ ...w, lwin: Number(w.lwin) }))),
  ]);
  return { ...row, synonyms: syn, appellation_count: appCount, appellations: apps, wine_count: wineCount, wines };
}

export interface ShelfDetail {
  slug: string;
  name: string;
  blurb: string | null;
  status: string;
  members: Array<{ entity_type: WineEntityType; entity_id: number; name: string; rank: number; note: string | null; status: string }>;
  edges: Array<{ direction: string; to_slug: string; to_name: string; note: string | null }>;
}

export async function listShelves(db: Kysely<any>): Promise<Array<{ slug: string; name: string; blurb: string | null; status: string }>> {
  return (await sql<any>`SELECT slug, name, blurb, status FROM wine.shelves ORDER BY rank, name`.execute(db)).rows;
}

export async function getShelf(db: Kysely<any>, slug: string): Promise<ShelfDetail | null> {
  const row = (await sql<any>`SELECT slug, name, blurb, status FROM wine.shelves WHERE slug = ${slug}`.execute(db)).rows[0];
  if (!row) return null;
  const [members, edges] = await Promise.all([
    sql<any>`
      SELECT m.entity_type, m.entity_id, m.rank, m.note, m.status,
             CASE m.entity_type
               WHEN 'producer' THEN (SELECT display_name FROM wine.producers WHERE id = m.entity_id)
               WHEN 'appellation' THEN (SELECT name FROM wine.appellations WHERE id = m.entity_id)
               WHEN 'wine' THEN (SELECT display_name FROM wine.wines WHERE lwin = m.entity_id)
               WHEN 'grape' THEN (SELECT name FROM wine.grapes WHERE id = m.entity_id)
             END AS name
      FROM wine.shelf_members m WHERE m.shelf_slug = ${slug} ORDER BY m.rank, m.entity_type
    `.execute(db).then((r) => r.rows.map((m: any) => ({ ...m, entity_id: Number(m.entity_id) }))),
    sql<any>`
      SELECT e.direction, e.to_slug, s.name AS to_name, e.note
      FROM wine.shelf_edges e JOIN wine.shelves s ON s.slug = e.to_slug WHERE e.from_slug = ${slug} ORDER BY e.direction
    `.execute(db).then((r) => r.rows),
  ]);
  return { ...row, members, edges };
}

/** Something real to open on: a shelf member when the pack exists, else a Live wine with an appellation. */
export async function randomOpenerSubject(db: Kysely<any>): Promise<{ kind: "wine" | "producer" | "appellation"; name: string; context: string | null } | null> {
  const fromShelf = (await sql<any>`
    SELECT m.entity_type, m.entity_id, s.name AS shelf FROM wine.shelf_members m JOIN wine.shelves s ON s.slug = m.shelf_slug
    WHERE m.entity_type IN ('producer','appellation','wine') ORDER BY random() LIMIT 1
  `.execute(db)).rows[0];
  if (fromShelf) {
    const id = Number(fromShelf.entity_id);
    if (fromShelf.entity_type === "producer") {
      const p = (await sql<any>`SELECT display_name AS name, region FROM wine.producers WHERE id = ${id}`.execute(db)).rows[0];
      if (p) return { kind: "producer", name: p.name, context: p.region ?? fromShelf.shelf };
    } else if (fromShelf.entity_type === "appellation") {
      const a = (await sql<any>`SELECT name, country FROM wine.appellations WHERE id = ${id}`.execute(db)).rows[0];
      if (a) return { kind: "appellation", name: a.name, context: a.country };
    } else {
      const w = (await sql<any>`SELECT display_name AS name, sub_region, region FROM wine.wines WHERE lwin = ${id}`.execute(db)).rows[0];
      if (w) return { kind: "wine", name: w.name, context: w.sub_region ?? w.region };
    }
  }
  const w = (await sql<any>`
    SELECT w.display_name AS name, a.name AS appellation FROM wine.wines w JOIN wine.appellations a ON a.id = w.appellation_id
    WHERE w.status = 'Live' AND w.classification IS NOT NULL
    OFFSET floor(random() * greatest((SELECT count(*) FROM wine.wines WHERE status = 'Live' AND classification IS NOT NULL AND appellation_id IS NOT NULL), 1)) LIMIT 1
  `.execute(db)).rows[0];
  return w ? { kind: "wine", name: w.name, context: w.appellation } : null;
}
