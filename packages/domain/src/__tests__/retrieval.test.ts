import { describe, it, expect } from "vitest";
import type { ArtistDetail } from "../retrieval/artist.js";
import type { LabelDetail } from "../retrieval/label.js";
import type { MasterDetail } from "../retrieval/master.js";
import type { ReleaseDetail, ReleaseShadow } from "../retrieval/release.js";

describe("ArtistDetail shape", () => {
  it("matches response contract", () => {
    const artist: ArtistDetail = {
      discogs_id: 3840,
      name: "Radiohead",
      real_name: null,
      profile: "Band from Oxfordshire",
      data_quality: "Correct",
      // Slim shape: aliases come from denormed `aliases_text TEXT[]` and have
      // no per-alias discogs_id.
      aliases: [{ discogs_id: null, name: "On A Friday" }],
      // name_variations / members / groups are dropped surfaces in v1 and
      // always come back empty during the cutover.
      name_variations: [],
      members: [],
      groups: [],
      urls: ["https://radiohead.com"],
      provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 3840 },
    };

    expect(artist.discogs_id).toBe(3840);
    expect(artist.aliases).toHaveLength(1);
    expect(artist.aliases[0].discogs_id).toBeNull();
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
      // Denormed text aliases (TEXT[]) — empty for this fixture.
      aliases: [],
      // tier1 example — Planet E is on the editorial tier-1 list in real data.
      tier: "tier1",
      editorial: {
        tier: "tier1",
        palette: { accent: "#1a1a1a", accent_ink: "#f4f1e8" },
        blurb: "Detroit techno cornerstone — Carl Craig's house.",
        founded_year: 1991,
        closed_year: null,
        is_active: true,
        location: "Detroit, US",
      },
      sublabels: [
        { discogs_id: 12345, name: "Planet E Communications" },
        { discogs_id: 67890, name: "C2" },
      ],
      urls: ["https://planet-e.net"],
      provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 1 },
    };

    expect(label.name).toBe("Planet E");
    expect(label.parent_label.discogs_id).toBeNull();
    expect(label.tier).toBe("tier1");
    expect(label.editorial.tier).toBe("tier1");
  });

  it("supports unrated labels (long-tail)", () => {
    const label: LabelDetail = {
      discogs_id: 999999,
      name: "Some Tiny Label",
      profile: null,
      contact_info: null,
      parent_label: { discogs_id: null, name: null },
      data_quality: "Needs Vote",
      aliases: [],
      tier: null,
      editorial: {
        tier: null,
        palette: null,
        blurb: null,
        founded_year: null,
        closed_year: null,
        is_active: true,
        location: null,
      },
      sublabels: [],
      urls: [],
      provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 999999 },
    };
    expect(label.tier).toBeNull();
    expect(label.editorial.palette).toBeNull();
    expect(label.sublabels).toEqual([]);
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
      scene_weight: 42,
      primary_artist: { discogs_id: 45467, name: "Pink Floyd" },
      primary_label:  { discogs_id: 99,    name: "Harvest" },
      artists_credit_text: "Pink Floyd",
      primary_country: "UK",
      primary_format: "LP",
      genres: ["Rock"],
      styles: ["Prog Rock"],
      artists: [{ discogs_id: 45467, name: "Pink Floyd", role: null, join_relation: null }],
      tracks: [{
        position: "A1",
        title: "Speak To Me",
        duration_seconds: 90,
        artists_text: "Pink Floyd",
        source_release_discogs_id: 249504,
      }],
      videos: [{
        url: "https://youtube.com/watch?v=abc",
        title: "Money",
        duration_seconds: 382,
        source_type: "master",
        source_release_discogs_id: null,
        discogs_release_url: null,
      }],
      provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 10362 },
    };

    expect(master.title).toBe("The Dark Side Of The Moon");
    expect(master.year).toBe(1973);
    expect(master.scene_weight).toBe(42);
    expect(master.genres).toContain("Rock");
    expect(master.primary_artist.name).toBe("Pink Floyd");
    expect(master.tracks[0].position).toBe("A1");
    expect(master.videos[0].source_type).toBe("master");
  });
});

describe("ReleaseDetail shape (deprecated, preserved for cutover typecheck)", () => {
  it("type still compiles for legacy callers", () => {
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
      provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 1 },
    };
    expect(release.title).toBe("Stockholm");
  });
});

describe("ReleaseShadow shape (slim — drives 301 → /master/:id)", () => {
  it("matches the minimal release surface", () => {
    const shadow: ReleaseShadow = {
      release_discogs_id: 249504,
      master_discogs_id: 10362,
      title: "The Dark Side Of The Moon",
      release_year: 1973,
      country: "UK",
      label: "Harvest",
      format: "LP",
      is_main_release: true,
      has_tracklist_delta: false,
      has_remix_signal: false,
      discogs_url: "https://www.discogs.com/release/249504",
    };
    expect(shadow.master_discogs_id).toBe(10362);
    expect(shadow.is_main_release).toBe(true);
  });
});
