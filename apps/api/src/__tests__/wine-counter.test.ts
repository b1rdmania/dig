import { describe, it, expect, vi } from "vitest";

/**
 * The wine counter after an answer: producers and wines carry the maker's
 * site and picture, appellations their region map when one was built, and
 * nothing unsafe reaches the page from third-party data.
 */

const PHOTO = { kind: "photo", src: "https://upload.wikimedia.org/x.jpg", page: "https://commons.wikimedia.org/wiki/File:X.jpg", credit: "A. Person", licence: "CC BY-SA 4.0" };

vi.mock("@dig/domain", async (orig) => ({
  ...(await orig<typeof import("@dig/domain")>()),
  loadBorePack: (_slug: string, file: string) =>
    file === "producer-images.json" ? { Q1: PHOTO } : { ids: ["PDO-FR-A0194"] },
}));

// Answers each query by the table it reads.
vi.mock("@dig/db", async (orig) => ({
  ...(await orig<typeof import("@dig/db")>()),
  sql: (strings: TemplateStringsArray) => ({
    execute: async () => {
      const q = strings.join("?");
      if (q.includes("FROM wine.wines")) return { rows: [{ lwin: "1000001", producer_id: 7 }] };
      if (q.includes("FROM wine.producers")) {
        return { rows: [{ id: 7, site: "chateau.example", qid: "Q1" }, { id: 8, site: "javascript:alert(1)", qid: null }] };
      }
      if (q.includes("FROM wine.appellations")) return { rows: [{ id: 3, pdo: "PDO-FR-A0194" }, { id: 4, pdo: "PDO-FR-X9999" }] };
      return { rows: [] };
    },
  }),
}));

const { dressCounter } = await import("../routes/v1/ask/wine-counter.js");
import type { WineEvidence } from "../routes/v1/ask/wine-bore.js";

const item = (type: WineEvidence["type"], id: number, title: string): WineEvidence =>
  ({ type, id, title, subtitle: null, find_url: null });

describe("dressCounter", () => {
  it("gives producers and their wines the maker's site, picture and a buy link", async () => {
    const ev = [item("producer", 7, "Château X"), item("wine", 1000001, "Château X Rouge")];
    await dressCounter({} as never, ev);
    expect(ev[0]).toMatchObject({ site_url: "https://chateau.example/", image: PHOTO });
    expect(ev[0].find_url).toContain("wine-searcher.com");
    expect(ev[1]).toMatchObject({ site_url: "https://chateau.example/", image: PHOTO });
  });

  it("maps only appellations that have a built map", async () => {
    const ev = [item("appellation", 3, "Sancerre"), item("appellation", 4, "Nowhere")];
    await dressCounter({} as never, ev);
    expect(ev[0].map_url).toBe("https://app.dig.baby/winebore/maps/PDO-FR-A0194.svg");
    expect(ev[1].map_url).toBeNull();
  });

  it("drops a non-http site from the data", async () => {
    const ev = [item("producer", 8, "Bad Data")];
    await dressCounter({} as never, ev);
    expect(ev[0].site_url).toBeNull();
    expect(ev[0].image).toBeNull();
  });
});
