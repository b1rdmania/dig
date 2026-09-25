import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Every record the answer links should bring its videos, not just the top
 * rows the tools prefetched. The fill fetches only what's cited and missing.
 */

const getMaster = vi.fn(async (_db: unknown, id: number) => ({
  primary_artist: { name: `Artist ${id}` },
  videos: [{ url: `https://www.youtube.com/watch?v=${String(id).padStart(11, "x")}`, title: `Video ${id}` }],
}));

vi.mock("@dig/domain", async (orig) => ({
  ...(await orig<typeof import("@dig/domain")>()),
  getBatchForTable: vi.fn(async () => ({ batchId: "b", dumpDate: "2026-02-01" })),
  getMaster: (...args: unknown[]) => getMaster(...(args as [unknown, number])),
}));

const { fillCitedVideos } = await import("../routes/v1/ask/tools.js");
const link = (id: number) => `[R${id}](https://app.dig.baby/master/${id})`;

beforeEach(() => getMaster.mockClear());

describe("fillCitedVideos", () => {
  it("fetches videos only for cited masters that have none yet", async () => {
    const media = [{ discogs_id: 1, title: "t", artist: "a", youtube_url: "https://youtu.be/aaaaaaaaaaa" }];
    await fillCitedVideos({} as never, `${link(1)} and ${link(2)}`, [], media);
    expect(getMaster.mock.calls.map((c) => c[1])).toEqual([2]);
    expect(media.map((m) => m.discogs_id)).toEqual([1, 2]);
  });

  it("does nothing when every cited master already has a video", async () => {
    const media = [{ discogs_id: 1, title: "t", artist: "a", youtube_url: "https://youtu.be/aaaaaaaaaaa" }];
    await fillCitedVideos({} as never, link(1), [], media);
    expect(getMaster).not.toHaveBeenCalled();
  });

  it("caps the fill at eight masters", async () => {
    const answer = Array.from({ length: 12 }, (_, i) => link(i + 10)).join(" ");
    await fillCitedVideos({} as never, answer, [], []);
    expect(getMaster).toHaveBeenCalledTimes(8);
  });
});
