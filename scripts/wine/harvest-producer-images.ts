/**
 * Producer pictures for Wine Bore's counter: Wikidata P18 (image) or, failing
 * that, P154 (logo), resolved on Wikimedia Commons to a thumbnail URL with
 * its real author and licence - Commons files are free to use only with
 * credit, so the card credits them.
 *
 * Input: data/wine/raw/wikidata/producer-qids.txt, one QID per line. Export
 * it read-only from prod:
 *   fly ssh console -a dig-db-scene -C "su postgres -c \"psql -p 5433 -d dig -Atc
 *     'select distinct wikidata_qid from wine.producers where wikidata_qid is not null'\""
 *
 * Output: bores/wine-bore/pack/producer-images.json, keyed by QID. Keyed by
 * QID rather than producer id so a data reload can't point a photo at the
 * wrong house.
 *
 *   pnpm exec tsx scripts/wine/harvest-producer-images.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { RAW, REPO_ROOT } from "./lib";

const OUT = resolve(REPO_ROOT, "bores", "wine-bore", "pack", "producer-images.json");
const UA = "dig-winebore-harvest/0.1 (https://app.dig.baby; andy@cherrygalore.com)";
const THUMB_PX = 320;

export interface ProducerImage {
  kind: "photo" | "logo";
  /** Commons thumbnail, THUMB_PX wide. */
  src: string;
  /** The file's Commons page, where the credit points. */
  page: string;
  credit: string | null;
  licence: string | null;
}

async function getJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (res.ok) return res.json();
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${res.status} ${url.slice(0, 120)}`);
  }
}

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// Commons "Artist" is HTML; the card wants a plain name. The full credit
// stays one click away on the file page the card links to.
const plain = (html: string | undefined) =>
  html ? html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim().slice(0, 120) || null : null;

// "Foo.jpg: A derivative work: B (talk)" -> "B": the last credited hand.
function credit(html: string | undefined): string | null {
  let c = plain(html);
  if (!c) return null;
  c = c.split(/derivative work:/i).pop() ?? c;
  c = c.replace(/^No machine-readable author provided\.\s*(.+?)\s+assumed.*$/i, "$1").replace(/^The original uploader was\s+(.+?)\s+at\s+.+$/i, "$1").replace(/~commonswiki$/i, "");
  c = c.replace(/^[^:]*\.(jpe?g|png|tiff?|svg|gif)\s*:\s*/i, "").replace(/\s*\((talk|discussion|page de discussion)\)/gi, "").replace(/_/g, " ").trim();
  return c || null;
}

async function main() {
  const qids = readFileSync(resolve(RAW, "wikidata", "producer-qids.txt"), "utf8").split(/\s+/).filter((q) => /^Q\d+$/.test(q));

  // 1. QID -> Commons file name (P18 photo, else P154 logo).
  const files = new Map<string, { file: string; kind: ProducerImage["kind"] }>();
  for (const batch of chunks(qids, 50)) {
    const d = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join("|")}&props=claims&format=json`);
    for (const [qid, ent] of Object.entries<any>(d.entities ?? {})) {
      const pick = (p: string) => ent.claims?.[p]?.find((c: any) => c.rank !== "deprecated")?.mainsnak?.datavalue?.value;
      const photo = pick("P18");
      const logo = pick("P154");
      if (photo) files.set(qid, { file: String(photo), kind: "photo" });
      else if (logo) files.set(qid, { file: String(logo), kind: "logo" });
    }
  }

  // 2. File -> thumbnail, author, licence.
  const meta = new Map<string, { src: string; page: string; credit: string | null; licence: string | null }>();
  const titles = [...new Set([...files.values()].map((f) => `File:${f.file}`))];
  for (const batch of chunks(titles, 50)) {
    const u = new URL("https://commons.wikimedia.org/w/api.php");
    u.search = new URLSearchParams({
      action: "query", format: "json", prop: "imageinfo", iiprop: "url|extmetadata",
      iiurlwidth: String(THUMB_PX), iiextmetadatafilter: "Artist|LicenseShortName", titles: batch.join("|"),
    }).toString();
    const d = await getJson(u.toString());
    const normalized = new Map<string, string>((d.query?.normalized ?? []).map((n: any) => [n.to, n.from]));
    for (const page of Object.values<any>(d.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      if (!info?.thumburl) continue;
      const asked = normalized.get(page.title) ?? page.title;
      meta.set(asked.replace(/^File:/, ""), {
        src: info.thumburl,
        page: info.descriptionurl,
        credit: credit(info.extmetadata?.Artist?.value),
        licence: plain(info.extmetadata?.LicenseShortName?.value),
      });
    }
  }

  const out: Record<string, ProducerImage> = {};
  for (const [qid, f] of files) {
    const m = meta.get(f.file) ?? meta.get(f.file.replace(/_/g, " "));
    if (m) out[qid] = { kind: f.kind, ...m };
  }
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1))));
  writeFileSync(OUT, JSON.stringify(sorted, null, 1) + "\n");
  const photos = Object.values(out).filter((x) => x.kind === "photo").length;
  console.log(`${qids.length} producers with a QID -> ${Object.keys(out).length} pictures (${photos} photos, ${Object.keys(out).length - photos} logos)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
