/**
 * Migration 034: the `wine` schema - Wine Bore's corpus.
 *
 * Bore #3 sits on open wine data (LWIN spine, EU appellation register,
 * national cahiers des charges, Wikidata grapes, one monopoly catalogue as
 * demo-only listings). Nothing here touches catalog/enrich; it is a separate
 * schema in the same database so the ask loop can serve two bores from one
 * connection.
 *
 * Every row carries `source` (a slug in wine.sources) and `source_ref` (the
 * publisher's own identifier) so the Bore can quote the register, not the
 * pack, when the two disagree. Unmatched rows are kept, never dropped: the
 * join rate is reported, not hidden.
 *
 * Loaders: scripts/wine/*.ts. Design: docs/wine-bore-build.md.
 * Down: drops the schema.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS wine`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS wine.sources (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      licence TEXT,
      pulled_at DATE,
      demo_only BOOLEAN NOT NULL DEFAULT false,
      notes TEXT
    )
  `.execute(db);

  // Appellations: one row per protected name (EU register), plus non-EU
  // designations that LWIN uses (AVA, GI, WO...) added by the resolver with
  // source='lwin' so every wine can point somewhere.
  await sql`
    CREATE TABLE IF NOT EXISTS wine.appellations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      name_norm TEXT NOT NULL,
      country TEXT NOT NULL,                 -- ISO-3166 alpha-2
      gi_type TEXT NOT NULL,                 -- PDO | PGI | AVA | GI | WO | other
      eu_gi_id TEXT,                         -- EUGI00000000021
      eu_file_number TEXT,                   -- PDO-FR-A0994 (joins the Sci Data PDO set)
      protection_date DATE,
      status TEXT,
      legal_instrument TEXT,
      register_url TEXT,
      parent_id INTEGER REFERENCES wine.appellations(id),
      categories TEXT[] NOT NULL DEFAULT '{}',   -- wine product categories from the register
      max_yield_hl NUMERIC,
      max_yield_kg NUMERIC,
      min_planting_density NUMERIC,
      irrigation TEXT,
      municipalities TEXT[] NOT NULL DEFAULT '{}',
      source TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      search_vector TSVECTOR,
      UNIQUE (source, source_ref)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_appellations_norm_idx ON wine.appellations (name_norm)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_appellations_country_idx ON wine.appellations (country)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_appellations_sv_idx ON wine.appellations USING GIN (search_vector)`.execute(db);

  // Every name an appellation is known by: the protected names in each
  // language, transcriptions, and the strings LWIN uses for it.
  await sql`
    CREATE TABLE IF NOT EXISTS wine.appellation_names (
      appellation_id INTEGER NOT NULL REFERENCES wine.appellations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      name_norm TEXT NOT NULL,
      kind TEXT NOT NULL,                    -- protected | transcription | lwin | alias
      source TEXT NOT NULL,
      PRIMARY KEY (appellation_id, name_norm, kind)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_appellation_names_norm_idx ON wine.appellation_names (name_norm)`.execute(db);

  // The rules, as text: cahiers des charges (FR), disciplinari (IT), pliegos
  // (ES). One row per document; full text so the Bore can quote a clause.
  await sql`
    CREATE TABLE IF NOT EXISTS wine.appellation_documents (
      id SERIAL PRIMARY KEY,
      appellation_id INTEGER REFERENCES wine.appellations(id) ON DELETE SET NULL,
      country TEXT NOT NULL,
      doc_type TEXT NOT NULL,                -- cahier | disciplinare | pliego | catalogoviti
      title TEXT NOT NULL,
      name_norm TEXT NOT NULL,               -- the appellation name the file was pulled for
      url TEXT,
      sha256 TEXT,
      text TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      search_vector TSVECTOR,
      UNIQUE (source, source_ref)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_appellation_documents_app_idx ON wine.appellation_documents (appellation_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_appellation_documents_sv_idx ON wine.appellation_documents USING GIN (search_vector)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS wine.grapes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      name_norm TEXT NOT NULL,
      colour TEXT,                           -- red | white | rose | unknown
      wikidata_qid TEXT UNIQUE,
      vivc_ids TEXT[] NOT NULL DEFAULT '{}',
      parent_varieties TEXT[] NOT NULL DEFAULT '{}',
      countries_of_origin TEXT[] NOT NULL DEFAULT '{}',
      source TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      search_vector TSVECTOR,
      UNIQUE (source, source_ref)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_grapes_norm_idx ON wine.grapes (name_norm)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_grapes_sv_idx ON wine.grapes USING GIN (search_vector)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS wine.grape_names (
      grape_id INTEGER NOT NULL REFERENCES wine.grapes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      name_norm TEXT NOT NULL,
      kind TEXT NOT NULL,                    -- primary | synonym | translation
      lang TEXT,
      source TEXT NOT NULL,
      PRIMARY KEY (grape_id, name_norm)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_grape_names_norm_idx ON wine.grape_names (name_norm)`.execute(db);

  // Permitted grapes per appellation, from the register. grape_id is NULL
  // when the register's spelling did not resolve to a wine.grapes row; the
  // raw name is kept so the Bore can still answer.
  await sql`
    CREATE TABLE IF NOT EXISTS wine.appellation_grapes (
      appellation_id INTEGER NOT NULL REFERENCES wine.appellations(id) ON DELETE CASCADE,
      grape_name_raw TEXT NOT NULL,
      grape_id INTEGER REFERENCES wine.grapes(id),
      colour_code TEXT,                      -- N | B | Rs | Rg | G (register codes)
      kind TEXT NOT NULL,                    -- oiv | other
      category TEXT,                         -- wine product category the rule applies to
      source TEXT NOT NULL,
      PRIMARY KEY (appellation_id, grape_name_raw, kind, category)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_appellation_grapes_grape_idx ON wine.appellation_grapes (grape_id)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS wine.producers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,                    -- "Acappella"
      title TEXT,                            -- "Chateau" / "Domaine" (LWIN PRODUCER_TITLE)
      display_name TEXT NOT NULL,            -- "Chateau Acappella"
      name_norm TEXT NOT NULL,
      country TEXT,                          -- ISO-3166 alpha-2 where known
      country_name TEXT,                     -- as the source spelled it
      region TEXT,
      wikidata_qid TEXT,
      website TEXT,
      founded_year INTEGER,
      uk_importer TEXT,
      wine_count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      search_vector TSVECTOR,
      UNIQUE (source, source_ref)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_producers_norm_idx ON wine.producers (name_norm)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_producers_country_idx ON wine.producers (country)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_producers_sv_idx ON wine.producers USING GIN (search_vector)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_producers_trgm_idx ON wine.producers USING GIN (name_norm gin_trgm_ops)`.execute(db);

  // Where else a producer shows up: Wikidata, a consorzio directory, an Exa
  // enrichment row, a Systembolaget supplier name. match_method says how the
  // join was made so a bad one can be traced.
  await sql`
    CREATE TABLE IF NOT EXISTS wine.producer_links (
      producer_id INTEGER NOT NULL REFERENCES wine.producers(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      name_as_found TEXT NOT NULL,
      url TEXT,
      kind TEXT NOT NULL,                    -- wikidata | directory | website | importer | monopoly
      match_method TEXT NOT NULL,            -- exact | norm | trgm | manual
      match_score NUMERIC,
      PRIMARY KEY (source, source_ref)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_producer_links_producer_idx ON wine.producer_links (producer_id)`.execute(db);

  // Wines: LWIN-7 is the primary key. One row per producer + named wine.
  await sql`
    CREATE TABLE IF NOT EXISTS wine.wines (
      lwin BIGINT PRIMARY KEY,
      display_name TEXT NOT NULL,
      producer_id INTEGER REFERENCES wine.producers(id),
      wine_name TEXT,                        -- LWIN WINE column, NULL when NA
      country TEXT,
      country_name TEXT,
      region TEXT,
      sub_region TEXT,
      site TEXT,
      parcel TEXT,
      colour TEXT,
      sub_type TEXT,                         -- Still | Sparkling
      wine_type TEXT NOT NULL,               -- Wine | Fortified Wine
      designation TEXT,                      -- AOP | DOC | AVA ...
      classification TEXT,                   -- Grand Cru, Premier Cru ...
      vintage_config TEXT,
      first_vintage INTEGER,
      final_vintage INTEGER,
      status TEXT NOT NULL,                  -- Live | Combined | Deleted
      appellation_id INTEGER REFERENCES wine.appellations(id),
      appellation_match TEXT,                -- sub_region | region | site | none
      source TEXT NOT NULL DEFAULT 'lwin',
      search_vector TSVECTOR
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_wines_producer_idx ON wine.wines (producer_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_wines_appellation_idx ON wine.wines (appellation_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_wines_region_idx ON wine.wines (country, region, sub_region)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_wines_sv_idx ON wine.wines USING GIN (search_vector)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS wine.wine_names (
      lwin BIGINT NOT NULL REFERENCES wine.wines(lwin) ON DELETE CASCADE,
      name TEXT NOT NULL,
      name_norm TEXT NOT NULL,
      kind TEXT NOT NULL,                    -- wikidata | label | alias
      source TEXT NOT NULL,
      PRIMARY KEY (lwin, name_norm)
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS wine.wine_grapes (
      lwin BIGINT NOT NULL REFERENCES wine.wines(lwin) ON DELETE CASCADE,
      grape_id INTEGER REFERENCES wine.grapes(id),
      grape_name_raw TEXT NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY (lwin, grape_name_raw, source)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_wine_grapes_grape_idx ON wine.wine_grapes (grape_id)`.execute(db);

  // Listings: a catalogue row that names a wine, a vintage, a price and
  // sometimes a tasting text. Demo-only sources are flagged in wine.sources.
  await sql`
    CREATE TABLE IF NOT EXISTS wine.listings (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      lwin BIGINT REFERENCES wine.wines(lwin),
      producer_id INTEGER REFERENCES wine.producers(id),
      producer_name TEXT,
      wine_name TEXT NOT NULL,
      country TEXT,
      country_name TEXT,
      region_l1 TEXT,
      region_l2 TEXT,
      vintage INTEGER,
      colour TEXT,
      category TEXT,
      grapes TEXT[] NOT NULL DEFAULT '{}',
      alcohol NUMERIC,
      price NUMERIC,
      currency TEXT,
      volume_ml INTEGER,
      taste_text TEXT,
      taste_lang TEXT,
      serve_text TEXT,
      match_method TEXT,                     -- exact | norm | trgm | none
      match_score NUMERIC,
      search_vector TSVECTOR,
      UNIQUE (source, source_ref)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_listings_lwin_idx ON wine.listings (lwin)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_listings_sv_idx ON wine.listings USING GIN (search_vector)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS wine_listings_producer_idx ON wine.listings (producer_id)`.execute(db);

  // Curation pack: shelves are the wine equivalent of Dig's scenes. Loaded
  // from bores/wine-bore/pack/shelves.json. Everything is draft until Andy cuts it.
  await sql`
    CREATE TABLE IF NOT EXISTS wine.shelves (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      blurb TEXT,
      status TEXT NOT NULL DEFAULT 'draft',  -- draft | cut
      rank INTEGER NOT NULL DEFAULT 0
    )
  `.execute(db);
  await sql`
    CREATE TABLE IF NOT EXISTS wine.shelf_members (
      shelf_slug TEXT NOT NULL REFERENCES wine.shelves(slug) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,             -- producer | appellation | wine | grape
      entity_id BIGINT NOT NULL,
      rank INTEGER NOT NULL DEFAULT 0,
      note TEXT,                             -- the shop's one-line opinion
      status TEXT NOT NULL DEFAULT 'draft',
      PRIMARY KEY (shelf_slug, entity_type, entity_id)
    )
  `.execute(db);
  await sql`
    CREATE TABLE IF NOT EXISTS wine.shelf_edges (
      from_slug TEXT NOT NULL REFERENCES wine.shelves(slug) ON DELETE CASCADE,
      to_slug TEXT NOT NULL REFERENCES wine.shelves(slug) ON DELETE CASCADE,
      direction TEXT NOT NULL,               -- deeper | cleaner | wilder | earlier | cheaper | grander
      note TEXT,
      PRIMARY KEY (from_slug, to_slug, direction)
    )
  `.execute(db);

  // Join report rows: one per loader run, so the rates are queryable.
  await sql`
    CREATE TABLE IF NOT EXISTS wine.load_log (
      id SERIAL PRIMARY KEY,
      loader TEXT NOT NULL,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      rows_in INTEGER,
      rows_out INTEGER,
      matched INTEGER,
      unmatched INTEGER,
      notes JSONB
    )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS wine CASCADE`.execute(db);
}
