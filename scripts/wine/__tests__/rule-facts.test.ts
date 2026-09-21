import { describe, expect, it } from "vitest";
import { agreesWithRegister, nameForms, namedInText, parseFrenchYields, trustworthy } from "../rule-facts";
import { norm } from "../text";

describe("parseFrenchYields", () => {
  it("reads one prose pair (La Tâche: 35 base, 49 butoir)", () => {
    const t = `VIII. - Rendements. - Entrée en production
1°- Rendement
Le rendement visé à l’article D. 644-25 du code rural est fixé à 35 hectolitres par hectare.
2°- Rendement butoir
Le rendement butoir visé à l’article D. 644-25 du code rural est fixé à 49 hectolitres par hectare.`;
    expect(parseFrenchYields(t)).toEqual([{ label: null, base_hl: 35, butoir_hl: 49 }]);
  });

  it("does not take the butoir sentence as the base", () => {
    const t = "Le rendement butoir visé à l'article D. 645-7 est fixé à 49 hectolitres par hectare.";
    expect(parseFrenchYields(t)).toEqual([]);
  });

  it("reads the two-column table with colour and premier cru labels (Meursault)", () => {
    const t = `1°- Rendement et rendement butoir
                                               RENDEMENT                     RENDEMENT BUTOIR
       COULEUR DES VINS
                                           (hectolitres par hectare)         (hectolitres par hectare)

                                             AOC « Meursault »

    Vins blancs                                       57                                  64
Procédure nationale d’opposition suite à l’avis du Comité national des appellations d’origine relatives

    Vins rouges                                        50                                   58

                       Vins susceptibles de bénéficier de la mention « premier cru »

    Vins blancs                                       55                                  62
    Vins rouges                                        48                                   56

2°- Entrée en production des jeunes vignes`;
    expect(parseFrenchYields(t)).toEqual([
      { label: "Vins blancs", base_hl: 57, butoir_hl: 64 },
      { label: "Vins rouges", base_hl: 50, butoir_hl: 58 },
      { label: "premier cru - Vins blancs", base_hl: 55, butoir_hl: 62 },
      { label: "premier cru - Vins rouges", base_hl: 48, butoir_hl: 56 },
    ]);
  });

  it("pairs prose by colour, one butoir for both (Hermitage)", () => {
    const t = `a) - Le rendement visé à l’article D. 645-7 du code rural et de la pêche maritime est fixé à 40
hectolitres par hectare pour les vins rouges.

b) - Le rendement visé à l’article D. 645-7 du code rural et de la pêche maritime est fixé à 45
hectolitres par hectare pour les vins blancs.

2°- Rendement butoir

a) - Le rendement butoir visé à l’article D. 645-7 du code rural et de la pêche maritime est fixé à 46
hectolitres par hectare pour les vins rouges et blancs.`;
    expect(parseFrenchYields(t)).toEqual([
      { label: "vins rouges", base_hl: 40, butoir_hl: 46 },
      { label: "vins blancs", base_hl: 45, butoir_hl: 46 },
    ]);
  });

  it("pairs two one-column tables by label (Sancerre)", () => {
    const t = `Le rendement visé à l’article D. 645-7 du code rural et de la pêche maritime est fixé à :

                                                                            RENDEMENT
                 COULEUR DES VINS
                                                                        (hectolitres par hectare)

                 Vins blancs                                                     65
                 Vins rouges et rosés                                            59

2°- Rendement butoir

Le rendement butoir visé à l’article D. 645-7 du code rural et de la pêche maritime est fixé à :

                 Vins blancs                                                     75
                 Vins rouges et rosés                                            69
`;
    expect(parseFrenchYields(t)).toEqual([
      { label: "vins blancs", base_hl: 65, butoir_hl: 75 },
      { label: "vins rouges et rosés", base_hl: 59, butoir_hl: 69 },
    ]);
  });

  it("reads a label-less two-column table (Chablis)", () => {
    const t = `                   RENDEMENT                                         RENDEMENT BUTOIR
               (hectolitres par hectare)                             (hectolitres par hectare)
                                              AOC « Chablis »

                          60                                                     70
`;
    expect(parseFrenchYields(t)).toEqual([{ label: null, base_hl: 60, butoir_hl: 70 }]);
  });

  it("refuses an opposition draft that prints the struck figure beside the new one (Musigny)", () => {
    const t = "Le rendement visé à l’article D. 644-25 du code rural est fixé à 35 42 hectolitres par hectare pour les vins rouges. Le rendement butoir visé à l’article D. 644-25 est fixé à 49 hectolitres par hectare pour les vins rouges.";
    expect(parseFrenchYields(t)).toEqual([]);
  });

  it("ignores the sugar table, which has one numeric column and a percentage", () => {
    const t = "  RENDEMENT   RENDEMENT BUTOIR\n  Vins blancs          178            11 %\n";
    expect(parseFrenchYields(t)).toEqual([]);
  });
});

describe("guards", () => {
  it("refuses a label with a figure in it (a density grid) or a swallowed sentence", () => {
    expect(trustworthy([{ label: "De 3500 à 3999 7100", base_hl: 40, butoir_hl: 48 }])).toBe(false);
    expect(trustworthy([{ label: "vins rouges et à soixante hectolitres par hectare pour les vins rosés du pays", base_hl: 55, butoir_hl: 63 }])).toBe(false);
    expect(trustworthy([{ label: "premier cru - Vins blancs", base_hl: 55, butoir_hl: 62 }, { label: null, base_hl: 35, butoir_hl: 49 }])).toBe(true);
  });
  it("accepts a cahier newer than the register, refuses the wrong clause", () => {
    expect(agreesWithRegister([{ label: null, base_hl: 60, butoir_hl: 75 }], 70)).toBe(true);  // Chablis
    expect(agreesWithRegister([{ label: null, base_hl: 20, butoir_hl: 20 }], 72)).toBe(false); // Cotes du Jura, vin de paille
    expect(agreesWithRegister([{ label: null, base_hl: 35, butoir_hl: 49 }], null)).toBe(true);
  });
});

describe("namedInText", () => {
  const etna = norm("Etna bianco: Carricante minimo 60%; Catarratto bianco comune o lucido da 0 a 40%. Etna rosso: Nerello Mascalese minimo 80%; Nerello Mantellato (Nerello Cappuccio) da 0 a 20%. Possono concorrere altri vitigni a bacca bianca idonei alla coltivazione nella Regione Sicilia.");
  it("finds the varieties the disciplinare names", () => {
    expect(namedInText(etna, ["Nerello Mascalese"])).toBe(true);
    expect(namedInText(etna, ["Nerello Cappuccio"])).toBe(true);
    expect(namedInText(etna, ["Carricante"])).toBe(true);
    expect(namedInText(etna, ["Catarratto Bianco Lucido"])).toBe(true);
  });
  it("does not find the province-wide list", () => {
    expect(namedInText(etna, ["Glera"])).toBe(false);
    expect(namedInText(etna, ["Chenin", "Chenin blanc"])).toBe(false);
  });
  it("uses a synonym the text prefers", () => {
    expect(namedInText(norm("vitigno Prugnolo gentile minimo 70%"), ["Sangiovese", "Prugnolo Gentile"])).toBe(true);
  });
  it("never matches on a colour word or a fragment", () => {
    expect(nameForms(["Nero"])).toEqual([]);
    expect(namedInText(norm("uve a bacca bianca"), ["Bianca"])).toBe(false);
    expect(namedInText(norm("il merlotto"), ["Merlot"])).toBe(false);
  });
});
