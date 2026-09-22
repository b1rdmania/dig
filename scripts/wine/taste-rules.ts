/**
 * taste-rules.ts - what the rule text says a wine must look, smell and taste
 * like. Pure, no I/O. Tests: scripts/wine/__tests__/taste-rules.test.ts
 *
 * One entry point, parseTasteClauses(text, lang), and one shape per language:
 *
 *   fr  A cahier des charges puts it in chapter I, section X "Lien avec la zone
 *       géographique", clause "2°- Informations sur la qualité et les
 *       caractéristiques du produit", which runs to "3°- Interactions causales".
 *       An IGP cahier uses "Spécificité du produit", which runs to "Lien causal".
 *       Prose. Paragraphs split by colour where a paragraph opens "Les vins
 *       blancs ...", or under a centred heading ("Vins tranquilles").
 *   it  A disciplinare puts it in Articolo 6 "Caratteristiche al consumo": one
 *       block per tipologia, each a run of "colore:", "odore:", "sapore:",
 *       "titolo alcolometrico ... minimo:" lines. The tipologia is the heading
 *       above the block («Etna» rosso riserva) or the sentence that introduces
 *       it (Il vino ... «Barolo» tipologia «riserva» ... deve rispondere ...).
 *   es  A pliego puts it under "Características organolépticas". Most give one
 *       block per type with "Vista / Olfato / Boca", "Fase visual / olfativa /
 *       gustativa" or "Aspecto Visual / Olfativo / Gustativo" lines under a
 *       type heading (VINO TINTO RESERVA). The rest describe in prose, split
 *       the French way ("Los vinos tintos ...").
 *
 * The clause is stored verbatim. Nothing is translated here: the Bore's model
 * reads the original at answer time. Minimum alcohol and a sweetness word are
 * read only where the block states them in one unambiguous line.
 */

export type TasteColour = "red" | "white" | "rose" | "sparkling" | "sweet" | "fortified";

export interface TasteClause {
  /** The style as the text labels it, cleaned: "Etna rosso riserva", "Vins blancs", "VINO TINTO RESERVA". null = the text does not split. */
  style: string | null;
  /** Key for the unique constraint: norm of the style, or "all". */
  style_key: string;
  colour: TasteColour | null;
  /** Verbatim, original language, whitespace collapsed inside lines. */
  clause_text: string;
  /** % vol, from a line in the block or the document that states one figure for this style. */
  min_alcohol: number | null;
  /** dry | off-dry | medium-sweet | sweet, or a range ("dry to medium-sweet", "brut nature to demi-sec"). */
  sweetness: string | null;
  /** Which anchor the parser used, for provenance. */
  section: string;
}

export const TASTE_PARSER_VERSION = "taste-rules@1";

const MAX_CLAUSE = 2500;

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

function squash(s: string): string {
  return s.replace(/[ \t\f]+/g, " ").trim();
}

function keyOf(s: string | null): string {
  if (!s) return "all";
  const k = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return k || "all";
}

function num(s: string): number | null {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 5 && n <= 25 ? n : null;
}

/** Colour and style words per language, checked against the label first and the clause second. */
const COLOUR_WORDS: Record<"fr" | "it" | "es", Array<[RegExp, TasteColour]>> = {
  fr: [
    [/\b(mousseux|p[ée]tillants?|cr[ée]mant|effervescents?)\b/i, "sparkling"],
    [/\b(vins? doux naturels?|vdn|liquoreux|moelleux|vendanges tardives|s[ée]lection de grains nobles|vin de paille|rancio)\b/i, "sweet"],
    [/\b(ros[ée]s?|gris)\b/i, "rose"],
    [/\b(blancs?|jaune)\b/i, "white"],
    [/\b(rouges?)\b/i, "red"],
  ],
  it: [
    [/\b(spumante|frizzante|metodo classico)\b/i, "sparkling"],
    [/\b(passito|dolce|vendemmia tardiva|recioto|vin santo|vino santo|liquoroso)\b/i, "sweet"],
    [/\b(rosato|ros[eé]|chiaretto|cerasuolo|kretzer)\b/i, "rose"],
    [/\b(bianco|bianca)\b/i, "white"],
    [/\b(rosso|rossa|nero|novello)\b/i, "red"],
  ],
  es: [
    [/\b(espumosos?|cava|aguja)\b/i, "sparkling"],
    [/\b(generosos?|licorosos?|fino|manzanilla|amontillado|oloroso|palo cortado|rancio|fondillón|fondillon|mistela)\b/i, "fortified"],
    [/\b(dulces?|naturalmente dulce|vendimia tardía|vendimia tardia|moscatel)\b/i, "sweet"],
    [/\b(rosados?|claretes?)\b/i, "rose"],
    [/\b(blancos?)\b/i, "white"],
    [/\b(tintos?)\b/i, "red"],
  ],
};

/** The colour a description states ("robe or pâle", "colore: rosso rubino", "Vista: Púrpura"), when the label does not say. */
const VALUE_WORDS: Record<"fr" | "it" | "es", Array<[RegExp, TasteColour]>> = {
  fr: [
    [/\b(robe|couleur|teinte)\b[^.]{0,40}\b(rose|ros[ée]e?|saumon|[ée]glantine|pelure d'oignon)\b/i, "rose"],
    [/\b(robe|couleur|teinte)\b[^.]{0,40}\b(or|dor[ée]e?|jaune|paille|citron|verts?|p[âa]le)\b/i, "white"],
    [/\b(robe|couleur|teinte)\b[^.]{0,40}\b(rouge|rubis|grenat|pourpre|violac[ée]e?|noire?|sombre|profonde|intense)\b/i, "red"],
  ],
  it: [
    [/\b(rosa|rosato|cerasuolo|chiaretto|ramato)\b/i, "rose"],
    [/\b(giallo|paglierino|dorato|verdolino|ambrato|oro)\b/i, "white"],
    [/\b(rosso|rubino|granato|porpora|violaceo|aranciato)\b/i, "red"],
  ],
  es: [
    [/\b(rosa|rosado|ros[áa]ceo|salm[óo]n|piel de cebolla)\b/i, "rose"],
    [/\b(amarillo|pajizo|dorado|oro|verdoso|verde lim[óo]n|p[áa]lido)\b/i, "white"],
    [/\b(rojo|p[úu]rpura|cereza|picota|granate|rub[íi]|violáceo|violaceo|teja)\b/i, "red"],
  ],
};

function colourFrom(lang: "fr" | "it" | "es", label: string | null, clause: string): TasteColour | null {
  for (const src of [label ?? "", clause.slice(0, 200)]) {
    if (!src) continue;
    for (const [re, c] of COLOUR_WORDS[lang]) if (re.test(src)) return c;
  }
  const head = clause.slice(0, 200);
  for (const [re, c] of VALUE_WORDS[lang]) if (re.test(head)) return c;
  return null;
}

// ---------------------------------------------------------------------------
// French
// ---------------------------------------------------------------------------

/** Page furniture that pdftotext leaves inside the section. */
const FR_NOISE = [
  /^\s*proc[ée]dure nationale d[’']opposition/i,
  /^\s*(aux|relatives aux) vins et aux boissons alcoolis[ée]es/i,
  /^\s*modifications? du cahier des charges/i,
  /^\s*cahier des charges de l[’']appellation/i,
  /^\s*version n°/i,
  /^\s*(g[ée]ographiques prot[ée]g[ée]es|relatives aux vins et aux cidres|d[’']origine relatives)/i,
  /^\s*\d{1,3}\s*(\/\s*\d{1,3})?\s*$/, // page number
  /^\s*et des boissons spiritueuses/i,
  /^\s*(pr[ée]sent[ée]e|approuv[ée]e|adopt[ée]e)s? (au|par le) comit[ée] national/i,
];

const FR_START = [
  { re: /\n[^\n]*informations? sur (?:la qualit[ée] et )?les caract[ée]ristiques d[ue]s? (?:produits?|vins)[^\n]*\n/i, name: "Informations sur la qualité et les caractéristiques du produit" },
  { re: /\n[^\n]*sp[ée]cificit[ée] du produit[^\n]*\n/i, name: "Spécificité du produit" },
];
const FR_END = /\n[^\n]*(interactions? causales?|lien causal|lien entre la sp[ée]cificit[ée]|sp[ée]cificit[ée] de la zone g[ée]ographique|3°\s*-)[^\n]*\n/i;

/** "Les vins blancs ...", "Les vins mousseux de qualité rosés ...", "Le vin jaune ...": the type words straight after "vins". Not "Les vins sont ...". */
const FR_STYLE_OPEN = /^(les|le|la)\s+vins?\s+((?:(?:blancs?|rouges?|ros[ée]s?|gris|mousseux|p[ée]tillants?|tranquilles?|liquoreux|moelleux|secs?|doux|jaune|de paille|effervescents?|de qualit[ée]|naturels?)\b\s*){1,4})/i;
/** A centred heading: short, no full stop, title-case words like "Vins tranquilles", "Vins mousseux de qualité". */
const FR_HEADING = /^\s{4,}(vins?\s[^.:]{2,50}|[A-ZÉ][^.:]{2,40})\s*$/;

/** Words that make a paragraph a taste description rather than a production statistic. */
const FR_TASTE = /\b(robe|ar[ôo]mes?|aromatique|bouche|tanins?|tanniques?|frais|fra[îi]cheur|fruit[ée]s?|floraux?|floral|min[ée]ral|notes?|nez|finale|souples?|ronds?|rondeur|vifs?|vivacit[ée]|puissants?|charpent[ée]s?|[ée]l[ée]gants?|finesse|complexes?|complexit[ée]|persistan|structure|gras|onctu|sucr|moelleux|liquoreux|secs?|douceur|acidit[ée]|couleur|teinte|reflets|bouquet|saveur|mousse|bulles?|garde)\b/i;

export function parseFrenchTaste(text: string): TasteClause[] {
  let start = -1;
  let section = "";
  for (const s of FR_START) {
    const m = s.re.exec(text);
    if (m && m.index >= 0) { start = m.index + m[0].length; section = s.name; break; }
  }
  if (start < 0) return [];
  const endM = FR_END.exec(text.slice(start));
  const end = endM ? start + (endM.index ?? 0) : Math.min(text.length, start + 12000);
  const body = text.slice(start, end);
  if (body.length > 20000) return [];

  const lines = body.split("\n").filter((l) => !FR_NOISE.some((re) => re.test(l)));
  // Paragraphs: blank-line separated, or a centred heading on its own line.
  type Para = { heading: string | null; text: string };
  const paras: Para[] = [];
  let heading: string | null = null;
  let cur: string[] = [];
  const flush = () => { if (cur.length) { paras.push({ heading, text: squash(cur.join(" ")) }); cur = []; } };
  for (const raw of lines) {
    const line = raw.replace(/\f/g, "");
    if (!line.trim()) { flush(); continue; }
    if (FR_HEADING.test(line) && !cur.length) { flush(); heading = squash(line); continue; }
    cur.push(line.trim());
  }
  flush();

  // Group paragraphs by style. A paragraph opens a style when it starts "Les vins blancs ..." or sits under a heading.
  const out: TasteClause[] = [];
  let current: { style: string | null; parts: string[] } | null = null;
  for (const p of paras) {
    if (!FR_TASTE.test(p.text) && p.text.length < 400) continue; // a production figure or a one-line aside
    const open = FR_STYLE_OPEN.exec(p.text);
    const style = p.heading ?? (open ? `vins ${squash(open[2])}` : null);
    const key = style ? keyOf(style) : null;
    if (!current || (key && key !== keyOf(current.style))) {
      if (current) out.push(...emit(current.style, current.parts, "fr", section));
      current = { style, parts: [p.text] };
    } else {
      current.parts.push(p.text);
    }
  }
  if (current) out.push(...emit(current.style, current.parts, "fr", section));

  // Minimum alcohol from the document, when it states one figure or one per colour.
  const alc = frenchMinAlcohol(text);
  for (const c of out) {
    const hit = alc.find((a) => a.colour === c.colour) ?? (alc.length === 1 && alc[0].colour === null ? alc[0] : null);
    if (hit) c.min_alcohol = hit.value;
    c.sweetness = frenchSweetness(c.clause_text);
  }
  return dedupeKeys(out);
}

const FR_ALC = /titre alcoom[ée]trique volumique naturel minimum\s+(?:de|est fix[ée] [àa])\s+(\d{1,2}(?:[.,]\d)?)\s*%(?:\s+(?:pour les|les)\s+vins\s+(blancs|rouges|ros[ée]s))?/gi;

function frenchMinAlcohol(text: string): Array<{ colour: TasteColour | null; value: number }> {
  const flat = text.replace(/\s+/g, " ");
  const found: Array<{ colour: TasteColour | null; value: number }> = [];
  for (const m of flat.matchAll(FR_ALC)) {
    const v = num(m[1]);
    if (v === null) continue;
    const colour = m[2] ? colourFrom("fr", m[2], "") : null;
    if (!found.some((f) => f.colour === colour && f.value === v)) found.push({ colour, value: v });
  }
  // Several figures with no colour label: the document does not say which applies to what.
  const unlabelled = found.filter((f) => f.colour === null);
  if (unlabelled.length > 1) return found.filter((f) => f.colour !== null);
  return found;
}

/** Only what the clause states of the wine itself: a mention of vendanges tardives in an aside is not a sweetness. */
function frenchSweetness(clause: string): string | null {
  const head = clause.slice(0, 300);
  if (/\bvins?\s+(?:\w+\s+)?(liquoreux|doux naturels?|moelleux)\b|\bsont (?:des vins )?(liquoreux|moelleux|doux)\b/i.test(head)) return "sweet";
  if (/\bvins?\s+demi-secs?\b/i.test(head)) return "off-dry";
  if (/\bvins?\s+(?:\w+\s+)?secs?\b|\bvin blanc sec\b|\bsont secs\b|\bsont des vins secs\b/i.test(clause)) return "dry";
  return null;
}

// ---------------------------------------------------------------------------
// Italian
// ---------------------------------------------------------------------------

const IT_KEY = /^\s*(?:[-–•]\s*){0,2}(spuma|colore|odore|profumo|sapore|gusto|titolo alcolometrico[^:]*|acidit[àa] totale[^:]*|estratto[^:]*|zuccher[^:]*|acidit[àa] volatile[^:]*|anidride carbonica[^:]*|sovrappressione[^:]*|pressione[^:]*|residuo zuccherino[^:]*)\s*:/i;
const IT_COLORE = /^\s*(?:[-–•]\s*){0,2}colore\s*:/i;
const IT_SPUMA = /^\s*(?:[-–•]\s*){0,2}spuma\s*:/i;
const IT_INTRO = /\b(?:il vino|i vini|la tipologia|le tipologie|la denominazione)\b[^\n]*?\b(?:deve|devono)\s+(?:rispondere|presentare|avere)\b[^\n]*?caratteristiche\s*[:;.]?\s*$/i;
const IT_ARTICLE = /^\s*(articolo|art\.)\s*\d+/i;

function cleanItalianLabel(s: string): string | null {
  let t = squash(s.replace(/\f/g, ""));
  t = t.replace(/^\s*(\d+[.)]|[a-z][.)]|[-–•])\s*/i, "");
  t = t.replace(/\b(il|i)\s+vin[oi]\s+(a|ad)\s+denominazione\s+di\s+origine\s+controllata(\s+e\s+garantita)?\b/i, "")
    .replace(/\b(il|i)\s+vin[oi]\s+a\s+d\.?o\.?c\.?g?\.?\b/i, "")
    .replace(/\b(il|i)\s+vin[oi]\s+(a|ad)\s+indicazione\s+geografica\s+(tipica|protetta)\b/i, "")
    .replace(/\ball[’']atto\s+dell[’']immissione\s+al\s+consumo\b/i, "")
    .replace(/\b(deve|devono)\s+(rispondere|presentare|avere)\b.*$/i, "")
    .replace(/\b(designat[oi]|con la (?:menzione|specificazione|indicazione)|tipologia|nella tipologia|nelle tipologie|con (?:le|la|i|il) (?:riferiment[oi]|menzion[ei]|specificazion[ei]))\b/gi, " ")
    .replace(/[«»“”"']/g, " ");
  t = squash(t).replace(/\s+,/g, ",").replace(/^[\s,:;.]+/, "").replace(/[\s,:;.]+$/, "").replace(/\s*,\s*,+/g, ",");
  if (!t || /\b(ufficio|ministero|disciplinare|pqa|dgpqa|gazzetta|decreto)\b/i.test(t)) return null;
  return t.length > 90 ? t.slice(0, 90) : t;
}

export function parseItalianTaste(text: string): TasteClause[] {
  const lines = text.split("\n");
  const out: TasteClause[] = [];
  let i = 0;
  let prevEnd = 0; // line index after the previous block
  while (i < lines.length) {
    if (!IT_COLORE.test(lines[i]) && !(IT_SPUMA.test(lines[i]) && lines.slice(i + 1, i + 4).some((l) => IT_COLORE.test(l)))) { i++; continue; }
    // Block: key lines and their wrapped continuations.
    const block: string[] = [];
    let j = i;
    let lastKey = -1;
    while (j < lines.length) {
      const line = lines[j].replace(/\f/g, "");
      if (IT_KEY.test(line)) { block.push(line.trim()); lastKey = j; j++; continue; }
      if (!line.trim()) {
        // A blank, then another key line: still the block. A blank then prose: done.
        const next = lines.slice(j + 1, j + 3).find((l) => l.trim());
        if (next && IT_KEY.test(next) && !IT_COLORE.test(next) && !IT_SPUMA.test(next)) { j++; continue; }
        break;
      }
      if (IT_ARTICLE.test(line) || /^\s*\d+[.)]\s+\S/.test(line) || /^\s*\d{1,3}\s*$/.test(line)) break;
      // Continuation of a wrapped key line.
      if (lastKey >= 0 && block.length && !/[;.]\s*$/.test(block[block.length - 1])) { block[block.length - 1] += ` ${line.trim()}`; j++; continue; }
      break;
    }
    // Label: the introduction between the previous block and this one.
    const pre = lines.slice(Math.max(prevEnd, i - 12), i).map((l) => l.replace(/\f/g, "")).filter((l) => l.trim() && !/^\s*\d{1,3}\s*$/.test(l));
    let label: string | null = null;
    const preFlat = squash(pre.join(" "));
    const intro = IT_INTRO.exec(preFlat);
    if (intro) {
      label = cleanItalianLabel(preFlat.slice(intro.index));
    } else {
      const last = pre[pre.length - 1];
      if (last && last.trim().length <= 70 && !/[.;]\s*$/.test(last.trim())) label = cleanItalianLabel(last);
    }
    const clause = block.map(squash).join("\n");
    const c: TasteClause = {
      style: label, style_key: keyOf(label), colour: null, clause_text: clause.slice(0, MAX_CLAUSE),
      min_alcohol: italianMinAlcohol(clause), sweetness: italianSweetness(clause), section: "Caratteristiche al consumo",
    };
    c.colour = colourFrom("it", label, colourLine(clause));
    out.push(c);
    prevEnd = j;
    i = Math.max(j, i + 1);
  }
  return dedupeKeys(out);
}

function colourLine(clause: string): string {
  const m = /colore\s*:\s*([^\n]*)/i.exec(clause);
  return m ? m[1] : "";
}

const IT_ALC = /titolo alcolometrico volumico[^:\n]*minimo[^:\n]*:\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i;
function italianMinAlcohol(clause: string): number | null {
  const m = IT_ALC.exec(clause);
  return m ? num(m[1]) : null;
}

const IT_SWEET: Array<[RegExp, string]> = [
  [/\bsecco\b|\basciutto\b/i, "dry"], [/\babboccato\b/i, "off-dry"], [/\bamabile\b/i, "medium-sweet"], [/\bdolce\b/i, "sweet"],
  [/\bpas dos[ée]\b|\bdosaggio zero\b|\bbrut nature\b/i, "brut nature"], [/\bextra brut\b/i, "extra brut"], [/\bbrut\b/i, "brut"],
  [/\bextra ?dry\b/i, "extra dry"], [/\bdry\b/i, "dry (sparkling)"], [/\bdemi[- ]sec\b/i, "demi-sec"],
];
function italianSweetness(clause: string): string | null {
  const m = /(?:sapore|gusto)\s*:\s*([^\n]*)/i.exec(clause);
  if (!m) return null;
  const v = m[1];
  const range = /\bda\s+([a-z ]+?)\s+(?:a|ad|al|all[’'])\s+([a-z\- ]+?)(?:[,;.]|$)/i.exec(v);
  if (range) {
    const a = IT_SWEET.find(([re]) => re.test(range[1]))?.[1];
    const b = IT_SWEET.find(([re]) => re.test(range[2]))?.[1];
    if (a && b) return `${a} to ${b}`;
  }
  const hit = IT_SWEET.find(([re]) => re.test(v));
  return hit ? hit[1] : null;
}

// ---------------------------------------------------------------------------
// Spanish
// ---------------------------------------------------------------------------

const ES_ORG = /organol[ée]ptic/i;
/** A heading, not a sentence: short, at most ten words, numbered or starting in capitals, naming the organoleptic section. */
function spanishHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90 || !ES_ORG.test(t)) return false;
  const words = t.split(/\s+/).length;
  if (words > 10) return false;
  return /^(?:\(?[a-z\d]{1,3}[.)]\s*)+/i.test(t) || t === t.toUpperCase() || /^[A-ZÁÉÍÓÚÑ]/.test(t);
}
const ES_NUMBERED = /^\s*(?:(?:\d+[.)]?\s?)+|[a-z][.)]|[ivx]{1,4}[.)])\s*[-–]?\s+(.*)$/i;
/** A numbered heading in capitals that names a wine type is a style label inside the section, not its end. */
const ES_TYPE_WORD = /\b(VINOS?|TINTOS?|BLANCOS?|ROSADOS?|CLARETES?|ESPUMOSOS?|LICOR|DULCES?|CRIANZA|RESERVA|J[ÓO]VEN(ES)?|GENEROSOS?|RANCIOS?|AGUJA|FASE|ASPECTO|VISTA|OLFATO|BOCA)\b/;
const ES_END_WORDS = /^(pr[áa]cticas\s+(enol[óo]gicas|de cultivo|vit[íi]colas|espec[íi]ficas)|delimitaci[óo]n|zona geogr[áa]fica|rendimiento|variedades?\s+de\s+(uva|vid)|v[íi]nculo|elementos que justifican|estructura de control|requisitos aplicables|etiquetado|normas? de etiquetado|caracter[íi]sticas anal[íi]ticas|par[áa]metros anal[íi]ticos)/i;
const ES_KEY = /^\s*(?:[-–•·]\s*){0,2}(?:\(?[\d.]{1,7}\)?\s+|[a-z][.)]\s+)?(vista|fase visual|aspecto visual|visual|olfato|nariz|fase olfativa|aspecto olfativo|olfativa|olfativo|boca|gusto|fase gustativa|aspecto gustativo|gustativa|gustativo)\b\s*[:.]?/i;
const ES_TABLE_HEAD = /^\s*fase\s+descripci[óo]n\s*$/i;
const ES_TABLE_TOKEN = /^\s*(fase\s+visual|fase\s+olfativa|fase\s+gustativa|fase|visual|olfativa|gustativa)\b\s*/i;
const ES_STYLE_OPEN = /^(los|el|las|la)\s+vinos?\s+(?:[\w\- ]{0,30}?)(tintos?|blancos?|rosados?|claretes?|espumosos?|dulces?|generosos?|licorosos?|de licor|de aguja|jóvenes|j[óo]venes)\b/i;
const ES_TASTE = /\b(color|aroma|olor|sabor|burbuja|frescura|arom[áa]tic|boca|nariz|tanin|fresc|frut|flor|equilibr|estructur|persisten|untuos|ácid|acid|amargo|dulz|sabor|limpio|brillante|capa|ribete|tonos?|notas?|recuerdos?|especi|madera|crianza)\b/i;

/** The section ends at the next numbered heading in capitals ("3. PRÁCTICAS ESPECÍFICAS") or a known heading word. */
function spanishSectionEnd(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90 || ES_KEY.test(line)) return false;
  const n = ES_NUMBERED.exec(t);
  const rest = n ? n[1] : t;
  if (ES_END_WORDS.test(rest)) return true;
  if (n && rest.length >= 8 && rest === rest.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3}/.test(rest) && rest.split(/\s+/).length >= 2 && !ES_TYPE_WORD.test(rest)) return true;
  return false;
}

function keyFamily(line: string): "v" | "o" | "g" | null {
  const k = ES_KEY.exec(line)?.[1]?.toLowerCase();
  if (!k) return null;
  return /vis/.test(k) ? "v" : /olf|nariz/.test(k) ? "o" : "g";
}

export function parseSpanishTaste(text: string): TasteClause[] {
  const lines = text.split("\n").map((l) => l.replace(/\f/g, ""));
  // Anchor: the first heading-like line that names the organoleptic section.
  let start = lines.findIndex((l) => spanishHeading(l));
  if (start < 0) start = lines.findIndex((l) => ES_ORG.test(l));
  if (start < 0) return [];
  const section = squash(lines[start]).slice(0, 80);
  let end = Math.min(lines.length, start + 400);
  for (let k = start + 1; k < end; k++) if (spanishSectionEnd(lines[k])) { end = k; break; }
  const body = lines.slice(start + 1, end).filter((l) => !/^\s*\d{1,3}\s*$/.test(l) && !/^\s*p[áa](x|g)ina\s+\d+/i.test(l) && !/^\s*pliego de condiciones/i.test(l));

  type Block = { label: string | null; lines: string[]; prose: boolean };
  const blocks: Block[] = [];
  let pendingLabel: string | null = null;
  let cur: Block | null = null;
  let tableMode = false;
  let tableSeenG = false;
  const nextNonEmpty = (k: number) => body.slice(k + 1, k + 4).find((l) => l.trim()) ?? "";
  const stripEnum = (t: string) => t.replace(/^(?:\(?(?:\d+(?:\.\s?\d+)*|[a-z]|[ivx]{1,4})(?:[.)\-–]+\s*|\s+))+/i, "");
  const isLabel = (k: number) => {
    const t = stripEnum(body[k].trim());
    if (!t || t.length > 100 || !/^[«"“]?[A-ZÁÉÍÓÚÑ]/.test(t) || /[,;]\s*$/.test(t) || ES_KEY.test(t)) return false;
    if (t === t.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3}/.test(t)) return true;
    if (t.length > 60) return false;
    const nxt = nextNonEmpty(k);
    return /:\s*$/.test(t) || ES_KEY.test(nxt) || ES_TABLE_HEAD.test(nxt) || (ES_NUMBERED.test(body[k].trim()) && t.length <= 40);
  };
  const open = (label: string | null, prose: boolean) => { cur = { label, lines: [], prose }; blocks.push(cur); pendingLabel = null; };

  for (let k = 0; k < body.length; k++) {
    const line = body[k];
    const t = line.trim();
    if (ES_TABLE_HEAD.test(line)) { tableMode = true; tableSeenG = false; open(pendingLabel, false); continue; }
    if (tableMode) {
      if (!t) continue;
      if (!/^\s/.test(line) && isLabel(k)) { tableMode = false; }
      else {
        const m = ES_TABLE_TOKEN.exec(line);
        let rest = t;
        let marker = "";
        if (m) {
          rest = t.slice(m[0].trim().length).trim();
          const tok = m[1].toLowerCase();
          if (/visual/.test(tok)) marker = "Fase visual: ";
          else if (/olfativa/.test(tok) && /^fase/.test(tok)) marker = "Fase olfativa: ";
          else if (tok === "fase" || /gustativa/.test(tok)) { if (!tableSeenG) { marker = "Fase gustativa: "; tableSeenG = true; } }
        }
        if (!rest && !marker) continue;
        if (cur && (marker || !cur.lines.length)) cur.lines.push(`${marker}${rest}`);
        else if (cur) cur.lines[cur.lines.length - 1] += ` ${rest}`;
        continue;
      }
    }
    if (!t) continue; // prose under a label runs to the next label or key line
    if (ES_KEY.test(line)) {
      const fam = keyFamily(line);
      if (!cur || cur.prose || cur.lines.some((x) => keyFamily(x) === fam)) open(pendingLabel, false);
      (cur as Block).lines.push(t);
      continue;
    }
    if (isLabel(k)) { pendingLabel = stripEnum(t).replace(/[:.]\s*$/, ""); cur = null; continue; }
    // Not a key, not a label: the rest of a wrapped label, a wrapped key line, or prose under a label.
    if (pendingLabel && cur === null && /^[a-záéíóúñ(]/.test(t) && t.length <= 60) { pendingLabel = `${pendingLabel} ${t.replace(/[:.]\s*$/, "")}`; continue; }
    if (cur && !cur.prose && cur.lines.length) { cur.lines[cur.lines.length - 1] += ` ${t}`; continue; }
    if (cur?.prose) { cur.lines.push(t); continue; }
    if (pendingLabel) { open(pendingLabel, true); (cur as Block).lines.push(t); }
  }

  const out: TasteClause[] = [];
  for (const b of blocks) {
    const clause = b.prose ? squash(b.lines.join(" ")) : b.lines.map(squash).join("\n");
    if (b.prose ? (!ES_TASTE.test(clause) || clause.length < 40) : b.lines.length < 2) continue;
    const label = b.label ? squash(b.label).slice(0, 90) : null;
    out.push({
      style: label, style_key: keyOf(label), colour: colourFrom("es", label, clause), clause_text: clause.slice(0, MAX_CLAUSE),
      min_alcohol: spanishMinAlcohol(clause), sweetness: spanishSweetness(label, clause), section,
    });
  }
  if (out.length) return dedupeKeys(out);

  // Prose fallback: paragraphs, split where one opens "Los vinos tintos ...".
  const paras: string[] = [];
  let acc: string[] = [];
  for (const line of body) {
    if (!line.trim()) { if (acc.length) { paras.push(squash(acc.join(" "))); acc = []; } continue; }
    acc.push(line.trim());
  }
  if (acc.length) paras.push(squash(acc.join(" ")));
  let current: { style: string | null; parts: string[] } | null = null;
  for (const p of paras) {
    if (!ES_TASTE.test(p) && p.length < 400) continue;
    const o = ES_STYLE_OPEN.exec(p);
    const style = o ? squash(o[0]).replace(/^(los|el|las|la)\s+/i, "") : null;
    const key = style ? keyOf(style) : null;
    if (!current || (key && key !== keyOf(current.style))) {
      if (current) out.push(...emit(current.style, current.parts, "es", section));
      current = { style, parts: [p] };
    } else current.parts.push(p);
  }
  if (current) out.push(...emit(current.style, current.parts, "es", section));
  for (const c of out) { c.min_alcohol = spanishMinAlcohol(c.clause_text); c.sweetness = spanishSweetness(c.style, c.clause_text); }
  return dedupeKeys(out);
}

const ES_ALC = /grado alcoh[óo]lico[^\n]{0,60}m[íi]nimo[^\n]{0,20}?(\d{1,2}(?:[.,]\d)?)\s*%?\s*vol/i;
function spanishMinAlcohol(clause: string): number | null {
  const m = ES_ALC.exec(clause);
  return m ? num(m[1]) : null;
}

function spanishSweetness(label: string | null, clause: string): string | null {
  const src = `${label ?? ""} ${clause.slice(0, 200)}`;
  if (/\bsemi ?dulce\b|\bsemidulce\b/i.test(src)) return "medium-sweet";
  if (/\bsemi ?seco\b|\bsemiseco\b/i.test(src)) return "off-dry";
  if (/\bdulces?\b/i.test(src)) return "sweet";
  if (/(?<!frutos? )(?<!frutas )\bsecos?\b/i.test(src)) return "dry";
  return null;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function emit(style: string | null, parts: string[], lang: "fr" | "it" | "es", section: string): TasteClause[] {
  const clause = parts.join("\n").slice(0, MAX_CLAUSE);
  if (clause.length < 40) return [];
  return [{ style, style_key: keyOf(style), colour: colourFrom(lang, style, clause), clause_text: clause, min_alcohol: null, sweetness: null, section }];
}

/** A repeated block (same style, same text) is dropped; two blocks with the same style and different text keep distinct keys. */
function dedupeKeys(cs: TasteClause[]): TasteClause[] {
  const seen = new Map<string, number>();
  const out: TasteClause[] = [];
  const texts = new Set<string>();
  for (const c of cs) {
    const sig = `${c.style_key}|${c.clause_text}`;
    if (texts.has(sig)) continue;
    texts.add(sig);
    const n = (seen.get(c.style_key) ?? 0) + 1;
    seen.set(c.style_key, n);
    out.push(n === 1 ? c : { ...c, style_key: `${c.style_key} ${n}` });
  }
  return out;
}

export function parseTasteClauses(raw: string, lang: "fr" | "it" | "es"): TasteClause[] {
  // pdftotext keeps non-breaking spaces; the anchors are written with plain ones.
  // Symbol-font bullets come through as private-use code points (U+F02D in Recioto di Gambellara).
  const text = raw.normalize("NFC").replace(/[\u00a0\u2007\u202f]/g, " ").replace(/[\ue000-\uf8ff]/g, "-");
  if (lang === "fr") return parseFrenchTaste(text);
  if (lang === "it") return parseItalianTaste(text);
  return parseSpanishTaste(text);
}
