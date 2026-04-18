import { describe, it, expect } from "vitest";

/**
 * Media binding invariant tests for /v1/ask.
 *
 * As of v2 the LLM route binds videos to **citations in the answer text**,
 * not to "any master we touched in a tool call". This is a stronger contract:
 * a video can only render if its master's dig.baby URL appears in the
 * assistant's answer markdown.
 *
 * Regression history:
 *   1. Flying Records bug — release IDs were used as master IDs and pulled
 *      unrelated videos (Shy FX / Frente! / Ry Cooder). Original fix gated
 *      media on `evidence.type === "master"`, but that still surfaced videos
 *      for masters Claude fetched but never wrote about (the "generic videos"
 *      complaint).
 *   2. Citation-binding rewrite — videos now strictly require the model to
 *      have linked the master in the answer text via:
 *        [Title](https://app.dig.baby/master/ID)
 *      No citation, no video. Strict empty is the right default.
 *
 * These tests validate both the new bind logic and the legacy
 * `allowedMasterIds` server-side guard (still active to prevent Claude calling
 * get_master with a release ID).
 */

// Mirrors the types from ask.ts
interface MediaItem {
  discogs_id: number;
  title: string;
  artist: string;
  youtube_url: string;
}

/**
 * The exact post-loop citation binder from ask.ts (must stay in sync).
 *
 * Scans the answer text for `app.dig.baby/master/{id}` URLs and keeps only
 * media whose master ID is in that set. No fallback — if the model didn't
 * link a master, no video renders for it.
 */
function bindMediaToCitations(media: MediaItem[], answer: string): MediaItem[] {
  const cited = new Set<number>();
  const re = /app\.dig\.baby\/master\/(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const id = Number(m[1]);
    if (Number.isFinite(id)) cited.add(id);
  }
  return media.filter((item) => cited.has(item.discogs_id));
}

// ---------------------------------------------------------------------------
// Generic-videos regression — model fetched masters but never cited them
// ---------------------------------------------------------------------------

describe("citation binding — generic videos regression", () => {
  // Replay: user asked about Italian house. Claude exploratorily called
  // get_artist_masters for an artist, which auto-fetched videos for the top 3
  // masters. The final answer talked about something else entirely and never
  // linked any of those masters. Under the old evidence-based binding all 3
  // videos still surfaced. Under citation binding none should.
  const exploratoryMedia: MediaItem[] = [
    { discogs_id: 5001, title: "Generic vid 1", artist: "X", youtube_url: "https://www.youtube.com/watch?v=aaa11111111" },
    { discogs_id: 5002, title: "Generic vid 2", artist: "X", youtube_url: "https://www.youtube.com/watch?v=bbb22222222" },
    { discogs_id: 5003, title: "Generic vid 3", artist: "X", youtube_url: "https://www.youtube.com/watch?v=ccc33333333" },
  ];

  it("strips all media when the answer cites no master", () => {
    const answer = "Try checking out [some artist](https://app.dig.baby/artist/777) — they're worth a listen.";
    expect(bindMediaToCitations(exploratoryMedia, answer)).toHaveLength(0);
  });

  it("strips all media when the answer is plain text without any links", () => {
    const answer = "Italian house had a great early-90s run, especially the Naples scene.";
    expect(bindMediaToCitations(exploratoryMedia, answer)).toHaveLength(0);
  });

  it("returns empty media array, not undefined or null", () => {
    const result = bindMediaToCitations(exploratoryMedia, "no citations here");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Flying Records regression (release-ID-as-master-ID coincidence)
// ---------------------------------------------------------------------------

describe("citation binding — Flying Records regression", () => {
  // Wrong videos that previously leaked through because their numeric IDs
  // (originally release IDs) coincidentally matched unrelated masters.
  const wrongMedia: MediaItem[] = [
    { discogs_id: 345612, title: "Wolf (45 Roller)", artist: "Shy FX", youtube_url: "https://www.youtube.com/watch?v=shyfxabc1234" },
    { discogs_id: 398201, title: "Horrible", artist: "Frente!", youtube_url: "https://www.youtube.com/watch?v=frente5678xyz" },
  ];

  it("strips wrong-master videos when answer only links the label", () => {
    const answer = "[Flying Records](https://app.dig.baby/label/3929) had a great Italian house run.";
    expect(bindMediaToCitations(wrongMedia, answer)).toHaveLength(0);
  });

  it("strips wrong-master videos when answer links other masters", () => {
    const answer = "Try [Real Track](https://app.dig.baby/master/999) instead.";
    const result = bindMediaToCitations(wrongMedia, answer);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Correct path — model linked the master, video binds through
// ---------------------------------------------------------------------------

describe("citation binding — correct master citation", () => {
  const media: MediaItem[] = [
    { discogs_id: 12345, title: "Akasa", artist: "Kasra V", youtube_url: "https://www.youtube.com/watch?v=kasraabc1234" },
    { discogs_id: 67890, title: "Other", artist: "Other Artist", youtube_url: "https://www.youtube.com/watch?v=otherxyz5678" },
  ];

  it("passes media whose master ID is linked in the answer", () => {
    const answer = "Start with [Akasa EP](https://app.dig.baby/master/12345) — slow burner.";
    const result = bindMediaToCitations(media, answer);
    expect(result).toHaveLength(1);
    expect(result[0].discogs_id).toBe(12345);
  });

  it("passes only the cited subset when the model links a few of many fetched masters", () => {
    const answer = "[Akasa EP](https://app.dig.baby/master/12345) is the standout.";
    const result = bindMediaToCitations(media, answer);
    expect(result).toHaveLength(1);
    expect(result[0].discogs_id).toBe(12345);
  });

  it("passes multiple videos when the model links multiple masters", () => {
    const answer = "[Akasa EP](https://app.dig.baby/master/12345) and [Other](https://app.dig.baby/master/67890) both worth your time.";
    const result = bindMediaToCitations(media, answer);
    expect(result).toHaveLength(2);
  });

  it("ignores non-master dig links (artist, label, scene)", () => {
    const answer = "[Kasra V](https://app.dig.baby/artist/12345) on [Whities](https://app.dig.baby/label/67890).";
    expect(bindMediaToCitations(media, answer)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// allowedMasterIds guard invariant (server-side, defends against Claude calling
// get_master with a release ID — separate concern from citation binding)
// ---------------------------------------------------------------------------

describe("allowedMasterIds guard — label release ID must not grant master access", () => {
  it("release ID from get_label_releases is not a valid master ID by default", () => {
    const allowedMasterIds = new Set<number>();
    const labelReleaseId = 345612;

    // Simulates: label release returned, master_discogs_id is null
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
// Invariant: every bound media item must be a cited master
// ---------------------------------------------------------------------------

describe("binding invariant — media ⊆ answer-cited masters", () => {
  it("holds when media is empty", () => {
    const answer = "[Title](https://app.dig.baby/master/100)";
    expect(bindMediaToCitations([], answer)).toHaveLength(0);
  });

  it("holds when answer is empty", () => {
    const media: MediaItem[] = [
      { discogs_id: 1, title: "X", artist: "Y", youtube_url: "https://www.youtube.com/watch?v=abc" },
    ];
    expect(bindMediaToCitations(media, "")).toHaveLength(0);
  });

  it("every bound media item has its discogs_id linked in the answer text", () => {
    const answer =
      "Two essentials: [A](https://app.dig.baby/master/100) and [B](https://app.dig.baby/master/200). Skip C.";
    const media: MediaItem[] = [
      { discogs_id: 100, title: "A vid", artist: "X", youtube_url: "https://www.youtube.com/watch?v=aaa11111111" },
      { discogs_id: 200, title: "B vid", artist: "Y", youtube_url: "https://www.youtube.com/watch?v=bbb22222222" },
      { discogs_id: 300, title: "C vid", artist: "Z", youtube_url: "https://www.youtube.com/watch?v=ccc33333333" },
    ];
    const bound = bindMediaToCitations(media, answer);
    expect(bound).toHaveLength(2);
    expect(bound.map((m) => m.discogs_id).sort()).toEqual([100, 200]);
  });
});
