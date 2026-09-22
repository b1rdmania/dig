import { describe, it, expect } from "vitest";
import { unlinkAll, looksLikeUncheckedBottle, shapeGrapes, shapeYields, shapeTaste } from "../routes/v1/ask/wine-bore.js";

/**
 * Wine Bore grounds by evidence, not links: no URL leaves the shop, and a
 * bottle or grower named with no lookup this turn goes back to the cellar
 * book once. Counter chat passes straight through.
 */
describe("unlinkAll", () => {
  it("strips markdown links but keeps the text", () => {
    expect(unlinkAll("Try [Huet](https://app.dig.baby/producer/1) or [this](http://x.y/z).")).toBe("Try Huet or this.");
  });
  it("removes bare URLs", () => {
    expect(unlinkAll("See https://www.wine-searcher.com/find/huet for it.")).toBe("See  for it.");
  });
  it("leaves plain prose alone", () => {
    expect(unlinkAll("Chardonnay. That's the whole answer.")).toBe("Chardonnay. That's the whole answer.");
  });
});

describe("looksLikeUncheckedBottle", () => {
  it("flags a vintage named with no lookup", () => {
    expect(looksLikeUncheckedBottle("The 2010 is the one to find.", 0)).toBe(true);
  });
  it("flags a grower honorific with no lookup", () => {
    expect(looksLikeUncheckedBottle("Domaine Tempier does it properly.", 0)).toBe(true);
  });
  it("passes the same text after a lookup", () => {
    expect(looksLikeUncheckedBottle("Domaine Tempier does it properly.", 2)).toBe(false);
  });
  it("passes counter chat", () => {
    expect(looksLikeUncheckedBottle("Fair. Say what you mean by dry and I'll re-aim.", 0)).toBe(false);
  });
});

describe("get_appellation output", () => {
  it("La Tâche: base 35 and ceiling 49 under plain names, and the register figure is called a ceiling", () => {
    const out = shapeYields({ country: "FR", max_yield_hl: 49, max_yield_kg: null, base_yield_hl: 35, butoir_yield_hl: 49, yield_rules: [{ label: null, base_hl: 35, butoir_hl: 49 }] });
    expect(out.yields_from_the_rule_text_hl_per_ha).toEqual([{ applies_to: "all wines", base_yield: 35, ceiling_in_exceptional_years_rendement_butoir: 49 }]);
    expect(out.eu_register_ceiling_hl_per_ha).toBe(49);
    expect(out).not.toHaveProperty("max_yield_hl_per_ha");
  });
  it("a French AOC with no parsed cahier never offers the register figure as the yield", () => {
    const out = shapeYields({ country: "FR", max_yield_hl: 35, max_yield_kg: null, base_yield_hl: null, butoir_yield_hl: null, yield_rules: null });
    expect(out).not.toHaveProperty("max_yield_hl_per_ha");
    expect(String(out.yield_note)).toMatch(/not the base yield/);
  });
  it("Barolo keeps its register maximum", () => {
    const out = shapeYields({ country: "IT", max_yield_hl: 56, max_yield_kg: 8000, base_yield_hl: null, butoir_yield_hl: null, yield_rules: null });
    expect(out).toEqual({ max_yield_hl_per_ha: 56, max_yield_kg_grapes_per_ha: 8000 });
  });
  it("Etna leads with the varieties the disciplinare names and marks the rest", () => {
    const g = (name: string, named: boolean | null) => ({ name, colour_code: "N", kind: "oiv", named_in_rules: named });
    const out = shapeGrapes([g("Nerello Mascalese", true), g("Carricante", true), g("Glera", false)]);
    expect(out.grapes_named_in_the_rules).toEqual(["Nerello Mascalese (N)", "Carricante (N)"]);
    expect(out.other_varieties_authorised_in_the_area_but_not_named_in_the_rules).toEqual(["Glera (N)"]);
  });
  it("says so when no rule text is attached", () => {
    const out = shapeGrapes([{ name: "Riesling", colour_code: "B", kind: "oiv", named_in_rules: null }]);
    expect(out.permitted_grapes).toEqual(["Riesling (B)"]);
    expect(out).toHaveProperty("permitted_grapes_note");
  });
});

describe("what the rules say it tastes like", () => {
  const t = (style: string | null, colour: "red" | "white" | "rose" | "sparkling" | "sweet" | "fortified" | null, clause_text: string, extra: Partial<{ min_alcohol: number | null; sweetness: string | null }> = {}) => ({
    id: 1, style, colour, language: "it", clause_text, min_alcohol: null, sweetness: null, ...extra,
    document: { id: 10727, doc_type: "disciplinare", title: "Etna", source: "masaf", source_ref: "etna" },
  });
  it("is absent when the book holds no clause", () => {
    expect(shapeTaste([])).toEqual({});
  });
  it("gives each style verbatim, with the figures and the citation", () => {
    const out = shapeTaste([t("Etna rosso", "red", "colore: rosso rubino;\nodore: intenso, caratteristico;\nsapore: secco, caldo, robusto, pieno, armonico;", { min_alcohol: 12.5, sweetness: "dry" })]) as any;
    const block = out.what_the_rules_say_it_tastes_like;
    expect(block.styles).toHaveLength(1);
    expect(block.styles[0]).toMatchObject({ applies_to: "Etna rosso", colour_or_style: "red", language: "Italian", min_alcohol_pct: 12.5, sweetness: "dry" });
    expect(block.styles[0].rule_text).toMatch(/^colore: rosso rubino;/);
    expect(block.styles[0].cited_from).toBe('disciplinare "Etna" (document 10727)');
    expect(block).not.toHaveProperty("more_styles_in_the_book");
  });
  it("caps the clause and the number of styles so the card fits the ask loop", () => {
    const long = "Les vins blancs " + "présentent des arômes de fleurs blanches et une bouche tendue. ".repeat(20);
    const many = Array.from({ length: 11 }, (_, i) => t(`style ${i}`, null, long));
    const out = shapeTaste(many) as any;
    const block = out.what_the_rules_say_it_tastes_like;
    expect(block.styles).toHaveLength(8);
    expect(block.more_styles_in_the_book).toBe(3);
    expect(block.styles[0].rule_text.length).toBeLessThan(540);
    expect(block.styles[0].rule_text).toMatch(/\[…\]$/);
    expect(block.styles[0].applies_to).toBe("style 0");
  });
  it("names the whole appellation when the text does not split by colour", () => {
    const out = shapeTaste([t(null, "white", "Le « Chablis grand cru » est un vin blanc sec, vif et fruité.")]) as any;
    expect(out.what_the_rules_say_it_tastes_like.styles[0].applies_to).toBe("all wines of the appellation");
  });
});
