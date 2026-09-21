import { describe, expect, it } from "vitest";
import { plausibleYield, registerStages, stripTypeSuffix } from "../appellation-rules";

const wine = (o: Partial<Parameters<typeof registerStages>[0]>) => ({ country: "FR", region: null, sub_region: null, site: null, classification: null, ...o });

describe("registerStages", () => {
  it("tries the grand cru PDO before the village when LWIN classes the wine Grand Cru", () => {
    const stages = registerStages(wine({ region: "Burgundy", sub_region: "Chablis", site: "Les Clos", classification: "Grand Cru" }));
    expect(stages[0]).toEqual(["sub_region", "chablis grand cru"]);
    expect(stages[1]).toEqual(["sub_region", "chablis"]);
  });
  it("leaves a premier cru on the village", () => {
    const stages = registerStages(wine({ region: "Burgundy", sub_region: "Chablis", site: "Fourchaume", classification: "Premier Cru" }));
    expect(stages[0]).toEqual(["sub_region", "chablis"]);
  });
  it("ends on the region", () => {
    const stages = registerStages(wine({ country: "IT", region: "Sicily", sub_region: "Etna Rosso" }));
    expect(stages).toEqual([["sub_region", "etna rosso"], ["region", "sicily"]]);
  });
});

describe("stripTypeSuffix", () => {
  it("strips wine-type words and DAC tiers from the end only", () => {
    expect(stripTypeSuffix("etna rosso")).toBe("etna");
    expect(stripTypeSuffix("kremstal reserve")).toBe("kremstal");
    expect(stripTypeSuffix("rosso di montalcino")).toBe("rosso di montalcino");
  });
});

describe("plausibleYield", () => {
  it("drops the dataset's keying slips", () => {
    expect(plausibleYield(6635, "hl")).toBe(false);  // Colli Romagna centrale
    expect(plausibleYield(8.1, "hl")).toBe(false);   // Verduno Pelaverga
    expect(plausibleYield(80000, "kg")).toBe(false); // Maremma toscana
  });
  it("keeps the real extremes", () => {
    expect(plausibleYield(25, "hl")).toBe(true);     // Quarts de Chaume
    expect(plausibleYield(222, "hl")).toBe(true);    // Valle de Guimar
    expect(plausibleYield(15500, "kg")).toBe(true);  // Champagne
  });
});
