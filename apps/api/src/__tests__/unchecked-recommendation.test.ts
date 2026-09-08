import { describe, it, expect } from "vitest";
import { looksLikeUncheckedRecommendation } from "../routes/v1/ask/loop.js";

/**
 * The loop sends the model back to the racks once when it writes a
 * recommendation without a single lookup this turn. Signature: zero tool
 * calls and a year in the text. Counter chat and clarifying questions carry
 * no year and pass through.
 */
describe("looksLikeUncheckedRecommendation", () => {
  it("flags a from-memory recommendation (no tools, a year in the text)", () => {
    const t = "Transllusion - The Opening Of The Cerebral Gate from 2001 is the one.";
    expect(looksLikeUncheckedRecommendation(t, 0)).toBe(true);
  });

  it("passes when the same text followed tool calls", () => {
    const t = "Transllusion - The Opening Of The Cerebral Gate from 2001 is the one.";
    expect(looksLikeUncheckedRecommendation(t, 2)).toBe(false);
  });

  it("passes a clarifying question with no year", () => {
    const t = "Warm and heads-down, or the cold dubby thing? Tell me what you rate at that hour.";
    expect(looksLikeUncheckedRecommendation(t, 0)).toBe(false);
  });

  it("passes counter chat that owns a miss", () => {
    const t = "Fair. None of those were trippy. Say what trippy means to you and I'll re-aim.";
    expect(looksLikeUncheckedRecommendation(t, 0)).toBe(false);
  });

  it("does not trip on a catalogue number that merely looks numeric", () => {
    expect(looksLikeUncheckedRecommendation("Try the 303 stuff, or anything on catalogue 12345.", 0)).toBe(false);
  });
});
