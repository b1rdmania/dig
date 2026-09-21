/**
 * load-appellation-documents.ts - the rules as text.
 *
 * Reads:
 *   data/wine/raw/inao/cdc-text/*.txt   (French cahiers des charges; run extract-inao-text.ts first.
 *                                        Bundles are split and every text is checked against its
 *                                        own header - see inao-cahiers.ts)
 *   data/wine/raw/inao/lists/inao-ref-produit-siqo.csv (slug -> accented INAO title)
 *   data/wine/raw/masaf/index.csv + masaf/text/*.txt    (521 Italian disciplinari)
 *   data/wine/raw/mapa/index.csv  + mapa/text/*.txt     (147 Spanish pliegos)
 *
 * Writes: wine.appellation_documents (one row per document, full text),
 * resolved to wine.appellations by name_norm within the same country.
 * Owns source='inao' | 'masaf' | 'mapa'. Idempotent.
 *
 * masaf/catalogoviti is skipped: it is the variety register, not a disciplinare.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/load-appellation-documents.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { cahierFor, isGarbled, splitCahiers } from "./inao-cahiers";
import { RAW, connect, insertMany, logLoad, na, norm, readCsv, upsertSource } from "./lib";

const MIN_CHARS = 500;

/** French title decoration that the EU register does not carry. */
const FR_DROP = new Set(["aoc", "aop", "igp", "ig", "vdp", "vin", "vins", "de", "du", "des", "d"]);

function titleCase(slug: string): string {
  return slug.split("-").map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

function sha256(path: string): string | null {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex"); } catch { return null; }
}

async function main() {
  const pool = connect();

  await upsertSource(pool, { slug: "inao", name: "INAO - cahiers des charges (FR)", licence: "public administrative documents; INAO boundaries under Licence Ouverte", pulled_at: "2026-09-03", notes: "PDFs + extracted text; bundles split per cahier, every text checked against its own header" });
  await upsertSource(pool, { slug: "masaf", name: "MASAF - disciplinari di produzione (IT)", licence: "government publication", pulled_at: "2026-09-03", notes: "521 disciplinari; catalogoviti (variety register) deliberately not loaded" });
  await upsertSource(pool, { slug: "mapa", name: "MAPA - pliegos de condiciones (ES)", licence: "government publication", pulled_at: "2026-09-03", notes: "149 indexed pliegos, 147 with extracted text" });

  // ---- INAO titles from the SIQO reference list --------------------------
  const inaoTitle = new Map<string, string>();
  const slugify = (s: string) =>
    s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’'`´]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  for await (const r of readCsv(resolve(RAW, "inao", "lists", "inao-ref-produit-siqo.csv"))) {
    if (na(r.secteur) !== "VITICOLE") continue;
    for (const key of ["appellation", "denomination"]) {
      const v = na(r[key]);
      if (!v) continue;
      const s = slugify(v);
      if (s && !inaoTitle.has(s)) inaoTitle.set(s, v);
    }
  }

  type Doc = {
    country: string; doc_type: string; title: string; url: string | null;
    sha256: string | null; text: string; source: string; source_ref: string;
  };
  const docs: Doc[] = [];
  const skipped: Record<string, string[]> = { inao: [], masaf: [], mapa: [] };
  const missingText: Record<string, string[]> = { masaf: [], mapa: [] };
  const titleFromSlug: string[] = [];

  // ---- INAO ---------------------------------------------------------------
  // A file name is no evidence of what the PDF holds (see inao-cahiers.ts).
  // Pass 1 reads every text once and indexes every cahier found inside a
  // bundle. Pass 2 files a text under a slug only when a header names it.
  const inaoDir = resolve(RAW, "inao", "cdc-text");
  const inaoFiles = readdirSync(inaoDir).filter((x) => x.endsWith(".txt")).sort();
  const inaoText = new Map<string, string>();
  const sectionBySlug = new Map<string, { text: string; from: string }>();
  for (const f of inaoFiles) {
    const slug = f.replace(/\.txt$/, "");
    const text = readFileSync(resolve(inaoDir, f), "utf8");
    inaoText.set(slug, text);
    if (isGarbled(text)) continue;
    const sections = splitCahiers(text);
    if (sections.length < 2) continue;
    for (const sec of sections) {
      const body = text.slice(sec.start, sec.end);
      for (const key of [...sec.slugs, sec.slugs.join("-ou-")]) {
        const held = sectionBySlug.get(key);
        if (!held || body.length > held.text.length) sectionBySlug.set(key, { text: body, from: slug });
      }
    }
  }
  const inaoRejected: Record<string, string[]> = { garbled: [], wrong_cahier: [], bundle_without_slug: [] };
  const inaoHow: Record<string, number> = { whole: 0, section: 0, shared: 0, recovered_from_bundle: 0, slug_without_pdf: 0 };
  const pushInao = (slug: string, text: string) => {
    let title = inaoTitle.get(slug) ?? null;
    if (!title) { title = titleCase(slug); titleFromSlug.push(slug); }
    const pdf = resolve(RAW, "inao", "cdc", `${slug}.pdf`);
    docs.push({
      country: "FR", doc_type: "cahier", title, url: null,
      sha256: existsSync(pdf) && statSync(pdf).isFile() ? sha256(pdf) : null,
      text, source: "inao", source_ref: slug,
    });
  };
  for (const [slug, text] of inaoText) {
    if (text.trim().length < MIN_CHARS) { skipped.inao.push(`${slug} (${text.trim().length} chars)`); continue; }
    const v = cahierFor(slug, text);
    if (v.ok) { inaoHow[v.how]++; pushInao(slug, v.text); continue; }
    const other = sectionBySlug.get(slug) ?? slug.split("-ou-").map((p) => sectionBySlug.get(p)).find(Boolean);
    if (other) { inaoHow.recovered_from_bundle++; pushInao(slug, other.text); continue; }
    inaoRejected[v.reason].push(v.found.length ? `${slug} (holds ${v.found.slice(0, 3).join(", ")})` : slug);
  }
  // Cahiers that sit inside a bundle but never had a PDF of their own
  // (Romanee-Conti, Echezeaux, Corton-Charlemagne). Wine appellations only.
  for (const [slug, sec] of sectionBySlug) {
    if (inaoText.has(slug) || !inaoTitle.has(slug) || slug.includes("-ou-")) continue;
    if ([...inaoText.keys()].some((k) => k.split("-ou-").includes(slug))) continue;
    inaoHow.slug_without_pdf++;
    pushInao(slug, sec.text);
  }

  // ---- MASAF and MAPA (index.csv + text/<slug>.txt) -----------------------
  for (const spec of [
    { source: "masaf", country: "IT", doc_type: "disciplinare", nameCol: "denominazione" },
    { source: "mapa", country: "ES", doc_type: "pliego", nameCol: "denominacion" },
  ]) {
    const seenSlug = new Set<string>();
    for await (const r of readCsv(resolve(RAW, spec.source, "index.csv"))) {
      const slug = na(r.slug);
      if (!slug || seenSlug.has(slug)) continue;
      seenSlug.add(slug);
      const path = resolve(RAW, spec.source, "text", `${slug}.txt`);
      if (!existsSync(path)) { missingText[spec.source].push(slug); continue; }
      const text = readFileSync(path, "utf8");
      if (text.trim().length < MIN_CHARS) { skipped[spec.source].push(`${slug} (${text.trim().length} chars)`); continue; }
      docs.push({
        country: spec.country, doc_type: spec.doc_type,
        title: na(r[spec.nameCol]) ?? titleCase(slug), url: na(r.pdf_url),
        sha256: na(r.sha256), text, source: spec.source, source_ref: slug,
      });
    }
  }

  // ---- idempotence + insert ----------------------------------------------
  await pool.query(`DELETE FROM wine.appellation_documents WHERE source = ANY($1::text[])`, [["inao", "masaf", "mapa"]]);

  const rows = docs.map((d) => [
    d.country, d.doc_type, d.title, norm(d.title), d.url, d.sha256, d.text, d.source, d.source_ref,
  ]);
  const out = await insertMany(
    pool, "wine.appellation_documents",
    ["country", "doc_type", "title", "name_norm", "url", "sha256", "text", "source", "source_ref"],
    rows, "ON CONFLICT DO NOTHING", 20,
  );

  // ---- resolve appellation_id --------------------------------------------
  // name_norm -> appellation ids, per country, from every register spelling.
  const { rows: nameRows } = await pool.query(
    `SELECT n.name_norm, a.country, a.id FROM wine.appellation_names n JOIN wine.appellations a ON a.id = n.appellation_id`,
  );
  const byKey = new Map<string, Set<number>>();
  for (const r of nameRows) {
    const k = `${r.country}|${r.name_norm}`;
    if (!byKey.has(k)) byKey.set(k, new Set());
    (byKey.get(k) as Set<number>).add(r.id);
  }

  /**
   * National titles bundle every legal spelling into one string - "Alsace ou
   * Vin d'Alsace", "Asolo Prosecco o Asolo", "Cataluna / Catalunya" - while
   * the EU register keeps them as separate protected names. Split first, then
   * try each part.
   */
  const parts = (title: string): string[] => {
    const out = title.split(/\s*[/,]\s*|\s+(?:ou|o|e|et|y)\s+/gi)
      .map((x) => norm(x)).filter((x) => x.length >= 3);
    return out.length > 1 ? [...new Set(out)] : [];
  };

  const variants = (country: string, nn: string): string[] => {
    const out = [nn];
    const toks = nn.split(" ").filter(Boolean);
    if (country === "FR") {
      const kept = toks.filter((t) => !FR_DROP.has(t));
      if (kept.length && kept.join(" ") !== nn) out.push(kept.join(" "));
      if (nn.includes("grand cru")) {
        out.push(nn.replace(" grand cru", ""));
        out.push(nn.replace("grand cru ", ""));
      } else if (toks.length > 1) {
        out.push(`${toks[0]} grand cru ${toks.slice(1).join(" ")}`);
      }
    }
    if (country === "IT" || country === "ES") {
      const drop = ["docg", "doc", "dop", "igt", "igp", "vino", "vini", "di", "del", "della", "de", "disciplinare", "produzione"];
      const kept = toks.filter((t) => !drop.includes(t));
      if (kept.length && kept.join(" ") !== nn) out.push(kept.join(" "));
      // Some MASAF titles glue the class to the name: "MonferratoDOCG".
      const unglue = (list: string[]) => list.map((t) => t.replace(/(docg|dop|doc|igt|igp)$/, "")).filter(Boolean).join(" ");
      // Keep the connecting words the register uses ("Ruche di Castagnole
      // Monferrato") but drop the class words that top and tail the title.
      let inner = toks.filter((t) => t !== "disciplinare" && t !== "produzione");
      while (inner.length > 1 && drop.includes(inner[inner.length - 1])) inner = inner.slice(0, -1);
      while (inner.length > 1 && drop.includes(inner[0])) inner = inner.slice(1);
      for (const u of [unglue(toks.filter((t) => !drop.includes(t))), unglue(inner)]) {
        if (u && u !== nn && !out.includes(u)) out.push(u);
      }
    }
    return [...new Set(out)].filter((v) => v.length >= 3);
  };

  const { rows: docRows } = await pool.query(
    `SELECT id, country, name_norm, title, source FROM wine.appellation_documents WHERE source = ANY($1::text[])`,
    [["inao", "masaf", "mapa"]],
  );
  const updates: [number, number][] = [];
  const unmatched: Record<string, string[]> = { inao: [], masaf: [], mapa: [] };
  const matched: Record<string, number> = { inao: 0, masaf: 0, mapa: 0 };
  const ambiguous: string[] = [];

  for (const d of docRows) {
    let hit: number | null = null;
    const candidates: string[] = [];
    for (const base of [d.name_norm, ...parts(d.title), ...parts(d.name_norm)]) {
      for (const v of variants(d.country, base)) if (!candidates.includes(v)) candidates.push(v);
    }
    for (const v of candidates) {
      const set = byKey.get(`${d.country}|${v}`);
      if (set && set.size === 1) { hit = [...set][0]; break; }
      if (set && set.size > 1) { ambiguous.push(`${d.source}:${d.name_norm}`); hit = [...set].sort((a, b) => a - b)[0]; break; }
    }
    if (hit) { updates.push([d.id, hit]); matched[d.source]++; } else unmatched[d.source].push(d.title);
  }

  for (let i = 0; i < updates.length; i += 500) {
    const slice = updates.slice(i, i + 500);
    const params: unknown[] = [];
    const values = slice.map((u) => { params.push(u[0], u[1]); return `($${params.length - 1}::int,$${params.length}::int)`; }).join(",");
    await pool.query(
      `UPDATE wine.appellation_documents d SET appellation_id = v.app_id FROM (VALUES ${values}) AS v(doc_id, app_id) WHERE d.id = v.doc_id`,
      params,
    );
  }

  const notes: Record<string, unknown> = {
    docs_inao: docs.filter((d) => d.source === "inao").length,
    docs_masaf: docs.filter((d) => d.source === "masaf").length,
    docs_mapa: docs.filter((d) => d.source === "mapa").length,
    matched, 
    unmatched_counts: { inao: unmatched.inao.length, masaf: unmatched.masaf.length, mapa: unmatched.mapa.length },
    unmatched_examples: {
      inao: unmatched.inao.slice(0, 15), masaf: unmatched.masaf.slice(0, 15), mapa: unmatched.mapa.slice(0, 15),
    },
    skipped_under_500_chars: skipped,
    index_rows_without_text: missingText,
    inao_titles_from_slug: titleFromSlug,
    inao_filed_by: inaoHow,
    inao_rejected: inaoRejected,
    ambiguous_name_norm: [...new Set(ambiguous)].slice(0, 15),
  };

  const totalMatched = Object.values(matched).reduce((a, b) => a + b, 0);
  await logLoad(pool, "load-appellation-documents", {
    rows_in: docs.length, rows_out: out, matched: totalMatched, unmatched: docRows.length - totalMatched,
  }, notes);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
