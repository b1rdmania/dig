/**
 * text.ts - the one normalisation (ledger rule 1). No imports, so every pure
 * module and test can use it. lib.ts re-exports both functions.
 */

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
