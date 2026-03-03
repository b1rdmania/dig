import { describe, it, expect } from "vitest";
import {
  extractContextRows,
  getTimeValue,
  getEnDescription,
  getEnLabel,
} from "../wikidata-context-import.js";

describe("getEnLabel", () => {
  it("extracts English label", () => {
    expect(getEnLabel({ labels: { en: { value: "Radiohead" } } })).toBe("Radiohead");
  });

  it("returns null when missing", () => {
    expect(getEnLabel({ labels: {} })).toBeNull();
    expect(getEnLabel({})).toBeNull();
    expect(getEnLabel(null)).toBeNull();
  });
});

describe("getEnDescription", () => {
  it("extracts English description", () => {
    expect(
      getEnDescription({ descriptions: { en: { value: "English rock band" } } }),
    ).toBe("English rock band");
  });

  it("returns null when missing", () => {
    expect(getEnDescription({ descriptions: {} })).toBeNull();
  });
});

describe("getTimeValue", () => {
  it("parses year-precision time", () => {
    expect(getTimeValue({ time: "+1985-01-01T00:00:00Z", precision: 9 })).toBe("1985");
  });

  it("parses month-precision time", () => {
    expect(getTimeValue({ time: "+1985-10-01T00:00:00Z", precision: 10 })).toBe("1985-10");
  });

  it("parses day-precision time", () => {
    expect(getTimeValue({ time: "+1985-10-07T00:00:00Z", precision: 11 })).toBe("1985-10-07");
  });

  it("returns null for invalid input", () => {
    expect(getTimeValue(null)).toBeNull();
    expect(getTimeValue({})).toBeNull();
    expect(getTimeValue("not an object")).toBeNull();
  });
});

describe("extractContextRows", () => {
  const mockEntity = {
    labels: { en: { value: "Radiohead" } },
    descriptions: { en: { value: "English rock band formed in Abingdon, Oxfordshire in 1985" } },
    claims: {
      P740: [
        {
          mainsnak: {
            datavalue: { value: { id: "Q189413", "numeric-id": 189413 } },
          },
        },
      ],
      P571: [
        {
          mainsnak: {
            datavalue: {
              value: { time: "+1985-01-01T00:00:00Z", precision: 9 },
            },
          },
        },
      ],
      P136: [
        {
          mainsnak: {
            datavalue: { value: { id: "Q11399", "numeric-id": 11399 } },
          },
        },
        {
          mainsnak: {
            datavalue: { value: { id: "Q9778", "numeric-id": 9778 } },
          },
        },
      ],
    },
  };

  it("extracts bio context", () => {
    const rows = extractContextRows(3840, "Q188440", mockEntity);
    const bio = rows.find((r) => r.context_type === "bio");
    expect(bio).toBeDefined();
    expect(bio!.discogs_id).toBe(3840);
    expect(bio!.source).toBe("wikidata");
    expect(bio!.source_id).toBe("Q188440");
    expect(bio!.confidence).toBe(0.85);
    expect(bio!.context_key).toBe("wikidata:artist:3840:bio");

    const json = bio!.content_json as Record<string, unknown>;
    expect(json.name).toBe("Radiohead");
    expect(json.summary).toBe("English rock band formed in Abingdon, Oxfordshire in 1985");
    expect(json.genre_qids).toEqual(["Q11399", "Q9778"]);
  });

  it("extracts location context", () => {
    const rows = extractContextRows(3840, "Q188440", mockEntity);
    const loc = rows.find((r) => r.context_type === "location");
    expect(loc).toBeDefined();
    expect(loc!.context_key).toBe("wikidata:artist:3840:location");

    const json = loc!.content_json as Record<string, string>;
    expect(json.location_of_formation_qid).toBe("Q189413");
  });

  it("extracts timeline context", () => {
    const rows = extractContextRows(3840, "Q188440", mockEntity);
    const tl = rows.find((r) => r.context_type === "timeline_note");
    expect(tl).toBeDefined();
    expect(tl!.context_key).toBe("wikidata:artist:3840:timeline_note");

    const json = tl!.content_json as Record<string, string>;
    expect(json.formed).toBe("1985");
  });

  it("returns empty for entity with no useful data", () => {
    const rows = extractContextRows(99999, "Q99999", { labels: {}, descriptions: {}, claims: {} });
    expect(rows).toHaveLength(0);
  });

  it("returns bio-only when no location or timeline", () => {
    const entity = {
      labels: { en: { value: "Test" } },
      descriptions: { en: { value: "A test artist" } },
      claims: {},
    };
    const rows = extractContextRows(1, "Q1", entity);
    expect(rows).toHaveLength(1);
    expect(rows[0].context_type).toBe("bio");
  });

  it("sets deterministic context_key", () => {
    const rows = extractContextRows(42, "Q42", mockEntity);
    for (const row of rows) {
      expect(row.context_key).toMatch(/^wikidata:artist:42:/);
    }
  });
});
