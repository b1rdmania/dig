# Wine Bore data audit - 21 September 2026

Branch `winebore-data-2026-09-21`. Local Docker Postgres only. Prod is not touched.
Every number below comes from a command that ran in this session. The command is
given with the number.

Shorthand: `psql` = `docker exec -i dig-baby-mvp-postgres-1 psql -U dig -d dig -Atc`.
Loaders run as `DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/<loader>.ts`.

## Headline numbers

| Measure | Before | After | Command |
|---|---|---|---|
| PDO grape strings resolved to a grape | 49,688 of 55,971 (88.8%) | 53,628 of 55,971 (95.8%) | `select count(grape_id), count(*) from wine.appellation_grapes` |
| Wine grape strings resolved | 1,890 of 1,934 (97.7%) | 1,925 of 1,933 (99.6%) | `resolve-wine-grapes.ts` |
| Grapes with no colour | 845 | 201 | `select colour, count(*) from wine.grapes group by 1` |
| Grapes whose parents read "Vitis vinifera" | 1,913 | 0 | `... where parent_varieties::text ilike '%vitis%'` |
| Grapes with a real pedigree | 0 | 854 | `... where cardinality(parent_varieties) > 0` |
| INAO cahiers loaded | 285 | 412 | `select source, count(*) from wine.appellation_documents group by 1` |
| INAO cahiers that held another appellation's rules, or symbol soup | 12 | 0 | `inao-cahiers.ts` verdict on each text |
| French PDOs with their own cahier | not measured (282 attached, 12 of them wrong) | 335 of 368 | join on `appellation_documents` |
| Live wines on `Etna` | 0 | 348 | see finding 4 |
| Live wines on `Chablis grand cru` | 0 | 303 | see finding 4 |
| Argentina, Live wines resolved | 1 of 4,390 | 4,245 of 4,390 | see finding 5 |
| New Zealand, Live wines resolved | 524 of 4,032 | 3,973 of 4,032 | see finding 5 |
| Synthetic non-EU appellations | 504 | 113 | `select count(*) from wine.appellations where source='lwin'` |
| All Live wines with an appellation | 163,699 of 185,293 (88.3%) | 171,805 of 185,293 (92.7%) | `select count(appellation_id), count(*) from wine.wines where status='Live'` |
| EU Live wines with an appellation | 110,723 of 115,402 (95.95%) | same | `resolve-appellations.ts` prints it |
| Producers with Live wines | 33,218 | 32,540 (1,047 rows merged away) | `select count(*) from wine.producers where wine_count > 0` |
| Shelf members that point at no row | 28 of 217 (every grape) | 0 | `load-pack.ts` |

Tests: `pnpm test:wine` (new; `pnpm test` now runs it too) - 5 files, 78 tests, all pass.
`pnpm typecheck` - all six packages done, no errors. `pnpm lint` - 0 errors, 13 warnings, none in `scripts/wine/`.
`pnpm test` - web 55, domain 61, mcp 18, ingest 43, api 46 passed and 24 skipped (the integration suite skips with no `DATABASE_URL`), wine 78.

## Findings, ranked by how likely a trade reader is to hit them

### 1. Cahiers filed under the wrong appellation

The INAO pull saved one PDF per appellation. Many links point at a Bulletin Officiel
bundle that holds several cahiers. Some point at another cahier. The loader trusted
the file name. `get_appellation` runs its clause search on the first 200,000
characters of the text, so a question on Santenay quoted the rules of Bellet.

Evidence: `pnpm exec tsx` over the 285 original texts with `cahierFor()` from
`scripts/wine/inao-cahiers.ts`: 257 whole and correct, 14 shared (Alsace grand cru, one
cahier for 51 names, correct), 4 bundles attached whole, 10 wrong, 2 unreadable.

- `santenay.txt`, `beaune.txt`, `chassagne-montrachet.txt`, `irancy.txt`: a 311,204-character bundle that opens with Bellet. None of the four cahiers is inside it.
- `julienas.txt` is the cahier of Régnié.
- `maury.txt` and `muscat-de-rivesaltes.txt` are symbol soup (font-encoded PDF).

A second fault sat beside it. 109 of the 394 PDFs in `data/wine/raw/inao/cdc/` had no
extracted text at all: Sancerre, Hermitage, Côte Rôtie, Vosne-Romanée, Nuits-Saint-Georges,
Pouilly-Fuissé, Saint-Estèphe, Tavel, Chablis grand cru. 44 of those PDFs are bundles
too: `gevrey-chambertin.pdf` opens with Fitou, `chateauneuf-du-pape.pdf` holds Cassis,
Crozes-Hermitage, Gigondas, Languedoc, Lirac and Pommard, and no Châteauneuf.

A third: 30 downloads failed on the first pull (`cdc/index.csv`, status
`download_failed_000`). The `www.inao.gouv.fr` host now answers 404. The same path on
`extranet.inao.gouv.fr` serves the file. INAO's own page for La Tâche, Richebourg, La
Romanée and La Grande Rue links the Echezeaux file; the guard refuses it.

Fix:
- `scripts/wine/inao-cahiers.ts` (pure, tested): splits a bundle on the cahier header, and files a text under a slug only when a header names that slug. It refuses symbol soup.
- `scripts/wine/extract-inao-text.ts`: `pdftotext -layout` for each PDF with no text (byte-identical to the first pull on `chablis.pdf`).
- `scripts/wine/fetch-inao-missing.py`: retries the 30 failed rows on the extranet host (30 of 30 fetched), then tries INAO's `PNOCDC<Name>.pdf` pattern for each appellation with no valid cahier and keeps a file only when its header names the appellation (15 recovered: La Tâche, Richebourg, La Romanée, La Grande Rue, Musigny, Montrachet, Corton, Saint-Julien, Santenay, Juliénas, Rully, Montagny, Pic Saint-Loup, Côtes du Rhône Villages, Bourgogne Passe-tout-grains).
- `load-appellation-documents.ts` uses the guard and also lifts cahiers out of bundles for names that never had a PDF (Romanée-Conti, Echezeaux, Grands-Echezeaux, Corton-Charlemagne, Crémant d'Alsace).

Before / after: INAO documents 285 -> 412, attached 282 -> 406, wrong or unreadable 12 -> 0.
French PDOs with their own cahier: 335 of 368. La Tâche now returns "rendement ... 35
hectolitres" and "rendement butoir ... 49 hectolitres" from its own text.

MASAF and MAPA were checked the same way (name in the first 6,000 characters): 521 and
147 texts, 3 spelling slips in titles, no wrong text. One MAPA text is poor
(`ribera-del-guadiana`, 54% letters); it is kept.

### 2. Every grape's parents read "Vitis vinifera"

`wikidata/03_grape_varieties.csv` has two columns. `parentVarieties` is Wikidata P171,
the parent taxon. `hybridOf` is P1531, the cross. The loader read the first. `get_grape`
returns `parent_varieties`, so "what are the parents of Cabernet Sauvignon" answered
"Vitis vinifera".

Evidence: `select count(*) from wine.grapes where parent_varieties::text ilike '%vitis%'` = 1,913.
Real pedigrees: 0. Examples: Cabernet Sauvignon, Riesling, Chardonnay, all `{"Vitis vinifera"}`.

Fix: `load-grapes.ts` takes VIVC Parent1 x Parent2 when both parents are known and the
pedigree is marker-confirmed, else Wikidata `hybridOf`. It never takes the taxon. A half
pedigree is not loaded: VIVC gives Pinot noir as "? x Savagnin blanc", which a
sommelier will dispute and the data cannot settle.

After: 0 taxon rows, 854 grapes with parents. Cabernet Sauvignon = Cabernet Franc x
Sauvignon blanc. Syrah = Mondeuse Blanche x Dureza. Chardonnay = Gouais blanc x Pinot.

### 3. Grape colour: 845 unknown, and red-skinned berries loaded as red-wine grapes

Evidence: `select colour, count(*) from wine.grapes group by 1` at the start: unknown 845,
white 709, red 593, rose 64. 1,176 Wikidata items have no VIVC number, so the 09-17 fix
(VIVC colour wins) could not reach them. Also, the 09-17 map sent VIVC `ROUGE` to red.
`ROUGE` is a red-skinned berry: Riesling Rot, Silvaner Rot, Catawba, Muscat à petits
grains rouges (74 varieties in our set). The register codes these Rg or Rs.

Fix:
- `fetch-vivc-names.py` pulls all 81,037 VIVC cultivar names (prime names and synonyms, with colour and country of origin).
- `build-grape-synonyms.ts` gives a VIVC number to 459 Wikidata items that had none: 337 by exact prime name, 115 by a name VIVC lists under one variety only, 7 where Wikidata's colour splits two candidates. 53 stay ambiguous and are not assigned (Clevner, Roupeiro, Castelão).
- `grape-rules.ts`: `ROUGE` maps to rose.

After: red 924, white 851, rose 149, unknown 201. Riesling Rot is rose. The 201 have no
VIVC match and no usable Wikidata colour (Godello is one; VIVC files it as Gouveio and
the Wikidata item does not say so).

### 4. Famous appellations with no wines, because the sub-region fell through to the region

Evidence: `select w.sub_region, a.name, count(*) from wine.wines w join wine.appellations a on a.id = w.appellation_id where w.appellation_match like 'region%' and w.sub_region is not null and w.status = 'Live' group by 1, 2 order by 3 desc`.

- `Etna Rosso` 192, `Etna Bianco` 109, `Etna Rosato` 40, `Etna Spumante` 7: all on `Sicilia`. `Etna` held 0 wines.
- `Chablis` with LWIN classification `Grand Cru`: 303 wines on plain `Chablis`. `Chablis grand cru` held 0. The Bore quoted the village yield for Les Clos.
- `Blaye-`, `Castillon-`, `Cadillac-`, `Francs-Côtes de Bordeaux`: 539 wines on `Bordeaux`. `Conegliano Valdobbiadene Superiore` and `Cartizze`: 225 on `Prosecco`. `Kremstal Reserve`, `Kamptal Reserve` and four more DAC tiers: 130 on `Niederösterreich` or `Burgenland`.

Cause: the type-suffix pass ("Etna Rosso" -> "Etna") ran only for wines that matched
nothing. These wines had matched on REGION through the alias Sicily -> Sicilia, so the
search had ended. LWIN keeps "Grand Cru" in CLASSIFICATION, which the resolver did not read.

Fix in `resolve-appellations.ts` and `appellation-rules.ts` (pure, tested): the suffix pass
covers region-only matches; `<sub_region> grand cru` is tried first when LWIN classes the
wine Grand Cru; `reserve` joins the suffix list; nine curated aliases, each checked
against the register at load time (0 misses).

After: Etna 348, Chablis grand cru 303, Côtes de Bordeaux 580, Conegliano Valdobbiadene -
Prosecco 225, Kremstal 199, Kamptal 200. The EU Live rate does not move (95.95%): these
wines were already counted as resolved. They were resolved to the wrong row.

Spot-check of famous producers (DRC, Huet, Raveneau, Envínate, Overnoy, Clos Rougeard,
Giacomo Conterno, López de Heredia, Egon Müller, Coche-Dury, Leroy, Roumier, Rayas, Chave,
Keller, Selosse, Vega Sicilia, Bartolo Mascarello, Montevertine, Trimbach, Zind Humbrecht,
Dagueneau, Tempier, Niepoort, Equipo Navazos, Ganevat, Foillard; about 1,300 Live wines,
every sub_region and appellation pair read): no wrong appellation beyond the patterns
above. Champagne villages resolve to Champagne, which is correct. Envínate's Tenerife
wines resolve to Islas Canarias through a curated alias; that is coarse, not wrong.

### 5. Non-EU appellations

Evidence, 14 September: AR 1 of 4,390, NZ 524 of 4,032, and 504 synthetic rows built from
LWIN's own strings.

Fix: `load-gi-lists.ts` loads 654 official rows with 407 parent links. `resolve-appellations.ts`
matches the six countries by place (site, then sub_region, then region) with no designation gate.

| Country | Source | Rows | Live wines before | Live wines after |
|---|---|---|---|---|
| US | TTB AVA geojson (`data/wine/raw/ttb-ava`) | 276 | 28,543 of 34,538 | 28,872 of 34,538 |
| AU | Wine Australia GI geojson (`wine-australia-gi`) | 104 | 11,313 of 11,570 | 11,329 of 11,570 |
| NZ | Wikipedia list of the IPONZ register (IPONZ's own page is script-rendered) | 21 | 524 of 4,032 | 3,973 of 4,032 |
| ZA | Wikipedia table of the Wine of Origin scheme | 102 | 5,032 of 5,195 | 5,044 of 5,195 |
| CL | Diario Oficial decree of 25 May 2018 (Decreto 464), plus Wikipedia for Atacama and Coquimbo | 104 | 3,460 of 3,661 | 3,516 of 3,661 |
| AR | Wikipedia (Argentine wine, Mendoza wine, Valle de Uco); the INV site answers 404 | 47 | 1 of 4,390 | 4,245 of 4,390 |

Command: `select country, count(*) filter (where appellation_id is not null), count(*) from wine.wines where status='Live' and country in ('US','AU','NZ','ZA','CL','AR') group by 1`.

The NZ, ZA, CL and AR lists are committed as `scripts/wine/gi-lists/<cc>.json`. The
Swartland shelf now points at real WO rows (ids only; "Paardeberg" maps to the ward Voor
Paardeberg and `load-pack.ts` prints one name-drift warning).

Synthetic rows: 504 -> 113 (CH 38, CA 29, US 24, AU 8, CL 2, and 12 rows in four small countries).

### 6. The pack stores ids that a reload renumbers

Evidence: at the start of this session `select min(id), max(id) from wine.grapes` = 6633, 8843.
`shelves.json` holds grape ids 4422 to 6632. The 09-17 grape reload deleted and
re-inserted every grape, so all 28 grape shelf members pointed at no row (Savagnin 5755,
Poulsard 5482, Riesling 6249). `ops/reload-winebore-grapes.sh` would do the same on prod.

Fix: ids are part of the loader contract.
- `scripts/wine/grape-ids.json` pins `wine.grapes.id` per QID (2,211 ids, read from the 09-14 dump, which is what the pack was built on).
- `scripts/wine/gi-lists/ids.json` pins the 654 GI rows. The lowest is 8227; the 09-14 dump's highest appellation id is 7572, so prod has room.
- `load-appellations.ts` and `load-gi-lists.ts` upsert on `(source, source_ref)`. They no longer delete rows that wines, documents and shelves point at. Before this, `load-appellations.ts` could not run on a loaded corpus at all (foreign key from `wines`).

After: `load-pack.ts` loads 217 members, 0 bad ids, after every reload in this session.

### 7. One variety, several rows

Evidence: `select vivc_ids[1] from wine.grapes where cardinality(vivc_ids) = 1 group by 1 having count(*) > 1`: 52 groups.
Examples: Grenache (6208) and Garnacha Tinta (6036), both VIVC 4461, with the register's
links split between them; Trousseau and Bastardo (12668); Trebbiano and Trebbiano toscano
(12628). Thin copies with no VIVC number too: `Chenin` (78 appellation links) beside
`Chenin blanc`, `Meunier` beside `Pinot meunier`, `Mourvedre` beside `Mourvèdre`.

Fix: `mergeByVivc()` in `grape-rules.ts`. Two items load as one row when two sources agree:
VIVC files both under one number, and one Wikidata item lists the other's name. VIVC
alone is not enough. It files Nerello Cappuccio under Magliocco Dolce, and Wikidata's
P3904 is wrong often enough (Spergola carries the number of Vernaccia di Oristano). The
row named like the VIVC prime name keeps the id, so Trousseau stays Trousseau on the Jura
shelf and Garnacha Tinta stays on the Rioja shelf.

After: 2,211 rows -> 2,125 (86 merged). 82 groups still share a number and stay apart on
purpose (Nielluccio / Sangiovese, Pigato / Vermentino, Verdicchio / Trebbiano di Soave,
Nerello Cappuccio / Magliocco Dolce). The resolver treats a synonym shared by rows of one
number as unshared, so resolution does not suffer.

### 8. Synonyms (`grape-synonyms.json` was empty)

Fix: the file now holds, for 1,846 VIVC varieties: prime name, colour, country of origin,
parents, and 28,705 synonyms; the 459 assigned numbers; and a `manual` block of ten
register typos checked by hand (Vernaccia Di S. Giminiano, Fetească Neagrăn, Băbeasacă
Neagră, Roter Vetliner, Xarello, Viogner, Sivi Pinot, Tramín Červený, Rolle, Catarratto).
Only a VIVC name that the corpus uses is loaded into `wine.grape_names` (`source='vivc'`, 1,148 names: register spellings and wine-list spellings). `get_grape` prints the first 15 synonyms in alphabetical order; VIVC lists 447 names for Pinot noir, and loading them all would bury Spätburgunder under Affenthaler and Aprofekete.

Both resolvers now use one class, `GrapeResolver` in `grape-rules.ts`. A name resolves in
tiers: primary name, then Wikidata name, then VIVC synonym. A VIVC synonym that several
varieties share resolves only when the register's colour code leaves one (Ploussard with
code N is Poulsard; with no code it stays unresolved).

Before / after: PDO grape strings 88.8% -> 95.8%. Wine grape strings 97.7% -> 99.6%.
Now resolved: Malbech, Carignano, Olasz Rizling, Rulandské Modré, Mazuela, Aragonez,
Cannonau, Ugni Blanc, Primitivo, Sylvaner, Meunier. Checked: the 70 most frequent
synonym-only resolutions were read one by one; none is wrong. 193 resolved rows have a
register colour code that disagrees with the grape's colour.

### 9. Country of origin "Italy" on non-Italian grapes

Evidence: `select count(*) from wine.grapes where 'Italy' = any(countries_of_origin)` = 801.
Riesling `{Italy,Germany}`, Chardonnay `{Italy,France}`, Grüner Veltliner `{Italy,Austria}`,
Zweigelt `{Italy,Austria}`. Wikidata P495 carries it; it looks like an import from the
Italian national register.

Fix: VIVC country of origin wins where a VIVC number is known (1,902 grapes). After: 627
rows say Italy, and each is a variety VIVC files under Italy or an item with no VIVC number.

### 10. Yields

Three keying slips in the PDO dataset: Colli Romagna centrale 6,635 hl/ha, Verduno
Pelaverga 8.1 hl/ha, Maremma toscana 80,000 kg/ha. `plausibleYield()` in
`appellation-rules.ts` drops a figure outside 15 to 250 hl/ha or 1,500 to 35,000 kg/ha.
Fixed and reloaded.

The larger fault is not fixed. See "Not fixed", item 1.

### 11. Producers split by LWIN title

Evidence: `producer-merge.ts` scans all 34,466 producers: 31,082 same-country candidate
pairs. Examples: Keller (203 wines) / Weingut Keller; Roche de Bellene / Roche Bellene;
three rows named Bouchard Père et Fils.

Fix: a conservative merge. Rules: same name, or same name after title words, in the same
country; and the wines must agree (same region, a shared sub-region). Class `auto` is
applied. A differing given name is never auto. Two rows with different titles are never
auto: Domaine Leroy is the estate and Maison Leroy the négociant, and the first cut of
the script merged them. Every run first puts each wine back on its LWIN producer from
`lwin.csv`, so a rule change that withdraws a merge undoes it.

After: auto 1,108 pairs (1,047 rows merged away, 2,390 wines and 108 listings moved),
review 8,727, reject 21,247. Producers with Live wines 33,218 -> 32,540. The review file
`docs/wine-bore-producer-merge-review.md` lists the 703 review pairs that touch a top-500
or shelf producer. 40 random auto merges were read against their wines; all held.
In the tests as never-auto: Overnoy, Gros, Conterno, Mascarello, Prüm, Leroy.

## Not fixed

1. **`max_yield_hl` is the rendement butoir for France, and the tool calls it the maximum yield.**
   Of 179 French PDOs where both figures parse out of the cahier, the register value equals
   the butoir in 159 and the base yield in 0. La Tâche: 35 base, 49 butoir, field 49. Chablis:
   60 and 70, field 70. A merchant quotes the base. The fix needs a `base_yield_hl` column
   (migration 035), a parser over the cahier text, and one more field in the `get_appellation`
   output. That is a schema and tool change, outside tonight's limits. Until then the cahier
   is attached, so a clause search for "rendement" returns both figures.
   Query: the two `regexp_matches` on `appellation_documents.text` for `rendement vis.` and `rendement butoir`.
2. **Permitted-grape lists mix named varieties with the province-wide list.** `Etna` lists 31
   grapes (Chenin, Glera, Petit Manseng); the disciplinare names Nerello Mascalese, Nerello
   Cappuccio, Carricante, Catarratto. `Soave` lists 39. `appellation_grapes.kind` is `oiv` or
   `other`, which is the source column, not principal or accessory. A flag "named in the rule
   text" can be computed from the documents; it needs a column. Eval question 30 tests it.
3. **33 French PDOs still have no cahier**: Châteauneuf-du-Pape (991 wines), Chassagne-Montrachet
   (1,181), Beaune (929), Chambolle-Musigny (859), Savigny-lès-Beaune, Saint-Aubin,
   Pernand-Vergelesses, Auxey-Duresses, Bâtard-Montrachet, Maury. INAO's product page gives no
   PDF or the wrong one, and the `PNOCDC` name does not exist. Legifrance holds each decree.
   Saint-Julien's text is 6,563 characters (the PDF is mostly scanned).
4. **No village level for Mosel, no Rioja subzones, no Etna contrade.** Unchanged from `pack/missing.md`.
5. **Mexico, Lebanon, Israel, Georgia, China: 0% resolved.** No list loaded. Argentina's
   Calchaquí Valley (44 wines) has no sourced row. Penfolds Grange resolves to a synthetic
   "South Australia": the Wine Australia file has zones, regions and subregions, not the state GI.
6. **`load-lwin.ts` still deletes and re-inserts**, so producer ids are not stable across an LWIN
   reload. The pack holds 120 producer ids. Not run tonight; fix it the same way (pin or upsert) before the next LWIN release.
7. **8,727 producer pairs wait for a human.** Only `auto` is applied.
8. **`get_grape` lists synonyms alphabetically, first 15.** Grenache has about 160 names, so "Grenache" itself may not be in the 15 shown for the row `Garnacha Tinta`. Ordering by source and kind (translation, then Wikidata synonym, then VIVC) is a one-line change in `packages/domain/src/wine.ts`. It is a call-site change, so it was not made.
9. **The eval was not run.** See below.

## Eval

`scripts/wine/eval.ts` now has 70 questions: the 30 from 14 September and 40 adversarial
ones (8 colour traps, 9 synonym traps, 6 monopole and ownership, 8 permitted grapes, 5
yields, 4 claims the corpus cannot support). Where the right answer is to not assert, the
question carries `abstain: true`; a refusal scores `declined`, and an unhedged answer goes
to a human as `review`. `GROUP=adversarial` runs the new set alone.

Not run, before or after. The repo has no model key: `OPENROUTER_API_KEY` is not in `.env`
and not in the shell. `~/.dd-openrouter-key` exists but belongs to another project and the
task did not name it, so it was not used. To run:
`OPENROUTER_API_KEY=... pnpm dev` (API on :3010), then `API_URL=http://localhost:3010 pnpm exec tsx scripts/wine/eval.ts`.

## Needs prod reload

One command: `ops/reload-winebore-data.sh`. It was written and syntax-checked (`bash -n`). It
was not run. It replaces `ops/reload-winebore-grapes.sh` (the grape reload is its step 3).
It needs `data/wine/raw/` on the machine, including tonight's new INAO PDFs and texts.
No api or web deploy: no code under `apps/` or `packages/` changed.

Tables that change on prod, in the order the script runs the loaders:

| Step | Loader | Tables |
|---|---|---|
| 1 | `load-appellations.ts` | `wine.appellations` (upsert, 3 yields nulled), `appellation_names`, `appellation_grapes` (rebuilt) |
| 2 | `load-gi-lists.ts` | `wine.appellations` (+654), `appellation_names` (+710) |
| 3 | `load-grapes.ts` | `wine.grapes` (2,211 -> 2,125, ids pinned), `grape_names` (4,870 -> 5,907), `appellation_grapes.grape_id` |
| 4 | `resolve-wine-grapes.ts` | `wine.wine_grapes.grape_id` |
| 5 | `load-appellation-documents.ts` | `wine.appellation_documents` (953 -> 1,080) |
| 6 | `resolve-appellations.ts` | `wine.wines.appellation_id`, `appellation_match`; `appellation_names` kind=lwin; synthetic `appellations` (504 -> 113) |
| 7 | `producer-merge.ts` | `wine.wines.producer_id`, `listings.producer_id`, `producers.wine_count`, `producer_links` kind=merged_into |
| 8 | `search-vectors.ts` | `search_vector` on producers, wines, listings, appellations, grapes, documents |
| 9 | `load-pack.ts` | `wine.shelves`, `shelf_members`, `shelf_edges` |

The script prints eight checks before and after. Expected after, from the local run:
colour unknown 201; "Vitis" parents 0; 53,628 of 55,971; 412 cahiers; La Tâche 1; Etna 348;
Argentina 4,245 of 4,390; 32,540 producers with Live wines.

If prod ran `ops/reload-winebore-grapes.sh` after 17 September, its grape ids are already
renumbered and its 28 grape shelf members are broken now. Step 3 puts the pinned ids back
and step 9 reloads the pack, so the same command repairs it.
