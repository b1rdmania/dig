/**
 * Migration 036: what the rules say a wine must look, smell and taste like
 * (Wine Bore).
 *
 * wine.appellation_documents holds the full text of 1,080 cahiers des charges,
 * disciplinari and pliegos. Most carry an organoleptic clause: the French
 * "Informations sur la qualité et les caractéristiques du produit", the Italian
 * "Caratteristiche al consumo" (colore / odore / sapore per tipologia), the
 * Spanish "Características organolépticas" (vista / olfato / boca per type).
 * scripts/wine/taste-rules.ts reads them out; scripts/wine/load-appellation-taste.ts
 * stores one row per appellation, document and style, verbatim in the original
 * language, with the document it came from so the Bore can cite it. Nothing is
 * translated: the Bore's model reads the original at answer time.
 *
 * Rows are keyed on (appellation_id, doc_source, doc_source_ref, style_key), so
 * a reload upserts and ids hold. source_document_id is re-linked on each run:
 * load-appellation-documents deletes and re-inserts documents, so the FK is
 * ON DELETE SET NULL and the natural key (doc_source, doc_source_ref) is the
 * stable reference.
 *
 * Additive only.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS wine.appellation_taste (
      id                  SERIAL PRIMARY KEY,
      appellation_id      INTEGER NOT NULL REFERENCES wine.appellations(id) ON DELETE CASCADE,
      doc_source          TEXT NOT NULL,
      doc_source_ref      TEXT NOT NULL,
      source_document_id  INTEGER REFERENCES wine.appellation_documents(id) ON DELETE SET NULL,
      style               TEXT,
      style_key           TEXT NOT NULL,
      colour              TEXT CHECK (colour IN ('red','white','rose','sparkling','sweet','fortified')),
      language            TEXT NOT NULL CHECK (language IN ('fr','it','es','de','pt')),
      clause_text         TEXT NOT NULL,
      min_alcohol         NUMERIC,
      sweetness           TEXT,
      provenance          JSONB NOT NULL DEFAULT '{}'::jsonb,
      loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (appellation_id, doc_source, doc_source_ref, style_key)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS appellation_taste_appellation_idx ON wine.appellation_taste (appellation_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS appellation_taste_document_idx ON wine.appellation_taste (source_document_id)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS wine.appellation_taste`.execute(db);
}
