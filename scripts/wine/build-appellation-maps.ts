/**
 * Region maps for EU wine appellations: one small SVG per PDO, the delimited
 * area filled in the shop's red over country borders for context.
 *
 * Inputs (both public domain / CC0, fetched once into data/wine/raw):
 *   pdo-dataset/EU_PDO.gpkg
 *     Candiago et al. 2022, "A geospatial inventory of regulatory information
 *     for wine PDOs in Europe" (figshare c.5877659, CC0). 1,177 dissolved
 *     PDO boundaries in EPSG:3035, keyed by PDOid - the eAmbrosia file
 *     number, which is wine.appellations.eu_file_number.
 *   natural-earth/ne_50m_admin_0_countries.geojson (Natural Earth, public domain)
 *
 * Outputs:
 *   apps/web/public/winebore/maps/<PDOid>.svg
 *   bores/wine-bore/pack/appellation-maps.json   (the PDOids that have a map)
 *
 * No database: the join to appellations happens at ask time on
 * eu_file_number. Needs the sqlite3 CLI (GeoPackage is SQLite).
 *
 *   pnpm exec tsx scripts/wine/build-appellation-maps.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { RAW, REPO_ROOT } from "./lib";

const OUT_DIR = resolve(REPO_ROOT, "apps", "web", "public", "winebore", "maps");
const INDEX = resolve(REPO_ROOT, "bores", "wine-bore", "pack", "appellation-maps.json");

// Frame: 4:3, the whole country the area sits in - "where is it" matters
// more to a customer than the exact outline. Islands within ISLAND_REACH of
// the mainland (Sicily, Crete, Corsica, the Balearics) keep the mainland in
// frame; distant ones (Canaries, Madeira) frame their own island.
const W = 400;
const H = 300;
const PAD = 0.06;
const MIN_SPAN_M = 150_000;
const ISLAND_REACH_M = 600_000;
const SIMPLIFY_PX = 0.6;

type Pt = [number, number];
type Ring = Pt[];
type Poly = Ring[];

// --- EPSG:3035 (ETRS89 / LAEA Europe), ellipsoidal, Snyder 1987 -------------

const A = 6378137;
const E2 = 0.0066943800229;
const E = Math.sqrt(E2);
const LAT0 = (52 * Math.PI) / 180;
const LON0 = (10 * Math.PI) / 180;
const FE = 4321000;
const FN = 3210000;
const q = (phi: number) => {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
};
const QP = q(Math.PI / 2);
const RQ = A * Math.sqrt(QP / 2);
const BETA0 = Math.asin(q(LAT0) / QP);
const D = (A * Math.cos(LAT0)) / Math.sqrt(1 - E2 * Math.sin(LAT0) ** 2) / (RQ * Math.cos(BETA0));

export function laea(lon: number, lat: number): Pt {
  const phi = (lat * Math.PI) / 180;
  const dl = (lon * Math.PI) / 180 - LON0;
  const beta = Math.asin(Math.max(-1, Math.min(1, q(phi) / QP)));
  const B = RQ * Math.sqrt(2 / (1 + Math.sin(BETA0) * Math.sin(beta) + Math.cos(BETA0) * Math.cos(beta) * Math.cos(dl)));
  return [
    FE + B * D * Math.cos(beta) * Math.sin(dl),
    FN + (B / D) * (Math.cos(BETA0) * Math.sin(beta) - Math.sin(BETA0) * Math.cos(beta) * Math.cos(dl)),
  ];
}

// --- GeoPackage geometry -> polygons ------------------------------------------

const ENVELOPE_BYTES = [0, 32, 48, 48, 64];

function parseGpkg(buf: Buffer): Poly[] {
  if (buf[0] !== 0x47 || buf[1] !== 0x50) throw new Error("not a GeoPackage geometry");
  const env = ENVELOPE_BYTES[(buf[3] >> 1) & 7] ?? 0;
  let o = 8 + env;
  const polys: Poly[] = [];

  const readGeom = () => {
    const le = buf[o] === 1;
    o += 1;
    const u32 = () => { const v = le ? buf.readUInt32LE(o) : buf.readUInt32BE(o); o += 4; return v; };
    const f64 = () => { const v = le ? buf.readDoubleLE(o) : buf.readDoubleBE(o); o += 8; return v; };
    const raw = u32();
    const base = raw % 1000;
    const dims = raw >= 3000 ? 4 : raw >= 1000 ? 3 : 2;
    const polygon = (): Poly => {
      const rings: Poly = [];
      for (let r = u32(); r > 0; r--) {
        const ring: Ring = [];
        for (let n = u32(); n > 0; n--) {
          const x = f64();
          const y = f64();
          for (let k = 2; k < dims; k++) f64();
          ring.push([x, y]);
        }
        rings.push(ring);
      }
      return rings;
    };
    if (base === 3) polys.push(polygon());
    else if (base === 6) for (let n = u32(); n > 0; n--) readGeom();
    else throw new Error(`unexpected WKB type ${raw}`);
  };
  readGeom();
  return polys;
}

// --- geometry helpers -------------------------------------------------------------

interface Box { x0: number; y0: number; x1: number; y1: number }

function bounds(polys: Poly[]): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of polys) for (const [x, y] of p[0] ?? []) {
    if (x < b.x0) b.x0 = x;
    if (y < b.y0) b.y0 = y;
    if (x > b.x1) b.x1 = x;
    if (y > b.y1) b.y1 = y;
  }
  return b;
}

const overlaps = (a: Box, b: Box) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

// Sutherland-Hodgman against the frame rectangle. The window is convex, so
// any ring clips cleanly; seams along the frame edge are outside the view.
function clip(ring: Ring, b: Box): Ring {
  const edges: Array<[(p: Pt) => boolean, (a: Pt, c: Pt) => Pt]> = [
    [(p) => p[0] >= b.x0, (a, c) => [b.x0, a[1] + ((c[1] - a[1]) * (b.x0 - a[0])) / (c[0] - a[0])]],
    [(p) => p[0] <= b.x1, (a, c) => [b.x1, a[1] + ((c[1] - a[1]) * (b.x1 - a[0])) / (c[0] - a[0])]],
    [(p) => p[1] >= b.y0, (a, c) => [a[0] + ((c[0] - a[0]) * (b.y0 - a[1])) / (c[1] - a[1]), b.y0]],
    [(p) => p[1] <= b.y1, (a, c) => [a[0] + ((c[0] - a[0]) * (b.y1 - a[1])) / (c[1] - a[1]), b.y1]],
  ];
  let out = ring;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(cross(prev, cur));
      }
    }
    if (out.length === 0) break;
  }
  return out;
}

// Douglas-Peucker, iterative.
function simplify(pts: Ring, tol: number): Ring {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = pts[s];
    const [bx, by] = pts[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let far = -1;
    let farD = t2;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > farD) { farD = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([s, far], [far, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function pathData(polys: Poly[], toPx: (p: Pt) => Pt, frame?: Box): string {
  let d = "";
  for (const poly of polys) for (const ring of poly) {
    const cut = frame ? clip(ring, frame) : ring;
    if (cut.length < 3) continue;
    const px = simplify(cut.map(toPx), SIMPLIFY_PX);
    if (px.length < 3) continue;
    d += `M${px.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
  }
  return d.replace(/\.0(?=[ LZM])/g, "");
}

// --- build -------------------------------------------------------------------------

interface Country { name: string; code: string; polys: Poly[]; box: Box; mainland: Box }

function loadCountries(): Country[] {
  const gj = JSON.parse(readFileSync(resolve(RAW, "natural-earth", "ne_50m_admin_0_countries.geojson"), "utf8"));
  const out: Country[] = [];
  for (const f of gj.features) {
    const g = f.geometry;
    if (!g) continue;
    const lonlat: number[][][][] = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    // Europe and its edges only: nothing west of the Azores or east of the Urals.
    const polys: Poly[] = lonlat
      .filter((p) => p[0].some(([lon, lat]) => lon > -32 && lon < 60 && lat > 25 && lat < 75))
      .map((p) => p.map((ring) => ring.map(([lon, lat]) => laea(lon, lat))));
    if (!polys.length) continue;
    // Mainland = the part with the largest bounding box.
    const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);
    const mainland = polys.map((p) => bounds([p])).reduce((a, b) => (area(b) > area(a) ? b : a));
    out.push({ name: String(f.properties.NAME ?? ""), code: String(f.properties.ISO_A2_EH ?? ""), polys, box: bounds(polys), mainland });
  }
  return out;
}

const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const gap = (a: Box, b: Box) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));

function frameFor(b: Box, home: Country | undefined): Box {
  let f = b;
  if (home) {
    if (gap(b, home.mainland) <= ISLAND_REACH_M) f = union(b, home.mainland);
    else {
      const part = home.polys.map((p) => bounds([p])).find((pb) => overlaps(pb, b));
      if (part) f = union(b, part);
    }
  }
  const cx = (f.x0 + f.x1) / 2;
  const cy = (f.y0 + f.y1) / 2;
  let spanX = Math.max((f.x1 - f.x0) * (1 + 2 * PAD), ((f.y1 - f.y0) * (1 + 2 * PAD) * W) / H, MIN_SPAN_M);
  const spanY = (spanX * H) / W;
  spanX = (spanY * W) / H;
  return { x0: cx - spanX / 2, x1: cx + spanX / 2, y0: cy - spanY / 2, y1: cy + spanY / 2 };
}

function svgFor(id: string, polys: Poly[], countries: Country[]): string {
  const b = bounds(polys);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const home = countries.find((c) => c.code === id.slice(4, 6));
  const frame = frameFor(b, home);
  const spanX = frame.x1 - frame.x0;
  const pad = spanX * 0.02;
  const clipBox: Box = { x0: frame.x0 - pad, x1: frame.x1 + pad, y0: frame.y0 - pad, y1: frame.y1 + pad };
  const s = W / spanX;
  const toPx = ([x, y]: Pt): Pt => [(x - frame.x0) * s, (frame.y1 - y) * s];

  const near = countries.filter((c) => c !== home && overlaps(c.box, clipBox)).map((c) => pathData(c.polys, toPx, clipBox)).join("");
  const own = home ? pathData(home.polys, toPx, clipBox) : "";
  const area = pathData(polys, toPx);
  const areaPx = (b.x1 - b.x0) * s;
  // A single commune can be a few pixels across: ring it so it can be found.
  const marker = areaPx < 14 ? `<circle cx="${((cx - frame.x0) * s).toFixed(1)}" cy="${((frame.y1 - cy) * s).toFixed(1)}" r="11" fill="none" stroke="#c83a25" stroke-width="1.5"/>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of the ${id} appellation area"><title>${id}</title>` +
    `<rect width="${W}" height="${H}" fill="#e9eef0"/>` +
    `<path d="${near}" fill="#e6e1d7" stroke="#c9c1b3" stroke-width="0.6" stroke-linejoin="round"/>` +
    `<path d="${own}" fill="#f7f2e8" stroke="#a89f90" stroke-width="0.9" stroke-linejoin="round"/>` +
    `<path d="${area}" fill="#c83a25" fill-opacity="0.85" stroke="#8f2515" stroke-width="0.6" stroke-linejoin="round"/>` +
    marker + `</svg>\n`;
}

function main() {
  // Guard the projection against EPSG's own worked example.
  const [ex, ny] = laea(5, 50);
  if (Math.abs(ex - 3962799.45) > 1 || Math.abs(ny - 2999718.85) > 1) throw new Error(`LAEA check failed: ${ex}, ${ny}`);

  const gpkg = resolve(RAW, "pdo-dataset", "EU_PDO.gpkg");
  const rows = execFileSync("sqlite3", ["-separator", "\t", gpkg, "SELECT PDOid, hex(Shape) FROM EU_PDO WHERE Shape IS NOT NULL"], { maxBuffer: 512 * 1024 * 1024 })
    .toString()
    .trim()
    .split("\n");

  const countries = loadCountries();
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const ids: string[] = [];
  let bytes = 0;
  const failed: string[] = [];
  for (const row of rows) {
    const [id, hex] = row.split("\t");
    try {
      const polys = parseGpkg(Buffer.from(hex, "hex"));
      if (!polys.length) throw new Error("empty");
      const svg = svgFor(id.trim(), polys, countries);
      writeFileSync(resolve(OUT_DIR, `${id.trim()}.svg`), svg);
      ids.push(id.trim());
      bytes += svg.length;
    } catch (err) {
      failed.push(`${id}: ${(err as Error).message}`);
    }
  }
  ids.sort();
  writeFileSync(INDEX, JSON.stringify({ source: "Candiago et al. 2022 (figshare c.5877659, CC0); Natural Earth", ids }, null, 0) + "\n");
  console.log(`${ids.length} maps, ${(bytes / 1e6).toFixed(1)} MB, avg ${(bytes / ids.length / 1000).toFixed(1)} KB; ${failed.length} failed`);
  for (const f of failed.slice(0, 10)) console.log(`  ${f}`);
}

main();
