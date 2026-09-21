/**
 * Migration 035: facts read out of the rule texts (Wine Bore).
 *
 * 1. Yields. wine.appellations.max_yield_hl is the EU register figure. For a
 *    French AOC that figure is the rendement butoir (the ceiling), not the
 *    base yield a merchant quotes: La Tache is 35 hl/ha with a butoir of 49,
 *    and the register says 49. The cahier states both. base_yield_hl and
 *    butoir_yield_hl hold them when the cahier gives one pair; yield_rules
 *    holds every pair with its label when the cahier gives several (Meursault:
 *    white 57/64, red 50/58, and again for premier cru).
 *
 * 2. Permitted grapes. The register row for an Italian DOC lists every variety
 *    authorised in the province (Etna: 31 names, Glera and Chenin among them).
 *    The disciplinare names four. named_in_rules is true when the rule text
 *    names the variety, false when it does not, NULL when no rule text is
 *    attached.
 *
 * 3. Synonym use. wine.grape_names.uses counts how often the corpus spells the
 *    grape this way (register rows, wine-list rows, LWIN wine names). get_grape
 *    shows the most-used synonyms first. load-grapes.ts fills it.
 *
 * Additive only. scripts/wine/load-rule-facts.ts fills the first four columns.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE wine.appellations ADD COLUMN IF NOT EXISTS base_yield_hl NUMERIC`.execute(db);
  await sql`ALTER TABLE wine.appellations ADD COLUMN IF NOT EXISTS butoir_yield_hl NUMERIC`.execute(db);
  await sql`ALTER TABLE wine.appellations ADD COLUMN IF NOT EXISTS yield_rules JSONB`.execute(db);
  await sql`ALTER TABLE wine.appellation_grapes ADD COLUMN IF NOT EXISTS named_in_rules BOOLEAN`.execute(db);
  await sql`ALTER TABLE wine.grape_names ADD COLUMN IF NOT EXISTS uses INTEGER NOT NULL DEFAULT 0`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE wine.grape_names DROP COLUMN IF EXISTS uses`.execute(db);
  await sql`ALTER TABLE wine.appellation_grapes DROP COLUMN IF EXISTS named_in_rules`.execute(db);
  await sql`ALTER TABLE wine.appellations DROP COLUMN IF EXISTS yield_rules`.execute(db);
  await sql`ALTER TABLE wine.appellations DROP COLUMN IF EXISTS butoir_yield_hl`.execute(db);
  await sql`ALTER TABLE wine.appellations DROP COLUMN IF EXISTS base_yield_hl`.execute(db);
}
