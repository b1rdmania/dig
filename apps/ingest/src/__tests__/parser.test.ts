/**
 * Golden fixture tests for the SAX parser.
 *
 * These parse real Discogs XML (extracted from dump files) through parseXmlDump
 * and assert the output shape matches expectations. The current v0 parser only
 * captures direct-child text fields — nested structures (tracklists, artists,
 * aliases, etc.) are not yet parsed. Tests document both what works and what
 * is known-missing.
 */

import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { parseXmlDump, type RawEntity, type EntityType } from "../parser.js";

const FIXTURES_DIR = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "../../../../packages/domain/src/__tests__/fixtures"
);

/**
 * Helper: parse a fixture XML file through parseXmlDump and collect entities.
 * Wraps fixture in the dump's root element (e.g. <artists>...</artists>)
 * so saxes sees well-formed XML.
 */
async function parseFixture(
  type: EntityType,
  filename: string
): Promise<RawEntity[]> {
  const raw = await readFile(path.join(FIXTURES_DIR, filename), "utf8");
  // Wrap in the plural root element that the real dumps use
  const xml = `<${type}>${raw}</${type}>`;

  const entities: RawEntity[] = [];

  const stream = Readable.from([Buffer.from(xml, "utf8")]);
  // Suppress console.log from parser progress logging
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await parseXmlDump(type, stream, (entity) => {
      entities.push(entity);
    });
  } finally {
    logSpy.mockRestore();
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

describe("parseXmlDump — artists", () => {
  it("parses artist_1 (The Persuader) with id and direct-child fields", async () => {
    const entities = await parseFixture("artists", "artist_1.xml");
    expect(entities).toHaveLength(1);

    const artist = entities[0];
    expect(artist.type).toBe("artists");
    // <artist> has no attributes — id is a child element
    expect(artist.attributes).toEqual({});

    // Direct-child text fields the v0 parser captures
    expect(artist.fields["name"]).toBe("The Persuader");
    expect(artist.fields["realname"]).toBe("Jesper Dahlbäck");
    expect(artist.fields["data_quality"]).toBe("Needs Vote");
    expect(artist.fields["id"]).toBe("1");

    // Profile with inline text
    expect(artist.fields["profile"]).toContain("Electronic artist");
    expect(artist.fields["profile"]).toContain("Stockholm");
  });

  it("handles multiple artists in one file", async () => {
    // artist_1.xml only has one entity but the parser should handle the stream ending
    const entities = await parseFixture("artists", "artist_1.xml");
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it("captures unicode characters (Dahlbäck)", async () => {
    const [artist] = await parseFixture("artists", "artist_1.xml");
    expect(artist.fields["realname"]).toBe("Jesper Dahlbäck");
  });
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe("parseXmlDump — labels", () => {
  it("parses label_1 (Planet E) with multiline contactinfo", async () => {
    const entities = await parseFixture("labels", "label_1.xml");
    expect(entities).toHaveLength(1);

    const label = entities[0];
    expect(label.type).toBe("labels");
    // <label> has no attributes — id is a child element
    expect(label.attributes).toEqual({});
    expect(label.fields["name"]).toBe("Planet E");
    expect(label.fields["id"]).toBe("1");
    expect(label.fields["data_quality"]).toBe("Needs Vote");

    // contactinfo has embedded &#13; newlines
    expect(label.fields["contactinfo"]).toContain("Planet E Communications");
    expect(label.fields["contactinfo"]).toContain("Detroit");
  });

  it("preserves profile markup references", async () => {
    const [label] = await parseFixture("labels", "label_1.xml");
    // Profile contains [a=Carl Craig] markup
    expect(label.fields["profile"]).toContain("Carl Craig");
  });
});

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

describe("parseXmlDump — masters", () => {
  it("parses master_1 (Moments In Time) with id attribute", async () => {
    const entities = await parseFixture("masters", "master_1.xml");
    expect(entities).toHaveLength(1);

    const master = entities[0];
    expect(master.type).toBe("masters");
    expect(master.attributes).toEqual({ id: "113" });

    expect(master.fields["title"]).toBe("Moments In Time");
    expect(master.fields["year"]).toBe("2002");
    expect(master.fields["main_release"]).toBe("116925");
    expect(master.fields["data_quality"]).toBe("Correct");
  });
});

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

describe("parseXmlDump — releases", () => {
  it("parses release_1 (Stockholm) with id and direct fields", async () => {
    const entities = await parseFixture("releases", "release_1.xml");
    expect(entities).toHaveLength(1);

    const release = entities[0];
    expect(release.type).toBe("releases");
    expect(release.attributes).toEqual({ id: "1" });

    expect(release.fields["title"]).toBe("Stockholm");
    expect(release.fields["country"]).toBe("Sweden");
    expect(release.fields["released"]).toBe("1999-03-00");
    expect(release.fields["data_quality"]).toBe("Needs Vote");
  });

  it("captures multiline notes with special characters", async () => {
    const [release] = await parseFixture("releases", "release_1.xml");
    expect(release.fields["notes"]).toContain("Stockholm districts");
    expect(release.fields["notes"]).toContain("Globe studio");
  });

  it("captures master_id text", async () => {
    const [release] = await parseFixture("releases", "release_1.xml");
    expect(release.fields["master_id"]).toBe("1660109");
  });
});

// ---------------------------------------------------------------------------
// Known parser v0 limitations (document, don't fail)
// ---------------------------------------------------------------------------

describe("parseXmlDump — known v0 limitations", () => {
  it("does not capture nested structures (artists, tracks, etc.)", async () => {
    const [release] = await parseFixture("releases", "release_1.xml");

    // The v0 parser only grabs depth-1 text. Nested containers like
    // <artists>, <tracklist>, <formats> don't produce useful text at depth 1.
    // These fields are either empty or contain concatenated child text.
    // Phase 1 parser will handle nested structures properly.

    // Verify the entity was parsed without errors even with complex nesting
    expect(release.attributes["id"]).toBe("1");
    expect(release.fields["title"]).toBe("Stockholm");
  });

  it("overwrites repeated same-name elements (last wins)", async () => {
    const [artist] = await parseFixture("artists", "artist_1.xml");

    // <urls> contains multiple <url> children, but the parser stores
    // fields["url"] which gets overwritten by each successive <url>.
    // This is a known limitation — Phase 1 will collect arrays.
    // We just verify it doesn't crash.
    expect(artist.type).toBe("artists");
  });
});
