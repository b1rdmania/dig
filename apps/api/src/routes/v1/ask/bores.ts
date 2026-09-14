// ---------------------------------------------------------------------------
// The shops. getBore(slug) hands the ask route a fully assembled BoreConfig.
// Record Bore is built at import time (its map is in the prompt text). Wine
// Bore's shelf map comes from the database, so it is assembled once on first
// use and refreshed when the pack is reloaded (see refreshWineBore).
// ---------------------------------------------------------------------------

import type { Kysely, Database } from "@dig/db";
import type { BoreConfig, BoreSlug } from "./bore.js";
import { RECORD_BORE } from "./record-bore.js";
import { makeWineBore, loadShelfMap } from "./wine-bore.js";

export type { BoreSlug } from "./bore.js";

let wineBore: BoreConfig<any> = makeWineBore("");

/** Rebuild Wine Bore's prompt with the current shelf map. Called at boot. */
export async function refreshWineBore(db: Kysely<Database>): Promise<void> {
  wineBore = makeWineBore(await loadShelfMap(db));
}

export function getBore(slug: BoreSlug): BoreConfig<any> {
  return slug === "wine" ? wineBore : (RECORD_BORE as BoreConfig<any>);
}
