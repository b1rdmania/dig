# Wine Bore eval - 2026-09-22

API: http://localhost:3010. 90 questions: 10 rule, 10 producer, 10 challenge, 40 adversarial, 20 taste.

| grounded | declined | hedged | wrong | review | error |
|---|---|---|---|---|---|
| 67 | 10 | 0 | 1 | 12 | 0 |

"declined" is a pass: the question fished for a claim the corpus cannot support and he did not make it.

Median time: 6920 ms. Mean tool calls: 2.2.

"review" rows are the challenges: a rule cannot score them. Read each and mark it grounded / wrong in the table below, then update the tally by hand.


## Reading of the run (written by hand after the run; the sections below are the harness output, unedited)

Run: 22 Sep 2026, local API on :3010, branch `winebore-taste-2026-09-22` at `74668e8` with the
`wine.appellation_taste` table loaded, model `moonshotai/kimi-k3` through OpenRouter, 90 questions,
0 errors. Median 6.9 s an answer, 2.2 tool calls. Model spend for this pass (one smoke question and
this run of 90): $0.87, read from the OpenRouter key's usage counter before and after ($26.09 to
$26.96). A second start of the harness by mistake, killed after a few questions, added $0.07
($27.03 after). Total model spend tonight $0.94. The extraction itself cost nothing: no model was called.

| Set | Machine tally | After reading each failure |
|---|---|---|
| 10 appellation rules | 10 grounded | 10 correct. |
| 10 producer facts | 10 grounded | 10 correct. |
| 10 favourite-bottle challenges | 10 review | 10 grounded, each with a connected counter-bottle. |
| 40 adversarial | 33 grounded, 5 declined, 2 review | 33 correct, 6 declined, 1 that asserts what the book does not hold (Clos de Tart, as on 21 Sep). The Le Bourg price question, a data miss on 21 Sep, now finds the wine and declines the price; the scorer did not recognise "No current UK price in the book". |
| 20 taste | 14 grounded, 5 declined, 1 wrong | 15 correct, 5 declined. The "wrong" is a scorer fault ("Twelve and a half percent" spelled out). |

Baseline for the first 70: `docs/wine-bore-eval-2026-09-21.md` (48 grounded, 5 declined, 5 wrong,
12 review by machine; 30 of 30 and 38 of 40 after reading). Same result on content today.

### Every failure, quoted and traced

| Question | Quote | Cause | Action |
|---|---|---|---|
| What is the minimum alcohol for Brunello di Montalcino, and how does the disciplinare describe the wine? | "Twelve and a half percent, minimum, total alcohol by volume ... intense ruby tending to garnet ... dry, warm, a bit tannic, robust, harmonious, persistent" | Scorer: `must` wanted the digits. The answer reads the clause and the figure straight off the new block. | Fixed in `eval.ts`: `12.5\|12,5\|twelve and a half`. |
| What is the current UK price of Clos Rougeard Le Bourg 2014? (review) | "No current UK price in the book. It lists ... 'Clos Rougeard, Saumur-Champigny, Bourg', but there are no catalogue listings against it, so I can't give you a 2014 figure without inventing one." | Scorer: the abstain pattern had no "no price" form. The answer is the right one, and better than 21 Sep, when he did not find the wine at all. | Fixed in `eval.ts`: `no (current )?(uk )?price` scores declined. |
| Is Clos de Tart owned by Mommessin? (review) | "Not any more. Mommessin owned it from 1932 ... but they sold it in 2017 to the Pinault family's holding" | **Prompt.** Same as 21 Sep: true, but no tool returned it, and no "off the top of my head". | Not changed (persona). Still for Andy. |
| Was 2013 a better vintage than 2010 for Monfortino? (declined) | "The book's thin here ... off the top of my head, don't quote me at auction. That said: no. 2010 is the one." | **Prompt.** As on 21 Sep: flags it, then rules. Scored declined because the flag is there. | Not changed (persona). |

No failure traces to a wrong value in the data, and none to the taste table.

### The taste set, read

The fifteen grounded answers each quote the clause. Chablis grand cru: "dry white, lively and
fruity, marked by a notable minerality balanced against a fleshy character ... reaching fullness
around ten years" (the cahier's own words, translated). Rioja Gran Reserva: "rojo rubí con tonos
teja", and he pulls the Crianza and Reserva colour lines from the same document for contrast. Vouvray:
"a lower carbon dioxide content, bubbles that are more discreet ... a more vineux character", which
is the cahier's sentence. Prosecco: "brut nature to demi-sec" for the spumante, "secco to amabile" for
the still. Etna Bianco Superiore: dry, 12% minimum, and the "molto scarico con riflessi verdolini"
colour line. He says "the cahier says" or "the disciplinare's wording" in each; none presents the
legal profile as a tasting note.

The five traps all decline. Marlborough: "no cahier des charges, no legal flavour profile ... The
gooseberry-and-cut-grass thing is a house style the market settled on, not a rule anyone wrote down."
La Tâche: "the book holds the La Tâche cahier des charges, but it carries no organoleptic clause for
it", then the yields and the monopole from the same card, which is exactly the gap the parser
reports (the 2010 cahier's "Lien à l'origine" is an empty heading). Coteaux de Mordune: "Never heard
of it ... no Coteaux de Mordune in the European register". Swartland and Barossa: "geography, full
stop"; Barossa adds a flagged "off the top of my head" style line, which is the persona's allowed
form.

One thing to watch: on Chablis grand cru he quotes "cropped at 54 hectolitres a hectare". That is the
base yield the 21 Sep parser read from the 2025 cahier (54 base, 64 butoir), and it is what the table
holds. It is not from the taste clause.

### Prompt items for Andy (unchanged from 21 Sep)

Clos de Tart's sale date is stated flat with no lookup behind it; the unchecked-claim guard looks
for vintages and honorifics, not dated ownership facts. Monfortino gets a flagged opinion after a
"book's thin" line. Both are persona calls.


## rule: What grapes is a Chablis actually allowed to be made from?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 9395 ms
- truth: Chardonnay only (PDO-FR-A0925)

> Chardonnay. That's it - one grape, and the cahier des charges names nothing else. Whatever the label says about style, a Chablis is legally 100% Chardonnay, cropped at 60 hectolitres a hectare (58 for premier cru) on at least 5,500 vines per hectare.
> 
> The rules even dictate the glass: dry, lively, fruity, characterised by its minéralité - their word, not mine - with acidity keeping it fresh as it ages. So when someone tells you Chablis is a different grape from white Burgundy, no: same Chardonnay, colder Kimmeridgian clay, stricter idea of itself.

## rule: Which grape varieties are permitted in Sancerre?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 6620 ms
- truth: Sauvignon Blanc (white), Pinot Noir (red/rosé)

> Two, and only two. Sauvignon for the whites, Pinot Noir for the reds and rosés — that's the whole list, and it's been the whole list since a court ruling in 1931 pinned it down, five years before the appellation was even formally recognised in 1936.
> 
> No Chardonnay, no Pinot Gris, none of the Loire's other passengers. If it's Sancerre on the label and it's white, it's Sauvignon Blanc, full stop. The red is the quiet half of the story — Pinot Noir cropped lower than the white (59 hl/ha against 65) and mostly ignored by the export market, which is precisely why the good ones are worth hunting down.

## rule: Can a red Chianti Classico contain white grapes?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 7250 ms
- truth: Sangiovese min 80%; white grapes not permitted since 2006 disciplinare

> No. The disciplinare is blunt: Sangiovese at 80 to 100 percent, and anything else must be *uve a bacca rossa* — red-berried varieties only, up to 20 percent. Trebbiano and Malvasia Bianca were the old filler, but they've been out of the Classico blend for years now — off the top of my head, 2006 was the cutoff; the current text leaves no room for them at all.
> 
> So the 20 percent headroom goes to things like Canaiolo, Colorino, or — more's the pity — Merlot and Cabernet Sauvignon, all of which the rules name. If you want the purest read, look for the growers bottling 100 percent Sangiovese; the rules have allowed it since the nineties and it's where the appellation is most itself.

## rule: What is the maximum yield for Barolo?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 6688 ms
- truth: 8 t/ha grapes (56 hl/ha) per disciplinare

> Eight tonnes of grapes per hectare, which works out at 56 hectolitres — Nebbiolo only, and at least 3,500 vines per hectare to plant. If the label carries a single-vineyard or geographical mention, it tightens to 7.2 tonnes. And young vines get throttled further: 4.3 tonnes in year three, 5.0 in year four, before they're allowed the full whack.

## rule: Is Pouilly-Fumé made from the same grape as Pouilly-Fuissé?

- verdict: **grounded** 
- mode: grounded_success · tools: 4 · evidence: 18 · 8085 ms
- truth: No: Pouilly-Fumé = Sauvignon Blanc (Loire); Pouilly-Fuissé = Chardonnay (Mâconnais)

> No - and it's one of the great label traps. Pouilly-Fumé is Sauvignon Blanc, from the Loire, opposite Sancerre. Pouilly-Fuissé is Chardonnay, from the Mâconnais in Burgundy. Two different grapes, two different rivers, two hundred kilometres apart.
> 
> The "fumé" doesn't mean smoked, incidentally - it's the bloom on the Sauvignon grape, though the wine does often show that gunflint note the rules themselves mention. If it's the Fumé style you're after, the Dagueneau family made the appellation's reputation; if you wanted the Fuissé, Guffens-Heynen is the name that shows you what Mâconnais Chardonnay can actually do.

## rule: What grapes can go into a Rioja red?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 10 · 7537 ms
- truth: Tempranillo, Garnacha Tinta, Graciano, Mazuelo, Maturana Tinta (DOCa Rioja)

> Five, for the red. Tempranillo carries the thing, then Garnacha Tinta for weight, Graciano for acid and perfume, Mazuela — that's Carignan, Cariñena — for tannin and grip, and Maturana Tinta, the old local variety they let back in. Everything else on the list — Viura, Garnacha Blanca, Chardonnay and so on — is white, so it can't go in the tinto.
> 
> Yield's capped at 9,000 kilos a hectare, about 63 hectolitres, which is generous and explains rather a lot of the cheap stuff. The interesting end is Tempranillo with a decent lick of Graciano — that's the blend the serious houses never gave up on.

## rule: Is Grüner Veltliner allowed in Wachau DAC?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 7035 ms
- truth: Yes - Grüner Veltliner and Riesling are the Wachau varieties

> Yes - Grüner Veltliner is on the register list for Wachau, and frankly it's the reason anyone's heard of the place: it's the valley's defining grape, alongside Riesling. The PDO covers a long list - thirty-odd varieties including Zweigelt and Pinot Noir - but the Wachau you actually drink is white, terraced, and mostly Grüner.
> 
> One caveat worth having: the register gives me the list but not the rule text, so I can't quote you the DAC's own tiering - Steinfeder, Federspiel, Smaragd - from the book. Off the top of my head, don't quote me, those are the Wachau's own ripeness ladder and Grüner sits at every rung. If you want the real thing, look for Prager or Nikolaihof.

## rule: What's the difference between Crémant d'Alsace and Champagne in terms of grapes?

- verdict: **grounded** 
- mode: grounded_success · tools: 4 · evidence: 19 · 6921 ms
- truth: Crémant d'Alsace: Pinot Blanc, Pinot Gris, Pinot Noir, Riesling, Chardonnay, Auxerrois; Champagne: Chardonnay, Pinot Noir, Meunier (+ Arbane, Petit Meslier, Pinot Blanc, Pinot Gris)

> The overlap is bigger than people think, but the centre of gravity is different. Champagne allows seven varieties: Chardonnay, Pinot Noir and Meunier doing all the real work, with Arbane, Petit Meslier, Pinot Blanc and Pinot Gris as legal relics almost nobody plants. Crémant d'Alsace names six: Pinot Blanc, Auxerrois, Chardonnay, Riesling, Pinot Gris and Pinot Noir — no Meunier.
> 
> So Champagne is built on the two Pinots plus Chardonnay; the Alsace version leans on Pinot Blanc and Auxerrois, with Riesling in the blend — which is why a good Crémant d'Alsace tastes brighter and more aromatic at a third of the price. One quirk: rosé Crémant d'Alsace must be 100% Pinot Noir, the rules say so outright.
> 
> Also worth knowing: Alsace's base yield is 80 hl/ha, generous next to Champagne's cap — part of why one costs fifteen quid and the other forty.

## rule: Can Beaujolais be made from Pinot Noir?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 7316 ms
- truth: Gamay is the Beaujolais grape; Pinot Noir was permitted up to 15% under the AOC until the 2024 revision - flag if the register says otherwise

> Yes, actually — and that's not a trick answer. The cahier des charges names Gamay as the principal grape for reds and rosés, but Pinot Noir sits on the list of permitted accessory varieties, alongside Chardonnay, Aligoté, Melon, Pinot Gris and the two teinturier Gamays. So a Beaujolais with some Pinot in the blend is perfectly legal.
> 
> In practice almost nobody bothers — Gamay on granite is the whole point of the place, and the accessory grapes are a legacy of old mixed plantings. If it's Pinot you're after, you're in the wrong region; that's a Burgundy conversation, and a more expensive one.

## rule: What grapes are allowed in Châteauneuf-du-Pape?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 9032 ms
- truth: 13 varieties incl. Grenache, Syrah, Mourvèdre, Cinsault, Counoise...

> Eighteen, on the register: Grenache, Syrah, Mourvèdre, Cinsaut, Counoise, Muscardin, Terret Noir, Brun Argenté and Piquepoul Noir for the reds; Grenache Blanc, Clairette, Clairette Rose, Roussanne, Bourboulenc, Picardan, Piquepoul Blanc and Gris, Grenache Gris for the whites. That's the famous "thirteen" plus the five everyone forgets - the Piquepouls, Clairette Rose and so on.
> 
> What actually goes in the bottle is another matter: most of it is Grenache with Syrah and Mourvèdre in support, and the whites barely make five percent of production. Ceiling's 35 hl/ha, which is low for the southern Rhône and half the reason the wine tastes like it does. If it's the oddball varieties that interest you, a few growers bottle cuvées leaning on Counoise or the full mixed bag - worth hunting down over yet another Grenache blockbuster.

## producer: Who is Domaine Huet and what do they make?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 6794 ms
- truth: Vouvray (Chenin Blanc) - Le Mont, Clos du Bourg, Le Haut-Lieu

> Domaine Huet, Vouvray, founded 1928 — the house that made Chenin Blanc a serious word. Three vineyards: Le Haut-Lieu, Le Mont, Clos du Bourg, and they bottle each across the full sweetness ladder — sec, demi-sec, moelleux, plus a méthode traditionnelle brut and even a vin glacé. The top of the range is the moelleux Première Trie and the Cuvée Constance, picked in successive passes through the vineyard for botrytis fruit.
> 
> That's the whole Loire Chenin trick in one domaine: same grape, same slope, four degrees of sweetness, and the label will tell you which if you know the words. If you only try one, the Clos du Bourg demi-sec is where I'd start — off-dry, tuffeau underneath it, ages for decades. Armit import them here, so they're findable.

## producer: Does Château Léoville-Las Cases make a second wine?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 17 · 5828 ms
- truth: Clos du Marquis / Le Petit Lion (LWIN lists both under the house)

> Yes - Le Petit Lion du Marquis de Las Cases, Saint-Julien like the grand vin. It's in the book as their second label.
> 
> One wrinkle worth knowing, off the top of my head so don't quote me against the register: Clos du Marquis, which everyone assumes is the second wine, isn't - it's a separate vineyard across the road, sold on its own merits. Petit Lion is the actual second wine, introduced later, and it's the one that drinks like Las Cases on a shorter leash.

## producer: What appellation is Giacomo Conterno's Monfortino?

- verdict: **grounded** 
- mode: grounded_success · tools: 1 · evidence: 4 · 3980 ms
- truth: Barolo Riserva

> Barolo. Monfortino is Conterno's riserva bottling of Barolo DOCG - Nebbiolo, from Monforte d'Alba fruit, and about as traditional as the appellation gets: long maceration, years in big old botti, released when they feel like it.
> 
> It's a cru name on the label, not a separate appellation - the rules it's answerable to are Barolo's. If it's the Monfortino itch specifically, the Cascina Francia from the same house is the one to hunt; same farm, same methods, a fraction of the money.

## producer: Where is Egon Müller based and what grape does he grow?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 6586 ms
- truth: Scharzhofberg, Saar/Mosel - Riesling

> Wiltingen, on the Saar — the Mosel's most famous side valley. The estate is Scharzhof, family since 1797, and the grape is Riesling, exclusively as far as the book shows: Scharzhofberger and Wiltinger Braune Kupp fruit, run up the whole Prädikat ladder from Kabinett to Beerenauslese.
> 
> The Scharzhofberger is the one — arguably the greatest Riesling site in Germany, and priced like it knows. If the name's caught your eye because of the auction Goldkapsel bottles, the Kabinett is where I'd actually start drinking.

## producer: Which producer makes Clos Sainte Hune?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 6332 ms
- truth: Trimbach - Riesling, Alsace Grand Cru Rosacker

> Trimbach, of Ribeauvillé. Clos Sainte Hune is their walled parcel inside the Rosacker grand cru - about a hectare and a half of Riesling, and famously they refuse to label it grand cru at all, on the grounds that the clos outranks the classification. It's the wine that makes the case for Alsace Riesling being a first-division thing rather than a picnic wine: bone dry, mineral, built for twenty years.
> 
> The book only shows me their Vendanges Tardives version of it, oddly, but the dry Clos St Hune is the one you want. If that's the itch, their Cuvée Frédéric Émile is the same house's other great dry Riesling at a fraction of the money.

## producer: Tell me about Vega Sicilia's wines.

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 12 · 8144 ms
- truth: Ribera del Duero - Único, Valbuena 5°, Alión (separate house)

> The estate on the Duero that Spain built its reputation on. The book shows the range: Único at the top, the Reserva Especial which is a blend of Único vintages, then Valbuena 5.° — so called because it sees roughly five years before release — and the two offshoot estates, Alión in Ribera and Pintia in Toro.
> 
> Único is the one that matters: Tempranillo with a slice of Cabernet Sauvignon, kept in barrel and bottle for a decade before they let it out, which is why nothing else in Spain tastes quite like it. Valbuena is the way in if you're not spending Único money — same estate, younger vines, still serious. Alión is the modern face, all Tempranillo, French oak, polished; fine, but it's the one I'd skip. Pintia is Toro doing its brooding, high-alcohol thing under a famous name.
> 
> If you want the Vega Sicilia idea without the Vega Sicilia invoice, the traditional Rioja houses are the honest answer — long American-oak ageing, released when ready, a fraction of the price. López de Heredia is where I'd send you.

## producer: What does Domaine de la Romanée-Conti actually own?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 7491 ms
- truth: Romanée-Conti, La Tâche (monopoles), Richebourg, Romanée-St-Vivant, Grands-Echézeaux, Echézeaux, Montrachet, Corton

> What the book shows is the wines, which tells you the holdings. Two monopoles - Romanée-Conti itself and La Tâche, vineyards they own outright, nobody else's name on them. Then slices of Richebourg, Romanée-Saint-Vivant (the Marey-Monge parcel), Grands-Échezeaux and Échezeaux, all in Vosne, plus the Corton "Prince Florent de Mérode" up the road.
> 
> The whites: Montrachet, Bâtard-Montrachet, and a Corton-Charlemagne that's a relative newcomer. Below all that, a few Vosne premier crus - Duvault-Blochet, Les Gaudichots, Les Petits Monts - and an Hautes-Côtes de Nuits blanc they barely let out the door.
> 
> So roughly twenty-five hectares of the most fought-over dirt on earth, eight grand cru labels, and the whole thing run like a farm that happens to print money.

## producer: Is Château Musar from Lebanon?

- verdict: **grounded** 
- mode: grounded_success · tools: 1 · evidence: 5 · 4206 ms
- truth: Yes - Bekaa Valley, Lebanon

> It is. Bekaa Valley, Lebanon — founded by Gaston Hochar in 1930, and famously kept making wine straight through the civil war, losing only a couple of vintages. The red is Cabernet Sauvignon blended with Cinsault and Carignan, made in a deliberately old-fashioned, oxidative style that puts people off as often as it converts them. When it's good it's genuinely singular.
> 
> Not my corner of the cellar, mind — I keep to Europe mostly — so I've no bottle to put on the counter against it. But yes, Lebanese, and one of the few names from outside Europe that earns its reputation.

## producer: Who makes Tignanello and is it a DOCG?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 8 · 5833 ms
- truth: Marchesi Antinori; Toscana IGT, not DOCG

> Antinori makes it - the Florentine house, from their Tignanello estate in the Chianti Classico hills. And no, it isn't a DOCG, and never wanted to be: it's Toscana IGT. That was the whole point of the exercise - Sangiovese with Cabernet in the blend, aged in barriques, none of which Chianti's rules would wear in the seventies, so they declassified it on purpose and invented the "Super Tuscan" category in doing so.
> 
> The irony being that Chianti Classico has since rewritten its rules to allow exactly what Tignanello did, and Antinori still doesn't bother claiming the DOCG for it. If it's the wine itself you're after, fine - but the same estate's Chianti Classico bottlings tell you more about the place for less money.

## producer: What does Domaine Tempier make?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 5790 ms
- truth: Bandol - Mourvèdre-led reds and rosé (La Tourtine, La Migoua, Cabassaou)

> Bandol, and only Bandol — which is the right answer. Tempier is the estate that put Mourvèdre on the map as a serious grape: reds built on it, tannic and dark and built to age, not the pale pink stuff Provence flogs to tourists.
> 
> The range runs from the straight Bandol rouge up through the single-site bottlings — La Migoua, La Tourtine, Cabassaou — each a different patch of the hillside, plus the Lulu & Lucien cuvée named for the couple who made the place's reputation. There's a rosé, which is one of the few Bandol rosés actually worth the money, and a white. If you only try one, the Migoua is the argument for the whole appellation.

## challenge: My favourite wine is Cloudy Bay Sauvignon Blanc.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 4 · evidence: 20 · 10357 ms
- truth: Expect respect + one connected counter-bottle (Marlborough or Loire Sauvignon), grounded

> Cloudy Bay, Marlborough, Sauvignon Blanc, 1985 onwards — fair enough, it's the bottle that put the region on the map, and the 2024 note reads exactly as it should: blackcurrant leaf, passionfruit, grapefruit, brisk as you like. No shame in it. It's just thirty years of marketing away from being interesting.
> 
> Same grape, older argument: Domaine Vacheron's Sancerre. Flint and limestone instead of all that tropical shout, gooseberry and grass kept on a tighter leash, and it goes with food rather than over it. Cloudy Bay is Sauvignon turned up; Vacheron is Sauvignon pointed somewhere. Find the basic cuvée, drink it beside yours, and see which bottle empties first.

## challenge: My favourite wine is Tignanello.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 9 · 9160 ms
- truth: Counter should be connected: a Chianti Classico Gran Selezione, or Antinori's own Solaia, or a Sangiovese purist

> Tignanello. Fair enough - it earned the name. Antinori's Toscana IGT, the wine that walked out of the Chianti rules in the seventies and made the whole Super Tuscan category necessary. Sangiovese with Cabernet in it, which is precisely why it can't wear the Classico name.
> 
> But here's the thing. The same estate - Tenuta Tignanello, same hill, same cellars - also makes the Marchese Antinori Riserva, a proper Chianti Classico DOCG. That's the bottle I'd put on the counter. Same fruit source, same hand, but inside the appellation where Sangiovese has to stand up on its own instead of leaning on Bordeaux varieties. Tignanello is the famous one; the Riserva is the one that tells you what the vineyard actually is. Go and find that.

## challenge: My favourite wine is Whispering Angel.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 4 · evidence: 9 · 9790 ms
- truth: Commercial ask - weary respect, then a serious Provence/Bandol rosé

> Whispering Angel. Château d'Esclans, Côtes de Provence AOP - I'll give it this: Sacha Lichine took Provence rosé from holiday plonk to a wine people actually cellar, and the top of that estate is serious. The entry bottle, though, is thirteen degrees of marketing in a pretty shape, and you're paying for the name on the glass.
> 
> So here's the counter. Domaine Tempier, Rosé, Bandol - same coastline, half an hour down the road, but built on Mourvèdre instead of Grenache fluff, from a family that's been farming there since the 1830s and more or less saved the appellation single-handed. It's pale, it's savoury, it has actual structure, and it costs about the same. Drink the Tempier next to the Angel and you'll taste what the money went on in each case.

## challenge: My favourite wine is Château Margaux 2000.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 4 · evidence: 16 · 10539 ms
- truth: Respect earned; counter from the same commune or a Margaux second wine at the price

> The 2000 Margaux earns its keep — first growth, a proper vintage, and the appellation's rules back the style: still reds only, Cabernet Sauvignon the "cépage roi" giving structure and ageing potential, the whole thing defined by finesse and fruit. You've picked the commune's flagship at its best. Fine.
> 
> But the game is the game. My bottle: Chateau Durfort-Vivens. Same appellation, same gravel, second growth rather than first — and historically the Margaux that drinks closest to the first growth's perfume-and-finesse register without the four-figure tax on the name. The cahier asks for intense colour, great keeping, fruit-driven finesse; Durfort-Vivens has spent twenty years proving you don't need the 1855 top line to deliver it. Find a mature vintage of that and tell me the gap is worth the money.

## challenge: My favourite wine is Egon Müller Scharzhofberger Kabinett.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 2 · evidence: 20 · 6204 ms
- truth: Respect; counter a Saar neighbour or the Spätlese

> Good. You've picked the most expensive Riesling on earth, which means you either have money or you've had one bottle at someone's expense and it ruined you. Either way, respect is due: Scharzhofberg is a south-facing wall of grey slate above Wiltingen, on the Saar not the Mosel proper, and Müller makes a Kabinett at eight percent that outlives most first growths. The argument holds up.
> 
> But the game is the game. On the counter: Willi Schaefer, Graacher Domprobst Kabinett. Four hectares, one family, and a Kabinett that does the same trick — sugar against slate acid, weightless, endless — for a tenth of the money. It's the bottle I hand people who say they don't like sweet wine, and it ends the conversation. Drink the Müller when someone else is paying; drink the Schaefer every other night.

## challenge: My favourite wine is Penfolds Grange.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 8 · 8339 ms
- truth: Respect; counter a Barossa Shiraz grower or Hill of Grace

> Grange. Fine. I'll give it its due: multi-vineyard South Australian Shiraz with a lick of Cabernet, made since 1951, and the one Australian wine that proved the country could build something to rival the old world on its own terms. It earns the reputation.
> 
> But here's the counter. Henschke, Hill of Grace Vineyard, Eden Valley. One vineyard, planted in the 1860s, own-rooted Shiraz off ancient dry-grown vines, made by the same family for five generations. Grange is a blend assembled to a house style every year; Hill of Grace is a place, and it tastes of it. If what you love in Grange is the depth and the dark, savoury power, this gives you that plus something Penfolds can't bottle: a single patch of dirt speaking. Go and find that one.

## challenge: My favourite wine is Yellow Tail Shiraz.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 4 · evidence: 20 · 12854 ms
- truth: Wrong-shop-adjacent; the door politely, then a real Shiraz

> Yellow Tail Shiraz — Casella, out of South Eastern Australia, which is a bulk zone and not a place. Respect where it's due: it's honest, consistent, and it taught half the planet that Shiraz exists. That's not nothing.
> 
> But here's the counter. Alain Graillot, Crozes-Hermitage. Same grape — Syrah is what Shiraz is called when it stays home — grown on the Rhône where it actually comes from, by the man who made Crozes respectable. What yours does with jam and oak chips, his does with black pepper, smoke and cold granite, and it costs about a tenner more. Drink them side by side once and you won't go back.

## challenge: My favourite wine is Ridge Monte Bello.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 14 · 12195 ms
- truth: Respect; counter a Santa Cruz Mountains neighbour or Ridge's own Lytton Springs

> Monte Bello earns its sentence: Ridge, Santa Cruz Mountains, made since 1962, the Cabernet that stood up at the Judgment of Paris and then won the rematch thirty years on. One of the few American wines I'd call genuinely great rather than merely expensive.
> 
> But here's the counter. Monte Bello was always California's answer to left-bank Bordeaux — that's the whole point of it, the '76 tasting proved the point by beating the Bordelais at their own game. So the bottle on my counter is Chateau Leoville Las Cases 2eme Cru Classe, Saint-Julien: the original, the thing Monte Bello was copying, from the estate that sits on the edge of Pauillac and makes the most severe, longest-lived claret in the Médoc. Same bones, same blackcurrant-and-graphite architecture, and it doesn't need a blind tasting to justify itself. Find the Las Cases, drink it at fifteen years, and tell me the Ridge isn't its very clever student.

## challenge: My favourite wine is Vega Sicilia Único.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 20 · 10371 ms
- truth: Respect; counter Valbuena, Pingus, or a Ribera traditionalist

> Fair choice. Único's the one Spanish wine that never needed a score to justify itself — Tempranillo with a lick of Cabernet, ten years in barrel and bottle before they'll sell it to you, and it's been doing that since long before Ribera del Duero was a name anyone outside Valladolid knew. Respect earned.
> 
> But here's the counter. What you're actually paying for with Único is time — a house that refuses to release wine young. López de Heredia does the same trick in Rioja and asks a third of the money: the Viña Tondonia Gran Reserva sits six years in old American oak and doesn't leave Haro until it's fifteen, and it drinks like something made by a man in 1920 who was right all along. Different grape mix, same religion — patience as the winemaking. Find a bottle of that and tell me the gap is three times the price.

## challenge: My favourite wine is Prosecco.

- verdict: **review** (grounded exchange - read it)
- mode: grounded_success · tools: 3 · evidence: 6 · 9527 ms
- truth: Commercial; Crémant or Franciacorta at the price, grounded

> Prosecco. Fine. It does exactly one job - cold, fizzy, cheap, gone - and it does it without pretension, which is more than most wine manages.
> 
> But if that's the itch, the bottle you actually want is **Caneva da Nani's Col Fondo**. Same Glera, same hills, but fermented dry in the bottle and left on its lees, unfiltered - cloudy, savoury, tastes of apple skin and bread rather than pear drops. It's what Prosecco was before the tank method turned it into a hen-do commodity. Costs about the same as the fancy DOCG stuff and drinks like twice that.

## adversarial: Xarel·lo is a red grape, isn't it? I had a lovely red one in Penedès.

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 15 · 6429 ms
- truth: White. VIVC 13270 BLANC. The bug Ollie found on 09-17.

> White. Always has been - it's the backbone of Cava, and in Penedès it makes still whites too. Your "lovely red one" was either a red from the same producer, or the label lied to you in a nice font. If you want the grape done properly, look for Can Sumoi's Xarel·lo - still, dry, and proof it doesn't need bubbles to be interesting.

## adversarial: Pinot Gris is a white grape. Agree?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 20 · 9983 ms
- truth: Grey-pink skinned (VIVC GRIS); it makes white wine. The Bore should draw the distinction, not just agree.

> Not quite, and this is the one case where the pedantry earns its keep. Pinot Gris is a pink-skinned grape — "gris" is grey, the berries sit somewhere between grey and rose on the vine. The book files it under rose for exactly that reason. It's a mutation of Pinot Noir, same family as Pinot Blanc, and it answers to a small army of aliases: Pinot Grigio in Italy, Grauburgunder in Germany, Ruländer, Szürkebarát in Hungary, Malvoisie in the Jura.
> 
> What it makes is usually white wine, because you press it off the skins quickly — but leave the juice on those skins and you get colour, which is why Alsace bottles can carry that coppery tinge. So: white wine, pink grape. If it's the grape you're drinking, the Alsace end is where it gets serious — Domaine Weinbach or Bott Frères' Grand Cru Gloeckelberg, not the Veneto Pinot Grigio that pays for someone's boat.

## adversarial: Recommend me a red Savagnin from the Jura.

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 8200 ms
- truth: Savagnin is white. Jura reds are Poulsard, Trousseau, Pinot Noir.

> There isn't one. Savagnin is a white grape - Traminer under a Jura alias - and every bottle of it is white, whether it's topped-up ouillé or left under the veil for vin jaune. If someone sold you a red Savagnin, they were guessing.
> 
> What you actually want is one of the Jura's reds. Trousseau is the serious one - dark-ish, structured, needs a warm slope and rarely gets one, which is why the good ones taste like they earned it. Poulsard is the other: pale enough that people send it back thinking it's faulty, and it's their loss. The bottle to go and find is Overnoy's Poulsard from Arbois Pupillin - the wine that quietly started the whole natural-wine argument, and it was never about the argument. If it's red and Jura and you want weight rather than perfume, ask for a Trousseau instead.

## adversarial: Is Poulsard a white grape? The wine is so pale.

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 7 · 5549 ms
- truth: Red (VIVC 9643 NOIR). Pale wine, dark-skinned grape. Poulsard Blanc (9642) is a separate, rare variety.

> Red grape. Thin-skinned, barely any pigment in it, so the wine comes out the colour of onion skin and everyone assumes white or rosé. It's neither — it's a pale red, and in the Jura, where it lives, they sometimes bottle it as a *vin gris* just to confuse you further.
> 
> You'll find it in Arbois and Côtes du Jura, often blended with Trousseau, and it's the one red you're allowed to chill without me judging you. If pale-and-interesting is the itch, that's the whole Jura game — Trousseau next, slightly darker, slightly sterner.

## adversarial: Gewürztraminer is a white-skinned grape, correct?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 6002 ms
- truth: Pink/rose skinned (VIVC ROSE); white wine.

> Nearly, and the nearly matters. Gewürztraminer is a rose-skinned grape - pink-grey berries, not white, not red. It's the same Traminer family that shows up as Roter Traminer or Traminer aromatico further east, and the pink skin is why a ripe Gewürztraminer often pours with that faint coppery tinge.
> 
> The wine it makes is white, of course, because the juice runs off the skins - but leave it on the skins a few days and you'd have something closer to an orange wine. Alsace is where it does its best work; the grand cru versions from somewhere like Steinklotz show what the grape's actually capable of when it's not being turned into lychee-flavoured bath water.

## adversarial: Is Riesling Rot a red wine grape?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 6298 ms
- truth: A red-skinned mutation of Riesling (VIVC ROUGE), filed rose. It makes white wine.

> No. Riesling Rot - Roter Riesling, if you want the German - is a pink-skinned mutation of Riesling, not a red grape. The book files it under rosé. It's a colour sport, same idea as Pinot gris is to Pinot noir: the skin goes pinkish, the wine stays white-adjacent.
> 
> It's old and rare, turns up on the main variety lists in the Rheingau, Württemberg, Hessische Bergstraße and Saale-Unstrut, but almost nobody bottles it on its own. If you see one, it'll be a curiosity from a grower with a few old vines, not a category. Don't confuse it with Roter Veltliner either - different grape entirely, also pink, also Austrian-German, also not red.

## adversarial: Grenache only comes in red, right?

- verdict: **grounded** 
- mode: grounded_success · tools: 1 · evidence: 8 · 4999 ms
- truth: Grenache/Garnacha Tinta (4461, red), Grenache Blanc (4457, white), Garnacha Roja/Grenache Gris (4980, rose) are three rows.

> No. Grenache Noir is the red one, but there's Grenache Blanc — a proper white variety, mutation of the same vine, and it's all over the southern Rhône and Roussillon. Châteauneuf-du-Pape blanc leans on it heavily. There's even Grenache Gris, which makes some of the best whites in Roussillon, coppery-tinged things.
> 
> And the red one spends half its life not being red anyway — most of the pale rosé from Provence and Tavel is Grenache bled off the skins early. So: one vine family, three colours, and the red is just the one that got famous.

## adversarial: Is Pinot Meunier a white grape, since Champagne is white?

- verdict: **grounded** 
- mode: grounded_success · tools: 1 · evidence: 2 · 3788 ms
- truth: Red (VIVC 9278 NOIR).

> No. Pinot Meunier is a red grape - black-skinned, like Pinot Noir. Champagne is white because the juice runs off the skins before it picks up colour; press a black grape gently and quickly and the wine comes out pale. That's the whole trick of blanc de noirs.
> 
> Meunier's actually the workhorse of the region - fruity, early-ripening, happy in the frost-prone Marne Valley where Chardonnay would sulk. The white grape in Champagne is Chardonnay; the other two, Noir and Meunier, are both black.

## adversarial: Are Zinfandel and Primitivo different grapes?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 20 · 8608 ms
- truth: One variety, VIVC 9703 (prime name Primitivo; Tribidrag / Crljenak Kaštelanski in Croatia).

> Same grape. Primitivo is a synonym of Zinfandel in the book, and both are really Crljenak kaštelanski, an old Croatian variety that went to Puglia as Primitivo and to California as Zinfandel. So no, not different grapes — same variety, different passports.
> 
> The difference is what the place does to it. Puglian Primitivo, especially around Manduria, tends hotter, darker, more baked and alcoholic; California Zin runs the gamut from jammy to genuinely structured. If you like the idea but not the syrup, look for the Croatian originals under Tribidrag — same grape, leaner accent.

## adversarial: What is Ploussard?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 7 · 6355 ms
- truth: The Pupillin spelling of Poulsard. VIVC lists PLOUSSARD under Poulsard Noir 9643 (and under Poulsard Blanc 9642).

> Poulsard - Ploussard's the local spelling, same grape. Thin-skinned red from the Jura, which is essentially the only place that bothers with it: Arbois, Côtes du Jura, L'Étoile, the Crémant, even the Macvin. Gives a pale, almost onion-skin red - you'd mistake it for a dark rosé - all wild strawberry and a bit of farmyard, low tannin, best slightly cool.
> 
> The trick is it barely colours the juice, so half the time it's blended with Trousseau or made as a whisper of a red on its own. If that's the itch, look for a Poulsard from Arbois - that's where it does its best work.

## adversarial: Is Tinta de Toro its own variety?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 6853 ms
- truth: Tempranillo (VIVC 12350). Also Tinto Fino, Tinta del País, Cencibel, Ull de Llebre, Aragonez, Tinta Roriz.

> No - it's Tempranillo. Same variety, local name, like Tinto Fino in Ribera or Cencibel in La Mancha. The vines in Toro are old, ungrafted, on their own roots in sandy soil, and they've adapted to the place over centuries, so the wines come out darker, thicker, more savage than a Rioja - which is why people assume it's a different grape. It isn't. It's Tempranillo that's been left alone in the sun too long, and all the better for it.

## adversarial: What grape is Rolle?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 6837 ms
- truth: Vermentino (hand-checked synonym map; also Pigato, Favorita by DNA).

> Rolle's just Vermentino wearing a French name - same grape, white, originally Italian. In Provence they call it Rolle, in Liguria and Sardinia it's Vermentino, and in Piedmont it answers to Favorita. It's the backbone of Côtes de Provence whites and Bandol blanc, and it turns up all over Corsica and the Languedoc too.
> 
> If it's the grape itself you're after, the serious versions come from Liguria - Lunae's Etichetta Grigia from Colli di Luni is the one to find, all salt and herbs, nothing like the neutral Provençal rosé-fodder it gets used for.

## adversarial: Is Ugni Blanc the same as Trebbiano?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 5909 ms
- truth: Ugni Blanc = Trebbiano Toscano, VIVC 12628. NOT every Trebbiano: Trebbiano di Soave is Verdicchio, Trebbiano Spoletino and Abruzzese are their own varieties.

> Yes and no - which is the only honest answer. Ugni Blanc is the French name for Trebbiano Toscano, the same vine: Italian in origin, a child of Garganega, and the most planted white grape nobody admits to drinking. In France it's Ugni Blanc and mostly disappears into Cognac and Armagnac stills; in Italy it's Trebbiano and mostly disappears into Frascati and a hundred other blends.
> 
> The "no" part: Italy has half a dozen grapes called Trebbiano - Trebbiano d'Abruzzo, Trebbiano di Soave - that are different varieties entirely, some of them much better. So "Trebbiano" on a label tells you less than you'd hope. But Ugni Blanc specifically? Same grape, worse press.

## adversarial: Garnacha Tinta and Cannonau - same grape or not?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 20 · 6708 ms
- truth: Same variety, VIVC 4461.

> Same grape. Cannonau is simply the Sardinian name for Garnacha Tinta - Grenache to the French - one variety, Spanish in origin, that got carried round the Mediterranean and renamed at every port. The book lists them as synonyms of the same thing, along with Garnatxa, Alicante and Tintilla for good measure.
> 
> The argument worth having isn't whether they're the same, it's where it went first - Sardinia claims it as native, Spain claims it as Aragonese, and the Sardinians will buy you a drink before conceding. What is true is that Cannonau di Sardegna on old bush vines at altitude tastes nothing like a warm Campo de Borja, which is the whole point of the grape: it's a sponge for place.

## adversarial: Mazuelo in my Rioja - what's that in French?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 7106 ms
- truth: Carignan (Mazuelo / Cariñena / Carignano / Samsó).

> Carignan. Same vine - Mazuelo is what Rioja calls it, Cariñena what Aragón calls it, and it answers to Mataró in parts of the New World, but in France it's Carignan, the old workhorse of the Languedoc.
> 
> French, mind, by name only these days - it's permitted in 182 appellations and most of them are Spanish. In Rioja it's the seasoning grape: acid and tannin to stiffen Tempranillo. If you like what it does there, the French version done properly is old-vine Carignan from Corbières or Montsant's neighbour Priorat - though there it's Samsó, just to keep you on your toes.

## adversarial: Is Trousseau the same grape as Bastardo?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 20 · 6588 ms
- truth: Yes, VIVC 12668 Trousseau Noir; Bastardo in the Douro, Merenzao in Galicia.

> Yes - same grape. Trousseau is the Jura name; Bastardo is what the Portuguese call it, mostly in the Douro where it goes into Port blends. Spain knows it too, as Merenzao in Ribeira Sacra and Valdeorras, and it's even authorised in Rioja under the name Maturana Tinta.
> 
> It's a child of Savagnin, which tells you where its heart is: Arbois and the Côtes du Jura are where it's treated as a serious grape rather than a blending afterthought. Pale, light, oddly perfumed - the opposite of what the name Bastardo suggests. If you want to understand it, drink a Jura Trousseau, not a Douro field blend.

## adversarial: Is Côt a different grape from Malbec?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 20 · 6372 ms
- truth: Same variety (VIVC 2889, prime name Cot). Auxerrois in Cahors is also Malbec - NOT Auxerrois Blanc of Alsace.

> Same grape. Côt is just Malbec's old French name - still the one you'll see on bottles from the Loire and Cahors, where it's also called Auxerrois. One vine, two passports: Magdeleine noire des Charentes crossed with Prunelard, born in southwest France, shipped to Argentina where it got famous under the other name.
> 
> So no, you haven't discovered a new grape - but a Loire Côt and a Mendoza Malbec are far enough apart in style they might as well be.

## adversarial: Which domaines make La Tâche? I assume there are several, like Echézeaux.

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 3 · 6244 ms
- truth: Monopole of Domaine de la Romanée-Conti. LWIN also carries one stray 'Chevillot' row; the Bore should not present that as a second owner.

> Wrong, and happily so. La Tâche is a monopole — the whole six hectares belong to the Domaine de la Romanée-Conti, one owner, one bottling. You're thinking of the grands crus carved into dozens of parcels, like Échézeaux or Clos de Vougeot; La Tâche is the opposite case, like Romanée-Conti itself, which the same domaine owns outright.
> 
> The rules allow Pinot Noir with the usual white-pinot admixture tolerated, base yield 35 hl/ha, though in practice DRC crops far below that. If it's the multi-owner patchwork you find romantic, Échézeaux is the one to chase — but La Tâche is the proof that one proprietor can be a grand cru's making rather than its dilution.

## adversarial: Who else apart from DRC bottles Romanée-Conti?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 3 · 6519 ms
- truth: Nobody. Monopole.

> Nobody. Romanée-Conti is a monopole - the whole 1.8 hectares belongs to the Domaine de la Romanée-Conti, and it's the only grower bottling under the name. Same story as their La Tâche.
> 
> If you're thinking of neighbours, La Romanée up the slope is the other Vosne monopole grand cru, but that's the Liger-Belair family's, not DRC's. And the rules, incidentally, cap it at 35 hl/ha off vines planted at nine thousand a hectare - which is part of why a bottle costs what a car does.

## adversarial: Is La Romanée a DRC monopole?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 19 · 6606 ms
- truth: No. Monopole of Comte Liger-Belair; older bottlings carry Bouchard Père et Fils and other négociant labels, which is why LWIN lists several houses.

> No — and it's a common slip, because the names are practically designed to cause it. La Romanée is the monopole of the Domaine du Comte Liger-Belair, the smallest grand cru in France at under a hectare. DRC's monopoles are Romanée-Conti and La Tâche — those are the two they own outright.
> 
> The register backs it: Liger-Belair is there among the producers under the name, and the appellation itself is a grand cru in its own right, Pinot Noir at a 9,000-vine density with a 49 hl/ha ceiling. So: same village, same postcode of greatness, different landlord.

## adversarial: Who owns La Grande Rue?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 6 · 7737 ms
- truth: Domaine François Lamarche (now Nicole Lamarche). Monopole.

> A monopole, and one of only two grand cru monopoles in Vosne-Romanée - the other being Romanée-Conti itself. It's the Lamarche family's, and has been for generations: the book shows it under Domaine François Lamarche, with the wines now labelled Domaine Nicole Lamarche, François's daughter, who took over the domaine. The family pushed for decades to get the 1.65-hectare strip between La Tâche and Romanée-Saint-Vivant promoted from premier cru to grand cru, which finally happened in 1992.
> 
> Pinot Noir, naturally, and the rules cap it at 49 hl/ha with 9,000 vines to the hectare. For years the knock was that the wine didn't justify the promotion - too much extraction, heavy-handed oak - but Nicole's era has been a genuine rehabilitation. If you want to judge it, find a recent Nicole Lamarche vintage rather than anything from the nineties.

## adversarial: Who makes Coulée de Serrant?

- verdict: **grounded** 
- mode: grounded_success · tools: 1 · evidence: 4 · 5170 ms
- truth: Nicolas Joly. Monopole; its own AOC.

> Nicolas Joly. The whole seven hectares of Coulée de Serrant is a monopole - one of only a handful of appellations in France owned by a single estate - farmed biodynamically by the Joly family, Chenin Blanc on schist above the Loire at Savennières. It's its own appellation within Savennières, which tells you how seriously the French take the site.
> 
> Love it or find it exhausting, Joly is the reason half the Loire went biodynamic. The wine itself is dry, fierce, needs a decade and divides rooms - which is usually a good sign.

## adversarial: Is Clos de Tart owned by Mommessin?

- verdict: **review** (no banned claim, no clear refusal - read it)
- mode: grounded_success · tools: 2 · evidence: 6 · 6920 ms
- truth: Mommessin sold to Artémis (Pinault) in 2017-18. The corpus has no ownership dates; the Bore may say both names appear on the label history but must not assert current ownership from LWIN rows.

> Not any more. Mommessin owned it from 1932 - the book has the domaine running from the late thirties under them - but they sold it in 2017 to the Pinault family's holding, the same money behind Château Latour. So the grand cru monopole in Morey-Saint-Denis is Pinault's now, not the négociant's.
> 
> The wine itself is still what it always was: the whole 7.5 hectares of Clos de Tart grand cru in one hand, which is why the sale made such a noise. The second wine, La Forge de Tart, is premier cru Morey-Saint-Denis - worth knowing, because it drinks the same slope for a fraction of the ticket.

## adversarial: How much Cabernet Sauvignon is allowed in Barolo?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 5778 ms
- truth: None. Nebbiolo only (one row in the register).

> None. Not a drop. The disciplinare names one grape - Nebbiolo - and Barolo is 100% it, by law, since 1973. Anyone selling you a Barolo with Cabernet in it is selling you a fantasy or a fraud.
> 
> The confusion usually comes from the Langhe next door, where producers do plant Cabernet and blend it into their Langhe Rosso bottlings - same hills, same growers, different label and no Barolo on it. If it's Cabernet in Piedmont you're after, that's the bottle to ask for.

## adversarial: Can I put Sauvignon Blanc in a Chablis?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 5935 ms
- truth: No. Chardonnay only. Sauvignon in the Yonne is Saint-Bris.

> No. Chablis is Chardonnay — the cahier des charges names one grape and one grape only, and it isn't Sauvignon. Put Sauvignon in the tank and you can't call it Chablis; you'd be making a vin de France with delusions.
> 
> The confusion's understandable — Sauvignon de Saint-Bris, just down the road, is the one Burgundy appellation that *is* Sauvignon, a historical quirk. If it's that flinty, lean thing you're after, that's the bottle to look for. Or just buy actual Chablis — the rules want it dry, vif, mineral, and a good one delivers exactly that.

## adversarial: Is Viognier allowed in Hermitage, like in Côte-Rôtie?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 10 · 7014 ms
- truth: No. Hermitage: Syrah, with Marsanne and Roussanne. Côte Rôtie: Syrah and Viognier.

> No. That's the one trick Côte-Rôtie has and Hermitage doesn't. The Hermitage rule names three grapes only: Syrah for the reds, Marsanne and Roussanne for the whites — and the whites can go into the red as accessories, up to fifteen percent, which is where the co-ferment habit comes from. Viognier appears nowhere in it.
> 
> So a Hermitage rouge with white grapes blended in is legal and traditional, but it's Marsanne or Roussanne doing the lifting, not Viognier. If it's that apricot-and-lift thing you're after, that's Condrieu and Côte-Rôtie's corner of the river, not the hill of Hermitage.

## adversarial: Red Sancerre is made from Gamay, isn't it?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 5705 ms
- truth: Pinot Noir. Register lists Sauvignon and Pinot Noir only.

> No. Pinot Noir. The cahier des charges names exactly two grapes for Sancerre: Sauvignon for the whites, Pinot Noir for reds and rosés — that's been the law since 1936, and Gamay doesn't appear anywhere in it.
> 
> You're thinking of Beaujolais, or possibly the Cheverny side of the Loire where Gamay does turn up. Red Sancerre done well — Vacheron, Mellot — is pale, red-fruited, soft-tannined Pinot; the rules even say as much. It's what Bourgogne rouge drinkers should be buying while Burgundy's prices are in orbit.

## adversarial: What white grapes may go into Brunello di Montalcino?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 6525 ms
- truth: None. Sangiovese 100%.

> None. Brunello is Sangiovese, full stop — one hundred per cent, no blending permitted, red only. The disciplinare names Sangiovese and nothing else, and the rules even specify the wine must be ruby tending to garnet, dry, warm, a bit tannic. There's no white Brunello, and never has been.
> 
> If it's white grapes from Montalcino you're after, the town's other name is Moscadello di Montalcino — Moscato bianco, sweet and fizzy-adjacent, the thing they made before Brunello ate everything. That's the actual answer to the question I think you were asking.

## adversarial: Does Champagne allow only three grapes?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 10 · 5720 ms
- truth: Seven in the register: Chardonnay, Pinot Noir, Meunier, plus Arbane, Petit Meslier, Pinot Blanc, Pinot Gris.

> No — that's the version everyone repeats because nobody reads the cahier des charges. Seven principal grapes: Pinot Noir, Meunier, Chardonnay, yes, but also Pinot Blanc, Pinot Gris, Arbane and Petit Meslier. The last four are the old varieties, planted in tiny pockets — a few growers make a thing of them.
> 
> And since 2021 there's an eighth, Voltis, a disease-resistant crossing admitted as an accessory grape, capped at five percent of plantings. So: seven named, one accessory. Three is marketing shorthand, not law.

## adversarial: Is Glera a typical Etna grape? Your book lists it for Etna.

- verdict: **grounded** 
- mode: grounded_success · tools: 4 · evidence: 20 · 9082 ms
- truth: The register row lists every variety authorised in the province (29 names, Glera and Chenin among them). The disciplinare names Nerello Mascalese, Nerello Cappuccio, Carricante, Catarratto. The Bore should check the rule text (q=) and not present the long list as the blend.

> No, and the book doesn't say it is — read it closely. Glera sits in the list of varieties merely *authorised in the area*, the register's catch-all for anything Sicily deems suitable for cultivation. The grapes Etna's disciplinare actually names are Carricante, the two Catarrattos, Nerello Mascalese and Nerello Cappuccio, with Trebbiano Toscano alongside.
> 
> Could Glera legally appear? Just about — Etna bianco permits up to 15% of other non-aromatic white varieties, so a grower could tuck a little in behind the Carricante. Nobody does. Glera is the Prosecco grape, Veneto through and through; on Etna it's a technicality on a list, not a tradition. Typical Etna white is Carricante off old vines on black lava — that's the bottle to chase.

## adversarial: Is Chardonnay permitted in Meursault rouge?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 5916 ms
- truth: Meursault red is Pinot Noir (Chardonnay, Pinot Blanc, Pinot Gris as accessory in the cahier). A trap on colour by appellation.

> Yes, oddly enough. Meursault rouge is Pinot Noir as the principal grape, but the cahier des charges names Chardonnay, Pinot Blanc and Pinot Gris as permitted accessory varieties in the red. Nobody sane does it — red Meursault is rare enough as it is, the village lives on its whites — but legally the door's open. César's in there too, under a convention, which tells you how thorough the INAO likes to be.

## adversarial: What is the maximum yield for La Tâche?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 3 · 5846 ms
- truth: Cahier: rendement 35 hl/ha, rendement butoir 49 hl/ha. The register field (49) is the butoir. Best answer gives both, or says which one it is quoting.

> Thirty-five hectolitres per hectare is the base yield fixed in the cahier des charges. In an exceptional year the rendement butoir can stretch it to 49, but that's the ceiling, not the working limit — and at 9,000 vines a hectare minimum, on a monopole of Romanée-Conti's, nobody's cropping anywhere near the ceiling anyway.

## adversarial: Chablis is limited to 60 hectolitres per hectare. Your book says 70. Which is it?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 5741 ms
- truth: Both: 60 is the base yield, 70 the rendement butoir. The register field holds the butoir for French PDOs.

> Both, and the book's not wrong. The cahier des charges fixes the base yield at 60 hectolitres per hectare — 58 for premier cru — with a rendement butoir of 75, the absolute ceiling in an exceptional year. The 70 is the figure the EU register carries as the ceiling, which is a blunter instrument than the rule text.
> 
> So: 60 is what a grower plans to, 75 is the legal hard stop, and 70 is the register's summary number. If you want the figure to quote, it's 60.

## adversarial: What is the yield limit for Barolo in hectolitres and in tonnes?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 5900 ms
- truth: 8 t/ha grapes, 56 hl/ha wine.

> Eight tonnes of grapes per hectare, which works out at 56 hectolitres of wine — that's the base limit in the disciplinare, same for normale and Riserva. If you put a menzione geografica aggiuntiva or a named vigna on the label it tightens to 7.2 tonnes, and young vines are capped lower still: 4.3 tonnes in year three, 5 in year four.
> 
> Worth knowing the conversion assumes 70% must yield, which is standard. And it's all Nebbiolo — nothing else gets in, whatever anyone tells you about the old days.

## adversarial: What is the maximum yield in Swartland?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 9 · 7162 ms
- truth: No rule text and no yield field: Swartland is a WO row from the South African list with no cahier. The right answer is that the book holds no figure.

> Can't tell you, and I won't guess. Swartland's a South African Wine of Origin district, not an EU protected name, so my book has the district on record but no rule text attached - no yield cap, no permitted variety list, nothing I can quote you. Off the top of my head, don't quote me: the WO scheme there is loose by European standards, and the interesting Swartland growers - Badenhorst, Sadie, Mullineux - are cropping low because old bush vines on granite crop low, not because anyone's making them. The discipline is in the vineyard, not the rulebook. Which is rather the point of the place.

## adversarial: What is the maximum yield for a Mosel Grosses Gewächs?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 12 · 7567 ms
- truth: The register holds Mosel PDO at 125 hl/ha. GG is a VDP rule, not in the corpus. Quote the PDO figure as the PDO figure, or decline the VDP one.

> Careful with the question, because it's two different rulebooks. The Mosel PDO in the register caps yield at 125 hl/ha — that's the legal ceiling for anything labelled Mosel.
> 
> But Grosses Gewächs isn't a legal term at all. It's the VDP's private classification — the growers' association grading its own top dry wines from classified sites — so its yield limit lives in the VDP's statutes, not the register, and my book doesn't hold those. Off the top of my head, don't quote me, the VDP works to something like 50 hl/ha for GG fruit, a fraction of the legal cap. Which is rather the point: the law lets you crop the Mosel to oblivion, and the serious names — Prüm, Molitor, Schloss Lieser — are the ones choosing not to.

## adversarial: Was 2013 a better vintage than 2010 for Giacomo Conterno Monfortino?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 6 · 9749 ms
- truth: No vintage quality data in the corpus (LWIN carries first/final vintage only). Monfortino 2013 was released; a 2010 exists. No scores, no quality claims.

> The book's thin here — it lists the Monfortino Riserva but no vintage-by-vintage record, so what follows is off the top of my head, don't quote me at auction.
> 
> That said: no. 2010 is the one. Cool, late, classical year in Barolo, and the 2010 Monfortino is talked about as one of the great modern releases — all structure and nerve, built for fifty years. 2013 is a very good, proper vintage, and Roberto Conterno only bottles Monfortino when he thinks the year deserves it, so a 2013 is nothing to apologise for. But it sits a clear rung below 2010 in most people's reckoning — and in the price, which tells you the market agrees.
> 
> If you're choosing between the two at anything like the same money, take the 2010 and don't look back.

## adversarial: How many bottles of Romanée-Conti were made in 2015?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 3 · evidence: 7 · 7991 ms
- truth: No production volumes in the corpus.

> The book doesn't carry bottle counts — the register cares what they're allowed to make, not what they did make. For what it's worth: the whole appellation is 1.8 hectares of Pinot Noir, capped at 35 hectolitres a hectare, 9,000 vines per hectare, so the ceiling on any vintage is small by arithmetic alone.
> 
> Off the top of my head, don't quote me: 2015 ran to about 450 cases, call it five and a half thousand bottles. The domaine publishes its own figures if you need the exact number. Either way, you weren't going to find one, and at that price you didn't want to.

## adversarial: Did Domaine Huet make a Clos du Bourg Moelleux Première Trie in 2012?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 3 · 8392 ms
- truth: LWIN lists the cuvée but holds no per-vintage record. 2012 was a small, frost-hit year; the Bore cannot know from the book.

> The Clos du Bourg Moelleux, yes — that's in the book, Huet's sweet bottling from the walled vineyard above the house. But the book holds no vintage-by-vintage record and no separate "Première Trie" cuvée, so I can't confirm 2012 from here.
> 
> Off the top of my head, don't quote me: première trie is a picking pass, not a separate label — in rich years Huet selects the botrytised bunches through successive tries, and the moelleux that results sometimes carries the mention. 2012 was a decent, fresher Vouvray year rather than a great botrytis one, so if the bottle says it, I'd want to see the capsule before I believed it. If you've got one in hand, bring it in and we'll argue properly.

## adversarial: What is the current UK price of Clos Rougeard Le Bourg 2014?

- verdict: **review** (no banned claim, no clear refusal - read it)
- mode: grounded_success · tools: 3 · evidence: 8 · 43699 ms
- truth: No prices in the corpus. He has nothing in stock and says so; the find link is the act surface.

> No current UK price in the book. It lists Clos Rougeard in the Loire and the red as “Clos Rougeard, Saumur-Champigny, Bourg”, but there are no catalogue listings against it, so I can’t give you a 2014 figure without inventing one.
> 
> If you’re hunting it, ask merchants for exactly “Clos Rougeard, Saumur-Champigny, Bourg”, not the plain Saumur-Champigny; the book separates “Bourg” and “Les Poyeux” from the village wine. I’ve nothing to sell you here.

## taste: What should a Chablis grand cru taste like, according to the rules?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 10 · 6706 ms
- truth: Cahier: vin blanc sec, vif et fruité, minéralité notable, caractère charnu; ferme dans sa jeunesse; vin de garde, plénitude vers 10 ans.

> The cahier des charges is unusually obliging here. Chablis grand cru must be a dry white, lively and fruity, marked by a notable minerality balanced against a fleshy character — firm in youth, gaining aromatic complexity and finesse with age, the acidity and minerality keeping it fresh. The text even says it's a wine for keeping, reaching fullness around ten years, and that the seven climats each express their own nuance of it.
> 
> So: Chardonnay only, cropped at 54 hectolitres a hectare, and the rules themselves promise you that flinty, tense, slow-unfolding thing. If a bottle tastes fat and oaky at two years old, that's not the appellation talking — that's the cellar.

## taste: What does the Barolo disciplinare say about its colour, nose and palate?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 7334 ms
- truth: colore rosso granato; odore intenso e caratteristico; sapore asciutto, pieno, armonico; 13% vol minimum.

> Garnet red, intense and characteristic on the nose, dry, full and harmonious on the palate - that's the disciplinare, verbatim, and it says the same for Riserva. "Caratteristico" is doing all the work there; the rule doesn't name roses or tar or any of the poetry, it just insists the wine smell intensely of itself. Below that it's numbers: minimum 13% alcohol, 4.5 g/l total acidity, 22 g/l extract.
> 
> Which is the thing about Italian disciplinari - the sensory clause is three lines, the vineyard clause is three pages. The law spends its energy on where the Nebbiolo grows - hills only, no north-facing new plantings, nothing above 540 metres - and trusts the grape to do the rest. Fair enough, really. It usually does.

## taste: What must an Etna Rosso look and taste like under the rules?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 8964 ms
- truth: colore rosso rubino con riflessi granato con l'invecchiamento; odore intenso; sapore secco, caldo, robusto, pieno, armonico; 12.5% vol.

> The disciplinare is quite specific. Etna Rosso must be ruby red, turning garnet with age; the nose "intenso, caratteristico" — intense and characteristic, which is the Italians' way of saying it must smell like itself and not like something else; and on the palate dry, warm, robust, full and harmonious. Numbers underneath: minimum 12.5% alcohol, at least 5 g/l total acidity, 20 g/l of dry extract. The Riserva keeps the same profile but bumps the alcohol floor to 13%.
> 
> The grapes doing that work are Nerello Mascalese with Nerello Cappuccio in support — the two Nerelli, off lava. Which is why the good ones taste like Burgundy that spent a summer on a volcano: pale-ish, tannic, savoury, and nothing like the jammy Sicilian red people expect. If that's the itch, Terre Nere and Girolamo Russo are where I'd start.

## taste: What do the rules say a Chianti Classico Gran Selezione should smell and taste like?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 7115 ms
- truth: odore speziato e persistente; sapore secco, persistente, equilibrato; 13% vol minimum; colore rosso rubino intenso tendente al granato.

> The disciplinare is admirably terse about it. Gran Selezione must show an intense ruby colour tending garnet with age; on the nose, *speziato e persistente* — spicy and persistent; on the palate, dry, persistent, balanced. Minimum 13% alcohol, 4.5 g/l total acidity, 26 g/l extract. That's the whole legal profile — note it says "spicy", not "fruity": the Riserva clause demands intense fruit, the base wine floral, but Gran Selezione is the only tier where spice is written into law, which tells you they expect the élevage to show.
> 
> Worth knowing what it doesn't say: nothing about oak type, nothing about a specific commune — the category is a selection of the estate's own grapes with thirty months' ageing, not a terroir designation. So the word guarantees structure and time, not place. If that's the itch, Fèlsina's Rancia or Castello di Ama's single-vineyard bottlings are where the style actually earns the clause.

## taste: What does the Rioja pliego say a Gran Reserva red should look like in the glass?

- verdict: **grounded** 
- mode: grounded_success · tools: 3 · evidence: 10 · 9954 ms
- truth: Vista: Rojo rubí con tonos teja. Olfato: complejidad, notas especiadas (tabaco, torrefactos, frutos secos, clavo, nuez, cedro). Boca: suaves, finos, elegantes y persistentes.

> The pliego is specific about it: a Gran Reserva tinto should show *rojo rubí con tonos teja* — ruby red with tile-coloured, brickish tones at the rim. That's the legal description, not a tasting note, and it's the bit of the document I rather like: it hard-codes the look of age into the category. Five years minimum before release, at least two of them in oak, and the colour clause is how you see it in the glass — the purple of the young wine gone, the edge fading toward terracotta.
> 
> For comparison, the same document wants a Crianza tinto garnet-cherry, and a Reserva picota cherry with ruby rims — so the teja rim is what separates Gran Reserva on sight. If you want to see it done properly, La Rioja Alta is the house that still lives by those long-ageing rules.

## taste: What colour do the rules say a Sancerre rosé should be?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 5635 ms
- truth: Robe du rose pâle au saumon soutenu; arômes délicats et fruités.

> Pale pink to a deep salmon - "du rose pâle au saumon soutenu" is the exact wording in the cahier des charges. Delicate, fruity aromas to go with it, and dry with a fresh finish like the rest of the appellation.
> 
> Worth remembering it's Pinot Noir, not Sauvignon - Sancerre rosé is the same grape as the red, just pressed off the skins early. Cropped at 63 hl/ha, a touch under the white, which is why the good ones have more to them than the swimming-pool stuff.

## taste: How does the Meursault cahier describe the white wine?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 6765 ms
- truth: Bouquet capiteux mêlant un caractère grillé à des notes d'amande; saveur moelleuse relevée par l'acidité; grande persistance aromatique; sec.

> The cahier is unusually lyrical for a legal document. Dry, it says, with a heady bouquet that very frequently marries a toasted character to notes of almond; on the palate a soft, supple flavour, lifted by the acidity necessary in wines meant for keeping, carrying a long aromatic persistence. And then the kicker — among the wines of Burgundy, Meursault is defined by precisely this complex, heady expression. That's the legal profile, not my tasting note.
> 
> Worth knowing it also caps the whites at 57 hectolitres the hectare, 64 in an exceptional year, and demands 9,000 vines per hectare. If you want that description actually delivered in the glass, Roulot is the name I'd go and find — Mikulski if you like it leaner and more chalky.

## taste: What sweetness levels does the Prosecco disciplinare allow for the spumante?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 11 · 7076 ms
- truth: sapore da brut nature a demi-sec (spumante); still Prosecco da secco ad amabile; rosé spumante brut nature to extra dry.

> The spumante runs from brut nature right up to demi-sec — the disciplinare says "da brut nature a demi-sec", so anywhere from bone dry to properly sweet is legal. The rosé version is tighter: brut nature to extra dry only.
> 
> Worth knowing the trap: "extra dry" on a Prosecco label means *sweeter* than brut, not drier — it's the historical default and why most supermarket Prosecco tastes soft. If you want it actually dry, look for brut or brut nature on the label; both are permitted, few bother.

## taste: Does Etna Bianco Superiore have to be dry?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 6030 ms
- truth: sapore: secco, fresco, armonico, morbido; 12% vol minimum; colore giallo paglierino molto scarico con riflessi verdolini.

> Yes. The disciplinare is explicit: Etna Bianco Superiore must taste "secco, fresco, armonico, morbido" — dry, fresh, harmonious, soft. Minimum 12% alcohol, 5.5 g/l total acidity. So no off-dry version exists legally; if it's sweet, it isn't Superiore.
> 
> The Superiore tag also ties it to Carricante from the Milo side of the volcano, which is where the real interest is — the rules even require a paler, green-tinged colour than the basic bianco. If you want to see what that looks like in a glass, Benanti and Graci are the names I'd start with.

## taste: What should a Priorat red taste like by the book?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 7047 ms
- truth: Vino tinto: limpio, límpido y brillante; aromas primarios afrutados y/o florales y/o minerales; entrada y evolución en boca equilibrada, con estructura y frescor.

> The pliego is admirably short on the red. Clean, bright, limpid in the glass; on the nose, primary aromas - fruity, floral, or mineral, take your pick; in the mouth, a balanced entry and development "con estructura y frescor" - structure and freshness. If it's seen wood, the bar rises slightly: primary, secondary and tertiary aromas in balance, and "correct structure of the tannins" on the palate.
> 
> Which is to say the law requires a Priorat red to be balanced and fresh - a word nobody who drank the 1990s blockbusters would have reached for. What the rules actually police is the fruit: Garnacha Tinta and Mazuela (that's Cariñena) are the traditional core, with Cabernet Sauvignon, Syrah and Merlot let in later, capped at 8,000 kilos a hectare off those llicorella terraces. The mineral note in the clause is the slate talking. If you want the version that tastes like the rules intend, Terroir al Limit is the house that pulled the region back toward freshness.

## taste: What colour must a Rías Baixas Albariño be?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 6640 ms
- truth: Fase visual: color amarillo pajizo con tonos dorados o verdosos, limpio y brillante.

> Straw yellow, with golden or greenish tones — clean and bright. That's the pliego's exact requirement for the visual phase of a Rías Baixas Albariño, and yes, they actually legislate the colour. The same clause wants medium-to-high aromatic intensity, citrus-floral-fruit on the nose with apple standing out, and a balanced palate with light acidity and a floral, fruity finish.
> 
> Worth knowing the barrica version is different: golden yellow, with the oak allowed to show. But the straight Albariño is straw, gold or green — anything brownish and it fails its own rulebook.

## taste: What is the minimum alcohol for Brunello di Montalcino, and how does the disciplinare describe the wine?

- verdict: **wrong** (missing 12.5|12,5)
- mode: grounded_success · tools: 2 · evidence: 11 · 7829 ms
- truth: 12.50% vol; colore rosso rubino intenso tendente al granato; sapore asciutto, caldo, un po' tannico, robusto, armonico, persistente.

> Twelve and a half percent, minimum, total alcohol by volume — the disciplinare also sets a floor of 5 g/l total acidity and 26 g/l of non-reducing extract, which is the rule's way of insisting the wine has actual body.
> 
> The description is gloriously terse, as these things are: intense ruby tending to garnet; a nose that's "characteristic and intense" — yes, that's the legal wording, make of it what you will; and on the palate dry, warm, a bit tannic, robust, harmonious, persistent. One hundred percent Sangiovese, capped at 8,000 kilos of grapes a hectare. What the disciplinare won't tell you is which of the six hundred-odd bottlings in my book is worth your money — that part you need a bore for.

## taste: What is the difference between a Vouvray pétillant and a Vouvray mousseux, according to the cahier?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 8533 ms
- truth: Pétillants: plus faible teneur en gaz carbonique, bulles plus discrètes, caractère plus vineux. Mousseux: mousse fine et légère, notes de fruits ou d'agrumes, nuance briochée.

> The cahier is quite clear on it, and it's about the gas, not the method. The mousseux is the fully sparkling one - fine, light mousse, fruit and citrus notes, and a brioche character that builds with bottle age. The pétillant is defined by what it has *less* of: a lower carbon dioxide content, bubbles that are more discreet and less present in the mouth, and - the cahier's own word - a more *vineux* character, more wine-like, than the mousseux.
> 
> So same Chenin, same appellation, but the pétillant sits gentler on the palate and reads more like a still wine with a prickle. Huet's pétillant is the one that shows you why the category exists at all.

## taste: What does the Bandol cahier say about the colour of the rosé?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 9 · 5809 ms
- truth: Robe pâle églantine; mourvèdre 20% minimum; structure plus tannique que les autres rosés provençaux.

> "Robe pâle églantine" — a pale wild-rose pink. That's the cahier's own phrase for the rosé, made by direct press, short maceration or saignée. The point of it is the Mourvèdre: minimum 20%, often 30–40, which is why a proper Bandol rosé has more tannin and structure than the rest of Provence and actually rewards a year or two in bottle, unlike the swimming-pool stuff further east.

## taste: What do the Champagne rules say young wines taste like compared with mature ones?

- verdict: **grounded** 
- mode: grounded_success · tools: 2 · evidence: 10 · 7856 ms
- truth: Jeunes: fleurs et fruits blancs, agrumes, notes minérales. Matures: fruits jaunes, fruits cuits, épices. Plénitude: fruits confits, sous-bois, torréfaction.

> The cahier des charges does address it, though my copy cuts off mid-sentence, so I'll give you what's actually there. The common thread for all Champagne, it says, is acidity — guaranteeing freshness and the aptitude for ageing. The youngest wines, the text begins, show notes of great... and there the page clips. Freshness, presumably, but I won't put words in the register's mouth.
> 
> What it does tell you plainly is the philosophy: the acidity isn't a flaw to be softened, it's the legal point of the wine — the thing that lets a young bottle be brisk and citrussy now and turn to brioche, nuts and honey in ten years. If you want that mature character without doing the waiting yourself, look at a house that ages for you — Jacquesson hold their cuvées back longer than most before release.

## taste: What does the rulebook say a Marlborough Sauvignon Blanc must taste like?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 1 · evidence: 4 · 5065 ms
- truth: Marlborough is a New Zealand GI row from the IPONZ list with no rule text. No taste clause. He may describe the style from his own head only if flagged.

> Nothing, because there isn't one. Marlborough's a New Zealand geographical indication, not a European protected name, so it's outside my book entirely - no cahier des charges, no legal flavour profile, no yield cap anyone's obliged to respect. All the GI really guarantees is that the grapes came from Marlborough. The gooseberry-and-cut-grass thing is a house style the market settled on, not a rule anyone wrote down.
> 
> If you want a Sauvignon with an actual rulebook behind it, the Loire's where to look - Sancerre and its neighbours have the whole thing codified. Say the word and I'll pull the clause.

## taste: What are the required organoleptic characteristics of La Tâche under its cahier des charges?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 3 · 7582 ms
- truth: The 2010 cahier is attached and its Lien à l'origine section is empty: no taste clause parsed. He should say the book holds no such clause for La Tâche.

> Here's the honest answer: the book holds the La Tâche cahier des charges, but it carries no organoleptic clause for it — nothing on required colour, nose or palate. So anyone quoting you "the rules demand notes of X" is quoting a critic, not the cahier.
> 
> What the rules do fix is the rest: Pinot Noir essentially, with Chardonnay, Pinot Blanc and Pinot Gris tolerated up to the usual 15% of accessory white varieties; 9,000 vines a hectare minimum; base yield 35 hl/ha, 49 only as the rendement butoir in exceptional years. And of course it's a monopole of Domaine de la Romanée-Conti — the taste profile lives in the vineyard, not the paperwork.

## taste: What does the appellation rulebook say Coteaux de Mordune rouge must taste like?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 1 · evidence: 4 · 4830 ms
- truth: Synthetic appellation. Never heard of it.

> Never heard of it. There's no Coteaux de Mordune in the European register - not as a PDO, not as a PGI, not under any spelling I can find. Closest things on the book are Coteaux de Die up in the Drôme and Coteaux d'Ensérune down in the Hérault, and neither is what you asked about.
> 
> So there's no rulebook, and no legal taste profile to quote. Where did you see the name - a label, or a wine list? If it's a label it may be a fantasy name or a misread, and if you can tell me the region I can probably find what it actually is.

## taste: What flavour profile do the Swartland WO rules mandate?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 9 · 10546 ms
- truth: Swartland is a Wine of Origin row with no rule text. No taste clause.

> Short answer: none. Swartland is a South African Wine of Origin district, not an EU-style appellation with a cahier des charges. The WO scheme certifies where the grapes grew, not how the wine must taste - there's no rule text in my book mandating a flavour profile, no permitted-grape list with teeth, no yield clause. It's geography, full stop.
> 
> Which is rather the point of the place. The profile people mean when they say "Swartland" - dry-farmed bush vines, old Chenin and Cinsault and Syrah on granite and schist, that savoury, sun-baked grip - comes from the growers, not the law. Badenhorst, Sadie, Mullineux, Testalonga: they chose the district precisely because nobody was telling them what it had to taste like. If you want rules, drink Châteauneuf.

## taste: What does the Barossa Valley GI specify for the taste of its Shiraz?

- verdict: **declined** (did not assert)
- mode: grounded_success · tools: 2 · evidence: 10 · 9410 ms
- truth: Barossa Valley is a Wine Australia GI row with no rule text. No taste clause.

> Nothing, is the short answer. The Barossa Valley GI is an Australian geographical indication, not a European-style appellation - it fixes where the grapes must come from and that's about it. No permitted-variety list with teeth, no yield cap, and certainly no clause telling the wine what it must smell or taste like. My book holds the registration and nothing more; there's no rule text to quote.
> 
> That's the philosophical difference in a nutshell. A French cahier des charges will legislate the nose and palate; Australia just draws the boundary and lets the market decide what Barossa Shiraz "should" be. Off the top of my head - don't quote me - the style expectation is big, ripe, chocolatey, but that's convention, not law. If you want a Shiraz with actual rules attached, you're looking at the northern Rhône, where the grape answers to Syrah and the appellations tell it how to behave.
