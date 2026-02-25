/**
 * Golden fixture tests for the SAX parser.
 *
 * These parse real Discogs XML through parseXmlDump and assert the output
 * tree structure matches expectations. The Phase 1 parser builds full nested
 * JSON trees from the XML, preserving attributes, text, and child elements.
 */

import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { parseXmlDump, type RawEntity, type EntityType, type XmlNode } from "../parser.js";

const FIXTURES_DIR = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "../../../../packages/domain/src/__tests__/fixtures"
);

/** Helper to get a single child array from a node */
function children(node: XmlNode, key: string): XmlNode[] {
  const val = node[key];
  return Array.isArray(val) ? val : [];
}

/** Helper to get text from a node that's a simple text leaf */
function text(nodes: XmlNode[]): string {
  return nodes[0]?.["#text"] ?? "";
}

/**
 * Parse a fixture XML file and collect entities.
 * Wraps fixture in the dump's root element for well-formed XML.
 */
async function parseFixture(
  type: EntityType,
  filename: string
): Promise<RawEntity[]> {
  const raw = await readFile(path.join(FIXTURES_DIR, filename), "utf8");
  const xml = `<${type}>${raw}</${type}>`;
  const entities: RawEntity[] = [];

  const stream = Readable.from([Buffer.from(xml, "utf8")]);
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
  it("parses artist_1 (The Persuader) with nested structure", async () => {
    const entities = await parseFixture("artists", "artist_1.xml");
    expect(entities).toHaveLength(1);

    const { data } = entities[0];
    expect(entities[0].type).toBe("artists");

    // Direct child text fields
    expect(text(children(data, "id"))).toBe("1");
    expect(text(children(data, "name"))).toBe("The Persuader");
    expect(text(children(data, "realname"))).toBe("Jesper Dahlbäck");
    expect(text(children(data, "data_quality"))).toBe("Needs Vote");

    // Profile
    const profile = text(children(data, "profile"));
    expect(profile).toContain("Electronic artist");
    expect(profile).toContain("Stockholm");
  });

  it("captures nested aliases with id attributes", async () => {
    const [{ data }] = await parseFixture("artists", "artist_1.xml");

    const aliases = children(data, "aliases");
    expect(aliases).toHaveLength(1); // one <aliases> wrapper

    const aliasNames = children(aliases[0], "name");
    expect(aliasNames.length).toBeGreaterThan(0);

    // Each alias <name> has an id attribute
    const firstAlias = aliasNames[0];
    expect(firstAlias["@attr"]).toBeDefined();
    expect(firstAlias["@attr"]!["id"]).toBeDefined();
    expect(firstAlias["#text"]).toBeDefined();
  });

  it("captures name variations", async () => {
    const [{ data }] = await parseFixture("artists", "artist_1.xml");

    const nvs = children(data, "namevariations");
    expect(nvs).toHaveLength(1);

    const names = children(nvs[0], "name");
    expect(names.length).toBeGreaterThan(0);
    expect(names[0]["#text"]).toBeDefined();
  });

  it("captures URLs", async () => {
    const [{ data }] = await parseFixture("artists", "artist_1.xml");

    const urls = children(data, "urls");
    expect(urls).toHaveLength(1);

    const urlList = children(urls[0], "url");
    expect(urlList.length).toBeGreaterThan(0);
    expect(urlList[0]["#text"]).toContain("http");
  });

  it("handles unicode characters (Dahlbäck)", async () => {
    const [{ data }] = await parseFixture("artists", "artist_1.xml");
    expect(text(children(data, "realname"))).toBe("Jesper Dahlbäck");
  });

  it("handles artist with members (artist_2)", async () => {
    const [{ data }] = await parseFixture("artists", "artist_2.xml");
    expect(text(children(data, "name"))).toBe("Mr. James Barth & A.D.");

    const members = children(data, "members");
    expect(members).toHaveLength(1);

    const memberNames = children(members[0], "name");
    expect(memberNames.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe("parseXmlDump — labels", () => {
  it("parses label_1 (Planet E) with nested sublabels", async () => {
    const entities = await parseFixture("labels", "label_1.xml");
    expect(entities).toHaveLength(1);

    const { data } = entities[0];
    expect(text(children(data, "name"))).toBe("Planet E");
    expect(text(children(data, "id"))).toBe("1");
    expect(text(children(data, "data_quality"))).toBe("Needs Vote");
  });

  it("captures contactinfo with multiline text", async () => {
    const [{ data }] = await parseFixture("labels", "label_1.xml");
    const contactinfo = text(children(data, "contactinfo"));
    expect(contactinfo).toContain("Planet E Communications");
    expect(contactinfo).toContain("Detroit");
  });

  it("preserves profile markup references", async () => {
    const [{ data }] = await parseFixture("labels", "label_1.xml");
    const profile = text(children(data, "profile"));
    expect(profile).toContain("Carl Craig");
  });

  it("captures nested sublabels", async () => {
    const [{ data }] = await parseFixture("labels", "label_1.xml");
    const sublabels = children(data, "sublabels");
    expect(sublabels).toHaveLength(1);

    const labels = children(sublabels[0], "label");
    expect(labels.length).toBeGreaterThan(0);
    // Each sublabel has an id attribute
    expect(labels[0]["@attr"]!["id"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

describe("parseXmlDump — masters", () => {
  it("parses master_1 (Moments In Time) with attributes and children", async () => {
    const entities = await parseFixture("masters", "master_1.xml");
    expect(entities).toHaveLength(1);

    const { data } = entities[0];
    // Master has id as an attribute on the element
    expect(data["@attr"]!["id"]).toBe("113");

    expect(text(children(data, "title"))).toBe("Moments In Time");
    expect(text(children(data, "year"))).toBe("2002");
    expect(text(children(data, "main_release"))).toBe("116925");
    expect(text(children(data, "data_quality"))).toBe("Correct");
  });

  it("captures nested artists with join relations", async () => {
    const [{ data }] = await parseFixture("masters", "master_1.xml");

    const artists = children(data, "artists");
    expect(artists).toHaveLength(1);

    const artistList = children(artists[0], "artist");
    expect(artistList.length).toBeGreaterThan(0);

    const artist = artistList[0];
    expect(text(children(artist, "id"))).toBeDefined();
    expect(text(children(artist, "name"))).toBe("Vince Watson");
  });

  it("captures genres and styles", async () => {
    const [{ data }] = await parseFixture("masters", "master_1.xml");

    const genres = children(data, "genres");
    expect(genres).toHaveLength(1);
    expect(children(genres[0], "genre").length).toBeGreaterThan(0);

    const styles = children(data, "styles");
    expect(styles).toHaveLength(1);
    expect(children(styles[0], "style").length).toBeGreaterThan(0);
  });

  it("captures videos with src attribute", async () => {
    const [{ data }] = await parseFixture("masters", "master_1.xml");

    const videos = children(data, "videos");
    expect(videos).toHaveLength(1);

    const videoList = children(videos[0], "video");
    expect(videoList.length).toBeGreaterThan(0);

    const video = videoList[0];
    expect(video["@attr"]!["src"]).toContain("youtube.com");
    expect(video["@attr"]!["duration"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

describe("parseXmlDump — releases", () => {
  it("parses release_1 (Stockholm) with full nested structure", async () => {
    const entities = await parseFixture("releases", "release_1.xml");
    expect(entities).toHaveLength(1);

    const { data } = entities[0];
    expect(data["@attr"]!["id"]).toBe("1");

    expect(text(children(data, "title"))).toBe("Stockholm");
    expect(text(children(data, "country"))).toBe("Sweden");
    expect(text(children(data, "released"))).toBe("1999-03-00");
    expect(text(children(data, "data_quality"))).toBe("Needs Vote");
  });

  it("captures nested artists", async () => {
    const [{ data }] = await parseFixture("releases", "release_1.xml");

    const artists = children(data, "artists");
    expect(artists).toHaveLength(1);

    const artistList = children(artists[0], "artist");
    expect(artistList.length).toBeGreaterThan(0);

    const artist = artistList[0];
    expect(text(children(artist, "name"))).toBe("The Persuader");
  });

  it("captures tracklist with positions and durations", async () => {
    const [{ data }] = await parseFixture("releases", "release_1.xml");

    const tracklist = children(data, "tracklist");
    expect(tracklist).toHaveLength(1);

    const tracks = children(tracklist[0], "track");
    expect(tracks).toHaveLength(6); // Stockholm has 6 tracks

    const firstTrack = tracks[0];
    expect(text(children(firstTrack, "position"))).toBe("A");
    expect(text(children(firstTrack, "title"))).toBe("Östermalm");
    expect(text(children(firstTrack, "duration"))).toBe("4:45");
  });

  it("captures labels with attributes", async () => {
    const [{ data }] = await parseFixture("releases", "release_1.xml");

    const labels = children(data, "labels");
    expect(labels).toHaveLength(1);

    const labelList = children(labels[0], "label");
    expect(labelList.length).toBeGreaterThan(0);

    const label = labelList[0];
    expect(label["@attr"]!["name"]).toBe("Svek");
    expect(label["@attr"]!["catno"]).toBe("SK032");
  });

  it("captures formats with descriptions", async () => {
    const [{ data }] = await parseFixture("releases", "release_1.xml");

    const formats = children(data, "formats");
    expect(formats).toHaveLength(1);

    const formatList = children(formats[0], "format");
    expect(formatList.length).toBeGreaterThan(0);

    const format = formatList[0];
    expect(format["@attr"]!["name"]).toBe("Vinyl");
    expect(format["@attr"]!["qty"]).toBe("2");

    // Descriptions nested inside format
    const descs = children(format, "descriptions");
    expect(descs).toHaveLength(1);
    const descList = children(descs[0], "description");
    expect(descList.length).toBeGreaterThan(0);
  });

  it("captures identifiers with type/value/description", async () => {
    const [{ data }] = await parseFixture("releases", "release_1.xml");

    const identifiers = children(data, "identifiers");
    expect(identifiers).toHaveLength(1);

    const idList = children(identifiers[0], "identifier");
    expect(idList.length).toBeGreaterThan(0);

    const first = idList[0];
    expect(first["@attr"]!["type"]).toBe("Matrix / Runout");
    expect(first["@attr"]!["value"]).toBeDefined();
  });

  it("captures companies", async () => {
    const [{ data }] = await parseFixture("releases", "release_1.xml");

    const companies = children(data, "companies");
    expect(companies).toHaveLength(1);

    const companyList = children(companies[0], "company");
    expect(companyList.length).toBeGreaterThan(0);

    const company = companyList[0];
    expect(text(children(company, "id"))).toBeDefined();
    expect(text(children(company, "name"))).toBeDefined();
    expect(text(children(company, "entity_type_name"))).toBeDefined();
  });

  it("captures extraartists with roles", async () => {
    const [{ data }] = await parseFixture("releases", "release_1.xml");

    const extraartists = children(data, "extraartists");
    expect(extraartists).toHaveLength(1);

    const artistList = children(extraartists[0], "artist");
    expect(artistList.length).toBeGreaterThan(0);

    const artist = artistList[0];
    expect(text(children(artist, "role"))).toBeDefined();
  });

  it("captures multiline notes", async () => {
    const [{ data }] = await parseFixture("releases", "release_1.xml");
    const notes = text(children(data, "notes"));
    expect(notes).toContain("Stockholm districts");
    expect(notes).toContain("Globe studio");
  });

  it("captures master_id with is_main_release attribute", async () => {
    const [{ data }] = await parseFixture("releases", "release_1.xml");

    const masterIds = children(data, "master_id");
    expect(masterIds).toHaveLength(1);
    expect(masterIds[0]["#text"]).toBe("1660109");
    expect(masterIds[0]["@attr"]!["is_main_release"]).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Parser stats
// ---------------------------------------------------------------------------

describe("parseXmlDump — stats", () => {
  it("returns entity count", async () => {
    const raw = await readFile(
      path.join(FIXTURES_DIR, "artist_1.xml"),
      "utf8"
    );
    const xml = `<artists>${raw}</artists>`;
    const stream = Readable.from([Buffer.from(xml, "utf8")]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await parseXmlDump("artists", stream, () => {});
      expect(result.entityCount).toBe(1);
    } finally {
      logSpy.mockRestore();
    }
  });
});
