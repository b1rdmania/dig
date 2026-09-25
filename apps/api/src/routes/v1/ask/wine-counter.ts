// ---------------------------------------------------------------------------
// Dressing the counter. Wine Bore answers carry no links (the answer names
// bottles, the page shows them under it), so the counter is where a customer
// acts: the producer's own site, a photo of the house, a map of where the
// appellation is, and the search handoff to buy. Runs once per answer, after
// the model has finished, on the evidence the response actually carries.
//
// Pictures and maps come from pack files built offline:
//   bores/wine-bore/pack/producer-images.json  scripts/wine/harvest-producer-images.ts
//   bores/wine-bore/pack/appellation-maps.json scripts/wine/build-appellation-maps.ts
// ---------------------------------------------------------------------------

import { findUrl, loadBorePack } from "@dig/domain";
import { sql, type Database, type Kysely } from "@dig/db";
import type { CounterImage, WineEvidence } from "./wine-bore.js";

const MAP_BASE = "https://app.dig.baby/winebore/maps";

let images: Record<string, CounterImage> | null | undefined;
let maps: Set<string> | null | undefined;

function packs() {
  if (images === undefined) images = loadBorePack<Record<string, CounterImage>>("wine-bore", "producer-images.json");
  if (maps === undefined) {
    const idx = loadBorePack<{ ids: string[] }>("wine-bore", "appellation-maps.json");
    maps = idx ? new Set(idx.ids) : null;
  }
  return { images, maps };
}

interface Maker { id: number; site: string | null; qid: string | null }

export async function dressCounter(db: Kysely<Database>, evidence: WineEvidence[]): Promise<void> {
  const { images, maps } = packs();
  const ids = (type: WineEvidence["type"]) =>
    evidence.filter((e) => e.type === type).map((e) => Number(e.id)).filter(Number.isFinite);
  const lwins = ids("wine");
  const appellations = ids("appellation");

  const wineMaker = new Map<number, number>();
  if (lwins.length) {
    const { rows } = await sql<{ lwin: string; producer_id: number | null }>`
      SELECT lwin, producer_id FROM wine.wines WHERE lwin = ANY(${lwins}::bigint[])`.execute(db);
    for (const r of rows) if (r.producer_id != null) wineMaker.set(Number(r.lwin), r.producer_id);
  }

  const makerIds = [...new Set([...ids("producer"), ...wineMaker.values()])];
  const makers = new Map<number, Maker>();
  if (makerIds.length) {
    // The producer's own site, else one a producer link found (Wikidata,
    // trade directories, the Exa sweep).
    const { rows } = await sql<{ id: number; site: string | null; qid: string | null }>`
      SELECT p.id,
             COALESCE(NULLIF(p.website, ''), (
               SELECT l.url FROM wine.producer_links l
               WHERE l.producer_id = p.id AND l.kind IN ('website', 'wikidata') AND NULLIF(l.url, '') IS NOT NULL
               ORDER BY (l.kind = 'website') DESC LIMIT 1)) AS site,
             p.wikidata_qid AS qid
      FROM wine.producers p WHERE p.id = ANY(${makerIds}::int[])`.execute(db);
    for (const r of rows) makers.set(r.id, { id: r.id, site: r.site, qid: r.qid });
  }

  const pdo = new Map<number, string>();
  if (appellations.length && maps) {
    const { rows } = await sql<{ id: number; pdo: string | null }>`
      SELECT id, COALESCE(eu_file_number, CASE WHEN source = 'pdo-dataset' THEN source_ref END) AS pdo
      FROM wine.appellations WHERE id = ANY(${appellations}::int[])`.execute(db);
    for (const r of rows) if (r.pdo && maps.has(r.pdo)) pdo.set(r.id, r.pdo);
  }

  const picture = (m: Maker | undefined) => (m?.qid && images?.[m.qid]) || null;
  for (const e of evidence) {
    if (e.type === "producer") {
      const m = makers.get(Number(e.id));
      e.site_url = safeUrl(m?.site);
      e.image = picture(m);
      e.find_url ??= findUrl(e.title);
    } else if (e.type === "wine") {
      const m = makers.get(wineMaker.get(Number(e.id)) ?? -1);
      e.site_url = safeUrl(m?.site);
      e.image = picture(m);
    } else if (e.type === "appellation") {
      const id = pdo.get(Number(e.id));
      e.map_url = id ? `${MAP_BASE}/${id}.svg` : null;
    }
  }
}

// Sites come from third-party data; only hand the page an http(s) URL.
function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
