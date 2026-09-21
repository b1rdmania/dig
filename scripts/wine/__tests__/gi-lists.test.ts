import { describe, expect, it } from "vitest";
import { dedupeAliases, parseAkaList, parsePipeList, resolveParents, type GiListRow } from "../gi-lists";

describe("parsePipeList", () => {
  it("splits on pipe and trims", () => {
    expect(parsePipeList("Central Coast|San Francisco Bay")).toEqual(["Central Coast", "San Francisco Bay"]);
  });
  it("returns empty for null/blank", () => {
    expect(parsePipeList(null)).toEqual([]);
    expect(parsePipeList("")).toEqual([]);
  });
  it("returns a single-element array with no pipe", () => {
    expect(parsePipeList("Ozark Mountain")).toEqual(["Ozark Mountain"]);
  });
});

describe("parseAkaList", () => {
  it("splits a comma-separated name list", () => {
    expect(parseAkaList("Kelsey Bench, Kelseyfille Bench")).toEqual(["Kelsey Bench", "Kelseyfille Bench"]);
  });
  it("drops a prose note instead of inventing names from it", () => {
    const prose = 'refered by many newspaper articles as the  "Oak Flats Valley Ranch" or the "Oak Flats Valley"';
    expect(parseAkaList(prose)).toEqual([]);
  });
  it("drops a candidate with a digit", () => {
    expect(parseAkaList("District 7")).toEqual([]);
  });
  it("returns empty for null", () => {
    expect(parseAkaList(null)).toEqual([]);
  });
});

describe("dedupeAliases", () => {
  it("drops a candidate equal to the protected name", () => {
    expect(dedupeAliases("Napa Valley", ["Napa valley", "Napa"])).toEqual(["Napa"]);
  });
  it("drops a repeated norm, keeping the first spelling", () => {
    expect(dedupeAliases("Waipara Valley", ["Waipara", "WAIPARA"])).toEqual(["Waipara"]);
  });
  it("returns empty when every candidate norms to the protected name", () => {
    expect(dedupeAliases("Casablanca Valley", ["casablanca valley"])).toEqual([]);
  });
});

describe("resolveParents", () => {
  const rows: GiListRow[] = [
    { name: "Auckland", gi_type: "GI", parent: null, aliases: [], source_url: "x" },
    { name: "Waiheke Island", gi_type: "GI", parent: "Auckland", aliases: [], source_url: "x" },
    { name: "Kumeu", gi_type: "GI", parent: "Auckland", aliases: [], source_url: "x" },
  ];

  it("resolves a child to its parent's index", () => {
    const { parentIndex, misses } = resolveParents(rows);
    expect(parentIndex).toEqual([null, 0, 0]);
    expect(misses).toEqual([]);
  });

  it("reports a miss for a parent name absent from the list, without throwing", () => {
    const withGhost: GiListRow[] = [
      ...rows,
      { name: "Ghost Ward", gi_type: "ward", parent: "Nowhere", aliases: [], source_url: "x" },
    ];
    const { parentIndex, misses } = resolveParents(withGhost);
    expect(parentIndex[3]).toBeNull();
    expect(misses).toEqual(["Ghost Ward -> Nowhere"]);
  });

  it("matches parent names through norm(), case- and accent-insensitively", () => {
    const withAccent: GiListRow[] = [
      { name: "Valle de Curico", gi_type: "subregion", parent: null, aliases: [], source_url: "x" },
      { name: "Molina", gi_type: "area", parent: "valle DE curico", aliases: [], source_url: "x" },
    ];
    const { parentIndex, misses } = resolveParents(withAccent);
    expect(parentIndex).toEqual([null, 0]);
    expect(misses).toEqual([]);
  });
});
