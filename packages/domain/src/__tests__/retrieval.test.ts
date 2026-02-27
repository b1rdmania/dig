import { describe, it, expect } from "vitest";
import type { ArtistDetail } from "../retrieval/artist.js";
import type { LabelDetail } from "../retrieval/label.js";
import type { MasterDetail } from "../retrieval/master.js";
import type { ReleaseDetail } from "../retrieval/release.js";

describe("ArtistDetail shape", () => {
  it("matches response contract", () => {
    const artist: ArtistDetail = {
      discogs_id: 3840,
      name: "Radiohead",
      real_name: null,
      profile: "Band from Oxfordshire",
      data_quality: "Correct",
      aliases: [{ discogs_id: 12345, name: "On A Friday" }],
      name_variations: ["Radio Head"],
      members: [{ discogs_id: 67890, name: "Thom Yorke" }],
      groups: [],
      urls: ["https://radiohead.com"],
      provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 3840 },
    };

    expect(artist.discogs_id).toBe(3840);
    expect(artist.aliases).toHaveLength(1);
    expect(artist.provenance.source).toBe("discogs");
  });
});

describe("LabelDetail shape", () => {
  it("matches response contract", () => {
    const label: LabelDetail = {
      discogs_id: 1,
      name: "Planet E",
      profile: "Detroit techno label",
      contact_info: null,
      parent_label: { discogs_id: null, name: null },
      data_quality: "Needs Vote",
      urls: ["https://planet-e.net"],
      provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 1 },
    };

    expect(label.name).toBe("Planet E");
    expect(label.parent_label.discogs_id).toBeNull();
  });
});

describe("MasterDetail shape", () => {
  it("matches response contract", () => {
    const master: MasterDetail = {
      discogs_id: 10362,
      title: "The Dark Side Of The Moon",
      year: 1973,
      main_release_discogs_id: 249504,
      data_quality: "Correct",
      artists: [{ discogs_id: 45467, name: "Pink Floyd", role: null, join_relation: null }],
      genres: ["Rock"],
      styles: ["Prog Rock"],
      videos: [{ url: "https://youtube.com", title: "Money", duration_seconds: 382 }],
      provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 10362 },
    };

    expect(master.title).toBe("The Dark Side Of The Moon");
    expect(master.year).toBe(1973);
    expect(master.genres).toContain("Rock");
  });
});

describe("ReleaseDetail shape", () => {
  it("matches response contract", () => {
    const release: ReleaseDetail = {
      discogs_id: 1,
      title: "Stockholm",
      country: "Sweden",
      release_year: 1999,
      released_raw: "1999",
      status: "Accepted",
      notes: "Test notes",
      data_quality: "Needs Vote",
      master_discogs_id: null,
      is_main_release: null,
      artists: [{ discogs_id: 1, name: "The Persuader", role: null, join_relation: null }],
      labels: [{ discogs_id: 5, name: "Svek", catalog_number: "SK032" }],
      formats: [{ name: "Vinyl", qty: 1, descriptions: ["12\""] }],
      genres: ["Electronic"],
      styles: ["Deep House"],
      tracks: [{
        position_raw: "A1",
        title: "Gamla Stan",
        duration_seconds: 325,
        disc: null,
        credits: [{ artist_discogs_id: 1, artist_name: "The Persuader", role: "Written-By" }],
      }],
      credits: [{ artist_discogs_id: 1, artist_name: "The Persuader", role: "Written-By" }],
      identifiers: [{ type: "Barcode", value: "123", description: null }],
      companies: [{ discogs_id: 100, name: "JVC", entity_type: "Pressed By" }],
      videos: [{ url: "https://youtube.com", title: "Gamla Stan", duration_seconds: 325 }],
      provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 1 },
    };

    expect(release.title).toBe("Stockholm");
    expect(release.tracks).toHaveLength(1);
    expect(release.tracks[0].credits).toHaveLength(1);
    expect(release.genres).toContain("Electronic");
  });

  it("supports release with no master and no tracks", () => {
    const release: ReleaseDetail = {
      discogs_id: 999,
      title: "Untitled",
      country: null,
      release_year: null,
      released_raw: null,
      status: "Accepted",
      notes: null,
      data_quality: "Needs Vote",
      master_discogs_id: null,
      is_main_release: null,
      artists: [],
      labels: [],
      formats: [],
      genres: [],
      styles: [],
      tracks: [],
      credits: [],
      identifiers: [],
      companies: [],
      videos: [],
      provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 999 },
    };

    expect(release.master_discogs_id).toBeNull();
    expect(release.tracks).toHaveLength(0);
    expect(release.country).toBeNull();
    expect(release.release_year).toBeNull();
  });
});
