/**
 * Shared helpers for the wine loaders (scripts/wine/*.ts).
 *
 * One normalisation, one country map, one CSV reader, one load_log writer -
 * so every loader joins on the same strings and reports the same way.
 *
 * Run any loader with:
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/<loader>.ts
 */
import { createReadStream, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";

export const REPO_ROOT = resolve(__dirname, "..", "..");
export const RAW = resolve(REPO_ROOT, "data", "wine", "raw");

export function connect(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return new pg.Pool({ connectionString: url, max: 4 });
}

/**
 * Join key for names. Lowercase, diacritics stripped, punctuation to spaces,
 * whitespace collapsed. "Château Léoville-Las Cases" -> "chateau leoville las cases".
 * Do NOT strip title words here; producers.name_norm is the bare name and
 * display_name carries the title, so callers pick which to normalise.
 */
export function norm(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[’'`´]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** LWIN and the register write "NA" for missing values. */
export function na(s: string | null | undefined): string | null {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  return t === "" || t === "NA" || t === "na" || t === "null" ? null : t;
}

export function intOrNull(s: unknown): number | null {
  const t = na(s as string);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function numOrNull(s: unknown): number | null {
  const t = na(s as string);
  if (t === null) return null;
  const n = Number(String(t).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Country names as the sources spell them -> ISO-3166 alpha-2. LWIN uses
// English; Systembolaget Swedish; the register uses codes already.
const COUNTRY: Record<string, string> = {
  france: "FR", frankrike: "FR", italy: "IT", italien: "IT", spain: "ES", spanien: "ES",
  germany: "DE", tyskland: "DE", austria: "AT", osterrike: "AT", österrike: "AT", portugal: "PT",
  "united states": "US", usa: "US", "united kingdom": "GB", storbritannien: "GB", england: "GB",
  australia: "AU", australien: "AU", "new zealand": "NZ", "nya zeeland": "NZ", "south africa": "ZA",
  sydafrika: "ZA", argentina: "AR", chile: "CL", canada: "CA", kanada: "CA", hungary: "HU", ungern: "HU",
  greece: "GR", grekland: "GR", switzerland: "CH", schweiz: "CH", lebanon: "LB", libanon: "LB",
  israel: "IL", japan: "JP", mexico: "MX", mexiko: "MX", uruguay: "UY", turkey: "TR", turkiet: "TR",
  brazil: "BR", brasilien: "BR", slovenia: "SI", slovenien: "SI", "czech republic": "CZ", tjeckien: "CZ",
  luxembourg: "LU", luxemburg: "LU", georgia: "GE", georgien: "GE", moldova: "MD", moldavien: "MD",
  bulgaria: "BG", bulgarien: "BG", ukraine: "UA", ukraina: "UA", cyprus: "CY", cypern: "CY",
  romania: "RO", rumanien: "RO", rumänien: "RO", denmark: "DK", danmark: "DK", ireland: "IE", irland: "IE",
  china: "CN", kina: "CN", croatia: "HR", kroatien: "HR", poland: "PL", polen: "PL", morocco: "MA",
  marocko: "MA", netherlands: "NL", nederlanderna: "NL", nederländerna: "NL", sweden: "SE", sverige: "SE",
  finland: "FI", india: "IN", indien: "IN", slovakia: "SK", slovakien: "SK", norway: "NO", norge: "NO",
  armenia: "AM", armenien: "AM", belgium: "BE", belgien: "BE", serbia: "RS", serbien: "RS",
  malta: "MT", montenegro: "ME", "north macedonia": "MK", nordmakedonien: "MK", albania: "AL",
  "bosnia and herzegovina": "BA", tunisia: "TN", algeria: "DZ", peru: "PE", bolivia: "BO", taiwan: "TW",
  thailand: "TH", vietnam: "VN", "russian federation": "RU", russia: "RU", ryssland: "RU",
  "republic of korea": "KR", "south korea": "KR", egypt: "EG", ethiopia: "ET", kenya: "KE",
  "hong kong": "HK", singapore: "SG", indonesia: "ID", philippines: "PH", macedonia: "MK",
  "england/wales": "GB", scotland: "GB", wales: "GB", jersey: "JE", guernsey: "GG",
  // Added by load-lwin (LWIN spellings) and load-systembolaget (Swedish spellings).
  bhutan: "BT", ecuador: "EC", syria: "SY", venezuela: "VE",
  azerbajdzjan: "AZ", "folkrepubliken kina": "CN",
  // Systembolaget non-countries: recorded in country_name, no ISO code.
  "internationellt marke": "", eu: "", "varierande ursprung": "",
};

export function countryCode(name: string | null | undefined): string | null {
  const t = na(name);
  if (!t) return null;
  if (/^[A-Z]{2}$/.test(t)) return t;
  return COUNTRY[norm(t)] || null;
}

/** RFC 4180 CSV, streamed line by line. Handles quoted fields with embedded newlines. */
export async function* readCsv(path: string, opts: { bom?: boolean } = {}): AsyncGenerator<Record<string, string>> {
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let header: string[] | null = null;
  let pending = "";
  for await (const rawLine of rl) {
    const line = pending ? pending + "\n" + rawLine : rawLine;
    const fields = parseCsvLine(line);
    if (fields === null) { pending = line; continue; }
    pending = "";
    if (!header) {
      header = fields.map((h, i) => (i === 0 && opts.bom !== false ? h.replace(/^\uFEFF/, "") : h));
      continue;
    }
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = fields[i] ?? ""; });
    yield row;
  }
}

/** Returns null when the line ends inside a quoted field (caller buffers). */
export function parseCsvLine(line: string): string[] | null {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  if (q) return null;
  out.push(cur);
  return out;
}

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export async function logLoad(
  pool: pg.Pool,
  loader: string,
  counts: { rows_in?: number; rows_out?: number; matched?: number; unmatched?: number },
  notes: Record<string, unknown> = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO wine.load_log (loader, rows_in, rows_out, matched, unmatched, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
    [loader, counts.rows_in ?? null, counts.rows_out ?? null, counts.matched ?? null, counts.unmatched ?? null, JSON.stringify(notes)],
  );
  const parts = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`[${loader}] ${parts}`, Object.keys(notes).length ? JSON.stringify(notes) : "");
}

export async function upsertSource(
  pool: pg.Pool,
  s: { slug: string; name: string; licence?: string; pulled_at?: string; demo_only?: boolean; notes?: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO wine.sources (slug, name, licence, pulled_at, demo_only, notes) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, licence=EXCLUDED.licence, pulled_at=EXCLUDED.pulled_at, demo_only=EXCLUDED.demo_only, notes=EXCLUDED.notes`,
    [s.slug, s.name, s.licence ?? null, s.pulled_at ?? null, s.demo_only ?? false, s.notes ?? null],
  );
}

/** Multi-row INSERT in chunks. cols are column names; rows are arrays in that order. */
export async function insertMany(
  pool: pg.Pool,
  table: string,
  cols: string[],
  rows: unknown[][],
  onConflict = "",
  chunk = 1000,
): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    const values = slice
      .map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`)
      .join(",");
    const res = await pool.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${values} ${onConflict}`, params);
    n += res.rowCount ?? 0;
  }
  return n;
}
