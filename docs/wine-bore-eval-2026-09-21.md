# Wine Bore eval - 2026-09-21

API: http://localhost:3010. 70 questions: 10 rule, 10 producer, 10 challenge, 40 adversarial.

| grounded | declined | hedged | wrong | review | error |
|---|---|---|---|---|---|
| 48 | 5 | 0 | 5 | 12 | 0 |

"declined" is a pass: the question fished for a claim the corpus cannot support and he did not make it.

Median time: 7589 ms. Mean tool calls: 2.3.

"review" rows are the challenges: a rule cannot score them. Read each and mark it grounded / wrong in the table below, then update the tally by hand.


## Reading of the run (written by hand after the run; the sections below are the harness output, unedited)

Run: 21 Sep 2026, local API on :3010, branch `winebore-data-2026-09-21` at `69540d8`, model
`moonshotai/kimi-k3` through OpenRouter, 70 questions, 0 errors. Median 7.6 s an answer, 2.3 tool
calls. Model spend for everything in this pass (one smoke question, a first adversarial run that the
API's 10-asks-a-minute limit cut short at 17, this run of 70, and a before run of 40): $1.42, read
from the OpenRouter key's usage counter before and after ($24.64 to $26.05).

| Set | Machine tally | After reading each failure |
|---|---|---|
| 10 appellation rules | 9 grounded, 1 wrong | 10 correct. The "wrong" is a scorer fault. |
| 10 producer facts | 9 grounded, 1 wrong | 10 correct. The "wrong" is a scorer fault. |
| 10 favourite-bottle challenges | 10 review | 10 grounded, each with a connected counter-bottle. Grange now draws Hill of Grace; on 14 Sep it drew Porseleinberg, the weakest answer of that run. |
| 40 adversarial | 30 grounded, 5 declined, 3 wrong, 2 review | 33 correct, 5 declined, 2 that assert what the book does not hold. The 3 "wrong" are scorer faults. |

Baseline for the first 30: `docs/wine-bore-eval-2026-09-14.md`, 20 of 20 rules and producer facts
grounded, 10 of 10 challenges grounded, median 13 s. Same result today on content; the two machine
"wrong" marks are the scorer.

### Every failure, quoted and traced

| Question | Quote | Cause | Action |
|---|---|---|---|
| Which grape varieties are permitted in Sancerre? | "No Chardonnay, no blends" | Scorer: `must_not: ["chardonnay"]` fires on a denial. The answer is right, and now adds "Whites crop at 65 hl/ha base, reds at 59" from the parsed cahier. | Fixed in `eval.ts`: must_not strings are whole claims. |
| Where is Egon Müller based? | "Wiltingen, on the Saar" | Scorer: wanted the word "Mosel". | Fixed: `mosel\|saar`. |
| Xarel·lo is a red grape, isn't it? | "White, I'm afraid. ... there is a red-skinned mutation, Xarel·lo Vermell ... Off the top of my head, don't quote me" | Scorer: "is a red" matched inside "there is a red-skinned mutation". The answer is right and the aside is flagged as unchecked. | Fixed. |
| Is Ugni Blanc the same as Trebbiano? | "Ugni Blanc is the French name for Trebbiano Toscano ... different grapes wearing the same surname" | Scorer: "different grape". This is the exact answer the truth column asks for. | Fixed: must `trebbiano toscano`. |
| Yield limit for Barolo in hectolitres and tonnes? | "Eight tonnes per hectare ... 56 hectolitres" | Scorer: wanted the digit 8. | Fixed: `8\|eight`. |
| Is Clos de Tart owned by Mommessin? | "Not any more, no. ... they sold it in 2017 to Artémis, the Pinault family holding" | **Prompt.** The fact is true, but no tool returned it: the corpus has no ownership dates. He stated it flat, with no "off the top of my head". | Not changed (persona). For Andy: the unchecked-claim guard looks for vintages and honorifics, not for dated ownership facts. |
| Was 2013 a better vintage than 2010 for Monfortino? | "The book's thin on this one ... That said: 2010, and it isn't close." | **Prompt.** He says the book does not hold it, then rules on it anyway. The eval's standard is to not assert. A merchant would call this an opinion, and he flags it as one; Andy decides whether that is the house line. | Not changed (persona). |
| What is the current UK price of Clos Rougeard Le Bourg 2014? (scored declined) | "No Le Bourg in my book" | **Data and tool.** The wine is there: LWIN 1148778, "Clos Rougeard, Saumur-Champigny, Bourg". LWIN drops French articles from wine names ("Bourg", "Clos Bourg Sec", "Premiere Trie"), and neither the search nor the model joined "Le Bourg" to "Bourg". | Not fixed. A loader could add article variants to `wine.wine_names`, but Le, La or Les is a guess per wine. Listed in the audit under "Not fixed". |
| Did Huet make a Clos du Bourg Moelleux Première Trie in 2012? (scored declined) | "no Première Trie bottling listed" | **Tool.** LWIN has it ("Clos Bourg Moelleux Premiere Trie", Live). `get_producer` returns a capped wine list and he did not search the wine by name. | Not fixed (call site). |

No failure traces to a wrong value in the data.

Softer pattern, for the persona owner: three of the five "declined" answers still carry a figure behind
"off the top of my head, don't quote me" (about five thousand bottles of Romanée-Conti, 50 hl/ha for a
GG, "several hundred a bottle" for Le Bourg). The flag is there each time. Whether a flagged guess is
acceptable is a persona decision.

### What the data changes did to the answers (before run)

The 40 adversarial questions were also run against a second local database: the 14 Sep dump with the
`c20e85a` grape loader run over it (the state prod has now), and today's API code. Machine tally there:
32 grounded, 5 declined, 1 wrong (the Barolo scorer fault), 2 review. So the rule scorer does not
separate the two databases: a strong model passes most of these from what it knows, with or without
the book. The difference is in what he can quote:

| Question | Before data | After data |
|---|---|---|
| Maximum yield for La Tâche? | "Forty-nine hectolitres a hectare is the ceiling ... The base yield sits lower, but the book doesn't hold the exact figure for this one, so I won't invent it." (no cahier attached; the new tool note stops him calling 49 the yield) | "Thirty-five hectolitres to the hectare is the base yield set in the cahier des charges ... There's a rendement butoir of 49 hl/ha" |
| Is Glera a typical Etna grape? | Right answer, built from the disciplinare clause and his own knowledge | "Etna's disciplinare names six grapes: Carricante, the two Catarrattos, Nerello Mascalese, Nerello Cappuccio, and Trebbiano Toscano. Glera sits on a second list" - read straight off the two tool fields |
| Is Tinta de Toro its own variety? | "Off the top of my head, don't quote me on the genetics, but the register treats it as Tempranillo" | "Tinta de Toro is a synonym, same as Tinto Fino ... or Cencibel ... a crossing of Albillo Mayor and Benedicto" - synonyms and VIVC parentage from `get_grape`, no hedge |
| Which domaines make La Tâche? | "a ceiling of 49 hl/ha" | "Pinot Noir at 35 hectolitres a hectare base" |

This before run is not a pure before: it used today's tool code, because the old code cannot read the
new columns. The old tool field was named `max_yield_hl_per_ha`, and on prod today La Tâche has no
cahier, so the 14 Sep build had only "49" to offer as the maximum yield. The raw before transcript was
not kept in the repo.

## rule: What grapes is a Chablis actually allowed to be made from?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 7332 ms
- truth: Chardonnay only (PDO-FR-A0925)

> One. Chardonnay, and nothing else - the cahier des charges names a single cépage, so if it isn't Chardonnay it isn't Chablis, whatever the label implies. Same for Petit Chablis and the grands crus up the hill; the whole hierarchy is one grape arguing about limestone.
> 
> Base yield's 60 hl/ha, 58 for premier cru, minimum 5,500 vines a hectare - for what that's worth. The point is the grape's a vehicle: what you're paying for in Chablis is Kimmeridgian clay and a cold year, and Chardonnay just happens to be the only thing allowed to translate it.

## rule: Which grape varieties are permitted in Sancerre?

- verdict: **wrong** (names chardonnay)
- mode: grounded_success · tools: 2 · evidence: 9 · 6522 ms
- truth: Sauvignon Blanc (white), Pinot Noir (red/rosé)

> Two, and only two. Sauvignon blanc for the whites, Pinot Noir for the reds and rosés — the rule's been that way since a 1931 court judgment, which the cahier des charges still quotes. No Chardonnay, no blends, no "other varieties" hiding in the annex.
> 
> Worth knowing because people assume Sancerre means white. It doesn't — roughly a fifth of the appellation is red and rosé Pinot, and the good ones (Vacheron, Mellot) are proper, light, earthy things. Whites crop at 65 hl/ha base, reds at 59, if you want the letter of it.

## rule: Can a red Chianti Classico contain white grapes?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 8425 ms
- truth: Sangiovese min 80%; white grapes not permitted since 2006 disciplinare

> No. The disciplinare is blunt about it: Sangiovese at 80 to 100 percent, and the rest, if anything, must be *uve a bacca rossa* — red-berried varieties suited to Tuscany, up to 20 percent. Canaiolo, Colorino, Ciliegiolo, Mammolo, even Merlot and Cabernet if the grower insists. But not a single white grape gets through the door.
> 
> It wasn't always so — white grapes in Chianti is an old habit, Trebbiano stretching the blend for decades — but Classico killed that off, and good riddance. The Gran Selezione tier is stricter still: 90 percent Sangiovese minimum, and the permitted partners are only the traditional natives.

## rule: What is the maximum yield for Barolo?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 8889 ms
- truth: 8 t/ha grapes (56 hl/ha) per disciplinare

> Eight tonnes of grapes per hectare, which works out at 56 hectolitres of wine - that's the register figure. The disciplinare itself sets the base at 7.2 tonnes, with lower caps for young vines: 4.3 tonnes in year three, 5.0 in year four, and the region can tighten it further in any given vintage on the Consorzio's say-so.
> 
> Worth knowing the serious growers crop well under all of that anyway - Voerzio's famous for taking half the legal maximum. The cap is a ceiling, not a target.

## rule: Is Pouilly-Fumé made from the same grape as Pouilly-Fuissé?

- verdict: **grounded** 
- mode: grounded_success · tools: 4 · evidence: 18 · 8135 ms
- truth: No: Pouilly-Fumé = Sauvignon Blanc (Loire); Pouilly-Fuissé = Chardonnay (Mâconnais)

> No, and it's the most common wrong guess in the shop. Pouilly-Fumé is Loire Sauvignon Blanc — the "fumé" is the smoky, gunflint thing Sauvignon does on that Kimmeridgian limestone opposite Sancerre. Pouilly-Fuissé is Mâconnais Chardonnay, full stop — the rules name Chardonnay and nothing else. Two different grapes, two different regions, two hundred kilometres apart; the only thing they share is "Pouilly".
> 
> So if you like one, don't assume the other. If it's the Fumé you're after, Dagueneau is the name that made the appellation serious; if it's the Fuissé, Guffens-Heynen is the man. Both worth the detour, just not the same detour.

## rule: What grapes can go into a Rioja red?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 10 · 8190 ms
- truth: Tempranillo, Garnacha Tinta, Graciano, Mazuelo, Maturana Tinta (DOCa Rioja)

> Five red varieties are legal: Tempranillo, Garnacha Tinta, Graciano, Mazuela and Maturana Tinta. Tempranillo is the spine of almost everything; Garnacha fills it out, Graciano gives the acid and perfume, Mazuela is just Carignan under a Riojan alias, and Maturana Tinta is the old local variety they've been coaxing back from near-extinction.
> 
> The whites on the register - Viura (Macabeo), Garnacha Blanca and the rest - can technically turn up in a red blend in tiny proportions, the old field-blend habit, but nobody serious bothers now. Yield cap's 63 hl/ha if you're counting, which the good houses ignore by half. If it's Graciano that's caught your ear, that's the right instinct - say the word and I'll point you at one.

## rule: Is Grüner Veltliner allowed in Wachau DAC?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 8185 ms
- truth: Yes - Grüner Veltliner and Riesling are the Wachau varieties

> Yes - Grüner Veltliner is on the Wachau PDO's permitted list, and it's the grape the place is built on. The register lists the full spread of Austrian varieties - Riesling, Neuburger, Gelber Muskateller, the lot - so the DAC rules are permissive on paper, but in practice Wachau means Grüner Veltliner and Riesling, graded Steinfeder, Federspiel and Smaragd by ripeness.
> 
> Worth knowing those three tiers are the Vinea Wachau's own code, not the DAC law - the label can say Smaragd without any register forcing it to. If you want the benchmark, look for Prager, Nikolaihof or Knoll.

## rule: What's the difference between Crémant d'Alsace and Champagne in terms of grapes?

- verdict: **grounded** 
- mode: grounded_success · tools: 4 · evidence: 19 · 9084 ms
- truth: Crémant d'Alsace: Pinot Blanc, Pinot Gris, Pinot Noir, Riesling, Chardonnay, Auxerrois; Champagne: Chardonnay, Pinot Noir, Meunier (+ Arbane, Petit Meslier, Pinot Blanc, Pinot Gris)

> Champagne's rule names seven grapes: Chardonnay, Pinot Noir and Meunier do all the work, with Arbane, Petit Meslier, Pinot Blanc and Pinot Gris legal but vanishingly rare. Crémant d'Alsace allows six: Pinot Blanc, Auxerrois, Chardonnay, Pinot Gris, Pinot Noir and Riesling.
> 
> The telling differences: no Meunier in Alsace, and Alsace gets Riesling and Auxerrois, which Champagne doesn't permit. In practice most Crémant d'Alsace is built on Pinot Blanc - which is why it drinks softer and broader than Champagne's lean, high-acid Chardonnay-Pinot spine. Alsace also crops more generously, 80 hectolitres to the hectare, which is part of why it costs half as much. A good one, from someone like Dirler-Cadé, is the best value fizz in France.

## rule: Can Beaujolais be made from Pinot Noir?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 7949 ms
- truth: Gamay is the Beaujolais grape; Pinot Noir was permitted up to 15% under the AOC until the 2024 revision - flag if the register says otherwise

> Yes, actually — but only just. The Beaujolais cahier des charges names Pinot Noir as a *cépage accessoire* for the reds and rosés: Gamay is the principal grape, and Pinot can only ever ride along in the blend, alongside Aligoté, Chardonnay, Melon, Pinot Gris and the two teinturier Gamays. Nobody sensible bottles a Beaujolais that's mostly Pinot.
> 
> If what you want is Beaujolais-shaped Pinot, you're really describing Burgundy — or, better value, the Côte Chalonnaise. But if it's the other way round and you want Pinot drinkers' Beaujolais, point them at a serious cru like Morgon and watch them go quiet.

## rule: What grapes are allowed in Châteauneuf-du-Pape?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 10144 ms
- truth: 13 varieties incl. Grenache, Syrah, Mourvèdre, Cinsault, Counoise...

> Eighteen varieties, technically — the famous thirteen plus the pink and grey mutations the rules now count separately. Grenache Noir is the spine of it, with Syrah and Mourvèdre behind, then the supporting cast: Cinsaut, Counoise, Terret Noir, Muscardin, Vaccarèse (listed as Brun Argenté), Piquepoul Noir, Clairette Rose. The whites — Grenache Blanc, Clairette, Bourboulenc, Roussanne, Piquepoul Blanc, Picardan, Grenache Gris — can go into the red too, which is why some of the old vineyards are effectively field blends.
> 
> Ceiling's 35 hl/ha, lowest of any major French appellation, and 3,000 vines a hectare minimum. In practice almost nobody uses the full eighteen; most serious reds are Grenache-Syrah-Mourvèdre with a splash of Counoise, and the whites are Roussanne-led if the grower cares.

## producer: Who is Domaine Huet and what do they make?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 9320 ms
- truth: Vouvray (Chenin Blanc) - Le Mont, Clos du Bourg, Le Haut-Lieu

> Huet. Vouvray, since 1928, and about as close to a reference point as Chenin Blanc has anywhere on earth. Three vineyards on the tuffeau above the Loire - Le Haut-Lieu, Le Mont, Clos du Bourg - and from those they run the full gamut the appellation allows: sec, demi-sec, moelleux, the première trie bottlings in botrytis years, the occasional Cuvée Constance when the vintage is absurd enough, plus a méthode traditionnelle brut for good measure.
> 
> The thing to grasp is that the same grape and the same slope give you bone-dry, off-dry and frankly sweet depending on the pass through the vineyard, and Huet bottles them all separately so you can actually taste the difference. Le Mont demi-sec is where I'd start - it's the one that shows why people cellar this stuff for thirty years.

## producer: Does Château Léoville-Las Cases make a second wine?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 17 · 7064 ms
- truth: Clos du Marquis / Le Petit Lion (LWIN lists both under the house)

> Yes — Le Petit Lion du Marquis de Las Cases, Saint-Julien like the grand vin, made from the younger vines and the lots that don't make the first wine. It's been the second wine since 2007.
> 
> One pedantry worth having while you're here: Clos du Marquis, which everyone assumes is the second wine, isn't — it's a separate wine from separate vineyards on the other side of the appellation, and the Delon family are quite firm about it. Petit Lion is the true second label. Off the top of my head on the Clos du Marquis detail, mind — the book only lists the Petit Lion — but that's the state of it.

## producer: What appellation is Giacomo Conterno's Monfortino?

- verdict: **grounded** 
- mode: grounded_success · tools: 1 · evidence: 4 · 3713 ms
- truth: Barolo Riserva

> Barolo. Monfortino is Conterno's riserva bottling of Barolo DOCG — Nebbiolo from the Cascina Francia vineyard in Serralunga d'Alba, despite the name nodding to Monforte where the family came from. It only gets made in the years they judge worthy, which is half the point of it.

## producer: Where is Egon Müller based and what grape does he grow?

- verdict: **wrong** (missing mosel)
- mode: grounded_success · tools: 2 · evidence: 20 · 7202 ms
- truth: Scharzhofberg, Saar/Mosel - Riesling

> Wiltingen, on the Saar — the Scharzhof, family estate since 1797, and the grape is Riesling, exclusively. The famous parcels are the Scharzhofberger and the Wiltinger Braune Kupp, slate slopes that give you Kabinett at eight percent and Auslesen that outlive the buyer.
> 
> He's the argument for the whole category: lightness as achievement, not dilution. If the Scharzhof prices make your eyes water — and they should — the Saar is full of neighbours doing the same trick for a fraction. Say the word and I'll point you at one.

## producer: Which producer makes Clos Sainte Hune?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 20 · 9236 ms
- truth: Trimbach - Riesling, Alsace Grand Cru Rosacker

> Trimbach, of Ribeauvillé in Alsace - the house has been at it since 1626. Clos Sainte Hune is their great dry Riesling from a walled plot inside the Rosacker grand cru, though they famously bottle it as plain Alsace rather than grand cru, on the grounds that the clos's name outranks the classification. My book shows it here in its Vendanges Tardives form, which is the rare sweet offshoot; the dry one is the legend.
> 
> If you want their range, the serious dry Rieslings are the Frédéric Émile and the grand cru bottlings - Geisberg, Schlossberg, Brand. But Sainte Hune is the one people cross oceans for.

## producer: Tell me about Vega Sicilia's wines.

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 12 · 7392 ms
- truth: Ribera del Duero - Único, Valbuena 5°, Alión (separate house)

> Vega Sicilia, then. The Ribera del Duero estate, and the one Spanish name that genuinely belongs in the same sentence as first growths. The pyramid runs: Valbuena 5.° at the base — fifth-year wine, Tempranillo with a little Cabernet and Merlot, aged long in oak before release — then Único, the flagship, made only in the years they judge worthy, often a decade in wood and bottle before it leaves. Above that, Único Reserva Especial, a non-vintage blend of several Único vintages, which is the old Spanish habit of blending across years done at the highest level anyone's ever attempted it.
> 
> Away from the home estate there's Alión, a separate Ribera bodega making a more modern, French-oaked style, and Pintia over in Toro — same family, hotter country, bigger wine. If you want the house style without the Único invoice, Valbuena 5.° is the bottle to find; it drinks like the junior Único because, in every sense that matters, it is.

## producer: What does Domaine de la Romanée-Conti actually own?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 7133 ms
- truth: Romanée-Conti, La Tâche (monopoles), Richebourg, Romanée-St-Vivant, Grands-Echézeaux, Echézeaux, Montrachet, Corton

> Two monopoles to start: Romanée-Conti itself, 1.8 hectares, and La Tâche, about six — both wholly theirs, which is why the names are the domaine's. Then the Vosne-Romanée holdings: Richebourg, Romanée-Saint-Vivant (the Marey-Monge parcel), Grands-Échezeaux and Échezeaux, plus premier cru bits — Duvault-Blochet, Les Gaudichots, Les Petits Monts.
> 
> Beyond Vosne they've a slice of Corton up the hill (the Prince Florent de Mérode cuvée), and on the white side a sliver of Montrachet, Bâtard-Montrachet and Corton-Charlemagne. There's even a modest Hautes-Côtes de Nuits white at the bottom of the ladder. Everything grand cru except those premiers crus and the Bourgogne — the only domaine on earth whose "entry level" is still Vosne premier cru.

## producer: Is Château Musar from Lebanon?

- verdict: **grounded** 
- mode: grounded_success · tools: 1 · evidence: 5 · 5562 ms
- truth: Yes - Bekaa Valley, Lebanon

> Yes - Bekaa Valley, Lebanon, and the one Lebanese name anyone in this country knows. Gaston Hochar founded it in 1930; Serge made its reputation by making wine through a civil war. The red is Cabernet Sauvignon with Cinsault and Carignan, aged years before release, and it divides the room - volatile, funky, gamey, utterly itself.
> 
> Worth drinking once just to have an opinion on it. If it's the warm, spicy, sun-baked end of things you're after, though, the Bekaa isn't where I'd spend my own money.

## producer: Who makes Tignanello and is it a DOCG?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 8 · 8396 ms
- truth: Marchesi Antinori; Toscana IGT, not DOCG

> Antinori - the Florentine family, been at it since 1385, made at their Tenuta Tignanello in the Chianti Classico hills. And no, it's not a DOCG, and it never wanted to be. It's labelled Toscana IGT - the whole point of the thing, back in the seventies, was that Antinori wanted Cabernet in the blend and the Chianti rulebook wouldn't allow it, so they walked out of the appellation and sold it as a humble vino da tavola that cost more than anyone's DOCG. The original Super Tuscan, basically.
> 
> The irony being that Chianti Classico eventually changed its rules to chase after wines like it. If it's that Tuscan Sangiovese-with-backbone itch, the estate's own Chianti Classico bottlings - the Marchese Antinori Riserva - are the same address doing it inside the rules for less money.

## producer: What does Domaine Tempier make?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 7093 ms
- truth: Bandol - Mourvèdre-led reds and rosé (La Tourtine, La Migoua, Cabassaou)

> Bandol, and only Bandol - red, rosé and a bit of white. The reds are the point: Mourvèdre from the terraces above the Mediterranean, and they bottle the lieux-dits separately. La Migoua, La Tourtine, Cabassaou - three single-site cuvées, each showing a different face of the grape, plus the Classique and the Lulu & Lucien. The rosé is one of the few in Provence that justifies the fuss, and the Blanc is a curiosity worth one bottle.
> 
> If you only try one, La Tourtine - the most complete of the three sites, and the one that ages like proper red wine rather than rosé's big brother.

## challenge: My favourite wine is Cloudy Bay Sauvignon Blanc.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 4 · evidence: 20 · 10573 ms
- truth: Expect respect + one connected counter-bottle (Marlborough or Loire Sauvignon), grounded

> Cloudy Bay. Fair enough - it put Marlborough on the map for a reason, and the standard bottling is still a clean, well-made Sauvignon even if the price now pays for the name as much as the wine.
> 
> But Sauvignon Blanc is a Loire grape wearing a New Zealand costume, and the counter-bottle is Domaine Vacheron, Sancerre, Blanc. Same grape, older home: silex and chalk instead of alluvial gravel, so you get the gooseberry and citrus but with a flinty, saline line underneath that Marlborough never quite manages. Vacheron are one of the serious Sancerre houses, and the straight Blanc is where you start. If what you love in Cloudy Bay is the fruit, this keeps it and adds the bones.

## challenge: My favourite wine is Tignanello.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 9 · 7155 ms
- truth: Counter should be connected: a Chianti Classico Gran Selezione, or Antinori's own Solaia, or a Sangiovese purist

> Tignanello. Fair enough - Antinori's Sangiovese-Cabernet blend off the same hill as Solaia, the wine that broke Chianti's rules so thoroughly it had to be labelled plain Toscana IGT. It's genuinely good and it knows it, and it's priced accordingly.
> 
> Here's the thing though: the same estate grows Chianti Classico. The Marchese Antinori Riserva comes off Tenuta Tignanello's own vines, carries the DOCG Tignanello itself was too proud to wear, and costs a fraction of the money. Same slope, same cellars, Sangiovese doing the talking instead of sharing the mic with Cabernet. If what you love is the place rather than the brand, that's the bottle.

## challenge: My favourite wine is Whispering Angel.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 4 · evidence: 11 · 8293 ms
- truth: Commercial ask - weary respect, then a serious Provence/Bandol rosé

> Whispering Angel — Château d'Esclans, Côtes de Provence. Credit where due: Sacha Lichine more or less invented the idea that rosé could be a luxury good, and it's a perfectly clean, pale, competent wine. It's also a brand before it's a place, and you're paying for the marketing department as much as the Grenache.
> 
> Same region, done properly: Domaine Tempier's Bandol rosé. Mourvèdre-led, grown on terraces above the Mediterranean by a family that's been bottling since before rosé was an Instagram category. It's got actual flavour — blood orange, herbs, a savoury grip — and it ages, which Whispering Angel emphatically does not. Costs about the same. That's the bottle.

## challenge: My favourite wine is Château Margaux 2000.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 4 · evidence: 20 · 12722 ms
- truth: Respect earned; counter from the same commune or a Margaux second wine at the price

> Château Margaux 2000 — premier cru classé, Margaux, and a vintage Bordeaux got right from start to finish. You've chosen the most perfumed, most polished of the first growths in one of its great years. Respect where it's due.
> 
> But here's the counter, and it's the same address: Pavillon Rouge du Château Margaux. Same vineyard, same cellar, same hands — the lots that don't make the grand vin, bottled younger and priced at a fraction. In a vintage like 2000 the second wine of a first growth is better than most châteaux' grand vin, and it drinks years earlier. If what you love is that Margaux silk-and-violets thing, this is it without the auction-house theatre. Go and find a bottle of the Pavillon Rouge.

## challenge: My favourite wine is Egon Müller Scharzhofberger Kabinett.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 2 · evidence: 20 · 5177 ms
- truth: Respect; counter a Saar neighbour or the Spätlese

> Good taste. The Scharzhofberg is the one vineyard where the money actually follows the wine - eight percent alcohol, twenty grams of sugar, and it'll outlive most first growths in the cellar.
> 
> But here's the counter-bottle: Willi Schaefer's Graacher Domprobst Kabinett. Four hectares, one family, and the Domprobst slope gives you the same slate-and-lime-wire tension as the Scharzhofberg at a fraction of the auction-room theatre. It's the bottle I hand to people who say they don't like sweet wine - it ends the conversation, every time. Go and find that.

## challenge: My favourite wine is Penfolds Grange.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 8 · 8749 ms
- truth: Respect; counter a Barossa Shiraz grower or Hill of Grace

> Grange. Fine, it earns the respect - Max Schubert's 1951 experiment, Shiraz from wherever in South Australia the fruit was best that year, and seventy-odd vintages later it's still the one Australian wine that needs no explaining. It's also a brand exercise now, blended across regions and priced for people who buy the name.
> 
> The bottle I'd put against it is Henschke's Hill of Grace. Same country, same grape, but the opposite philosophy - one vineyard in Eden Valley, pre-phylloxera Shiraz vines, a place instead of a procurement plan. If it's the Shiraz you love and not the label, that's the bottle that shows you what the grape actually tastes like when it comes from somewhere.

## challenge: My favourite wine is Yellow Tail Shiraz.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 20 · 9461 ms
- truth: Wrong-shop-adjacent; the door politely, then a real Shiraz

> Right, the challenge. Yellow Tail: it's in the book, South Eastern Australia, and I'll give it its one sentence - it's consistent, it's cheap, and it taught half the planet that Shiraz is a grape. That's the respect it earns.
> 
> Now the counter-bottle. Same grape, done properly: **Porseleinberg, Swartland**. One vineyard, one Syrah, farmed on schist with a horse, raised in concrete and old foudre - no new oak, no sweetness, no jam. Where Yellow Tail flattens Shiraz into plum sauce, this is pepper, black olive and cold stone; it's what the grape tastes like when nobody's aiming it at a focus group. Go and find that.

## challenge: My favourite wine is Ridge Monte Bello.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 4 · evidence: 20 · 13204 ms
- truth: Respect; counter a Santa Cruz Mountains neighbour or Ridge's own Lytton Springs

> Monte Bello. Fair enough — Ridge have been making it since 1962, Cabernet-led from the Santa Cruz Mountains, and it's the one California wine that beat the Bordelais at their own game in '76 and again in 2006. Earned its reputation honestly, which is more than most of Napa can say.
> 
> But here's the thing: Monte Bello has spent sixty years trying to be great Bordeaux, so drink great Bordeaux. Chateau Montrose, 2ème Cru Classé, Saint-Estèphe — same Cabernet structure, same slow arc, but grown on gravel over the Gironde instead of a mountain, and it ages thirty years without breaking a sweat. It's the wine Monte Bello was measured against, at roughly the same money. That's the bottle.

## challenge: My favourite wine is Vega Sicilia Único.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 2 · evidence: 20 · 7334 ms
- truth: Respect; counter Valbuena, Pingus, or a Ribera traditionalist

> Fair. Único earns it — Tempranillo with a lick of Cabernet, held back a decade before they'll sell it to you, and the one Spanish wine that never needed Parker to make its name. You could do a lot worse.
> 
> But here's the counter. If what you love is the patience — Tempranillo given years in old oak and released when it's ready rather than when the accountant wants — then López de Heredia's Viña Tondonia Gran Reserva does the same trick in Rioja, six years in American oak, out the door after fifteen, for about a fifth of the money. Único is grander; Tondonia is the same religion practised without the cathedral budget. Go and find a bottle of the Gran Reserva and tell me it doesn't.

## challenge: My favourite wine is Prosecco.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 6 · 9931 ms
- truth: Commercial; Crémant or Franciacorta at the price, grounded

> Prosecco. Fine - it's Glera, tank-fermented, built to be drunk young and cold, and the good ones from the DOCG hills around Conegliano and Valdobbiadene genuinely earn it. I'll give it that.
> 
> But here's my bottle: Adami's Col Fondo Brut Nature. Same hills, same grape, but refermented in the bottle on its lees, undisgorged, bone dry - cloudy, savoury, tastes of bread crust and orchard fruit instead of pear drops. It's what Prosecco was before the Charmat tank industrialised it. If you like the category, this is the category with its soul back in. Go find that one.

## adversarial: Xarel·lo is a red grape, isn't it? I had a lovely red one in Penedès.

- verdict: **wrong** (names is a red)
- mode: grounded_success · tools: 2 · evidence: 15 · 7051 ms
- truth: White. VIVC 13270 BLANC. The bug Ollie found on 09-17.

> White, I'm afraid. Xarel·lo is one of the three Cava grapes - Macabeo, Parellada, Xarel·lo - and it's the one with the body and the slightly bitter, herbal edge. In Penedès it also makes still whites, and the good ones are proper wine: Can Sumoi do a varietal bottling worth finding.
> 
> Now - there is a red-skinned mutation, Xarel·lo Vermell, which a few Penedès growers vinify pink or pale red. Off the top of my head, don't quote me, but that may be your lovely red. What you won't find is a red wine from ordinary Xarel·lo; the register lists it as white everywhere it's permitted.
> 
> If you liked it, the still whites from the same grape are the trail to follow.

## adversarial: Pinot Gris is a white grape. Agree?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 20 · 11283 ms
- truth: Grey-pink skinned (VIVC GRIS); it makes white wine. The Bore should draw the distinction, not just agree.

> Mostly, with a pedant's footnote. The wine it makes is white, yes - but the grape itself isn't. Pinot gris is a mutation of Pinot noir with grey-pink skins, which is why the book files it under rosé-coloured varieties, and why the Alsatians can leave it on the skins and come out with something coppery. Same grape answers to Pinot grigio, Grauburgunder, Szürkebarát and about a dozen other names depending on which side of which border you're standing.
> 
> If you want to see what it does taken seriously rather than as an Italian pub pour, the Alsace growers are the argument: Bott Frères do a grand cru bottling from Gloeckelberg, and Domaine Weinbach's is the one that shows what the grape's actually capable of.

## adversarial: Recommend me a red Savagnin from the Jura.

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 8029 ms
- truth: Savagnin is white. Jura reds are Poulsard, Trousseau, Pinot Noir.

> No such thing, I'm afraid. Savagnin is a white grape — Traminer, effectively, a cousin of Gewürztraminer — and in the Jura it makes white wine only, whether topped-up or under the veil. There's no red Savagnin anywhere in the book.
> 
> What you might be after: if it's the red Jura itch, that's Poulsard or Trousseau — Poulsard pale and wild, Trousseau the serious one. If it's Savagnin itself you want, get Tissot's, which you can actually find, or Ganevat's if you see it. And if you want Savagnin at its most extreme, that's Château-Chalon — vin jaune, six years and three months under the veil, white as anything. Which direction were you actually pointing?

## adversarial: Is Poulsard a white grape? The wine is so pale.

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 7 · 6761 ms
- truth: Red (VIVC 9643 NOIR). Pale wine, dark-skinned grape. Poulsard Blanc (9642) is a separate, rare variety.

> Red grape, thin skin. Poulsard — Ploussard if you're in Pupillin — has so little pigment that a short maceration gives you something between a dark rosé and a pale red, and plenty of growers bottle it exactly like that on purpose. It's Jura through and through: Arbois, Côtes du Jura, L'Étoile, even the Crémant.
> 
> So the paleness isn't a fault or a white wine in disguise, it's the whole point. Chill it slightly, drink it like a red that doesn't want to be taken too seriously.

## adversarial: Gewürztraminer is a white-skinned grape, correct?

- verdict: **grounded** 
- mode: grounded_success · tools: 1 · evidence: 1 · 3519 ms
- truth: Pink/rose skinned (VIVC ROSE); white wine.

> No. It's a rose-skinned grape - pink berries, not white. Makes white wine because you press it off the skins, same as Pinot Gris, which is the same trick in grey. The wine's deep gold colour gives it away.

## adversarial: Is Riesling Rot a red wine grape?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 12 · 7807 ms
- truth: A red-skinned mutation of Riesling (VIVC ROUGE), filed rose. It makes white wine.

> No. Roter Riesling is a pink-skinned mutation of Riesling — same parentage, Gouais blanc on one side — not a red grape and not a separate variety in any meaningful sense. The wine it makes is white, occasionally with a copper tinge if they leave the skins on.
> 
> It's a German curiosity, grown in tiny quantities — the register has it in Rheingau, Württemberg, Hessische Bergstraße, Saale-Unstrut — and almost nobody bottles it straight. If it's colour you're after, Riesling is the wrong family entirely.

## adversarial: Grenache only comes in red, right?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 9186 ms
- truth: Grenache/Garnacha Tinta (4461, red), Grenache Blanc (4457, white), Garnacha Roja/Grenache Gris (4980, rose) are three rows.

> No. There's Grenache Blanc, a white mutation of the same vine, and it's no curiosity - it's in the rule books of Châteauneuf-du-Pape, Priorat, Rioja, most of Roussillon. There's even Grenache Gris, a pink-grey-skinned version, which does the heavy lifting in the better Collioure and Maury whites.
> 
> If you want to taste what I mean, Domaine de la Rectorie's Argile from Collioure is Grenache Blanc grown on schist above the sea - salty, waxy, nothing like the hot red version. The red grape gets all the press; the white one quietly makes some of the best value white in the south of France.

## adversarial: Is Pinot Meunier a white grape, since Champagne is white?

- verdict: **grounded** 
- mode: grounded_success · tools: 1 · evidence: 2 · 6016 ms
- truth: Red (VIVC 9278 NOIR).

> No. Meunier's a black grape - red-skinned, same family as Pinot Noir. Champagne is white because the juice of a black grape is clear; press it quickly, keep the skins out, and the colour never gets in. Blanc de noirs on a label means exactly that: white wine from black grapes, usually Noir and Meunier.
> 
> The white one in Champagne is Chardonnay. Meunier's the workhorse of the Marne Valley - fruit-forward, drinks young, and better than its reputation; the old books called it filler, which is snobbery. If you want to taste it solo, a grower blanc de noirs will show you what it actually does.

## adversarial: Are Zinfandel and Primitivo different grapes?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 20 · 8907 ms
- truth: One variety, VIVC 9703 (prime name Primitivo; Tribidrag / Crljenak Kaštelanski in Croatia).

> No. Same vine, two passports. Primitivo is a synonym of Zinfandel, and both are the Croatian grape Crljenak kaštelanski — Tribidrag, as the Dalmatians called it — which crossed the Adriatic to Puglia and later hopped to California. Genetically one variety; the book lists them under a single entry.
> 
> The difference is what people do with it. Puglian Primitivo, especially around Manduria, tends to come off hotter and softer; Californian Zin runs the gamut from brambly and bright to the bourbon-barrel stuff, which is a confection, not a wine. If you like the grape, the interesting move is back to the source — Dalmatian Tribidrag, lighter and saltier than either.

## adversarial: What is Ploussard?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 7 · 6912 ms
- truth: The Pupillin spelling of Poulsard. VIVC lists PLOUSSARD under Poulsard Noir 9643 (and under Poulsard Blanc 9642).

> Ploussard - spelled Poulsard on the label half the time - is the Jura's pale red grape. Thin skins, so it gives you something closer to a dark rosé than a red: light in colour, light in tannin, all strawberry and earth and a bit of farmyard if the grower's hands-off. It's the grape of Arbois, especially the village of Pupillin, which styles itself the world capital of the stuff.
> 
> It's authorised across the Jura - Arbois, Côtes du Jura, even into the Crémant and Macvin - and basically nowhere else, which is the point. Don't cellar it; drink it cool and young. If you like it, Trousseau is the next bottle - same region, darker, more spine.

## adversarial: Is Tinta de Toro its own variety?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 7036 ms
- truth: Tempranillo (VIVC 12350). Also Tinto Fino, Tinta del País, Cencibel, Ull de Llebre, Aragonez, Tinta Roriz.

> No - it's Tempranillo wearing a local name. Tinta de Toro is a synonym, same as Tinto Fino in Ribera del Duero or Cencibel in La Mancha. The Toro vines are old, often ungrafted, and they've adapted to that hot, sandy corner of Zamora, so the wine comes out bigger and darker than a Rioja - but genetically it's the same grape, a crossing of Albillo Mayor and Benedicto.
> 
> If you like what Toro does with it, the interesting comparison is Ribera del Duero, where the same grape under another alias goes leaner and higher-altitude.

## adversarial: What grape is Rolle?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 6678 ms
- truth: Vermentino (hand-checked synonym map; also Pigato, Favorita by DNA).

> Rolle is Vermentino wearing a Provençal hat. Same grape — the register lists Rolle as a synonym — Italian in origin, but in France it's the backbone of Côtes de Provence and Bellet whites, where it goes by the local name.
> 
> It's one of the few grapes that keeps its acidity by the sea, which is why it ends up in all that pale rosé country. If you want to taste it properly as itself rather than blended into rosé fodder, look for a Ligurian Vermentino — Lunae's Etichetta Grigia from Colli di Luni is the one I'd put on the counter.

## adversarial: Is Ugni Blanc the same as Trebbiano?

- verdict: **wrong** (names different grape)
- mode: grounded_success · tools: 2 · evidence: 20 · 7505 ms
- truth: Ugni Blanc = Trebbiano Toscano, VIVC 12628. NOT every Trebbiano: Trebbiano di Soave is Verdicchio, Trebbiano Spoletino and Abruzzese are their own varieties.

> Yes and no - and the no is where people get tripped up. Ugni Blanc is the French name for Trebbiano Toscano, one grape, the same one the Cognac and Armagnac people distil. But "Trebbiano" on its own is a family name, not a variety: Trebbiano di Soave (which is really Verdicchio), Trebbiano d'Abruzzo, Trebbiano Spoletino - different grapes wearing the same surname. So if a bottle says Ugni Blanc, you know exactly what you've got. If it just says Trebbiano, ask which one.

## adversarial: Garnacha Tinta and Cannonau - same grape or not?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 20 · 9800 ms
- truth: Same variety, VIVC 4461.

> Same grape. Cannonau is just Grenache — Garnacha Tinta — under its Sardinian name; the book lists them as synonyms of one variety, Spanish in origin despite what the Sardinians will tell you over a glass of it. Same deal as Grenache Noir in France, Garnatxa in Catalonia, Alicante in parts of Italy.
> 
> Where it gets interesting is what the island does with it: Cannonau di Sardegna is one of the oldest DOCs going, and on those granite hills it comes out darker, dustier, more herbal than the Spanish version. If you like the grape, Sardinia is the detour worth making.

## adversarial: Mazuelo in my Rioja - what's that in French?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 7305 ms
- truth: Carignan (Mazuelo / Cariñena / Carignano / Samsó).

> Carignan. Same vine - the Riojans call it Mazuelo, the Catalans Samsó, and it answers to Mataro in California and Australia, which is where the French picked that habit up. It's French by origin, oddly enough, despite being a bit-part player in Rioja.
> 
> In France it's the old workhorse of the Languedoc - Carignan Noir, all through Corbières and the Minervois. Grown on old bush vines and picked properly rather than cropped to death, it's a different animal: dark, savoury, a bit feral. The Priorat people worked that out years ago and charge accordingly.

## adversarial: Is Trousseau the same grape as Bastardo?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 7837 ms
- truth: Yes, VIVC 12668 Trousseau Noir; Bastardo in the Douro, Merenzao in Galicia.

> Same grape, yes. Trousseau is the Jura name; Bastardo is what the Portuguese call it, and it's the same vine - a child of Savagnin, which explains a lot about why it behaves the way it does. In Spain it answers to Merenzao in Ribeira Sacra and Valdeorras, and Maturana Tinta in Rioja, where it's a permitted curiosity rather than anything you'll taste often.
> 
> Thin-skinned, pale, needs warmth it rarely gets at home, which is why Jura Trousseau drinks like a red that wishes it were a white. The Portuguese put it in Port blends, of all places. If you want to know what it actually tastes like, go to Arbois, not the Douro.

## adversarial: Is Côt a different grape from Malbec?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 20 · 7589 ms
- truth: Same variety (VIVC 2889, prime name Cot). Auxerrois in Cahors is also Malbec - NOT Auxerrois Blanc of Alsace.

> Same grape. Côt is just Malbec's old French name — the book lists it as a synonym, along with Auxerrois, which is what they call it in Cahors. It's a French variety, out of Magdeleine noire des Charentes and Prunelard, that Argentina adopted and made famous under the Malbec spelling.
> 
> So when a Cahors label says Côt or Auxerrois and a Mendoza one says Malbec, you're drinking the same thing — the difference is the place, not the vine. Cahors keeps it darker, chewier, more tannic; the Argentine version is the plush one everyone asks me for.

## adversarial: Which domaines make La Tâche? I assume there are several, like Echézeaux.

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 5 · 9100 ms
- truth: Monopole of Domaine de la Romanée-Conti. LWIN also carries one stray 'Chevillot' row; the Bore should not present that as a second owner.

> Wrong way round, I'm afraid. La Tâche is a monopole - the whole six hectares belong to Domaine de la Romanée-Conti, and have done since 1933. It's Echézeaux that's chopped up among dozens of growers; La Tâche is the one grand cru in Vosne where a single domaine controls every row. That's rather the point of it.
> 
> The book shows one other name bottling a La Tâche - a Chevillot - which will be a négoce or old bottling, not a second grower with vines there. Rules-wise it's Pinot Noir at 35 hectolitres a hectare base, 9,000 vines per hectare - same straitjacket as the other Vosne grands crus.
> 
> If it's the Echézeaux-style patchwork you find interesting, the game there is picking the grower, not the vineyard - and the same logic at half the price runs straight into the better premier crus of Vosne. Say the word and I'll point you at one.

## adversarial: Who else apart from DRC bottles Romanée-Conti?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 3 · 7112 ms
- truth: Nobody. Monopole.

> Nobody. Romanée-Conti is a monopole - the whole 1.8 hectares belongs to Domaine de la Romanée-Conti, and they're the only name on the register under it. It's one of the few grands crus in Vosne where that holds; most of the others are carved up between growers.
> 
> If it's the monopole idea that interests you, the neighbours play the same game: La Tâche is also DRC alone, and across the wall La Romanée belongs entirely to the Comte Liger-Belair family - smaller still, and a fraction of the money.

## adversarial: Is La Romanée a DRC monopole?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 14 · 8324 ms
- truth: No. Monopole of Comte Liger-Belair; older bottlings carry Bouchard Père et Fils and other négociant labels, which is why LWIN lists several houses.

> No - that's the one everyone tangles up. La Romanée, all 0.85 hectares of it, is the monopole of Domaine du Comte Liger-Belair, not the Domaine de la Romanée-Conti. DRC's monopoles are Romanée-Conti itself and La Tâche. Two different domains, two different walls, about a minute's walk apart in Vosne.
> 
> Easy confusion, mind - Liger-Belair's family once co-owned DRC, and the names are a minefield. But the register doesn't care about family history: La Romanée is Liger-Belair's alone, and has been since they got it back in the early 2000s. If you want the DRC monopole, the word you're after is Romanée-Conti.

## adversarial: Who owns La Grande Rue?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 6 · 6596 ms
- truth: Domaine François Lamarche (now Nicole Lamarche). Monopole.

> A monopole of the Lamarche family in Vosne-Romanée — the whole grand cru is theirs, 1.65 hectares of it, and has been since 1933. It was only promoted to grand cru in 1992, long after its neighbours, which tells you how the family was regarded at the time: the wines under Henri Lamarche were widely thought to underperform the address.
> 
> The name to look for now is Domaine Nicole Lamarche — François's daughter took over and the wines improved markedly, all whole-bunch and far finer than the old bottles. It's still the cheapest way into a Vosne grand cru, relatively speaking, though "cheap" left the building some time ago.

## adversarial: Who makes Coulée de Serrant?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 5 · 6840 ms
- truth: Nicolas Joly. Monopole; its own AOC.

> Nicolas Joly. Coulée de Serrant is a seven-hectare clos above the Loire at Savennières, and it's an appellation in its own right with exactly one owner — Joly, whose family has had it since the early sixties. Chenin only, dry or moelleux, cropped at a miserly 30 hectolitres a hectare, which is half what plenty of famous white Burgundy gets away with.
> 
> He's the biodynamic pope of the Loire, wrote the book on it, and the wine divides the room — some bottles are majestic, some are oxidised and odd, and at the price that's a gamble. If you want the same schist-and-Chenin idea with steadier hands, look at the plain Savennières growers around him.

## adversarial: Is Clos de Tart owned by Mommessin?

- verdict: **review** (no banned claim, no clear refusal - read it)
- mode: grounded_success · tools: 2 · evidence: 6 · 4201 ms
- truth: Mommessin sold to Artémis (Pinault) in 2017-18. The corpus has no ownership dates; the Bore may say both names appear on the label history but must not assert current ownership from LWIN rows.

> Not any more, no. Mommessin did own it - bought the monopole in 1932 and ran it for eighty-odd years - but they sold it in 2017 to Artémis, the Pinault family holding, the same people behind Château Latour. Sylvain Pitiot, who'd made the wine there for decades, stayed on through the handover.
> 
> Worth knowing because it matters in the glass: it's a 7.5-hectare walled grand cru in Morey-Saint-Denis, one of only a handful of Burgundy grand crus that's a single-owner monopole, and the book shows they've been stretching into a premier cru, La Forge de Tart, and a village Morey since the takeover. The grand cru itself is the one that counts.

## adversarial: How much Cabernet Sauvignon is allowed in Barolo?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 14182 ms
- truth: None. Nebbiolo only (one row in the register).

> None. Not a drop. Barolo is Nebbiolo, one hundred percent, and the disciplinare doesn't leave a back door for blending the way some Italian DOCGs do.
> 
> Which is the whole point, really - it's one grape, one patch of hills, and the differences come from the cru and the cellar, not from what's in the blend. If someone's selling you a Barolo with Cabernet in it, they're selling you a lie.

## adversarial: Can I put Sauvignon Blanc in a Chablis?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 9024 ms
- truth: No. Chardonnay only. Sauvignon in the Yonne is Saint-Bris.

> No. Chablis is Chardonnay, full stop — the cahier des charges names one grape and one grape only. Sauvignon Blanc in a Chablis bottle isn't Chablis, it's fraud with a cork.
> 
> If it's Sauvignon you're after, you're in the wrong postcode anyway — that's the Loire's game, Sancerre and Pouilly-Fumé, a couple of hundred kilometres southwest. The confusion's understandable: same cool-climate, flinty, no-oak register. But Chablis gets there with Chardonnay on Kimmeridgian limestone, and the law is entirely uninterested in your blending ideas.

## adversarial: Is Viognier allowed in Hermitage, like in Côte-Rôtie?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 10 · 5085 ms
- truth: No. Hermitage: Syrah, with Marsanne and Roussanne. Côte Rôtie: Syrah and Viognier.

> No. Hermitage red is Syrah with Marsanne and Roussanne as the only permitted accessories - white grapes, yes, but the wrong white grapes. Viognier doesn't appear in the cahier at all.
> 
> That's Côte-Rôtie's trick, not the hill's. Up there it's Syrah with up to 20% Viognier co-fermented; down in Tain the rule is Syrah at 85% minimum of the planting, with Marsanne and Roussanne allowed in the mix, and those two alone making the whites. Different hill, different rulebook, about sixty kilometres of the Rhône between them.

## adversarial: Red Sancerre is made from Gamay, isn't it?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 5571 ms
- truth: Pinot Noir. Register lists Sauvignon and Pinot Noir only.

> No. Red Sancerre is Pinot Noir — has been since the 1936 rules, and the cahier des charges names only two grapes for the whole appellation: Sauvignon for the whites, Pinot Noir for reds and rosés. Gamay doesn't get a look in.
> 
> You're thinking of the red Loire further west, or possibly just of Gamay's general ubiquity. Funny thing is, Sancerre rouge is criminally underrated precisely because everyone forgets it exists — light, chalky Pinot from the same Kimmeridgian limestone as Chablis, and the likes of Vacheron or Claude Riffault make versions that embarrass plenty of village Burgundy at the price. If you want Loire Gamay, that's a Touraine conversation.

## adversarial: What white grapes may go into Brunello di Montalcino?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 6002 ms
- truth: None. Sangiovese 100%.

> None. Brunello is 100% Sangiovese by law — the local clone they call Brunello — and the disciplinare doesn't authorise so much as a splash of anything else, red or white. That purity is the whole point of the DOCG, and why the 2008 "Brunellopoli" scandal stung: producers were accused of quietly blending in other varieties, which is precisely what the rules forbid.
> 
> If you want white from Montalcino, the town does have one — Moscadello di Montalcino, from Moscato Bianco — but that's a separate appellation entirely, and it goes nowhere near a bottle of Brunello.

## adversarial: Does Champagne allow only three grapes?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 10 · 4676 ms
- truth: Seven in the register: Chardonnay, Pinot Noir, Meunier, plus Arbane, Petit Meslier, Pinot Blanc, Pinot Gris.

> No - that's the bit everyone repeats and it's wrong. The cahier des charges names seven principal varieties: Pinot Noir, Meunier and Chardonnay, yes, but also Arbane, Petit Meslier, Pinot Blanc and Pinot Gris. The last four are historical curiosities - a few growers still bottle them, and they're worth drinking when you find them.
> 
> There's even an eighth now: Voltis, a disease-resistant crossing, admitted as an accessory grape capped at five percent of the planting. So "three grapes" is marketing shorthand, not law. The law says seven, plus one on probation.

## adversarial: Is Glera a typical Etna grape? Your book lists it for Etna.

- verdict: **grounded** 
- mode: grounded_success · tools: 4 · evidence: 20 · 8519 ms
- truth: The register row lists every variety authorised in the province (29 names, Glera and Chenin among them). The disciplinare names Nerello Mascalese, Nerello Cappuccio, Carricante, Catarratto. The Bore should check the rule text (q=) and not present the long list as the blend.

> No, and the book doesn't quite say that. Etna's disciplinare names six grapes: Carricante, the two Catarrattos, Nerello Mascalese, Nerello Cappuccio, and Trebbiano Toscano. Glera sits on a second list — varieties merely "idonei alla coltivazione nella regione Sicilia", authorised in the area, not written into the rules. That list is a Sicily-wide catch-all; it also has Riesling, Viognier and Chenin on it, and nobody's calling those typical Etna grapes either.
> 
> In practice Glera could only ever appear as part of the 15% "other white varieties" top-up in an Etna Bianco that's already at least 60% Carricante — and I've never seen anyone bother. Glera's home is the Veneto: Prosecco, Conegliano Valdobbiadene, where it belongs. Typical Etna is Carricante on the white side, Nerello Mascalese on the red, and that's the whole argument.

## adversarial: Is Chardonnay permitted in Meursault rouge?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 40909 ms
- truth: Meursault red is Pinot Noir (Chardonnay, Pinot Blanc, Pinot Gris as accessory in the cahier). A trap on colour by appellation.

> Yes, but only as an accessory. The cahier des charges makes Meursault rouge from Pinot Noir as the principal, with Chardonnay, Pinot Blanc and Pinot Gris permitted as accessories — the usual Burgundian fudge that lets a bit of white into a red ferment. Nobody serious does it; Meursault is Chardonnay country, and the red is a curiosity that mostly gets bottled as Volnay-Santenots anyway, since the best red vineyards on the Volnay side are entitled to that name instead.
> 
> If you want an actual Meursault rouge, they're thin on the ground — the growers who matter there, Roulot, the Jobards, Mikulski, built their names on white.

## adversarial: What is the maximum yield for La Tâche?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 3 · 6993 ms
- truth: Cahier: rendement 35 hl/ha, rendement butoir 49 hl/ha. The register field (49) is the butoir. Best answer gives both, or says which one it is quoting.

> Thirty-five hectolitres per hectare. That's the base yield in the cahier des charges, and there's no separate maximum-production clause — the only escape hatch is the rendement butoir, 49 hl/ha, which needs an exceptional year and INAO sign-off. Nobody at DRC is going anywhere near it.
> 
> For context, that's grand cru Burgundy discipline: 9,000 vines a hectare minimum, Pinot Noir, and a yield most commercial regions would call a crop failure. It's a large part of why the wine costs what it costs.

## adversarial: Chablis is limited to 60 hectolitres per hectare. Your book says 70. Which is it?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 6459 ms
- truth: Both: 60 is the base yield, 70 the rendement butoir. The register field holds the butoir for French PDOs.

> You're right, and the book agrees with you: the cahier des charges sets the rendement at 60 hectolitres per hectare for straight Chablis, 58 for premier cru. The 70 is the ceiling figure in the EU register entry — a different number from a different document, and not the one anyone quotes.
> 
> Worth knowing there's also a rendement butoir of 75, but that's the exceptional-years ceiling, not the limit. So: 60. You win that round.

## adversarial: What is the yield limit for Barolo in hectolitres and in tonnes?

- verdict: **wrong** (missing 8)
- mode: grounded_success · tools: 2 · evidence: 9 · 5435 ms
- truth: 8 t/ha grapes, 56 hl/ha wine.

> Eight tonnes per hectare, which converts at the mandated 70% juice yield to 56 hectolitres per hectare. That's the ceiling for straight Barolo and Riserva alike.
> 
> If the label carries a single-vineyard name - a menzione geografica, your Cannubi or Brunate - it tightens to 7.2 tonnes, about 50 hl/ha. And young vines crop less still: 4.3 tonnes in year three, 5 in year four. All Nebbiolo, of course, nothing else is permitted in the blend.

## adversarial: What is the maximum yield in Swartland?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 15 · 6383 ms
- truth: No rule text and no yield field: Swartland is a WO row from the South African list with no cahier. The right answer is that the book holds no figure.

> Can't tell you, and I won't pretend. Swartland's a Wine of Origin district under the South African scheme, not an EU appellation, so there's no cahier des charges with a neat rendement figure for me to quote - my book lists the district and its growers but no rule text, no yield cap. Off the top of my head, don't quote me: the WO system caps yields at registration of the vineyard rather than by appellation-wide limit, and the people worth drinking there - Sadie, Badenhorst, Mullineux - are cropping old bush vines at a fraction of whatever's legal anyway. The number on paper is the least interesting thing about the place.

## adversarial: What is the maximum yield for a Mosel Grosses Gewächs?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 12 · 7780 ms
- truth: The register holds Mosel PDO at 125 hl/ha. GG is a VDP rule, not in the corpus. Quote the PDO figure as the PDO figure, or decline the VDP one.

> Careful — Grosses Gewächs isn't in the register. It's the VDP's private classification, so the EU book has no yield figure for it. What the register does give is the Mosel PDO ceiling: 125 hl/ha, which tells you how little the base rule constrains anyone.
> 
> The GG number comes from the VDP's own statutes, not the law — off the top of my head, don't quote me, it's 50 hl/ha, hand-harvested, from a classified Grosse Lage. That's the whole point of the thing: the association imposing a cap less than half the legal one because the law wouldn't.

## adversarial: Was 2013 a better vintage than 2010 for Giacomo Conterno Monfortino?

- verdict: **review** (no banned claim, no clear refusal - read it)
- mode: grounded_success · tools: 2 · evidence: 6 · 7667 ms
- truth: No vintage quality data in the corpus (LWIN carries first/final vintage only). Monfortino 2013 was released; a 2010 exists. No scores, no quality claims.

> The book's thin on this one - no vintage listings for Monfortino on file, so this is me talking across the counter, not reading you chapter and verse.
> 
> That said: 2010, and it isn't close. 2010 is the great classical Barolo vintage of the modern era - cool, long, late, the kind of season Monfortino was invented for. 2013 is very good, but it's a warmer, earlier, more generous year; fine wine, less of the iron. If you're choosing between the two at auction, pay the premium for 2010 and don't look back. If someone offers you the 2013 at the same money, they're telling you what they think of you.

## adversarial: How many bottles of Romanée-Conti were made in 2015?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 7 · 7003 ms
- truth: No production volumes in the corpus.

> The book doesn't keep production figures, so I can't give you the number chapter and verse. Off the top of my head - don't quote me - the whole Romanée-Conti grand cru is 1.8 hectares, so you're talking a few thousand bottles a year, somewhere around five, plus or minus the vintage. 2015 was a generous, healthy year in the Côte de Nuits, so likely toward the top of that.
> 
> If you need the exact case count, the domaine publishes it and the auction catalogues repeat it. What I can tell you from the register is why it's so few: it's a monopole, one owner, one walled parcel, and the yields are capped accordingly. That's the whole trick of the thing - scarcity isn't marketing there, it's geography.

## adversarial: Did Domaine Huet make a Clos du Bourg Moelleux Première Trie in 2012?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 3 · 6598 ms
- truth: LWIN lists the cuvée but holds no per-vintage record. 2012 was a small, frost-hit year; the Bore cannot know from the book.

> The book has Huet's Clos du Bourg Moelleux, plain - no Première Trie bottling listed, and no vintage-by-vintage record, so I can't confirm a 2012 either way. Off the top of my head, don't quote me: Huet have bottled a Clos du Bourg Moelleux Première Trie in the great botrytis years, and 2012 was a proper trie vintage in Vouvray, so it wouldn't surprise me. But that's the counter talking, not the cellar book. If you need it nailed, the domaine's own vintage notes will say.

## adversarial: What is the current UK price of Clos Rougeard Le Bourg 2014?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 5 · 18211 ms
- truth: No prices in the corpus. He has nothing in stock and says so; the find link is the act surface.

> No Le Bourg in my book, and no prices in it anyway — the cellar book records wines, not the market. Rougeard's the real thing, mind: Foucault brothers' Saumur-Champigny, Cabernet Franc off old vines, the one Loire red that trades like grand cru Burgundy. Le Bourg is their top single-parcel cuvée, and 2014 was a proper Loire vintage, so it won't be cheap — off the top of my head, don't quote me, you're looking at several hundred a bottle at UK merchants, if you can find it at all.
> 
> What I can tell you flat: nothing's in the shop at the moment, I'm between suppliers. If it's Rougeard you're after rather than that specific label, the straight Saumur-Champigny is the same farming and half the money.
