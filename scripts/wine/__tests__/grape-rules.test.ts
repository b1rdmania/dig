import { describe, expect, it } from "vitest";
import { GrapeResolver, grapeColour, mergeByVivc, stripColourWords, titleCase, vivcColour, wikidataColour } from "../grape-rules";

describe("colour", () => {
  it("treats a lone 'black berry skin' as no evidence (Xarel·lo)", () => {
    expect(wikidataColour("black berry skin")).toBe("unknown");
    expect(wikidataColour("black berry skin|white")).toBe("white");
    expect(wikidataColour("")).toBe("unknown");
  });
  it("lets VIVC win over Wikidata", () => {
    expect(grapeColour([vivcColour("BLANC")], "black berry skin|red")).toBe("white");
    expect(grapeColour([vivcColour("GRIS")], "white")).toBe("rose");
    expect(grapeColour([], "blue-black|black berry skin")).toBe("red");
  });
  it("files a red-skinned berry (VIVC ROUGE) with the pink grapes, not the red-wine grapes", () => {
    expect(vivcColour("ROUGE")).toBe("rose"); // Riesling Rot, Silvaner Rot
    expect(vivcColour("NOIR")).toBe("red");
  });
  it("falls back to Wikidata when VIVC numbers disagree", () => {
    expect(grapeColour([vivcColour("BLANC"), vivcColour("NOIR")], "white")).toBe("white");
  });
});

describe("mergeByVivc", () => {
  const item = (qid: string, name: string, vivc: string[], weight: number, extra: Partial<{ names: string[]; isPrimeName: boolean; vivcKnowsName: boolean }> = {}) => ({
    qid, vivc, weight, primaryNorm: name, nameNorms: [name, ...(extra.names ?? [])],
    isPrimeName: extra.isPrimeName ?? false, vivcKnowsName: extra.vivcKnowsName ?? true,
  });

  it("merges items that share a VIVC number when one names the other", () => {
    const keep = mergeByVivc([
      item("Q1", "grenache", ["4461"], 30, { names: ["cannonau", "garnacha tinta"] }),
      item("Q2", "garnacha tinta", ["4461"], 9, { isPrimeName: true }),
      item("Q3", "grenache blanc", ["4457"], 5),
      item("Q4", "no number", [], 1),
      item("Q5", "two numbers", ["1", "2"], 1),
    ]);
    expect(keep.get("Q1")).toBe("Q2"); // the VIVC prime name keeps the row
    expect(keep.get("Q3")).toBe("Q3");
    expect(keep.get("Q4")).toBe("Q4");
    expect(keep.get("Q5")).toBe("Q5");
  });
  it("keeps Trousseau over the heavier Bastardo", () => {
    const keep = mergeByVivc([
      item("Q63319", "bastardo", ["12668"], 40, { names: ["trousseau"] }),
      item("Q6160560", "trousseau", ["12668"], 8, { isPrimeName: true }),
    ]);
    expect(keep.get("Q63319")).toBe("Q6160560");
  });
  it("does not merge on VIVC's word alone (Nerello Cappuccio filed under Magliocco Dolce)", () => {
    const keep = mergeByVivc([
      item("Q1", "magliocco dolce", ["8478"], 9, { isPrimeName: true }),
      item("Q2", "nerello cappuccio", ["8478"], 9, { names: ["nerello mantellato"] }),
    ]);
    expect(keep.get("Q2")).toBe("Q2");
  });
  it("does not merge on a number VIVC does not know the item by (Spergola under Vernaccia di Oristano)", () => {
    const keep = mergeByVivc([
      item("Q1", "vernaccia di oristano", ["12979"], 9, { names: ["spergola"], isPrimeName: true }),
      item("Q2", "spergola", ["12979"], 3, { vivcKnowsName: false }),
    ]);
    expect(keep.get("Q2")).toBe("Q2");
  });
  it("chains: A names B, B names C", () => {
    const keep = mergeByVivc([
      item("Q10", "zinfandel", ["9703"], 20, { names: ["primitivo"] }),
      item("Q11", "primitivo", ["9703"], 10, { names: ["crljenak kastelanski"], isPrimeName: true }),
      item("Q12", "crljenak kastelanski", ["9703"], 2),
    ]);
    expect(new Set(keep.values())).toEqual(new Set(["Q11"]));
  });
  it("breaks a tie on the older QID", () => {
    const keep = mergeByVivc([item("Q900", "iordan", ["7"], 3), item("Q20", "iordan", ["7"], 3)]);
    expect(keep.get("Q900")).toBe("Q20");
  });
});

describe("GrapeResolver", () => {
  const facts = [
    { id: 1, primaryNorm: "poulsard", colour: "red" as const, weight: 10 },
    { id: 2, primaryNorm: "poulsard blanc", colour: "white" as const, weight: 2 },
    { id: 3, primaryNorm: "tempranillo", colour: "red" as const, weight: 20 },
    { id: 4, primaryNorm: "riesling", colour: "white" as const, weight: 20 },
    { id: 5, primaryNorm: "welschriesling", colour: "white" as const, weight: 8 },
    { id: 6, primaryNorm: "malbec", colour: "red" as const, weight: 12 },
    { id: 7, primaryNorm: "auxerrois", colour: "white" as const, weight: 6 },
  ];
  const names = [
    { grapeId: 1, nameNorm: "poulsard", tier: "primary" as const },
    { grapeId: 1, nameNorm: "ploussard", tier: "vivc" as const },
    { grapeId: 2, nameNorm: "poulsard blanc", tier: "primary" as const },
    { grapeId: 2, nameNorm: "ploussard", tier: "vivc" as const },
    { grapeId: 3, nameNorm: "tempranillo", tier: "primary" as const },
    { grapeId: 3, nameNorm: "tinta de toro", tier: "vivc" as const },
    { grapeId: 3, nameNorm: "aragonez", tier: "vivc" as const },
    { grapeId: 4, nameNorm: "riesling", tier: "primary" as const },
    { grapeId: 5, nameNorm: "welschriesling", tier: "primary" as const },
    { grapeId: 5, nameNorm: "olasz rizling", tier: "vivc" as const },
    { grapeId: 5, nameNorm: "riesling", tier: "vivc" as const },
    { grapeId: 6, nameNorm: "malbec", tier: "primary" as const },
    { grapeId: 6, nameNorm: "auxerrois", tier: "vivc" as const },
    { grapeId: 7, nameNorm: "auxerrois", tier: "primary" as const },
  ];
  const r = new GrapeResolver(facts, names);

  it("resolves a regional synonym that only VIVC lists", () => {
    expect(r.resolve("tinta de toro")?.id).toBe(3);
    expect(r.resolve("aragonez")?.id).toBe(3);
    expect(r.resolve("olasz rizling", "white")?.id).toBe(5);
  });
  it("uses the register colour to split a synonym two varieties share", () => {
    expect(r.resolve("ploussard", "red")?.id).toBe(1);
    expect(r.resolve("ploussard", "white")?.id).toBe(2);
  });
  it("leaves a shared synonym unresolved when nothing splits it", () => {
    expect(r.resolve("ploussard")).toBeNull();
  });
  it("never lets a VIVC synonym outrank a primary name", () => {
    expect(r.resolve("riesling", "white")?.id).toBe(4);
    expect(r.resolve("auxerrois", "white")?.id).toBe(7);
    expect(r.resolve("auxerrois")?.id).toBe(7);
  });
  it("refuses a VIVC synonym whose grape has the wrong colour", () => {
    expect(r.resolve("tinta de toro", "white")).toBeNull();
  });
  it("strips register colour adjectives", () => {
    expect(stripColourWords("weisser riesling")).toBe("riesling");
    expect(r.resolve("weisser riesling", "white")).toEqual({ id: 4, stage: "colour_stripped" });
  });
  it("treats a synonym shared by two rows of one VIVC number as unshared", () => {
    const two = new GrapeResolver(
      [{ id: 1, primaryNorm: "magliocco dolce", colour: "red", weight: 3, vivc: "8478" }, { id: 2, primaryNorm: "nerello cappuccio", colour: "red", weight: 9, vivc: "8478" }],
      [{ grapeId: 1, nameNorm: "nerello mantellato", tier: "vivc" }, { grapeId: 2, nameNorm: "nerello mantellato", tier: "vivc" }],
    );
    expect(two.resolve("nerello mantellato")?.id).toBe(2);
  });
  it("honours the manual map first", () => {
    const m = new GrapeResolver(facts, names, new Map([["riesling", 5]]));
    expect(m.resolve("riesling")).toEqual({ id: 5, stage: "manual" });
  });
});

describe("titleCase", () => {
  it("makes VIVC capitals readable", () => {
    expect(titleCase("CABERNET FRANC")).toBe("Cabernet Franc");
    expect(titleCase("GOUAIS BLANC")).toBe("Gouais Blanc");
    expect(titleCase("PINOT NOIR PRECOCE")).toBe("Pinot Noir Precoce");
    expect(titleCase("SAINT-LAURENT")).toBe("Saint-Laurent");
  });
});
