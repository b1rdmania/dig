#!/usr/bin/env npx tsx
/**
 * Wine Bore eval - ninety questions: thirty the register can settle, forty
 * adversarial ones in the voice of a sceptical sommelier (colour traps,
 * synonym traps, monopole ownership, permitted grapes, yields, and claims the
 * corpus cannot support, where the right answer is to not assert), and twenty
 * on what the rules say a wine should taste like (22 Sep: fifteen the taste
 * clause settles, five traps where the book holds no clause).
 *
 * Runs each question through /v1/ask (bore=wine) on a running API, records
 * the answer, mode, tool calls and timing, and scores what a rule can score:
 *   grounded  - the loop returned evidence and every `must` string appears
 *   hedged    - the answer flags itself as unverified ("don't quote me",
 *               "never heard of it", "off the top of my head")
 *   wrong     - a `must_not` string appears, or a `must` string is missing
 *               from a grounded answer
 * must_not strings are whole claims ("chardonnay is permitted"), never a bare
 * word: the 21 Sep run scored "No Chardonnay" and "there is a red-skinned
 * mutation" as wrong.
 * Anything a rule cannot settle (the favourite-bottle challenges) is marked
 * `review` for a human read. Output: docs/wine-bore-eval-<date>.md.
 *
 * Usage:
 *   API_URL=http://localhost:3010 pnpm exec tsx scripts/wine/eval.ts        # GROUP=rule|producer|challenge|adversarial|taste to run one section
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const API_URL = process.env.API_URL ?? "http://localhost:3010";
const OUT = resolve(__dirname, "..", "..", "docs", `wine-bore-eval-${new Date().toISOString().slice(0, 10)}${process.env.GROUP ? `-${process.env.GROUP}` : ""}.md`);

interface Q {
  group: "rule" | "producer" | "challenge" | "adversarial" | "taste";
  q: string;
  /** Strings that must appear (case-insensitive) for a grounded answer to count. "a|b" = either. */
  must?: string[];
  /** Strings that must not appear. */
  must_not?: string[];
  /** The fact the register settles, for the reviewer. */
  truth: string;
  /**
   * The data cannot support the claim the question fishes for. The right
   * answer is to not assert it. A hedge scores "declined"; an unhedged answer
   * with no must_not hit goes to a human as "review".
   */
  abstain?: boolean;
}

const QUESTIONS: Q[] = [
  // --- ten appellation rules ---
  { group: "rule", q: "What grapes is a Chablis actually allowed to be made from?", must: ["chardonnay"], must_not: ["sauvignon", "aligoté", "aligote"], truth: "Chardonnay only (PDO-FR-A0925)" },
  { group: "rule", q: "Which grape varieties are permitted in Sancerre?", must: ["sauvignon", "pinot"], must_not: ["chardonnay is permitted", "and chardonnay", "chardonnay for"], truth: "Sauvignon Blanc (white), Pinot Noir (red/rosé)" },
  { group: "rule", q: "Can a red Chianti Classico contain white grapes?", must: ["sangiovese"], truth: "Sangiovese min 80%; white grapes not permitted since 2006 disciplinare" },
  { group: "rule", q: "What is the maximum yield for Barolo?", must: ["56"], truth: "8 t/ha grapes (56 hl/ha) per disciplinare" },
  { group: "rule", q: "Is Pouilly-Fumé made from the same grape as Pouilly-Fuissé?", must: ["sauvignon", "chardonnay"], truth: "No: Pouilly-Fumé = Sauvignon Blanc (Loire); Pouilly-Fuissé = Chardonnay (Mâconnais)" },
  { group: "rule", q: "What grapes can go into a Rioja red?", must: ["tempranillo"], truth: "Tempranillo, Garnacha Tinta, Graciano, Mazuelo, Maturana Tinta (DOCa Rioja)" },
  { group: "rule", q: "Is Grüner Veltliner allowed in Wachau DAC?", must: ["grüner", "veltliner"], truth: "Yes - Grüner Veltliner and Riesling are the Wachau varieties" },
  { group: "rule", q: "What's the difference between Crémant d'Alsace and Champagne in terms of grapes?", must: ["pinot"], truth: "Crémant d'Alsace: Pinot Blanc, Pinot Gris, Pinot Noir, Riesling, Chardonnay, Auxerrois; Champagne: Chardonnay, Pinot Noir, Meunier (+ Arbane, Petit Meslier, Pinot Blanc, Pinot Gris)" },
  { group: "rule", q: "Can Beaujolais be made from Pinot Noir?", must: ["gamay"], truth: "Gamay is the Beaujolais grape; Pinot Noir was permitted up to 15% under the AOC until the 2024 revision - flag if the register says otherwise" },
  { group: "rule", q: "What grapes are allowed in Châteauneuf-du-Pape?", must: ["grenache", "syrah", "mourv"], truth: "13 varieties incl. Grenache, Syrah, Mourvèdre, Cinsault, Counoise..." },
  // --- ten producer facts ---
  { group: "producer", q: "Who is Domaine Huet and what do they make?", must: ["vouvray"], truth: "Vouvray (Chenin Blanc) - Le Mont, Clos du Bourg, Le Haut-Lieu" },
  { group: "producer", q: "Does Château Léoville-Las Cases make a second wine?", must: ["las cases|léoville|leoville"], truth: "Clos du Marquis / Le Petit Lion (LWIN lists both under the house)" },
  { group: "producer", q: "What appellation is Giacomo Conterno's Monfortino?", must: ["barolo"], truth: "Barolo Riserva" },
  { group: "producer", q: "Where is Egon Müller based and what grape does he grow?", must: ["riesling", "mosel|saar"], truth: "Scharzhofberg, Saar/Mosel - Riesling" },
  { group: "producer", q: "Which producer makes Clos Sainte Hune?", must: ["trimbach"], truth: "Trimbach - Riesling, Alsace Grand Cru Rosacker" },
  { group: "producer", q: "Tell me about Vega Sicilia's wines.", must: ["ribera"], truth: "Ribera del Duero - Único, Valbuena 5°, Alión (separate house)" },
  { group: "producer", q: "What does Domaine de la Romanée-Conti actually own?", must: ["romanée|romanee|tâche|tache"], truth: "Romanée-Conti, La Tâche (monopoles), Richebourg, Romanée-St-Vivant, Grands-Echézeaux, Echézeaux, Montrachet, Corton" },
  { group: "producer", q: "Is Château Musar from Lebanon?", must: ["lebanon", "bekaa"], truth: "Yes - Bekaa Valley, Lebanon" },
  { group: "producer", q: "Who makes Tignanello and is it a DOCG?", must: ["antinori"], truth: "Marchesi Antinori; Toscana IGT, not DOCG" },
  { group: "producer", q: "What does Domaine Tempier make?", must: ["bandol"], truth: "Bandol - Mourvèdre-led reds and rosé (La Tourtine, La Migoua, Cabassaou)" },
  // --- ten favourite-bottle challenges (human review) ---
  { group: "challenge", q: "My favourite wine is Cloudy Bay Sauvignon Blanc.", truth: "Expect respect + one connected counter-bottle (Marlborough or Loire Sauvignon), grounded" },
  { group: "challenge", q: "My favourite wine is Tignanello.", truth: "Counter should be connected: a Chianti Classico Gran Selezione, or Antinori's own Solaia, or a Sangiovese purist" },
  { group: "challenge", q: "My favourite wine is Whispering Angel.", truth: "Commercial ask - weary respect, then a serious Provence/Bandol rosé" },
  { group: "challenge", q: "My favourite wine is Château Margaux 2000.", truth: "Respect earned; counter from the same commune or a Margaux second wine at the price" },
  { group: "challenge", q: "My favourite wine is Egon Müller Scharzhofberger Kabinett.", truth: "Respect; counter a Saar neighbour or the Spätlese" },
  { group: "challenge", q: "My favourite wine is Penfolds Grange.", truth: "Respect; counter a Barossa Shiraz grower or Hill of Grace" },
  { group: "challenge", q: "My favourite wine is Yellow Tail Shiraz.", truth: "Wrong-shop-adjacent; the door politely, then a real Shiraz" },
  { group: "challenge", q: "My favourite wine is Ridge Monte Bello.", truth: "Respect; counter a Santa Cruz Mountains neighbour or Ridge's own Lytton Springs" },
  { group: "challenge", q: "My favourite wine is Vega Sicilia Único.", truth: "Respect; counter Valbuena, Pingus, or a Ribera traditionalist" },
  { group: "challenge", q: "My favourite wine is Prosecco.", truth: "Commercial; Crémant or Franciacorta at the price, grounded" },
  // --- forty adversarial questions: a sceptical sommelier, 21 Sep 2026 ---
  // Colour traps
  { group: "adversarial", q: "Xarel·lo is a red grape, isn't it? I had a lovely red one in Penedès.", must: ["white"], must_not: ["it is a red grape", "yes, red", "red grape, yes", "xarel·lo is red"], truth: "White. VIVC 13270 BLANC. The bug Ollie found on 09-17." },
  { group: "adversarial", q: "Pinot Gris is a white grape. Agree?", must: ["pink|grey|gris|rose|rosé"], truth: "Grey-pink skinned (VIVC GRIS); it makes white wine. The Bore should draw the distinction, not just agree." },
  { group: "adversarial", q: "Recommend me a red Savagnin from the Jura.", must: ["white"], must_not: ["red savagnin is"], truth: "Savagnin is white. Jura reds are Poulsard, Trousseau, Pinot Noir." },
  { group: "adversarial", q: "Is Poulsard a white grape? The wine is so pale.", must: ["red|black|noir"], truth: "Red (VIVC 9643 NOIR). Pale wine, dark-skinned grape. Poulsard Blanc (9642) is a separate, rare variety." },
  { group: "adversarial", q: "Gewürztraminer is a white-skinned grape, correct?", must: ["pink|rose|rosé|red-skinned|reddish"], truth: "Pink/rose skinned (VIVC ROSE); white wine." },
  { group: "adversarial", q: "Is Riesling Rot a red wine grape?", must: ["riesling"], must_not: ["makes red wine", "a red wine grape, yes"], truth: "A red-skinned mutation of Riesling (VIVC ROUGE), filed rose. It makes white wine." },
  { group: "adversarial", q: "Grenache only comes in red, right?", must: ["blanc|white", "gris|grey|roja"], truth: "Grenache/Garnacha Tinta (4461, red), Grenache Blanc (4457, white), Garnacha Roja/Grenache Gris (4980, rose) are three rows." },
  { group: "adversarial", q: "Is Pinot Meunier a white grape, since Champagne is white?", must: ["red|black|noir"], truth: "Red (VIVC 9278 NOIR)." },
  // Synonym traps
  { group: "adversarial", q: "Are Zinfandel and Primitivo different grapes?", must: ["same|synonym|identical|one variety|one grape"], truth: "One variety, VIVC 9703 (prime name Primitivo; Tribidrag / Crljenak Kaštelanski in Croatia)." },
  { group: "adversarial", q: "What is Ploussard?", must: ["poulsard"], truth: "The Pupillin spelling of Poulsard. VIVC lists PLOUSSARD under Poulsard Noir 9643 (and under Poulsard Blanc 9642)." },
  { group: "adversarial", q: "Is Tinta de Toro its own variety?", must: ["tempranillo"], truth: "Tempranillo (VIVC 12350). Also Tinto Fino, Tinta del País, Cencibel, Ull de Llebre, Aragonez, Tinta Roriz." },
  { group: "adversarial", q: "What grape is Rolle?", must: ["vermentino"], truth: "Vermentino (hand-checked synonym map; also Pigato, Favorita by DNA)." },
  { group: "adversarial", q: "Is Ugni Blanc the same as Trebbiano?", must: ["trebbiano toscano"], must_not: ["ugni blanc is a different grape", "no, they are different"], truth: "Ugni Blanc = Trebbiano Toscano, VIVC 12628. NOT every Trebbiano: Trebbiano di Soave is Verdicchio, Trebbiano Spoletino and Abruzzese are their own varieties." },
  { group: "adversarial", q: "Garnacha Tinta and Cannonau - same grape or not?", must: ["same|synonym|identical|grenache"], truth: "Same variety, VIVC 4461." },
  { group: "adversarial", q: "Mazuelo in my Rioja - what's that in French?", must: ["carignan"], truth: "Carignan (Mazuelo / Cariñena / Carignano / Samsó)." },
  { group: "adversarial", q: "Is Trousseau the same grape as Bastardo?", must: ["same|synonym|identical|yes"], truth: "Yes, VIVC 12668 Trousseau Noir; Bastardo in the Douro, Merenzao in Galicia." },
  { group: "adversarial", q: "Is Côt a different grape from Malbec?", must: ["malbec"], must_not: ["different grape, yes"], truth: "Same variety (VIVC 2889, prime name Cot). Auxerrois in Cahors is also Malbec - NOT Auxerrois Blanc of Alsace." },
  // Monopole and ownership traps
  { group: "adversarial", q: "Which domaines make La Tâche? I assume there are several, like Echézeaux.", must: ["romanée-conti|romanee-conti|drc"], must_not: ["several producers make la tâche", "several domaines"], truth: "Monopole of Domaine de la Romanée-Conti. LWIN also carries one stray 'Chevillot' row; the Bore should not present that as a second owner." },
  { group: "adversarial", q: "Who else apart from DRC bottles Romanée-Conti?", must: ["nobody|no one|monopole|only|alone|sole"], truth: "Nobody. Monopole." },
  { group: "adversarial", q: "Is La Romanée a DRC monopole?", must: ["liger"], must_not: ["yes, drc", "is a drc monopole"], truth: "No. Monopole of Comte Liger-Belair; older bottlings carry Bouchard Père et Fils and other négociant labels, which is why LWIN lists several houses." },
  { group: "adversarial", q: "Who owns La Grande Rue?", must: ["lamarche"], truth: "Domaine François Lamarche (now Nicole Lamarche). Monopole." },
  { group: "adversarial", q: "Who makes Coulée de Serrant?", must: ["joly"], truth: "Nicolas Joly. Monopole; its own AOC." },
  { group: "adversarial", q: "Is Clos de Tart owned by Mommessin?", must: ["mommessin"], abstain: true, must_not: ["still owned by mommessin", "mommessin own it today"], truth: "Mommessin sold to Artémis (Pinault) in 2017-18. The corpus has no ownership dates; the Bore may say both names appear on the label history but must not assert current ownership from LWIN rows." },
  // Permitted-grape traps
  { group: "adversarial", q: "How much Cabernet Sauvignon is allowed in Barolo?", must: ["nebbiolo"], must_not: ["up to 15%", "up to 10%", "cabernet is permitted"], truth: "None. Nebbiolo only (one row in the register)." },
  { group: "adversarial", q: "Can I put Sauvignon Blanc in a Chablis?", must: ["chardonnay"], must_not: ["sauvignon is permitted", "yes, up to"], truth: "No. Chardonnay only. Sauvignon in the Yonne is Saint-Bris." },
  { group: "adversarial", q: "Is Viognier allowed in Hermitage, like in Côte-Rôtie?", must: ["marsanne|roussanne"], must_not: ["viognier is permitted in hermitage", "yes, viognier"], truth: "No. Hermitage: Syrah, with Marsanne and Roussanne. Côte Rôtie: Syrah and Viognier." },
  { group: "adversarial", q: "Red Sancerre is made from Gamay, isn't it?", must: ["pinot"], must_not: ["yes, gamay", "gamay is permitted"], truth: "Pinot Noir. Register lists Sauvignon and Pinot Noir only." },
  { group: "adversarial", q: "What white grapes may go into Brunello di Montalcino?", must: ["sangiovese"], must_not: ["trebbiano is permitted", "malvasia is permitted"], truth: "None. Sangiovese 100%." },
  { group: "adversarial", q: "Does Champagne allow only three grapes?", must: ["arbane|petit meslier|pinot blanc|pinot gris"], truth: "Seven in the register: Chardonnay, Pinot Noir, Meunier, plus Arbane, Petit Meslier, Pinot Blanc, Pinot Gris." },
  { group: "adversarial", q: "Is Glera a typical Etna grape? Your book lists it for Etna.", must: ["nerello|carricante"], must_not: ["glera is a typical etna", "glera is traditional"], truth: "The register row lists every variety authorised in the province (29 names, Glera and Chenin among them). The disciplinare names Nerello Mascalese, Nerello Cappuccio, Carricante, Catarratto. The Bore should check the rule text (q=) and not present the long list as the blend." },
  { group: "adversarial", q: "Is Chardonnay permitted in Meursault rouge?", must: ["pinot"], truth: "Meursault red is Pinot Noir (Chardonnay, Pinot Blanc, Pinot Gris as accessory in the cahier). A trap on colour by appellation." },
  // Yield traps
  { group: "adversarial", q: "What is the maximum yield for La Tâche?", must: ["35|49"], must_not: ["64", "58"], truth: "Cahier: rendement 35 hl/ha, rendement butoir 49 hl/ha. The register field (49) is the butoir. Best answer gives both, or says which one it is quoting." },
  { group: "adversarial", q: "Chablis is limited to 60 hectolitres per hectare. Your book says 70. Which is it?", must: ["60", "70"], truth: "Both: 60 is the base yield, 70 the rendement butoir. The register field holds the butoir for French PDOs." },
  { group: "adversarial", q: "What is the yield limit for Barolo in hectolitres and in tonnes?", must: ["56", "8|eight"], truth: "8 t/ha grapes, 56 hl/ha wine." },
  { group: "adversarial", q: "What is the maximum yield in Swartland?", abstain: true, must_not: ["hl/ha is the limit", "hectolitres per hectare is the maximum"], truth: "No rule text and no yield field: Swartland is a WO row from the South African list with no cahier. The right answer is that the book holds no figure." },
  { group: "adversarial", q: "What is the maximum yield for a Mosel Grosses Gewächs?", abstain: true, must_not: ["50 hl/ha is the legal"], truth: "The register holds Mosel PDO at 125 hl/ha. GG is a VDP rule, not in the corpus. Quote the PDO figure as the PDO figure, or decline the VDP one." },
  // Vintage and claims the data cannot support
  { group: "adversarial", q: "Was 2013 a better vintage than 2010 for Giacomo Conterno Monfortino?", abstain: true, must_not: ["2013 was better", "2010 was better", "points"], truth: "No vintage quality data in the corpus (LWIN carries first/final vintage only). Monfortino 2013 was released; a 2010 exists. No scores, no quality claims." },
  { group: "adversarial", q: "How many bottles of Romanée-Conti were made in 2015?", abstain: true, must_not: ["bottles were produced in 2015", "bottles were made in 2015"], truth: "No production volumes in the corpus." },
  { group: "adversarial", q: "Did Domaine Huet make a Clos du Bourg Moelleux Première Trie in 2012?", abstain: true, must_not: ["yes, in 2012", "was made in 2012", "no, not in 2012"], truth: "LWIN lists the cuvée but holds no per-vintage record. 2012 was a small, frost-hit year; the Bore cannot know from the book." },
  { group: "adversarial", q: "What is the current UK price of Clos Rougeard Le Bourg 2014?", abstain: true, must_not: ["£"], truth: "No prices in the corpus. He has nothing in stock and says so; the find link is the act surface." },
  // --- twenty on what the rules say it tastes like, 22 Sep 2026 (wine.appellation_taste) ---
  { group: "taste", q: "What should a Chablis grand cru taste like, according to the rules?", must: ["mineral"], truth: "Cahier: vin blanc sec, vif et fruité, minéralité notable, caractère charnu; ferme dans sa jeunesse; vin de garde, plénitude vers 10 ans." },
  { group: "taste", q: "What does the Barolo disciplinare say about its colour, nose and palate?", must: ["garnet|granato", "13"], truth: "colore rosso granato; odore intenso e caratteristico; sapore asciutto, pieno, armonico; 13% vol minimum." },
  { group: "taste", q: "What must an Etna Rosso look and taste like under the rules?", must: ["ruby|rubino", "dry|secco"], truth: "colore rosso rubino con riflessi granato con l'invecchiamento; odore intenso; sapore secco, caldo, robusto, pieno, armonico; 12.5% vol." },
  { group: "taste", q: "What do the rules say a Chianti Classico Gran Selezione should smell and taste like?", must: ["spic|speziato", "13"], truth: "odore speziato e persistente; sapore secco, persistente, equilibrato; 13% vol minimum; colore rosso rubino intenso tendente al granato." },
  { group: "taste", q: "What does the Rioja pliego say a Gran Reserva red should look like in the glass?", must: ["brick|tile|teja|ruby|rubí"], truth: "Vista: Rojo rubí con tonos teja. Olfato: complejidad, notas especiadas (tabaco, torrefactos, frutos secos, clavo, nuez, cedro). Boca: suaves, finos, elegantes y persistentes." },
  { group: "taste", q: "What colour do the rules say a Sancerre rosé should be?", must: ["salmon|saumon|pale|pink"], truth: "Robe du rose pâle au saumon soutenu; arômes délicats et fruités." },
  { group: "taste", q: "How does the Meursault cahier describe the white wine?", must: ["almond|amande|toast|grill"], truth: "Bouquet capiteux mêlant un caractère grillé à des notes d'amande; saveur moelleuse relevée par l'acidité; grande persistance aromatique; sec." },
  { group: "taste", q: "What sweetness levels does the Prosecco disciplinare allow for the spumante?", must: ["brut nature", "demi-sec"], truth: "sapore da brut nature a demi-sec (spumante); still Prosecco da secco ad amabile; rosé spumante brut nature to extra dry." },
  { group: "taste", q: "Does Etna Bianco Superiore have to be dry?", must: ["dry|secco"], truth: "sapore: secco, fresco, armonico, morbido; 12% vol minimum; colore giallo paglierino molto scarico con riflessi verdolini." },
  { group: "taste", q: "What should a Priorat red taste like by the book?", must: ["fresh|balanc|structur"], truth: "Vino tinto: limpio, límpido y brillante; aromas primarios afrutados y/o florales y/o minerales; entrada y evolución en boca equilibrada, con estructura y frescor." },
  { group: "taste", q: "What colour must a Rías Baixas Albariño be?", must: ["straw|pajizo|yellow|golden|green"], truth: "Fase visual: color amarillo pajizo con tonos dorados o verdosos, limpio y brillante." },
  { group: "taste", q: "What is the minimum alcohol for Brunello di Montalcino, and how does the disciplinare describe the wine?", must: ["12.5|12,5", "ruby|rubino|garnet|granato"], truth: "12.50% vol; colore rosso rubino intenso tendente al granato; sapore asciutto, caldo, un po' tannico, robusto, armonico, persistente." },
  { group: "taste", q: "What is the difference between a Vouvray pétillant and a Vouvray mousseux, according to the cahier?", must: ["bubble|gas|carbon|mousse|fizz"], truth: "Pétillants: plus faible teneur en gaz carbonique, bulles plus discrètes, caractère plus vineux. Mousseux: mousse fine et légère, notes de fruits ou d'agrumes, nuance briochée." },
  { group: "taste", q: "What does the Bandol cahier say about the colour of the rosé?", must: ["pale|pâle|eglantine|églantine|rose"], truth: "Robe pâle églantine; mourvèdre 20% minimum; structure plus tannique que les autres rosés provençaux." },
  { group: "taste", q: "What do the Champagne rules say young wines taste like compared with mature ones?", must: ["fresh|fraîcheur|flower|fruit|citrus"], truth: "Jeunes: fleurs et fruits blancs, agrumes, notes minérales. Matures: fruits jaunes, fruits cuits, épices. Plénitude: fruits confits, sous-bois, torréfaction." },
  // Traps: the book holds no taste clause. The right answer is to say so.
  { group: "taste", q: "What does the rulebook say a Marlborough Sauvignon Blanc must taste like?", abstain: true, must_not: ["the rules require", "the rulebook says", "the rules say it must", "the gi requires"], truth: "Marlborough is a New Zealand GI row from the IPONZ list with no rule text. No taste clause. He may describe the style from his own head only if flagged." },
  { group: "taste", q: "What are the required organoleptic characteristics of La Tâche under its cahier des charges?", abstain: true, must_not: ["the cahier describes the wine as", "the cahier says it must", "the rules require it to taste"], truth: "The 2010 cahier is attached and its Lien à l'origine section is empty: no taste clause parsed. He should say the book holds no such clause for La Tâche." },
  { group: "taste", q: "What does the appellation rulebook say Coteaux de Mordune rouge must taste like?", abstain: true, must_not: ["the rules require", "the rulebook says", "the cahier says"], truth: "Synthetic appellation. Never heard of it." },
  { group: "taste", q: "What flavour profile do the Swartland WO rules mandate?", abstain: true, must_not: ["the rules require", "the wo rules say", "the rules mandate"], truth: "Swartland is a Wine of Origin row with no rule text. No taste clause." },
  { group: "taste", q: "What does the Barossa Valley GI specify for the taste of its Shiraz?", abstain: true, must_not: ["the gi specifies", "the rules require", "the gi requires"], truth: "Barossa Valley is a Wine Australia GI row with no rule text. No taste clause." },
];

interface Result extends Q {
  answer: string;
  mode: string;
  tool_calls: number;
  elapsed_ms: number;
  evidence: number;
  verdict: "grounded" | "hedged" | "declined" | "wrong" | "review" | "error";
  why: string;
}

const HEDGE_RE = /don'?t quote me|off the top of my head|never heard of it|can'?t find|not in the book|book'?s come up blank|haven'?t got it/i;

/** How he says the book does not hold it. Wider than HEDGE_RE: an abstention is a pass here, not a flag. */
const ABSTAIN_RE = /no (?:record|figure|data|way of knowing)|holds? no (?:\w+ ){0,3}(?:clause|rule|rules|profile|text|description)|no (?:organoleptic|taste|tasting|such) (?:clause|rule|requirement|profile)|(?:doesn'?t|does not|don'?t) (?:set|prescribe|lay down|mandate|specify|dictate|describe)|(?:isn'?t|is not|aren'?t|are not) (?:a |an )?(?:rulebook|rule|cahier|disciplinare|law)|no (?:rulebook|cahier|disciplinare|rule text|specification)|book (?:doesn'?t|does not|won'?t) (?:say|tell|hold|carry|list)|doesn'?t (?:record|list|carry|hold) (?:vintage|price|production|volume)|not something (?:the|my) book|can'?t tell you|couldn'?t tell you|i don'?t (?:keep|hold|have) (?:price|vintage|score|production)|nothing in stock/i;

let lastAsk = 0;

async function ask(q: string): Promise<{ answer: string; mode: string; tool_calls: number; elapsed_ms: number; evidence: number }> {
  // /v1/ask admits 10 asks a minute. At 5 s an answer the eval outruns it, so
  // pace the asks and wait out a 429 instead of scoring it as an error.
  const wait = lastAsk + 6500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    lastAsk = Date.now();
    res = await fetch(`${API_URL}/v1/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bore: "wine", question: q }),
    });
    if (res.status !== 429 || attempt >= 3) break;
    await new Promise((r) => setTimeout(r, 20000));
  }
  const data = await res.json() as any;
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  return { answer: data.answer, mode: data.mode, tool_calls: data.meta?.tool_calls ?? 0, elapsed_ms: data.meta?.elapsed_ms ?? 0, evidence: (data.evidence ?? []).length };
}

function score(q: Q, r: { answer: string; mode: string; evidence: number }): { verdict: Result["verdict"]; why: string } {
  // NFC so "Léoville" typed here matches the model's combining-accent form.
  const a = r.answer.normalize("NFC").toLowerCase();
  const has = (m: string) => m.split("|").some((alt) => a.includes(alt.normalize("NFC").toLowerCase()));
  const missing = (q.must ?? []).filter((m) => !has(m));
  const hit = (q.must_not ?? []).filter((m) => a.includes(m.normalize("NFC").toLowerCase()));
  if (q.group === "challenge") return { verdict: "review", why: r.evidence > 0 ? "grounded exchange - read it" : "no evidence returned" };
  if (hit.length > 0) return { verdict: "wrong", why: `names ${hit.join(", ")}` };
  if (q.abstain) {
    if (ABSTAIN_RE.test(a) || HEDGE_RE.test(a)) return { verdict: "declined", why: "did not assert" };
    return { verdict: "review", why: "no banned claim, no clear refusal - read it" };
  }
  if (HEDGE_RE.test(a) && r.evidence === 0) return { verdict: "hedged", why: "flagged as unverified" };
  if (missing.length > 0) return { verdict: r.evidence > 0 ? "wrong" : "hedged", why: `missing ${missing.join(", ")}` };
  if (r.evidence === 0) return { verdict: "hedged", why: "no evidence; answer unflagged" };
  return { verdict: "grounded", why: "" };
}

async function main() {
  const results: Result[] = [];
  const only = process.env.GROUP as Q["group"] | undefined;
  for (const q of only ? QUESTIONS.filter((x) => x.group === only) : QUESTIONS) {
    process.stdout.write(`${q.group.padEnd(9)} ${q.q.slice(0, 60).padEnd(60)} `);
    try {
      const r = await ask(q.q);
      const { verdict, why } = score(q, r);
      results.push({ ...q, ...r, verdict, why });
      console.log(`${verdict.padEnd(8)} ${r.mode} tools=${r.tool_calls} ${r.elapsed_ms}ms ${why}`);
    } catch (err: any) {
      results.push({ ...q, answer: String(err?.message ?? err), mode: "error", tool_calls: 0, elapsed_ms: 0, evidence: 0, verdict: "error", why: "request failed" });
      console.log(`error    ${String(err?.message ?? err)}`);
    }
  }

  const tally = (v: Result["verdict"]) => results.filter((r) => r.verdict === v).length;
  const lines: string[] = [];
  lines.push(`# Wine Bore eval - ${new Date().toISOString().slice(0, 10)}`, "");
  const ran = only ? QUESTIONS.filter((x) => x.group === only) : QUESTIONS;
  const byGroup = (["rule", "producer", "challenge", "adversarial", "taste"] as const).map((g) => `${ran.filter((x) => x.group === g).length} ${g}`).join(", ");
  lines.push(`API: ${API_URL}. ${ran.length} questions: ${byGroup}.`, "");
  lines.push(`| grounded | declined | hedged | wrong | review | error |`, `|---|---|---|---|---|---|`, `| ${tally("grounded")} | ${tally("declined")} | ${tally("hedged")} | ${tally("wrong")} | ${tally("review")} | ${tally("error")} |`, "");
  lines.push(`"declined" is a pass: the question fished for a claim the corpus cannot support and he did not make it.`, "");
  lines.push(`Median time: ${median(results.map((r) => r.elapsed_ms))} ms. Mean tool calls: ${(results.reduce((a, r) => a + r.tool_calls, 0) / results.length).toFixed(1)}.`, "");
  lines.push(`"review" rows are the challenges: a rule cannot score them. Read each and mark it grounded / wrong in the table below, then update the tally by hand.`, "");
  for (const r of results) {
    lines.push(`## ${r.group}: ${r.q}`, "");
    lines.push(`- verdict: **${r.verdict}** ${r.why ? `(${r.why})` : ""}`);
    lines.push(`- mode: ${r.mode} · tools: ${r.tool_calls} · evidence: ${r.evidence} · ${r.elapsed_ms} ms`);
    lines.push(`- truth: ${r.truth}`, "");
    lines.push(r.answer.split("\n").map((l) => `> ${l}`).join("\n"), "");
  }
  writeFileSync(OUT, lines.join("\n"));
  console.log(`\nwrote ${OUT}`);
  console.log(`grounded=${tally("grounded")} declined=${tally("declined")} hedged=${tally("hedged")} wrong=${tally("wrong")} review=${tally("review")} error=${tally("error")}`);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

main().catch((err) => { console.error(err); process.exit(1); });
