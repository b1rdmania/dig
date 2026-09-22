# Wine Bore taste clauses - 22 September 2026

Branch `winebore-taste-2026-09-22`, from `main` at `14ba68b`. Local Docker Postgres only.
Prod is not touched. Every number below comes from a command that ran in this session,
and the command is given with the number.

Shorthand: `psql` = `docker exec -i dig-baby-mvp-postgres-1 psql -U dig -d dig -Atc`.
The loader runs as `DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/load-appellation-taste.ts`.

## What was done

The 1,080 rule texts in `wine.appellation_documents` (412 cahiers des charges, 521
disciplinari, 147 pliegos) each carry, in most cases, an organoleptic clause: what the
rules say the wine must look, smell and taste like. Before tonight the Bore could reach
it only through a free-text `q` on `get_appellation`, which returns three fragments of
200,000 characters and no structure.

Tonight's job reads that clause out of each text with code, per colour and style where
the text splits it, and stores it verbatim in its own language with the document it
came from. Nothing is translated: the Bore's model reads the French, Italian or Spanish
at answer time, as it already does for the yield clauses. No model was called for the
extraction. The only model spend is the eval run at the end.

- Migration 036: `wine.appellation_taste` (appellation_id, doc_source, doc_source_ref,
  source_document_id, style, style_key, colour, language, clause_text, min_alcohol,
  sweetness, provenance). Additive. `pnpm audit:migrations` passes.
- `scripts/wine/taste-rules.ts`: the parser. Pure, no I/O. One entry point per language.
- `scripts/wine/load-appellation-taste.ts`: the loader. Runs after
  `load-appellation-documents`. Upserts on `(appellation_id, doc_source, doc_source_ref,
  style_key)` and deletes rows the parser no longer produces, so ids hold across a
  reload. Checked: two runs on the loaded corpus give the same `count(*)`, `sum(id)`,
  `min(id)` and `max(id)` (5646 / 15941481 / 1 / 5646 on the first pass).
- `packages/domain/src/wine.ts`: `getAppellation` returns `taste[]` (up to 12 rows, base
  styles first, then riserva / superiore / crianza / premier cru).
- `apps/api/src/routes/v1/ask/wine-bore.ts`: `get_appellation` returns
  `what_the_rules_say_it_tastes_like` (see "Tool contract"). The routing note in the
  tool rules names the block. The persona file is untouched.
- Tests: `scripts/wine/__tests__/taste-rules.test.ts` (14, on real clauses from FR, IT
  and ES) and four `shapeTaste` tests in `apps/api/src/__tests__/wine-bore.test.ts`.
- `ops/reload-winebore-data.sh`: migration 036 in step 0, step 6b
  `load-appellation-taste.ts` after `load-rule-facts.ts`, `ANALYZE wine.appellation_taste`,
  and a check line for the Chablis grand cru clause. `bash -n` clean. Not run.
- `scripts/wine/join-report.ts`: a "Taste clauses" table and the `appellation_taste`
  row count. Report regenerated.
- Eval: 20 questions in group `taste` (15 the clause settles, 5 traps where the book
  holds no clause). Full run: `docs/wine-bore-eval-2026-09-22.md`.

## Parser rules per language

The three ministries write the clause in three shapes. Each language has one anchor,
one end, and one way of splitting styles. A document that does not match yields nothing;
the tool then omits the block and the persona's "the book doesn't hold it" line covers it.

### French (INAO cahiers des charges)

- Anchor: the clause "Informations sur la qualité et les caractéristiques du produit"
  (also "des produits", "des vins", and "Informations sur les caractéristiques du produit")
  inside chapter I, section X "Lien avec la zone géographique". An IGP cahier uses
  "Spécificité du produit".
- End: "Interactions causales", "Lien causal", or the next "3°-" heading.
- Page furniture is dropped line by line: "Procédure nationale d'opposition ...",
  "Modification du cahier des charges ...", "Version n°", page numbers.
- Styles: a paragraph that opens "Les vins blancs / rouges / rosés / mousseux / pétillants
  / tranquilles / liquoreux ..." opens a style; a centred heading ("Vins tranquilles",
  "Vins mousseux de qualité") opens one too. Paragraphs with no such opening stay with
  the current style, or with the whole appellation when none is open ("Le « Chablis
  grand cru » est un vin blanc sec ..."). "Les vins sont ..." is not a style.
- A paragraph with no taste word (robe, arômes, bouche, tanins, frais, fruité, notes,
  finale, structure, garde ...) and under 400 characters is a production figure, not a
  description, and is skipped.
- Colour: from the style words, else from "robe / couleur / teinte ... or pâle / rubis /
  rose". 95 of 586 French clauses have no colour (Côtes du Rhône: "Les vins sont des vins
  tranquilles et secs").
- Minimum alcohol: from the document, "titre alcoométrique volumique naturel minimum de
  11,5 %", when it states one figure or one per colour. 140 clauses carry it.
- Sweetness: "dry" from "vins secs" / "vin blanc sec"; "sweet" from "vins liquoreux /
  doux naturels / moelleux" as a statement of the wine, not from a mention of vendanges
  tardives in an aside.

### Italian (MASAF disciplinari)

- Anchor: every block of key lines "colore:", "odore:" (or "profumo:"), "sapore:" (or
  "gusto:"), "titolo alcolometrico ... minimo:", "acidità totale minima:", "estratto non
  riduttore minimo:", "spuma:", "zuccheri ...". These sit in Articolo 6 "Caratteristiche
  al consumo". Up to two bullets before the key are allowed ("- - colore:", Copertino), and
  a Symbol-font bullet that pdftotext writes as U+F02D is treated as a bullet (Recioto di
  Gambellara).
- A wrapped key line is joined to its key; a page number or the next "Articolo" ends the
  block.
- Style: the heading above the block («Etna» rosso riserva, “Prosecco” spumante:), or the
  sentence that introduces it ("Il vino a denominazione di origine controllata e garantita
  «Barolo» tipologia «riserva», all'atto dell'immissione al consumo, deve rispondere alle
  seguenti caratteristiche:"), with the boilerplate stripped. A label that is page furniture
  ("UFFICIO PQA I") is dropped.
- Colour: from the style words (bianco, rosso, rosato, spumante, frizzante, passito,
  dolce, vendemmia tardiva ...), else from the "colore:" value (giallo, paglierino, rubino,
  granato, rosa ...). 9 of 4,354 Italian clauses have no colour ("colore: caratteristico
  del vitigno").
- Minimum alcohol: the block's own "titolo alcolometrico volumico totale minimo: 13,00% vol".
  3,600 clauses carry it.
- Sweetness: from "sapore:": secco / asciutto = dry, abboccato = off-dry, amabile =
  medium-sweet, dolce = sweet; a range "da secco ad amabile" is kept as a range; for a
  spumante "da brut nature a demi-sec" is kept as printed.

### Spanish (MAPA pliegos)

- Anchor: a heading (at most ten words, numbered, in capitals or starting with a capital)
  that contains "organoléptic": "b. CARACTERÍSTICAS ORGANOLÉPTICAS", "2.2. Características a
  determinar mediante un análisis organoléptico:", "2. 1. - CARACTERÍSTICAS ORGANOLÉPTICAS".
  When no heading matches, the first mention.
- End: a heading word (prácticas enológicas, delimitación, zona geográfica, rendimiento,
  variedades, vínculo, etiquetado ...) or a numbered heading in capitals that does not
  name a wine type ("3. PRÁCTICAS ESPECÍFICAS", not "1. VINOS TINTOS"). Hard cap 400 lines.
- Styles, three layouts:
  1. Key lines "Vista / Olfato / Boca", "Fase visual / olfativa / gustativa", "Aspecto
     Visual / Olfativo / Gustativo" (with or without a numbering such as "1.1.1 Fase
     Visual" and the text on the next line) under a type label. A label is a short line
     in capitals ("VINO TINTO RESERVA"), one ending in ":" ("a) Vino blanco:"), or one
     followed by a key line or a table header ("Rías Baixas tinto"). A wrapped label is
     joined.
  2. The two-column "Fase | Descripción" table (Rías Baixas): the description column is
     kept in reading order and the key words are re-inserted as "Fase visual:", "Fase
     olfativa:", "Fase gustativa:" where the table prints them.
  3. Prose under a label (Rioja's "VINO ESPUMOSO DE CALIDAD"), or prose paragraphs split
     the French way ("Los vinos tintos ...") when the pliego has no key lines at all.
- Colour: from the label (tinto, blanco, rosado, espumoso, dulce, generoso, rancio,
  mistela ...), else from the description ("Vista: Púrpura", "amarillo pajizo"). Aroma
  words are not colours: "fresa" is not rosé.
- Minimum alcohol: only from a "grado alcohólico ... mínimo ... 12 % vol" line inside the
  block (23 clauses). Most pliegos put the figure in an analytical table the parser does
  not read.
- Sweetness: from the label or the first 200 characters: seco = dry, semiseco = off-dry,
  semidulce = medium-sweet, dulce = sweet. "frutos secos" (dried fruit) is not dry.

## Tool contract

`get_appellation` now carries, when the book holds a clause:

```
what_the_rules_say_it_tastes_like: {
  note: "Verbatim from the rule document, in its own language. ...",
  styles: [
    { applies_to: "Etna rosso", colour_or_style: "red",
      rule_text: "colore: rosso rubino con riflessi granato con l'invecchiamento;\nodore: intenso, caratteristico;\nsapore: secco, caldo, robusto, pieno, armonico; ...",
      language: "Italian", min_alcohol_pct: 12.5, sweetness: "dry",
      cited_from: "disciplinare \"Etna\" (document 10727)" },
    ...
  ],
  more_styles_in_the_book: 4        // only when more than eight styles exist
}
```

Caps: eight styles, 520 characters of rule text each, so the block is at most about 1,200
tokens beside the rest of the card. `publicMaxTokens` in the bore config is 600 and
governs the answer, not the tool result; the loop's context holds the card. The field is
absent when no clause parsed, so the existing "the book doesn't hold it" behaviour covers
the gap.

## Coverage

Query for the first table: `select d.source, count(*), count(*) filter (where d.appellation_id is not null), count(*) filter (where exists (select 1 from wine.appellation_taste t where t.source_document_id = d.id)) from wine.appellation_documents d group by 1`.

| Source | Documents | Attached to an appellation | Yield a clause | Rate of attached |
|---|---|---|---|---|
| INAO (FR) | 412 | 406 | 383 | 94.3% |
| MASAF (IT) | 521 | 519 | 508 | 97.9% |
| MAPA (ES) | 147 | 147 | 143 | 97.3% |
| All | 1,080 | 1,072 | 1,034 | 96.5% |

Appellations with taste text, by country (of those with a document attached). Query:
`select a.country, count(distinct a.id), count(distinct t.appellation_id) from wine.appellations a join wine.appellation_documents d on d.appellation_id = a.id left join wine.appellation_taste t on t.appellation_id = a.id group by 1`.

| Country | Appellations with a document | With taste text |
|---|---|---|
| FR | 406 | 383 |
| IT | 519 | 508 |
| ES | 147 | 143 |

Clauses (one row per appellation, document and style): 5,675. Query:
`select coalesce(colour, 'unknown'), count(*) from wine.appellation_taste group by 1 order by 2 desc`.

| Colour or style | Clauses | FR | IT | ES |
|---|---|---|---|---|
| red | 1,957 | 175 | 1,542 | 240 |
| white | 1,595 | 202 | 1,217 | 176 |
| sparkling | 802 | 22 | 728 | 52 |
| rose | 581 | 84 | 390 | 107 |
| sweet | 526 | 8 | 468 | 51 |
| fortified | 16 | 0 | 0 | 16 |
| unknown | 198 | 95 | 9 | 93 |

(The by-country split is from the same query grouped by `a.country`, run before the last
Muscat fix added two French rows; the totals column is current.)

Styles per appellation: 356 appellations have one clause, 344 have two to four, 152 have
five to eight, 180 have more than eight (the tool shows eight and says how many more; the
most is 125, Alto Adige). Query: `select count(*) filter (where n=1), ... from (select appellation_id, count(*) n from wine.appellation_taste group by 1) x`.

Minimum alcohol filled: 3,823 of 5,675. Sweetness filled: 3,699 of 5,675.

## Famous appellations with no clause, and why

Query: `select a.name, a.country, count(w.lwin), (select count(*) from wine.appellation_documents d where d.appellation_id = a.id) from wine.appellations a join wine.wines w on w.appellation_id = a.id and w.status = 'Live' where not exists (select 1 from wine.appellation_taste t where t.appellation_id = a.id) and a.country in ('FR','IT','ES') group by a.id order by 3 desc limit 40`,
then each miss read by hand.

1. **No cahier attached at all** (the 33 French PDOs from the 21 Sep audit; INAO's product
   page gives no PDF, Légifrance answers 403 to a script): Chassagne-Montrachet (1,126 Live
   wines), Beaune (877), Châteauneuf-du-Pape (868), Chambolle-Musigny (803), Savigny-lès-Beaune
   (602), Saint-Aubin (473), Pernand-Vergelesses (260), Auxey-Duresses (224), Monthélie (219),
   Côtes du Roussillon (158), Bâtard-Montrachet (137), Maranges (135), Maury (84), Premières
   Côtes de Bordeaux (59), Limoux (54), Irancy (46), Bienvenues-Bâtard-Montrachet (39).
   Cava (346) has no pliego in the MAPA pull (`mapa/text/cava.txt` is empty).
2. **Cahier attached, but its "Lien à l'origine" is an empty heading.** The 2010 and 2011
   INAO texts for the Burgundy grands crus print the section title and nothing under it:
   La Tâche, Richebourg, Musigny, Montrachet, Corton, Charlemagne, Echezeaux, La Romanée,
   La Grande Rue, Santenay. The same year's "Lien avec la zone géographique" with empty
   sub-headings: Rully, Montagny, Juliénas, Bourgogne Passe-tout-grains. Nothing to parse;
   a newer cahier would fix it. La Tâche and Musigny are eval traps for this reason.
3. **Text missing or too short** (scanned PDF): Saint-Julien (6,563 characters), Muscat du
   Cap Corse (3,666), Vin de Corse (7,421), Loupiac (4,874), Ajaccio (3,782).
4. **Article 6 is analytics only.** Marsala lists alcohol, extract and acidity per type and
   no colore / odore / sapore. The Veneto IGTs (Veneto, Trevenezie, Verona, Marca Trevigiana,
   Alto Livenza, Colli Trevigiani, Conselvano, Veneto Orientale, Colleoni) list per-variety
   analytics the same way. Candia dei Colli Apuani too.
5. **Parse failed on a layout the parser does not read**: Estaing (unusual section order),
   Côtes de la Charité and Île-de-France (IGP, no "Spécificité du produit"), Castilla
   ("no defects" is the whole clause), Méntrida and Costa de Cantabria (the description sits
   in a table), Dominio de Valdepusa (per-variety blocks under grape abbreviations).

## Known limits of the parse

- French clauses are prose about typicity, not a legal profile line by line; some
  paragraphs mix production facts with taste ("produits à faible rendement ... puissants,
  charpentés"). They are kept whole.
- 51 Alsace grand cru rows carry the same shared clause (one cahier for 51 names).
- Italian appellations with many tipologie (Alto Adige 125, Oltrepò Pavese, Colli
  Piacentini) overflow the eight-style cap; the tool says how many more exist and the
  full set is in the table.
- Spanish two-column tables (Rías Baixas) come out in reading order with the key words
  re-inserted; a line of the olfactory description can sit under "Fase visual:".
- Sweetness and colour are heuristics over the label and the first 200 characters. They
  are convenience fields; the clause text is the fact.

## Spend

Extraction: $0.00 (code only; no model call).
Eval: $0.94 on the OpenRouter key ($26.09 before, $27.03 after; $0.87 for the smoke question
and the 90-question run, $0.07 for a second start of the harness by mistake, killed after a few
questions). Cap was $5.

## Checks run

- `pnpm typecheck`: all packages done, no errors.
- `pnpm lint`: 0 errors, 13 warnings, none in `scripts/wine/`, `packages/domain/` or `apps/api/`.
- `pnpm test:wine`: 7 files, 106 tests, all pass (taste-rules 14).
- `pnpm --filter @dig/api test`: 55 passed, 24 skipped (integration suite skips with no `DATABASE_URL`), wine-bore 16.
- `pnpm audit:migrations`: contiguous 001..036.
- `bash -n ops/reload-winebore-data.sh`: clean.
