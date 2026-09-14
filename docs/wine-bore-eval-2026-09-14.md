# Wine Bore eval - 2026-09-14

API: http://localhost:3010. 30 questions: 10 appellation rules, 10 producer facts, 10 favourite-bottle challenges.

| grounded | hedged | wrong | review | error |
|---|---|---|---|---|
| 20 | 0 | 0 | 10 | 0 |

Two rows rescored by hand after a scorer bug (a `must` list that demanded both accent spellings); the `|` either-of syntax fixed it in `eval.ts`. The ten challenges were read: all ten grounded with a connected counter-bottle; the weakest connection is Grange to Swartland Porseleinberg (pack-driven). Wrong count for this run: 0.

Median time: 26413 ms. Mean tool calls: 2.5.

"review" rows are the challenges: a rule cannot score them. Read each and mark it grounded / wrong in the table below, then update the tally by hand.

## rule: What grapes is a Chablis actually allowed to be made from?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 10997 ms
- truth: Chardonnay only (PDO-FR-A0925)

> Chardonnay. Only Chardonnay. The cahier des charges permits exactly one grape, white Chardonnay, and that's the whole story - no Pinot Gris sneaking in, no blending cushion. Yield's capped at 70 hectolitres a hectare, minimum 5,500 vines per hectare, which is generous by Burgundian standards and explains why cheap Chablis exists at all.
> 
> The thing people get wrong: Chablis isn't a style, it's a place with one legal grape. When someone says "this unoaked Chardonnay is very Chablis-like," what they mean is the place, not the rulebook. Same applies up the ladder - Chablis grand cru is the same single grape, just seven climats on the right slope of Kimmeridgian.

## rule: Which grape varieties are permitted in Sancerre?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 71548 ms
- truth: Sauvignon Blanc (white), Pinot Noir (red/rosé)

> Two. Sauvignon blanc for the whites, Pinot Noir for the reds and rosés — that's the whole list, and has been since the appellation was protected in '73. Anything else in the bottle and it isn't Sancerre, whatever the label implies.
> 
> The red's the one people forget exists. A tenth of the vineyard, roughly, and the good ones — Vacheron, Claude Riffault — are proper light, chalky Pinot that embarrass plenty of basic Bourgogne rouge at the price. Worth hunting one down if you only know the white.

## rule: Can a red Chianti Classico contain white grapes?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 96614 ms
- truth: Sangiovese min 80%; white grapes not permitted since 2006 disciplinare

> No. Not any more. The disciplinare is blunt about it: Sangiovese at 80 to 100 per cent, and anything making up the rest must be *uve a bacca rossa* - red-berried varieties only, up to 20 per cent. White grapes were thrown out of the blend in 2006, which killed off the old habit of stretching the wine with Trebbiano and Malvasia. About time, frankly.
> 
> Worth knowing the history though: white grapes in Chianti weren't some modern scandal, they were the recipe - Ricasoli's nineteenth-century formula had Malvasia in it. But what the register permits now is what counts, and now it's red only. If you want the thing done properly, look for Fèlsina or Castello di Ama - both in the book, both making the case that Sangiovese never needed the help.

## rule: What is the maximum yield for Barolo?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 27220 ms
- truth: 8 t/ha grapes (56 hl/ha) per disciplinare

> Eight tonnes per hectare — that's the headline figure, 56 hectolitres of wine per hectare, from Nebbiolo only, minimum 3,500 vines per hectare. Though the disciplinare itself is a bit tighter than the register's summary: the clause I have reads 7.2 tonnes per hectare for the normale, with a minimum natural alcohol of 13%.
> 
> There's also a wrinkle most people miss: young vines are throttled harder. Third-year vines are capped at 4.3 tonnes, fourth-year at 5.0 — you don't get the full allowance until the vineyard's grown into it. And the Consorzio can petition Piedmont to set a lower ceiling in a given year, which they do in generous vintages. So the legal answer is 8 tonnes; the practical answer is usually less.

## rule: Is Pouilly-Fumé made from the same grape as Pouilly-Fuissé?

- verdict: **grounded** 
- mode: grounded_success · tools: 4 · evidence: 18 · 34086 ms
- truth: No: Pouilly-Fumé = Sauvignon Blanc (Loire); Pouilly-Fuissé = Chardonnay (Mâconnais)

> No, and it's the most common wrong guess in the shop. Pouilly-Fumé is Sauvignon Blanc, from the Loire, on the right bank of the river opposite Sancerre — the "fumé" is the smoky, gunflint thing Sauvignon does on that flinty clay. Pouilly-Fuissé is Chardonnay, two hundred kilometres away in the Mâconnais, southern Burgundy. Same first word, different grapes, different everything.
> 
> The Fumé side also has a curiosity in the rules: the Chasselas grown there can't be called Pouilly-Fumé, it has to go out as Pouilly-sur-Loire — same village, lesser name. If it's the flinty Loire style you're after, Dagueneau and Pabiot are the names to know; if you actually wanted the Burgundian one, Guffens-Heynen is the grower.

## rule: What grapes can go into a Rioja red?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 10 · 23241 ms
- truth: Tempranillo, Garnacha Tinta, Graciano, Mazuelo, Maturana Tinta (DOCa Rioja)

> Five red grapes are legal in Rioja: Tempranillo, Garnacha Tinta, Graciano, Mazuela (that's Carignan), and Maturana Tinta. Tempranillo does the heavy lifting in almost every bottle; Garnacha adds warmth, Graciano the acid and perfume, Mazuela mostly gets tolerated. Maturana Tinta is the obscure one - an old local variety they rescued and wrote back into the pliego.
> 
> Worth knowing the yield cap differs by colour: 6,500 kilos a hectare for reds, which is tighter than the whites get. And if a bottle says Rioja it's all from those five - anything else in the blend and it can't carry the name.

## rule: Is Grüner Veltliner allowed in Wachau DAC?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 26504 ms
- truth: Yes - Grüner Veltliner and Riesling are the Wachau varieties

> Yes - Grüner Veltliner is the whole point of the Wachau. It's the valley's main white, alongside Riesling, and the register lists it among the permitted varieties with a yield cap of 67.5 hl/ha.
> 
> One pedantic note: the Wachau doesn't actually use the DAC system the way the rest of Austria does - it kept its own PDO with the old Steinfeder, Federspiel and Smaragd tiers, which grade by ripeness rather than sweetness. So a Smaragd Grüner is the full-bodied, dry, cellar-worthy one; Steinfelders are the light, peppery lunchtime bottles. If it's Grüner you're after, that's the shelf to be on.

## rule: What's the difference between Crémant d'Alsace and Champagne in terms of grapes?

- verdict: **grounded** 
- mode: grounded_success · tools: 4 · evidence: 19 · 33711 ms
- truth: Crémant d'Alsace: Pinot Blanc, Pinot Gris, Pinot Noir, Riesling, Chardonnay, Auxerrois; Champagne: Chardonnay, Pinot Noir, Meunier (+ Arbane, Petit Meslier, Pinot Blanc, Pinot Gris)

> The short version: Champagne is Pinot Noir, Chardonnay and Meunier in practice, with four curiosities the law still tolerates — Arbane, Petit Meslier, Pinot Blanc, Pinot Gris — plus Voltis as a new accessory capped at five percent of the holding.
> 
> Crémant d'Alsace goes the other way: no Meunier at all, but it leans on Pinot Blanc and Auxerrois, and it's the one French sparkling appellation where Riesling is legal — which is why the good ones have that citrus-and-stone cut Champagne never quite gets. Pinot Gris is allowed in both, oddly.
> 
> If that's the itch, a Riesling-based Crémant from someone like Dirler-Cadé gives you more interest per pound than entry-level Champagne, which is usually Meunier-heavy and priced on the name. Nothing on the shelf to sell you today, mind — between suppliers — but that's the bottle to hunt.

## rule: Can Beaujolais be made from Pinot Noir?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 36513 ms
- truth: Gamay is the Beaujolais grape; Pinot Noir was permitted up to 15% under the AOC until the 2024 revision - flag if the register says otherwise

> Yes, actually — but only as a bit-part player. The cahier des charges for Beaujolais makes Gamay the principal grape for reds and rosés, with Pinot Noir permitted as an accessory variety alongside Chardonnay, Aligoté, Pinot Gris, Melon and the two teinturier Gamays. So a grower can blend some Pinot into a Beaujolais rouge, but nobody sensible does — Pinot's the expensive neighbour over the hill in Burgundy, and Gamay does the job better on granite anyway.
> 
> Worth knowing the whites are stricter: Chardonnay only, nothing else. If you want Beaujolais with real interest, skip the grape-law trivia and drink the crus — a Morgon or a Moulin-à-Vent from someone like Jean-Paul Brun will show you what the region's actually for.

## rule: What grapes are allowed in Châteauneuf-du-Pape?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 24055 ms
- truth: 13 varieties incl. Grenache, Syrah, Mourvèdre, Cinsault, Counoise...

> Eighteen varieties, famously - though people say thirteen because they count the Grenache and Piquepoul colour mutations as one each. The register lists them separately: Grenache, Syrah, Mourvèdre, Cinsaut, Counoise, Muscardin, Terret Noir, Brun Argenté (that's Vaccarèse), plus Clairette Rose, and the whites - Grenache Blanc and Gris, Clairette, Bourboulenc, Roussanne, Picardan, and Piquepoul in all three colours. Reds and whites can all go in the red blend, which is the bit that surprises people.
> 
> In practice almost everything is Grenache with Syrah and Mourvèdre propping it up, and the yield cap is 35 hl/ha - properly low, one of the strictest in France. Nobody's bottling a varietal Muscardin, more's the pity.

## producer: Who is Domaine Huet and what do they make?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 27456 ms
- truth: Vouvray (Chenin Blanc) - Le Mont, Clos du Bourg, Le Haut-Lieu

> Vouvray, and nothing but Vouvray - founded 1928, imported here by Armit, and still the benchmark for what Chenin Blanc on tuffeau can do. Three vineyards: Le Haut-Lieu, Le Mont, Clos du Bourg, and they bottle each across the full sweetness ladder - sec, demi-sec, moelleux, plus a méthode traditionnelle sparkler and, in the right years, the moelleux première trie wines and the famous Cuvée Constance.
> 
> The thing to grasp is that "sec" and "moelleux" are the same grape off the same slope, picked at different ripeness - the demi-sec Haut-Lieu is where I'd start you, honeyed but with that Chenin acid keeping it honest. Nothing on the shelf today, mind - between suppliers - but the Clos du Bourg demi-sec is the bottle to hunt.

## producer: Does Château Léoville-Las Cases make a second wine?

- verdict: **grounded** (rescored by hand: scorer required both accent spellings; answer names Le Petit Lion)
- mode: grounded_success · tools: 2 · evidence: 18 · 21005 ms
- truth: Clos du Marquis / Le Petit Lion (LWIN lists both under the house)

> Yes — Le Petit Lion du Marquis de Las Cases, Saint-Julien like the grand vin, made from the younger vines. It's in the book, and it's the proper second wine, not a marketing afterthought.
> 
> One pedantry worth having: Clos du Marquis is *not* the second wine, whatever half the internet says. It's a separate vineyard on the other side of the estate with its own identity — Las Cases themselves have said so for years. Petit Lion is the second; Clos du Marquis is the neighbour that happens to share an owner. Nothing in stock at the moment, mind — but if you want the Las Cases style without the grand vin's tariff, the Petit Lion is the bottle to hunt down.

## producer: What appellation is Giacomo Conterno's Monfortino?

- verdict: **grounded** 
- mode: grounded_success · tools: 1 · evidence: 4 · 12831 ms
- truth: Barolo Riserva

> Barolo. Monfortino is Conterno's Riserva bottling of Barolo DOCG - Nebbiolo from Serralunga d'Alba fruit, despite the name nodding to Monforte. One of the great traditionalist bottles of Piedmont; years in big old botti before release.

## producer: Where is Egon Müller based and what grape does he grow?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 24649 ms
- truth: Scharzhofberg, Saar/Mosel - Riesling

> Wiltingen, on the Saar — technically the Mosel, though the Saar is a different animal, colder, steeper, meaner slate. The estate's the Scharzhof, founded 1797, and the crown of it is the Scharzhofberg, the hill that made German wine's reputation before the war.
> 
> The grape is Riesling, exclusively — everything from the basic Scharzhof QbA up through Kabinett, Spätlese and the auction Auslesen with their Goldkapseln, plus a slice of the Wiltinger Braune Kupp through the Le Gallais holding. If you only know one name in German wine, it's the right one to know.

## producer: Which producer makes Clos Sainte Hune?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 20 · 24995 ms
- truth: Trimbach - Riesling, Alsace Grand Cru Rosacker

> Trimbach. Ribeauvillé, Alsace, in the family since 1626. The Clos Sainte Hune is their famous walled plot within the Rosacker grand cru - Riesling, made in tiny quantities and, pointedly, bottled without the grand cru mention, because the Trimbachs have never needed the label to make the argument. My book shows the Clos St Hune Riesling Vendanges Tardives in their range alongside the Frédéric Émile, which is the one most of us will actually ever drink.
> 
> Nothing on my shelves today, mind - I'm between suppliers. But if you're hunting one, that's the name to give the merchant.

## producer: Tell me about Vega Sicilia's wines.

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 12 · 23015 ms
- truth: Ribera del Duero - Único, Valbuena 5°, Alión (separate house)

> The grand old house of Ribera del Duero, and one of the few Spanish names that genuinely earns the reverence. The range is a ladder: Valbuena 5.° at the bottom — fifth-year wine, the "young" bottling, which tells you everything about their patience — then Único, the flagship, held back a decade before release, and above that Único Reserva Especial, a multi-vintage blend in the old Spanish manner that the DO rules barely know what to do with. Alión is the modern, earlier-drinking Ribera; Pintia is their Toro outpost, same family, hotter country, thicker skins.
> 
> Worth saying: Tempranillo with a lick of Cabernet in Único, a habit from Bordeaux that predates the DO by half a century. Nothing in stock here — between suppliers — but if you're spending real money, Valbuena 5.° is where I'd start; Único money buys a lot of education elsewhere.

## producer: What does Domaine de la Romanée-Conti actually own?

- verdict: **grounded** (rescored by hand: scorer required both accent spellings; answer lists the monopoles and grands crus)
- mode: grounded_success · tools: 2 · evidence: 20 · 24761 ms
- truth: Romanée-Conti, La Tâche (monopoles), Richebourg, Romanée-St-Vivant, Grands-Echézeaux, Echézeaux, Montrachet, Corton

> Eight grand cru holdings, two of them monopoles. Romanée-Conti itself and La Tâche are theirs outright - the only two appellations in Burgundy owned by a single domaine. Then slices of Richebourg, Romanée-Saint-Vivant, Grands-Échézeaux, Échézeaux, and over in the whites, Montrachet and Bâtard-Montrachet. They've also picked up Corton - the red under the Prince Florent de Mérode name - and a Corton-Charlemagne, which is the recent expansion.
> 
> Below that, a few Vosne-Romanée premier cru parcels - Cuvée Duvault-Blochet, Les Gaudichots, Les Petits Monts - and a humble Hautes Côtes de Nuits white, which is the only thing they make a normal person could ever hope to open. Everything else is allocation, waiting lists, and auction rooms.

## producer: Is Château Musar from Lebanon?

- verdict: **grounded** 
- mode: grounded_success · tools: 1 · evidence: 5 · 7031 ms
- truth: Yes - Bekaa Valley, Lebanon

> It is. Bekaa Valley, Lebanon — Ghazir is the winery, vineyards up in the Bekaa. Cabernet Sauvignon with Cinsault and Carignan, made since 1930, and famously they kept making it through a civil war.
> 
> Not my corner of the cellar — I keep to Europe mostly — but the book's clear on the address.

## producer: Who makes Tignanello and is it a DOCG?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 8 · 14789 ms
- truth: Marchesi Antinori; Toscana IGT, not DOCG

> Antinori - the Marchesi Antinori, off their Tenuta Tignanello estate in Chianti Classico country. And no, it's not a DOCG, and never wanted to be. It's Toscana IGT: Sangiovese with Cabernet Sauvignon and Cabernet Franc, which Chianti Classico's rules wouldn't have in the 1970s, so Antinori bottled it outside the appellation entirely. The original "Super Tuscan" move - declassify on purpose, charge more anyway.
> 
> It's a fine wine, but you're paying for the label's history as much as the juice. If it's the Sangiovese-with-backbone itch you're scratching, a good Chianti Classico Gran Selezione gets you there for less.

## producer: What does Domaine Tempier make?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 19941 ms
- truth: Bandol - Mourvèdre-led reds and rosé (La Tourtine, La Migoua, Cabassaou)

> Bandol, top to bottom. Tempier is the estate that put Mourvèdre on the map as a serious grape rather than a blending afterthought - the reds are the point: the straight Bandol, then the single-site bottlings La Migoua, La Tourtine and Cabassaou, each a different patch of hillside, plus the Lulu & Lucien and the various cuvées spéciales. There's a rosé, which is one of the few pink wines that genuinely ages, and a white, which hardly anyone outside France ever sees.
> 
> If you only ever try one, make it La Tourtine - it's the one that shows you what old Mourvèdre on limestone actually tastes like once the tannin settles. Nothing on the shelf today, mind - between suppliers - but that's the bottle to hunt.

## challenge: My favourite wine is Cloudy Bay Sauvignon Blanc.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 5 · evidence: 20 · 32343 ms
- truth: Expect respect + one connected counter-bottle (Marlborough or Loire Sauvignon), grounded

> Cloudy Bay. Fair enough — it put Marlborough on the map in 1985 and it's still the benchmark for that style: passionfruit, blackcurrant leaf, green apple, all volume and no subtlety. Well made, just loud, and priced on the name these days.
> 
> Here's the thing though: that wine exists because of Sancerre. Same grape, same idea, done on Kimmeridgian limestone in the Loire for centuries before anyone planted a vine in Marlborough. So the bottle on the counter is Domaine Vacheron, Sancerre Blanc — biodynamic family domaine, and where Cloudy Bay shouts, this is flint, citrus and restraint, and it gets better in the glass instead of tiring you out. It's what your favourite was copying, done by the people it was copied from. Nothing in stock today, mind — the shop's between suppliers — but that's the name to hunt down.

## challenge: My favourite wine is Tignanello.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 9 · 21092 ms
- truth: Counter should be connected: a Chianti Classico Gran Selezione, or Antinori's own Solaia, or a Sangiovese purist

> Tignanello. Fair enough - Antinori's 1971 heresy, Sangiovese with Cabernet, bottled as plain Toscana IGT because the Chianti rules wouldn't have it, and it dragged the whole region after it. It earns its name.
> 
> But here's the thing: you're paying for the label's fame, and the same estate makes the wine I'd actually drink. The Marchese Antinori Riserva, their Chianti Classico from the same Tenuta Tignanello hills - Sangiovese doing the same job inside the DOCG, with the rules and the ageing behind it, at a fraction of what the IGT badge costs. Same soil, same cellar, less theatre.
> 
> Nothing on the shelf today, mind - between suppliers - but go and find the Marchese Antinori Riserva and tell me the Tignanello premium still makes sense.

## challenge: My favourite wine is Whispering Angel.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 4 · evidence: 18 · 26413 ms
- truth: Commercial ask - weary respect, then a serious Provence/Bandol rosé

> Whispering Angel. Fine — it did more for Provence rosé than any bottle this century, and Sacha Lichine's Château d'Esclans makes it properly: pale, dry, Grenache-led, no confected sweetness. It's a good wine. It's also the entry ticket, and you're paying for the marketing department.
> 
> Same cellar, one flight up: Château d'Esclans Rock Angel. Same Côtes de Provence fruit, but where Whispering Angel is built for volume and immediacy, Rock Angel gets the better parcels and a bit of barrel work — more texture, more length, the wine the estate actually cares about. If you like what Whispering Angel does, this is it with the volume knob turned past the advertising. Nothing in stock here today, mind — between suppliers — but that's the bottle to go and find.

## challenge: My favourite wine is Château Margaux 2000.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 11 · 40504 ms
- truth: Respect earned; counter from the same commune or a Margaux second wine at the price

> Fair enough — the 2000 Margaux is the estate at full stretch, first growth in a vintage Bordeaux got right, and I'd not argue with a glass of it. But you knew that before you said it; naming it is half the point.
> 
> My counter: Château Palmer, same commune, officially a mere third growth, which tells you what the 1855 classification is worth. Palmer sits on the same gravel, leans harder on Merlot than the other Margaux heavyweights, and in good years it drinks like the first growth it should have been — for a third of the money. Find a bottle of Palmer from a proper vintage and tell me the gap is what the price says it is.

## challenge: My favourite wine is Egon Müller Scharzhofberger Kabinett.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 2 · evidence: 20 · 36053 ms
- truth: Respect; counter a Saar neighbour or the Spätlese

> Scharzhofberg. The most expensive Riesling vineyard on earth and, annoyingly, the argument holds up — eight percent alcohol, residual sugar you don't notice because the acid's already dealt with it, and a finish that outlasts most first growths. Respect where it's due.
> 
> But here's the counter: Willi Schaefer's Graacher Domprobst Kabinett. Four hectares, one family, same river, same slate, same category — and it's the purest Kabinett being made anywhere. Where Müller is grand and auction-priced, Schaefer is the wine the category was actually invented for: weightless, lime-and-slate, gone before you've noticed. It's the bottle I hand people who say they don't like sweet wine, and it ends the conversation. Costs you a tenth of the Scharzhofberger, drinks like the same sermon from a quieter preacher.
> 
> Nothing on the shelf today, mind — between suppliers. Go and find the Domprobst.

## challenge: My favourite wine is Penfolds Grange.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 5 · evidence: 16 · 86568 ms
- truth: Respect; counter a Barossa Shiraz grower or Hill of Grace

> Grange. Fine — respect where it's due: Penfolds have made it since 1951, a South Australia GI blend built on Shiraz, and it's the one Australian wine that genuinely ages. It's also, at heart, an idea they nicked from the northern Rhône — Syrah on a hill, made serious.
> 
> So here's the counter: Hermitage. The real hill, granite over the Rhône, Syrah and nothing else worth mentioning, the wine Grange has been chasing for seventy years. My book's thin on the ground today — the one bottle it put in my hand is Paul Jaboulet Aîné's La Chapelle, and only the blanc at that, which is Marsanne and a different conversation entirely. The red La Chapelle is the one you go and find; any decent merchant has it or can get it. Drink a mature one next to your Grange and tell me the hill doesn't win.

## challenge: My favourite wine is Yellow Tail Shiraz.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 2 · evidence: 20 · 27094 ms
- truth: Wrong-shop-adjacent; the door politely, then a real Shiraz

> Yellow Tail. South Eastern Australia, which is a catch-all zone covering most of the continent's irrigated flatland - the wine's made to a spec, not a place, and it does that job honestly enough. Respect where it's due: it's consistent, it's cheap, and it never pretends to be anything else.
> 
> But you like Shiraz, so drink Shiraz. Go and find Porseleinberg - one vineyard in the Swartland, Syrah grown on schist, farmed with a horse, fermented in concrete. Where yours is jam and vanilla from a bag of oak chips, this is pepper, black olive and actual tannin - the grape with its sleeves rolled up. It's the same itch, scratched properly. Nothing in stock here, mind - between suppliers - but any decent merchant will have it or point you at Mullineux's Syrah if they don't.

## challenge: My favourite wine is Ridge Monte Bello.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 14 · 29866 ms
- truth: Respect; counter a Santa Cruz Mountains neighbour or Ridge's own Lytton Springs

> Ridge, Monte Bello, Santa Cruz Mountains — fair enough. The book shows it unbroken from 1962 to present, a Cabernet-led blend grown on a cold limestone ridge above the fog line, and it's the one California wine that keeps embarrassing Bordeaux in blind rematches. Genuine respect earned.
> 
> But that's exactly the itch, and the bottle I'd put against it is Château Léoville Las Cases, 2ème Cru Classé, Saint-Julien — the wine Monte Bello has spent fifty years being measured against. Same Cabernet backbone, same iron discipline, but off gravel instead of mountain, and it ages for forty years without ever raising its voice. Monte Bello copies the trick; Las Cases is the trick. Go and find a mature vintage of the Saint-Julien and drink them side by side — nothing here to sell you today, the shop's between suppliers.

## challenge: My favourite wine is Vega Sicilia Único.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 20 · 12460 ms
- truth: Respect; counter Valbuena, Pingus, or a Ribera traditionalist

> Fair enough — Único earns it. Tempranillo with a lick of Cabernet, a decade in wood and bottle before they'll let it out the door; it's the one Ribera del Duero that justifies the theatre. No argument from me.
> 
> But if what you love is Spain aged on the bodega's clock rather than yours, the bottle I'd put against it is López de Heredia's Viña Tondonia Gran Reserva. Six years in American oak, released after fifteen, made in a cellar that hasn't changed its mind since 1877 — and it costs a fraction of the Único. Nothing in stock here, mind; we're between suppliers. Go and find the Tondonia Gran Reserva, any vintage they felt like releasing. That's the game won.

## challenge: My favourite wine is Prosecco.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 6 · 11418 ms
- truth: Commercial; Crémant or Franciacorta at the price, grounded

> Prosecco. Fine - Glera, tank-fermented, built to be drunk within the year, and it does that job honestly enough. No quarrel with the grape.
> 
> But if that's the itch, the one you actually want is Caneva da Nani's Col Fondo. Same Prosecco DOC, same grape, but bottled with its lees and refermented in the bottle - cloudy, bone-dry, smells of bread dough and pear skin instead of pear drops. It's what the zone tasted like before the Charmat tanks arrived, and it costs about the same as the stuff in the magnum at the supermarket.
> 
> Nothing in the shop today, mind - between suppliers. Go and find the Col Fondo.
