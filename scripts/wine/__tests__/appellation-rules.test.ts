import { describe, expect, it } from "vitest";
import { registerStages, stripTypeSuffix } from "../appellation-rules";

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
