// What goes on Wine Bore's counter: of everything the tools returned, only
// what the answer actually named. Kept apart from the page so it can be
// tested without React.

export interface Bottle {
  type: "appellation" | "producer" | "wine" | "grape" | "shelf";
  id: number | string;
  title: string;
  subtitle: string | null;
  find_url: string | null;
  /** The producer's own site (on a wine's card, its maker's). */
  site_url?: string | null;
  /** A photo of the house from Wikimedia Commons; credit is required. */
  image?: { kind: "photo" | "logo"; src: string; page: string; credit: string | null; licence: string | null } | null;
  /** Where the appellation is: the delimited area over its country. */
  map_url?: string | null;
}

// Evidence arrives as everything the tools returned; the counter shows the
// bottles and growers, deduped, wines first.
// Only what he actually named goes on the counter: a bottle stays if its
// producer (the part before the first comma) or its whole title appears in
// the answer. If he named nothing the counter is empty.
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").toLowerCase();
// Words that name a kind of house, not a house: "Chateau" alone is no one.
const HONORIFIC = new Set([
  "chateau", "domaine", "maison", "weingut", "bodega", "bodegas", "tenuta", "quinta", "cantina", "azienda", "clos", "cave", "caves", "winery", "estate", "cellars",
  // ...and the family tail: "Giacomo Borgogno & Figli" is named by "Borgogno".
  "figli", "fils", "freres", "sons", "fratelli", "hermanos", "famille", "familia", "family", "vins", "vini", "vinos", "wines",
]);
function named(answer: string, b: Bottle, places: Set<string>, shared: Set<string>): boolean {
  const a = fold(answer);
  const parts = b.title.split(",").map((p) => fold(p).trim()).filter((p) => p.length > 2);
  if (parts.length === 0) return false;
  // He says "Overnoy", the book says "Maison Pierre Overnoy": the surname
  // (last word of the house) as a whole word is enough for a producer -
  // unless it's only an honorific, or a place he named anyway ("Lucy
  // Margaux" is not named by talking about Margaux).
  const house = parts[0];
  const words = house.split(" ").filter((w) => w.length > 3 && !HONORIFIC.has(w));
  const surname = words.pop();
  // A surname alone only counts when it's this house's alone: "Mascarello"
  // names Bartolo, not five other Mascarellos from the same search.
  const houseNamed = (a.includes(house) && !HONORIFIC.has(house)) ||
    (!!surname && !places.has(surname) && !shared.has(surname) && new RegExp(`\\b${surname}\\b`).test(a));
  if (b.type === "producer") return houseNamed;
  if (b.type !== "wine") return a.includes(fold(b.title).trim());
  // A wine needs its house and, when the title carries one, its cuvée.
  const cuvee = parts[parts.length - 1];
  return houseNamed && (parts.length === 1 || a.includes(cuvee));
}
export function onTheCounter(evidence: Bottle[] | undefined, answer: string): Bottle[] {
  if (!evidence) return [];
  const seen = new Set<string>();
  const order: Record<Bottle["type"], number> = { wine: 0, producer: 1, appellation: 2, grape: 3, shelf: 9 };
  const places = new Set(evidence.filter((b) => b.type === "appellation").flatMap((b) => fold(b.title).split(" ")));
  // Surnames more than one grower on the counter shares.
  const bySurname = new Map<string, Set<string>>();
  for (const b of evidence) {
    if (b.type !== "producer" && b.type !== "wine") continue;
    const house = fold(b.title.split(",")[0]).trim();
    const sn = house.split(" ").filter((x) => x.length > 3 && !HONORIFIC.has(x)).pop();
    if (sn) bySurname.set(sn, (bySurname.get(sn) ?? new Set()).add(house));
  }
  const shared = new Set([...bySurname].filter(([, houses]) => houses.size > 1).map(([sn]) => sn));
  return evidence
    .filter((b) => b.type !== "shelf")
    .filter((b) => named(answer, b, places, shared))
    .filter((b) => { const k = `${b.type}/${b.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => order[a.type] - order[b.type])
    .slice(0, 8);
}
