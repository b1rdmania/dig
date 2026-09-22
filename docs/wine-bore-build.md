# Wine Bore - build ledger

**Started:** 14 September 2026. Whitepaper: `~/Documents/wine-bore-whitepaper-2026-09-03.md`.
Corpus inventory: `~/Documents/wine-bore-corpus-inventory-2026-09-04.md`.
Raw data: `data/wine/raw/` (gitignored, 4.2 GB, per-folder manifest + SHA256SUMS).

## The one decision

Wine Bore is a persona file plus a corpus adapter inside this monorepo, not a
fork. If it becomes a fork, stop and write down why here.

What changes in the engine to make that true:

- `bores/<slug>/persona.md` is the character. `loadBorePersona(slug)` loads it.
- The ask loop takes a `BoreConfig` (persona, tools, tool executor, link
  discipline, progress labels, quota key). Record Bore is the first config,
  unchanged in behaviour. Wine Bore is the second.
- `/v1/ask` picks the bore from the request body (`bore: "wine"`), default
  `record`, so the public gate, streaming and caps are shared.
- Wine Bore gets its own monthly counter row and its own daily per-IP map.

## Schema: `wine` (migrations 034, 035, 036)

| Table | Spine | Notes |
|---|---|---|
| sources | slug | licence and demo-only flag per publisher |
| appellations | id | EU register row per protected name; non-EU designations added by the resolver with `source='lwin'` |
| appellation_names | (appellation_id, name_norm, kind) | every spelling, incl. the strings LWIN uses |
| appellation_documents | (source, source_ref) | cahier / disciplinare / pliego full text, tsvector |
| appellation_taste | (appellation_id, doc_source, doc_source_ref, style_key) | the organoleptic clause per appellation, document and style, verbatim in its own language, with min_alcohol and sweetness where stated (036) |
| grapes, grape_names | id | Wikidata varieties + synonyms |
| appellation_grapes | (appellation_id, grape_name_raw, kind, category) | permitted varieties from the Sci Data PDO set; grape_id NULL when unresolved |
| producers, producer_links | id | LWIN producer per (title, name, country); links to Wikidata / directories / Exa / monopoly |
| wines, wine_names, wine_grapes | lwin (LWIN-7) | LWIN wine rows, resolved to appellation where possible |
| listings | (source, source_ref) | Systembolaget rows, matched to lwin / producer, demo-only |
| shelves, shelf_members, shelf_edges | slug | the curation pack, draft until cut |
| load_log | id | one row per loader run with in/out/matched/unmatched |

Rules that hold across every loader:

1. `name_norm` is `norm()` from `scripts/wine/lib.ts`. Nothing else.
2. Loaders are idempotent: delete the rows this loader owns (by `source`)
   and reload. Never truncate another loader's rows. A table whose ids the
   pack stores (grapes, appellations) is upserted or loaded with pinned ids,
   never renumbered (09-21).
3. Unmatched rows are kept with NULL foreign keys and a `match_method`, never
   dropped. Every loader writes a `wine.load_log` row.
4. Country is ISO alpha-2 in `country`; the source spelling stays in
   `country_name`.
5. Register beats pack. Nothing from `bores/wine-bore/pack/` overwrites a
   register row.

## Loaders (`scripts/wine/`)

| Script | Reads | Writes | Owner |
|---|---|---|---|
| lwin-to-csv.py | lwin/LWINdatabase.xlsx | lwin/lwin.csv | done 09-14 |
| load-lwin.ts | lwin/lwin.csv | producers, wines | agent A |
| load-producer-links.ts | wikidata/01_wineries.csv, exa-producers/results.csv, trade-bodies/*/extracted.jsonl | producer_links, producers.website/founded/wikidata_qid/uk_importer | agent A |
| load-systembolaget.ts | systembolaget/assortment.json | listings, wine_grapes, producer_links(kind=monopoly) | agent A |
| load-wikidata-wines.ts | wikidata/04_wines.csv | wine_names, wine_grapes | agent A |
| load-appellations.ts | eambrosia/detail/*.json, pdo-dataset/PDO_EU_id.csv + PDO_EU_cat.csv | appellations, appellation_names, appellation_grapes | agent B |
| load-grapes.ts | wikidata/03_grape_varieties.csv, scripts/wine/grape-synonyms.json, grape-ids.json | grapes, grape_names; resolves appellation_grapes.grape_id | agent B, 09-21 |
| load-appellation-documents.ts | inao/cdc-text, masaf/text + index.csv, mapa/text + index.csv | appellation_documents | agent B |
| resolve-appellations.ts | wines × appellation_names | wines.appellation_id, appellation_names(kind=lwin), synthetic non-EU appellations | agent C (after A + B) |
| resolve-wine-grapes.ts | wine_grapes x grape_names | wine_grapes.grape_id | agent C |
| join-report.ts | load_log + live counts | docs/wine-bore-join-report.md | agent C |
| search-vectors.ts | all | search_vector columns | agent C |
| load-gi-lists.ts | ttb-ava/avas.geojson, wine-australia-gi/*.geojson, scripts/wine/gi-lists/{nz,za,cl,ar}.json + ids.json | appellations, appellation_names for US, AU, NZ, ZA, CL, AR (run before resolve-appellations) | 09-21 |
| load-appellation-taste.ts | appellation_documents.text | appellation_taste (run after load-appellation-documents; upsert, ids kept) | 09-22 |
| load-rule-facts.ts | appellation_documents.text, appellation_grapes, grape_names | appellations.base_yield_hl / butoir_yield_hl / yield_rules, appellation_grapes.named_in_rules (run after load-appellation-documents and load-grapes) | 09-21 |
| producer-merge.ts | producers, wines, lwin/lwin.csv | wines.producer_id, listings.producer_id, producers.wine_count, producer_links(kind=merged_into) (run after resolve-appellations) | 09-21 |
| fetch-vivc-names.py, build-grape-synonyms.ts | vivc.de, wikidata/03_grape_varieties.csv | scripts/wine/grape-synonyms.json (load-grapes.ts reads it) | 09-21 |
| extract-inao-text.ts, fetch-inao-missing.py | inao/cdc/*.pdf, inao/cdc/index.csv | inao/cdc-text/*.txt, missing PDFs (run before load-appellation-documents) | 09-21 |

## Tools the Bore gets (six)

search_cellar · get_appellation · get_producer · get_wine · get_grape · get_shelf.
The act surface is not a tool: every wine the tools return carries a
`find_url` (search handoff by name and vintage) and the page renders it. He
has nothing in stock and says so in voice.

## Gates

- Every concrete claim traces to a tool result from that turn (loop-enforced).
- Register beats pack.
- Eval number exists before anyone outside sees the page.
- Shop window says, in voice, nothing is in stock.

## Ledger

- 09-14: migration 034 written and applied locally. LWIN converted to CSV
  (212,311 rows). Five late pulls (grapes-science, inao, masaf, mapa,
  wikipedia, eambrosia) finished without manifests; files are present.
- 09-14 (agent B): `load-appellations.ts` - 1,688 appellations (1,229 PDO +
  458 PGI from eAmbrosia, 1 PDO-only row: PDO-HU-A1507 Balaton, the single
  PDO_EU_id.csv row with no register record), 3,132 appellation_names
  (1,667 protected, 214 transcription, 1,251 pdo-dataset alias), 55,971
  appellation_grapes. 1,176 of 1,177 PDO rows joined to eAmbrosia by
  fileNumber. `parent_id` left NULL everywhere - the register states no
  hierarchy. Legal-suffix aliases ("Chianti DOCG" -> "Chianti") are generated
  but fire 0 times: register names carry no class suffix. Six non-Latin names
  (CN, TH) norm to empty; 207 rows take `name_norm` from the Latin
  transcription instead.
- 09-14 (agent B): `load-grapes.ts` - 2,211 grapes, 4,870 grape_names;
  49,686 of 55,971 appellation_grapes resolved (88.8%): 49,404 exact norm,
  159 after stripping colour adjectives, 123 on first two tokens. 536 Wikidata
  rows dropped with no label or alias in en/fr/it/es/de. The export holds thin
  duplicate items ("Mourvedre" Q139941743 beside "Mourvèdre" Q161864), so a
  norm that hits several grapes is decided by primary-name hit, then VIVC id
  and alias count, then the older QID (3,457 rows). `scripts/wine/grape-synonyms.json`
  is live but empty: none of the 30 most frequent unresolved register spellings
  (Malbech, Carignano, Olasz Rizling, Rulandské Modré...) appear anywhere in
  the Wikidata aliases column, so nothing could be verified.
- 09-14 (agent B): `load-appellation-documents.ts` - 953 documents (285 INAO
  cahiers, 521 MASAF disciplinari, 147 MAPA pliegos), 948 resolved to an
  appellation (99.5%). No file was under 500 characters. INAO titles come from
  `inao/lists/inao-ref-produit-siqo.csv` (all 285 slugs matched an accented
  INAO title); INAO sha256 is computed from the local PDF. `search-vectors-b.ts`
  sets the vectors for appellations, grapes and appellation_documents.
- 09-14 (agent A): LWIN spine loaded. `load-lwin.ts` - 212,311 rows in,
  190,479 wines out (TYPE Wine + Fortified Wine; Spirit 20,196, Other 1,577,
  Cider 23, Still 6, Beer 4 skipped), 34,466 producers, 26 rows dropped for a
  blank PRODUCER_NAME (case cases like "Liquid Gold Assortment Case"). Status
  split Live 185,293 / Combined 4,873 / Deleted 313. It is the FIRST loader:
  `wine.listings` FKs do not cascade, so re-running it under a loaded corpus
  aborts unless `FORCE=1` clears the downstream rows.
- 09-14 (agent A): `scripts/wine/match.ts` is the one producer matcher
  (exact -> norm -> norm_stripped -> trgm >= 0.6, country-narrowed, highest
  wine_count wins an ambiguous stage and the method is suffixed
  `_ambiguous`). It also carries a TS port of pg_trgm `similarity()`, verified
  against Postgres, so wine-name matching inside one producer's catalogue
  costs no round trip.
- 09-14 (agent A): `load-producer-links.ts` - 7,883 source rows, 3,365 matched
  (3,794 link rows incl. Exa techsheets). Wikidata 896/1,854, Exa 489/500 (the
  11 misses are cognac and grappa houses - LWIN files them as Spirit),
  trade-body directories 1,980/5,529. Unmatched rows are counted in
  `load_log.notes` with 20 samples per source; `producer_links` requires a
  `producer_id`, so they are not inserted.
- 09-14 (agent A): `load-systembolaget.ts` - 6,323 'Vin' rows, 6,298 listings
  (25 duplicate productIds collapse on the unique key), producer matched 60.1%,
  lwin matched 41.6% (69.2% of producer-matched), 536 of 1,497 Swedish tasting
  notes now hang off an LWIN. Demo-only in `wine.sources`.
- 09-14 (agent A): `load-wikidata-wines.ts` - 5,796 rows, 2,756 labels ending
  in a GI suffix skipped (they are denominations, agent B's table, and
  containment happily hangs them on an arbitrary wine), 676 of 2,988 real wine
  labels matched (22.6%), 676 `wine_names` and 3 `wine_grapes`. The grape
  lists in 04_wines sit almost entirely on the denomination rows.
- 09-14 (agent A): containment matching needs a floor. LWIN `wine_name` is a
  single letter often enough ("Locations, E") that unfloored bidirectional
  containment matched every long label; `bidiContains()` now demands word
  boundaries and 5 characters on the shorter side. The first systembolaget and
  wikidata-wines runs were rejected on that.
- 09-14 (agent C): `resolve-appellations.ts` - 190,479 wines in, 167,426 given
  an `appellation_id`. Live EU-register countries (EU-27 + GB, since eAmbrosia
  still carries the six UK names) 110,723 of 115,402 = **95.95%**. Methods on
  Live: sub_region 118,513, region 45,186, none 21,594; the `site` stage fires
  0 times - LWIN files the Alsace grand cru lieux-dits in SUB_REGION, and every
  string that reaches SITE is a Burgundy climat ("Morgeot", "Les Suchots")
  whose village PDO has already matched. 36 curated LWIN aliases are inserted
  into `appellation_names` as kind='lwin' (Burgundy->Bourgogne,
  Tuscany->Toscana, Moscato d'Asti->Asti, England->English, Crete->Kriti...)
  plus 1 generated by stripping a trailing wine-type word (Maury Sec->Maury),
  so the alias is a row, not a branch; every curated right-hand side is looked
  up in the register first and 0 now miss. `looseNorm` exists only to FIND a
  register row whose stored `name_norm` is broken - NFKD does not decompose
  ae, so eAmbrosia's "Sjaelland" is stored as "sj lland".
- 09-14 (agent C): the register already protects third-country names, so
  Napa Valley resolves to a real eAmbrosia PDO (3,771 Live wines) and
  Willamette Valley to a PGI, not to a synthetic row. 504 synthetic rows cover
  the rest of the non-EU world, keyed on the PLACE and not on
  (place, designation): LWIN's DESIGNATION column is inconsistent within a
  region - Paso Robles is filed as AVA, DO and AOP, Stellenbosch as WO and AVA
  - and the first cut of the loader split 37 places across several rows. The
  designation most of a place's wines carry becomes the `gi_type` and keeps the
  `source_ref` shape `country|designation|place`.
- 09-14 (agent C): non-EU resolution is designation-gated by design, and that
  is where the hole is. AR 1/4,390, MX 0/630, LB 0/285, IL 0/223, GE 0/220,
  CN 0/173 and NZ 524/4,032 - LWIN leaves DESIGNATION empty for Mendoza,
  Marlborough and Valle de Guadalupe, so there is nothing to synthesise from.
  Closing it needs per-country GI lists (TTB, Wine Australia, INV, the NZ GI
  schedule) as real appellation rows, not a looser resolver.
- 09-14 (agent C): `resolve-wine-grapes.ts` - 1,890 of 1,934 resolved (97.7%):
  1,884 exact norm, 5 after stripping colour adjectives, 1 on first two
  tokens. No trigram stage, same as load-grapes.ts. 18 distinct spellings left,
  all regional synonyms Wikidata does not carry (Mazuelo, Aragonez, Tinto
  fino, Tinta del pais, Tinta de toro, Rolle, Sangiovese grosso) plus one
  Systembolaget field holding an appellation, not a grape ("Barolo DOCG").
- 09-14 (agent C): `search-vectors.ts` - producers 34,466, wines 190,479 in
  107 windows of 20,000 lwin, listings 6,298, then `search-vectors-b.ts`
  re-run through its new `runVectorsB(pool)` export so the kind='lwin'
  appellation names are indexed; ANALYZE on all seven tables. Migration 034
  gave `wine.listings` no `search_vector`, so the script adds the column and
  its GIN index itself - if listings ever become a first-class search surface
  that belongs in 035.
- 09-14 (agent C): `join-report.ts` -> `docs/wine-bore-join-report.md`. Every
  figure is read back from Postgres at run time (live counts, plus the newest
  `load_log` row per loader and its notes), so a re-run of any loader changes
  the report. Systembolaget->producer 60.1%, ->lwin 41.6%; Wikidata wineries
  48.3%, Exa 97.8%, trade bodies 35.8% over 41 bodies (Jura 7.3%, Brunello
  79.0%); documents 948/953 matched but only FR/IT/ES exist at all.
- 09-14 (agent D): curation pack first cut. `bores/wine-bore/pack/shelves.json`
  holds 12 shelves, 217 members (44 appellations, 120 producers, 28 grapes,
  25 wines) and 37 edges; `scripts/wine/load-pack.ts` loads it. The pack is JSON,
  not YAML - no npm deps, so migration 034's comment saying `pack/*.yaml` is
  stale. Member ids are DB primary keys and every one was queried: producer ->
  `wine.producers.id`, appellation -> `wine.appellations.id`, grape ->
  `wine.grapes.id`, wine -> `wine.wines.lwin` (LWIN-7, not a surrogate, so
  `shelf_members.entity_id` holds the LWIN). The loader verifies all four id sets
  in one query per type BEFORE writing, prints every bad id and exits 1 having
  written nothing; it also warns on name drift (the pack's `name` field is for
  the reader, the DB wins). Shelves upsert, members and edges are deleted and
  replaced for the file's slugs only, all inside one transaction, everything at
  status 'draft'. Re-running is a no-op: 254 in / 217 members / 37 edges twice.
- 09-14 (agent D): where LWIN splits a house across rows, the pack takes the row
  with the most wines (`Anne et Jean-Francois Ganevat` 59 over
  `Jean-Francois Ganevat` 44, `Savart` 21 over `Frederic Savart` 2) - except
  where the two rows are different houses, not duplicates: `Domaine Overnoy`
  (54115, Guillaume, Cotes du Jura) is NOT `Maison Pierre Overnoy` (49252,
  Pupillin), and merging them on the wine_count rule would have put the wrong
  cellar on the Jura shelf. That check has to be by hand, per house.
- 09-14 (agent D): `bores/wine-bore/pack/missing.md` records the gaps, each one
  re-queried rather than assumed - the first draft of that file claimed a dozen
  growers were absent from LWIN and most of them were present. Genuinely absent:
  Callejuela, Cota 45/Collantes, Vino di Anna, Weingut Stein, Melsheimer,
  Patrick Meyer, Weingut Hofer, Julien Pineau, Skerpioen. Structural gaps that
  matter more: the register stops at `Mosel`/`Nahe`/`Rheingau` with no village
  PDOs, `Rioja` has no subzone rows, Etna's contrade exist only inside
  `wines.display_name`, and the four Swartland members are synthetic WO rows with
  no cahier - so the Bore must not quote rules on that shelf.
- 09-14 (agent D): open question for Andy. Notes are draft opinions in the
  Bore's voice and want cutting. Edges are the softest part of the pack: the
  within-shelf picks are defensible from the corpus, but `sherry -> grander:
  champagne-growers` and `swartland -> earlier: etna` are arguments, not facts.
- 09-14 (engine): the one decision came out "not a fork". `apps/api/src/routes/v1/ask/bore.ts`
  defines `BoreConfig`; `record-bore.ts` carries Record Bore's prompt rules, tools and
  link discipline unchanged (39 prior tests green, quota key unchanged); `wine-bore.ts`
  carries Wine Bore (six tools, no-links scrub, unchecked-bottle guard, `ask_public_wine`
  till). `loop.ts` lost every Record-Bore-specific line. `/v1/ask` and `/v1/ask/stream`
  take `bore: "wine"`; `/v1/ask/quota?bore=wine`. `loadBorePersona(slug)` in domain.
  New `/v1/wine/opener` + `/v1/wine/stats`. Page `/winebore` = `/recordbore` by
  subtraction, shares its CSS module; "On the counter" rows with `find_url`. No face.
- 09-14 (eval): `scripts/wine/eval.ts` - 30 questions; first full run on the local
  corpus: 10/10 rules, 10/10 producer facts grounded (three scorer false positives on
  accent encoding, fixed), 10/10 favourite-bottle challenges grounded with a connected
  counter (weakest: Grange -> Swartland Porseleinberg, a pack-driven leap). Median
  ~13 s, one 152 s outlier (Vega Sicilia, slow host round). Report:
  `docs/wine-bore-eval-2026-09-14.md`.
- 09-14 (deploy): NOT DEPLOYED. Production DB access was refused by the session's
  permission classifier. Migration 034 is additive; the data ships as a `pg_dump -n wine`
  restore (`~/Documents/wine-bore-schema-2026-09-14.dump`, 47 MB); commands in
  `~/Documents/wine-bore-handover-2026-09-14.md`.
- 09-21 (data audit): full write-up in `docs/wine-bore-data-audit-2026-09-21.md`. Branch
  `winebore-data-2026-09-21`, local only. Prod reload: `ops/reload-winebore-data.sh` (not run).
- 09-21: a cahier is filed under a name only when its own header says so
  (`inao-cahiers.ts`). The INAO pull trusted file names: Santenay, Beaune,
  Chassagne-Montrachet and Irancy carried a bundle that opens with Bellet, Juliénas
  carried Régnié, and 109 PDFs had no text at all. `extract-inao-text.ts` and
  `fetch-inao-missing.py` fill the gaps. INAO documents 285 -> 412; 335 of 368 French
  PDOs have their own cahier; La Tâche has one.
- 09-21: `load-grapes.ts` reads `grape-synonyms.json`, which `build-grape-synonyms.ts`
  writes from the VIVC pull (`fetch-vivc-names.py`, 81,037 names). VIVC decides colour,
  origin, parentage and synonyms wherever a number is known; 459 items get a number by
  name. The loader had read Wikidata P171 (parent taxon) as parentage: 1,913 grapes had
  "Vitis vinifera" as a parent. Items merge only when VIVC and Wikidata both say they are
  one variety (2,211 -> 2,125 rows). `grape-rules.ts` is the one resolver for both grape
  loaders. PDO grape strings 88.8% -> 95.8%; wine grapes 97.7% -> 99.6%; colour unknown
  845 -> 201.
- 09-21: ids are part of the loader contract, because `shelves.json` stores them. The
  09-17 grape reload renumbered every grape and broke all 28 grape shelf members.
  `grape-ids.json` and `gi-lists/ids.json` pin ids; `load-appellations.ts` and
  `load-gi-lists.ts` upsert on `(source, source_ref)`. `load-lwin.ts` still deletes and
  re-inserts: fix it before the next LWIN release.
- 09-21: `load-gi-lists.ts` - 654 official GI rows for US, AU, NZ, ZA, CL, AR with 407
  parent links. `resolve-appellations.ts` matches those countries by place with no
  designation gate. AR 1 -> 4,245 of 4,390; NZ 524 -> 3,973 of 4,032; synthetic rows
  504 -> 113. The Swartland shelf points at real WO rows.
- 09-21: EU sub-regions no longer fall through to the region. `Etna` held 0 wines (348
  sat on Sicilia); `Chablis grand cru` held 0 (303 sat on Chablis, because LWIN keeps
  "Grand Cru" in CLASSIFICATION). Rules in `appellation-rules.ts`. The EU Live rate stays
  95.95%: the wines were counted before, on the wrong row.
- 09-21: `producer-merge.ts` - conservative merge, review file
  `docs/wine-bore-producer-merge-review.md`. 1,108 auto pairs applied, 8,727 review,
  21,247 reject; producers with Live wines 33,218 -> 32,540. Never auto: a differing given
  name (Overnoy, Gros, Conterno, Mascarello, Prüm), or two different titles (Domaine Leroy
  is not Maison Leroy). Each run starts from `lwin.csv`, so a withdrawn merge is undone.
  Order: `producer-merge.ts --reset-only`, then `load-producer-links.ts` and
  `load-systembolaget.ts` if they must re-run, then `producer-merge.ts`.
- 09-21: `norm()` and `na()` live in `text.ts`; `lib.ts` re-exports them. Pure modules and
  their tests load without `pg`. Tests: `pnpm test:wine` (78), now part of `pnpm test`.
- 09-21: `eval.ts` has 70 questions (40 adversarial, verdict `declined` for a correct
  refusal). Not run: no model key in the repo.
- 09-21, open: `max_yield_hl` is the rendement butoir for France (159 of 179 parsed cahiers),
  not the base yield; it needs a `base_yield_hl` column. Italian permitted-grape lists mix
  named varieties with the province-wide list (Etna 31 names). 33 French PDOs still lack a
  cahier (Châteauneuf-du-Pape, Chassagne-Montrachet, Beaune, Chambolle-Musigny).
- 09-21 (second pass): migration 035 - `appellations.base_yield_hl`, `butoir_yield_hl`,
  `yield_rules`; `appellation_grapes.named_in_rules`; `grape_names.uses`. `rule-facts.ts` parses the
  base yield and the rendement butoir from a French cahier (213 of 406) and tells whether a rule text
  names a variety; `load-rule-facts.ts` loads both. Run it after load-appellations, load-grapes and
  load-appellation-documents. La Tâche 35 / 49. Etna leads with the six varieties its disciplinare names.
- 09-21 (second pass): tool output. `get_appellation` returns `grapes_named_in_the_rules` first, the
  rest marked, and yields as `base_yield` and `ceiling_in_exceptional_years_rendement_butoir`; the
  French register figure is `eu_register_ceiling_hl_per_ha`. `get_grape` orders synonyms by
  `grape_names.uses`. The full VIVC synonym set loads, minus protected place names (286) and other
  grapes' own names (1,089: VIVC files TROUSSEAU under Tempranillo). The api must be deployed after
  migration 035.
- 09-21 (second pass): `load-lwin.ts` upserts; producer ids hold across a reload. Run
  `producer-merge.ts` after it.
- 09-21 (second pass): eval run, 70 questions, `docs/wine-bore-eval-2026-09-21.md`. After reading:
  30 of 30 on the original set, 38 of 40 adversarial (33 correct, 5 declined), 2 prompt-cause
  assertions, 0 data-cause failures. `eval.ts` paces under the 10-asks-a-minute limit; `must_not`
  strings are whole claims.
- 09-22 (taste): migration 036 - `wine.appellation_taste`. `taste-rules.ts` reads the organoleptic
  clause out of each rule text with code (FR "Informations sur la qualité et les caractéristiques du
  produit", IT "Caratteristiche al consumo" colore / odore / sapore per tipologia, ES "Características
  organolépticas" vista / olfato / boca per type) and `load-appellation-taste.ts` stores it verbatim,
  per style, with the document cited. No model call; the Bore's model translates at answer time.
  1,034 of 1,072 attached documents yield a clause (FR 383, IT 508, ES 143); 5,675 clauses.
  `get_appellation` carries `what_the_rules_say_it_tastes_like` (eight styles, 520 characters each),
  absent when the book holds no clause. Gaps: 17 famous French names with no cahier at all, and the
  2010-11 Burgundy grand cru cahiers (La Tâche, Musigny, Montrachet, Richebourg, Corton) whose "Lien à
  l'origine" is an empty heading. Write-up: `docs/wine-bore-taste-2026-09-22.md`; eval (90 questions,
  20 in group `taste`): `docs/wine-bore-eval-2026-09-22.md`. Reload script gains step 6b.
