import { describe, expect, it } from "vitest";
import {
  classifyPair,
  coreTokens,
  corroborate,
  detectRule,
  generateCandidates,
  norm,
  stripNoise,
  type ProducerRow,
  type WineEvidence,
} from "../producer-merge-rules";

let nextId = 1;
function producer(p: Partial<ProducerRow> & { name: string; country: string }): ProducerRow {
  const id = p.id ?? nextId++;
  return {
    id,
    name: p.name,
    title: p.title ?? null,
    name_norm: p.name_norm ?? norm(p.name),
    country: p.country,
    region: p.region ?? null,
    wine_count: p.wine_count ?? 0,
    source_ref: p.source_ref ?? `${p.title ?? ""}|${p.name}|${p.country}`,
  };
}

function ev(region: string | null, subRegions: string[] = []): WineEvidence {
  return { region, subRegions };
}

describe("stripNoise / coreTokens", () => {
  it("strips legal and title tokens", () => {
    expect(stripNoise(norm("Domaine Coudert"))).toBe("coudert");
    expect(stripNoise(norm("Chateau Coudert"))).toBe("coudert");
    expect(stripNoise(norm("Weingut Stein"))).toBe("stein");
    expect(stripNoise(norm("Gerard Schueller et Fils"))).toBe("gerard schueller");
    expect(stripNoise(norm("Azienda Agricola Mascarello"))).toBe("mascarello");
  });

  it("keeps family-continuation words that name a distinct entity", () => {
    // "Frere" (brother) and "Soeur" (sister) are not legal/title words - they
    // are part of what makes Gros Frere et Soeur a different house from Gros.
    expect(stripNoise(norm("Gros Frere et Soeur"))).toBe("gros frere soeur");
  });

  it("core tokens exclude connectors too", () => {
    expect(coreTokens(norm("Gerard Schueller et Fils"))).toEqual(new Set(["gerard", "schueller"]));
  });
});

describe("detectRule", () => {
  it("same_norm: identical name_norm, title/punctuation differs", () => {
    const a = producer({ name: "Marie Courtin", country: "FR" });
    const b = producer({ name: "Marie-Courtin", country: "FR" });
    expect(detectRule(a, b)).toBe("same_norm");
  });

  it("title_stripped: legal word differs, core name matches", () => {
    const a = producer({ name: "Coudert", country: "FR" });
    const b = producer({ name: "Coudert", title: "Domaine", country: "FR" });
    // title lives in a separate column in the real data (name_norm is
    // already identical) - this covers the case where the legal word is
    // embedded in the NAME field itself instead.
    const c = producer({ name: "Gerard Schueller", country: "FR" });
    const d = producer({ name: "Gerard Schueller et Fils", country: "FR" });
    expect(detectRule(a, b)).toBe("same_norm");
    expect(detectRule(c, d)).toBe("title_stripped");
  });

  it("given_name_diff: shares a surname, one side carries an extra given name", () => {
    const a = producer({ name: "Savart", country: "FR" });
    const b = producer({ name: "Frederic Savart", country: "FR" });
    expect(detectRule(a, b)).toBe("given_name_diff");

    const c = producer({ name: "Jean-Francois Ganevat", country: "FR" });
    const d = producer({ name: "Anne et Jean-Francois Ganevat", country: "FR" });
    expect(detectRule(c, d)).toBe("given_name_diff");
  });

  it("no shared core token: not a candidate at all", () => {
    const a = producer({ name: "Chateau Margaux", country: "FR" });
    const b = producer({ name: "Domaine Leflaive", country: "FR" });
    expect(detectRule(a, b)).toBeNull();
  });
});

describe("corroborate", () => {
  it("strong when region matches and sub_regions overlap", () => {
    expect(corroborate(ev("Beaujolais", ["Fleurie", "Brouilly"]), ev("Beaujolais", ["Fleurie", "Moulin-a-Vent"])))
      .toBe("strong");
  });

  it("strong when region matches and one side has no sub_region data", () => {
    expect(corroborate(ev("Champagne", []), ev("Champagne", ["Verzenay"]))).toBe("strong");
  });

  it("weak when region matches but sub_regions are disjoint", () => {
    expect(corroborate(ev("Jura", ["Cotes du Jura"]), ev("Jura", ["Arbois Pupillin"]))).toBe("weak");
  });

  it("none when region differs or is missing", () => {
    expect(corroborate(ev("Beaujolais"), ev("Bordeaux"))).toBe("none");
    expect(corroborate(ev(null), ev("Bordeaux"))).toBe("none");
  });
});

describe("classifyPair - never-auto known-different houses", () => {
  it("Domaine Overnoy vs Maison Pierre Overnoy: same region, disjoint sub_regions -> reject", () => {
    const overnoy = producer({ name: "Overnoy", title: "Domaine", country: "FR", region: "Jura", wine_count: 12 });
    const pierre = producer({ name: "Pierre Overnoy", title: "Maison", country: "FR", region: "Jura", wine_count: 10 });
    const result = classifyPair(overnoy, pierre, ev("Jura", ["Cotes du Jura", "Cremant du Jura"]), ev("Jura", ["Arbois", "Arbois Pupillin"]));
    expect(result?.rule).toBe("given_name_diff");
    expect(result?.class).toBe("reject");
  });

  it("Anne Gros vs Gros Frere et Soeur: last token differs (gros vs soeur) -> not even a candidate", () => {
    // "Frere et Soeur" ends the name on "soeur", not "gros" - the
    // last-core-token rule means this pair is never generated at all, which
    // satisfies "known-different pairs land in reject or are never
    // generated" more strongly than a reject row would.
    const anne = producer({ name: "Anne Gros", country: "FR", region: "Burgundy", wine_count: 20 });
    const freresoeur = producer({ name: "Gros Frere et Soeur", country: "FR", region: "Burgundy", wine_count: 15 });
    const result = classifyPair(anne, freresoeur, ev("Burgundy", ["Vosne-Romanee"]), ev("Burgundy", ["Vosne-Romanee"]));
    expect(result).toBeNull();
  });

  it("Michel Gros vs A-F Gros: different individuals, same family -> never auto even with overlap", () => {
    const michel = producer({ name: "Michel Gros", country: "FR", region: "Burgundy", wine_count: 30 });
    const af = producer({ name: "A-F Gros", country: "FR", region: "Burgundy", wine_count: 10 });
    const result = classifyPair(michel, af, ev("Burgundy", ["Vosne-Romanee", "Chambolle-Musigny"]), ev("Burgundy", ["Vosne-Romanee"]));
    expect(result?.class).not.toBe("auto");
  });

  it("Giacomo Conterno vs Aldo Conterno: different individuals -> never auto", () => {
    const giacomo = producer({ name: "Giacomo Conterno", country: "IT", region: "Piedmont", wine_count: 40 });
    const aldo = producer({ name: "Aldo Conterno", country: "IT", region: "Piedmont", wine_count: 35 });
    const result = classifyPair(giacomo, aldo, ev("Piedmont", ["Barolo"]), ev("Piedmont", ["Barolo"]));
    expect(result?.rule).toBe("given_name_diff");
    expect(result?.class).not.toBe("auto");
  });

  it("Bartolo Mascarello vs Giuseppe Mascarello: different individuals -> never auto", () => {
    const bartolo = producer({ name: "Bartolo Mascarello", country: "IT", region: "Piedmont", wine_count: 25 });
    const giuseppe = producer({ name: "Giuseppe Mascarello", country: "IT", region: "Piedmont", wine_count: 30 });
    const result = classifyPair(bartolo, giuseppe, ev("Piedmont", ["Barolo"]), ev("Piedmont", ["Barolo"]));
    expect(result?.class).not.toBe("auto");
  });

  it("JJ Prum vs SA Prum: different branches -> never auto", () => {
    const jj = producer({ name: "JJ Prum", country: "DE", region: "Mosel", wine_count: 50 });
    const sa = producer({ name: "SA Prum", country: "DE", region: "Mosel", wine_count: 30 });
    const result = classifyPair(jj, sa, ev("Mosel", ["Wehlen"]), ev("Mosel", ["Wehlen"]));
    expect(result?.class).not.toBe("auto");
  });

  it("different countries are never candidates, whatever the name", () => {
    const a = producer({ name: "Overnoy", country: "FR" });
    const b = producer({ name: "Overnoy", country: "CH" });
    expect(classifyPair(a, b, ev(null), ev(null))).toBeNull();
  });
});

describe("classifyPair - safe auto merges", () => {
  it("Marie Courtin / Marie-Courtin: identical norm, same region -> auto, higher wine_count kept", () => {
    const a = producer({ name: "Marie Courtin", country: "FR", region: "Champagne", wine_count: 11 });
    const b = producer({ name: "Marie-Courtin", country: "FR", region: "Champagne", wine_count: 1 });
    const result = classifyPair(a, b, ev("Champagne", []), ev("Champagne", []));
    expect(result?.class).toBe("auto");
    expect(result?.keep_id).toBe(a.id);
    expect(result?.merge_id).toBe(b.id);
  });

  it("Coudert / Domaine Coudert: title differs, sub_regions overlap -> auto", () => {
    const a = producer({ name: "Coudert", country: "FR", region: "Beaujolais", wine_count: 4 });
    const b = producer({ name: "Coudert", title: "Domaine", country: "FR", region: "Beaujolais", wine_count: 2 });
    const result = classifyPair(a, b, ev("Beaujolais", ["Brouilly", "Fleurie"]), ev("Beaujolais", ["Fleurie", "Moulin-a-Vent"]));
    expect(result?.class).toBe("auto");
    expect(result?.keep_id).toBe(a.id);
  });

  it("Coudert (Beaujolais) vs Chateau Coudert (Bordeaux): same surname, different region -> reject, never auto", () => {
    const a = producer({ name: "Coudert", country: "FR", region: "Beaujolais", wine_count: 4 });
    const b = producer({ name: "Coudert", title: "Chateau", country: "FR", region: "Bordeaux", wine_count: 1 });
    const result = classifyPair(a, b, ev("Beaujolais", ["Fleurie"]), ev("Bordeaux", ["Saint-Emilion"]));
    expect(result?.class).toBe("reject");
  });

  it("Gerard Schueller / Gerard Schueller et Fils: title-stripped match, corroborated -> auto", () => {
    const a = producer({ name: "Gerard Schueller et Fils", country: "FR", region: "Alsace", wine_count: 12 });
    const b = producer({ name: "Gerard Schueller", country: "FR", region: "Alsace", wine_count: 3 });
    const result = classifyPair(a, b, ev("Alsace", ["Alsace Grand Cru"]), ev("Alsace", []));
    expect(result?.class).toBe("auto");
  });
});

describe("generateCandidates", () => {
  it("finds the safe pair and does not surface the known-different pair as auto", () => {
    const producers: ProducerRow[] = [
      producer({ name: "Coudert", country: "FR", region: "Beaujolais", wine_count: 4 }),
      producer({ name: "Coudert", title: "Domaine", country: "FR", region: "Beaujolais", wine_count: 2 }),
      producer({ name: "Overnoy", title: "Domaine", country: "FR", region: "Jura", wine_count: 12 }),
      producer({ name: "Pierre Overnoy", title: "Maison", country: "FR", region: "Jura", wine_count: 10 }),
    ];
    const evidence = new Map<number, WineEvidence>([
      [producers[0].id, ev("Beaujolais", ["Fleurie"])],
      [producers[1].id, ev("Beaujolais", ["Fleurie", "Moulin-a-Vent"])],
      [producers[2].id, ev("Jura", ["Cotes du Jura"])],
      [producers[3].id, ev("Jura", ["Arbois", "Arbois Pupillin"])],
    ]);
    const candidates = generateCandidates(producers, evidence);
    const coudert = candidates.find((c) => c.merge_name === "Coudert" && c.keep_name === "Coudert");
    expect(coudert?.class).toBe("auto");
    const overnoy = candidates.find((c) => c.merge_name.includes("Overnoy") && c.keep_name.includes("Overnoy"));
    expect(overnoy?.class).not.toBe("auto");
  });

  it("never generates a cross-country pair", () => {
    const producers: ProducerRow[] = [
      producer({ name: "Overnoy", country: "FR", wine_count: 5 }),
      producer({ name: "Overnoy", country: "CH", wine_count: 3 }),
    ];
    const candidates = generateCandidates(producers, new Map());
    expect(candidates).toHaveLength(0);
  });
});

describe("titles", () => {
  it("never auto-merges Domaine Leroy into Maison Leroy: estate and negociant are two labels", async () => {
    const { titlesConflict } = await import("../producer-merge-rules");
    expect(titlesConflict("Domaine", "Maison")).toBe(true);
    const villages = ["Vosne-Romanee", "Chambolle-Musigny", "Pommard"];
    const c = classifyPair(
      producer({ name: "Leroy", title: "Maison", country: "FR", region: "Burgundy", wine_count: 205 }),
      producer({ name: "Leroy", title: "Domaine", country: "FR", region: "Burgundy", wine_count: 47 }),
      ev("Burgundy", villages), ev("Burgundy", villages),
    );
    expect(c?.class).toBe("review");
  });

  it("still folds an untitled row into the titled one", async () => {
    const { titlesConflict } = await import("../producer-merge-rules");
    expect(titlesConflict(null, "Weingut")).toBe(false);
    expect(titlesConflict("Domaine", "Domaine de")).toBe(false);
    const c = classifyPair(
      producer({ name: "Keller", title: null, country: "DE", region: "Rheinhessen", wine_count: 202 }),
      producer({ name: "Keller", title: "Weingut", country: "DE", region: "Rheinhessen", wine_count: 1 }),
      ev("Rheinhessen", ["Rheinhessen"]), ev("Rheinhessen", ["Rheinhessen"]),
    );
    expect(c?.class).toBe("auto");
  });
});
