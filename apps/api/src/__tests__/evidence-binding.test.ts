import { describe, it, expect } from "vitest";

/**
 * Evidence binding invariant tests.
 *
 * Regression guard for: wrong videos appearing in LLM media rail when
 * label release IDs (version IDs) are mistakenly used as master IDs.
 *
 * Replay scenario: Flying Records Italian house query returned Shy FX /
 * Frente! / Ry Cooder videos because Claude called get_master(release_id)
 * and Discogs IDs are sequential across all entity types.
 *
 * These tests validate the post-loop binding validator and allowedMasterIds
 * guard logic independently of the LLM and database.
 */

// Mirrors the types from ask.ts
interface MediaItem {
  discogs_id: number;
  title: string;
  artist: string;
  youtube_url: string;
}
interface EvidenceItem {
  type: "artist" | "label" | "master" | "release";
  discogs_id: number;
  title: string;
  dig_url: string;
}

/** The exact post-loop binding validator from ask.ts (must stay in sync) */
function bindMedia(media: MediaItem[], evidence: EvidenceItem[]): MediaItem[] {
  const evidenceMasterIds = new Set(
    evidence.filter((e) => e.type === "master").map((e) => e.discogs_id),
  );
  return media.filter((m) => evidenceMasterIds.has(m.discogs_id));
}

// ---------------------------------------------------------------------------
// Flying Records replay scenario
// ---------------------------------------------------------------------------

describe("media binding validator — Flying Records regression", () => {
  // Simulated evidence: Claude retrieved Flying Records (label) and a few of
  // its releases (version-type), but never confirmed any masters.
  const flyingRecordsEvidence: EvidenceItem[] = [
    {
      type: "label",
      discogs_id: 3929,
      title: "Flying Records",
      dig_url: "https://app.dig.baby/label/3929",
    },
    {
      type: "release",
      discogs_id: 345612,
      title: "Try The Feeling",
      dig_url: "https://app.dig.baby/version/345612",
    },
    {
      type: "release",
      discogs_id: 398201,
      title: "Forever My Sunset",
      dig_url: "https://app.dig.baby/version/398201",
    },
  ];

  // Simulated media: Claude called get_master(345612) using the release ID —
  // that happened to resolve to an unrelated master (Shy FX) which had videos.
  const wrongMedia: MediaItem[] = [
    {
      discogs_id: 345612, // release ID ≠ master ID for Shy FX, coincidental match
      title: "Wolf (45 Roller)",
      artist: "Shy FX",
      youtube_url: "https://www.youtube.com/watch?v=shyfxabc1234",
    },
    {
      discogs_id: 398201, // another release ID that matched Frente! master
      title: "Horrible",
      artist: "Frente!",
      youtube_url: "https://www.youtube.com/watch?v=frente5678xyz",
    },
  ];

  it("strips all media when no master evidence exists", () => {
    const result = bindMedia(wrongMedia, flyingRecordsEvidence);
    expect(result).toHaveLength(0);
  });

  it("returns empty media array, not undefined or null", () => {
    const result = bindMedia(wrongMedia, flyingRecordsEvidence);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Correct path: master evidence allows bound media through
// ---------------------------------------------------------------------------

describe("media binding validator — correct master path", () => {
  const masterEvidence: EvidenceItem[] = [
    {
      type: "master",
      discogs_id: 12345,
      title: "Akasa EP",
      dig_url: "https://app.dig.baby/release/12345",
    },
  ];

  const correctMedia: MediaItem[] = [
    {
      discogs_id: 12345, // matches evidence master
      title: "Akasa",
      artist: "Kasra V",
      youtube_url: "https://www.youtube.com/watch?v=kasraabc1234",
    },
  ];

  const unrelatedMedia: MediaItem[] = [
    {
      discogs_id: 99999, // not in evidence
      title: "Something Else",
      artist: "Unrelated Artist",
      youtube_url: "https://www.youtube.com/watch?v=unrelated9999",
    },
  ];

  it("passes media whose source master is in evidence", () => {
    const result = bindMedia(correctMedia, masterEvidence);
    expect(result).toHaveLength(1);
    expect(result[0].discogs_id).toBe(12345);
  });

  it("strips media whose source master is not in evidence", () => {
    const result = bindMedia(unrelatedMedia, masterEvidence);
    expect(result).toHaveLength(0);
  });

  it("filters mixed media — keeps only bound items", () => {
    const mixed = [...correctMedia, ...unrelatedMedia];
    const result = bindMedia(mixed, masterEvidence);
    expect(result).toHaveLength(1);
    expect(result[0].discogs_id).toBe(12345);
  });
});

// ---------------------------------------------------------------------------
// allowedMasterIds guard invariant
// ---------------------------------------------------------------------------

describe("allowedMasterIds guard — label release ID must not grant master access", () => {
  it("release ID from get_label_releases is not a valid master ID by default", () => {
    const allowedMasterIds = new Set<number>();
    const labelReleaseId = 345612; // a version ID

    // Simulates: label release returned, master_discogs_id is null
    // so nothing is added to allowedMasterIds
    const masterDiscogId: number | null = null;
    if (masterDiscogId != null) allowedMasterIds.add(masterDiscogId);

    expect(allowedMasterIds.has(labelReleaseId)).toBe(false);
  });

  it("master_discogs_id from label release is added to allowed set", () => {
    const allowedMasterIds = new Set<number>();
    const masterDiscogId: number | null = 98765;

    if (masterDiscogId != null) allowedMasterIds.add(masterDiscogId);

    expect(allowedMasterIds.has(98765)).toBe(true);
  });

  it("search_catalog master result adds its ID to allowed set", () => {
    const allowedMasterIds = new Set<number>();
    const searchResult = { type: "master" as const, discogs_id: 54321 };

    if (searchResult.type === "master") allowedMasterIds.add(searchResult.discogs_id);

    expect(allowedMasterIds.has(54321)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invariant: every media item must reference an evidence master
// ---------------------------------------------------------------------------

describe("binding invariant — media ⊆ evidence masters", () => {
  it("holds when media is empty", () => {
    const evidence: EvidenceItem[] = [
      { type: "label", discogs_id: 1, title: "X", dig_url: "https://app.dig.baby/label/1" },
    ];
    const bound = bindMedia([], evidence);
    expect(bound).toHaveLength(0);
  });

  it("holds when evidence is empty", () => {
    const media: MediaItem[] = [
      { discogs_id: 1, title: "X", artist: "Y", youtube_url: "https://www.youtube.com/watch?v=abc" },
    ];
    const bound = bindMedia(media, []);
    expect(bound).toHaveLength(0);
  });

  it("every bound media item has its discogs_id in evidence masters", () => {
    const evidence: EvidenceItem[] = [
      { type: "master", discogs_id: 100, title: "A", dig_url: "https://app.dig.baby/release/100" },
      { type: "master", discogs_id: 200, title: "B", dig_url: "https://app.dig.baby/release/200" },
      { type: "release", discogs_id: 300, title: "C", dig_url: "https://app.dig.baby/version/300" },
    ];
    const media: MediaItem[] = [
      { discogs_id: 100, title: "A vid", artist: "X", youtube_url: "https://www.youtube.com/watch?v=aaa" },
      { discogs_id: 200, title: "B vid", artist: "Y", youtube_url: "https://www.youtube.com/watch?v=bbb" },
      { discogs_id: 300, title: "C vid", artist: "Z", youtube_url: "https://www.youtube.com/watch?v=ccc" }, // release, not master
    ];
    const bound = bindMedia(media, evidence);
    const masterIds = new Set(evidence.filter((e) => e.type === "master").map((e) => e.discogs_id));
    for (const m of bound) {
      expect(masterIds.has(m.discogs_id)).toBe(true);
    }
    expect(bound).toHaveLength(2); // 300 is a release, stripped
  });
});
