import { describe, expect, it } from "vitest";
import { QUALITY_VERSION, classifyEntityQuality } from "../quality.js";

describe("quality classifier v2", () => {
  it("exports quality version 2", () => {
    expect(QUALITY_VERSION).toBe(2);
  });

  it("marks empty names invalid", () => {
    expect(classifyEntityQuality("", "Correct")).toEqual({
      quality_status: "invalid",
      quality_reason: "empty_name",
    });
  });

  it("marks numeric names low_value", () => {
    expect(classifyEntityQuality("12345", "Correct")).toEqual({
      quality_status: "low_value",
      quality_reason: "numeric_name",
    });
  });

  it("suppresses entirely incorrect entities", () => {
    expect(classifyEntityQuality("Some Name", "Entirely Incorrect")).toEqual({
      quality_status: "suppressed",
      quality_reason: "discogs_quality_entirely_incorrect",
    });
  });

  it("suppresses artist placeholder names", () => {
    expect(
      classifyEntityQuality("Artist 123456", "Needs Vote", { entityType: "artist" }),
    ).toEqual({
      quality_status: "suppressed",
      quality_reason: "artist_placeholder_name",
    });
  });

  it("marks unlinked low-info artists as low_value", () => {
    expect(
      classifyEntityQuality("Random Name", "Needs Vote", {
        entityType: "artist",
        profile: "",
        realName: "",
        hasLinks: false,
      }),
    ).toEqual({
      quality_status: "low_value",
      quality_reason: "artist_unlinked_low_info",
    });
  });

  it("keeps normal artists active", () => {
    expect(
      classifyEntityQuality("Aphex Twin", "Needs Vote", {
        entityType: "artist",
        profile: "UK electronic artist",
        realName: "Richard David James",
        hasLinks: true,
      }),
    ).toEqual({
      quality_status: "active",
      quality_reason: "default_active",
    });
  });
});

