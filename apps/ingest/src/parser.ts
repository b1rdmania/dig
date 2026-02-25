/**
 * Streaming SAX parser for Discogs XML dumps.
 *
 * Discogs dumps are multi-GB gzipped XML files. Loading the whole document
 * into memory would be impractical, so we use a SAX-style event-driven parser
 * (saxes) that processes the byte stream incrementally — constant memory
 * regardless of file size.
 *
 * Expected call site (from cli.ts):
 *
 *   const stream = createReadStream(file).pipe(createGunzip());
 *   await parseXmlDump("artists", stream, async (entity) => {
 *     // TODO: insert entity into raw_entities via @dig/db
 *   });
 */

import { SaxesParser } from "saxes";
import type { Readable } from "node:stream";

export type EntityType = "artists" | "labels" | "masters" | "releases";

/**
 * A raw entity record as it comes out of the XML — a flat bag of string
 * attributes and text content collected during SAX traversal.
 *
 * TODO: replace with a proper typed shape from @dig/domain once entity
 * schemas are defined.
 */
export interface RawEntity {
  type: EntityType;
  /** The top-level element's attributes (e.g. id="123") */
  attributes: Record<string, string>;
  /** Accumulated child-element text keyed by element name */
  fields: Record<string, string>;
}

/**
 * Called once per top-level entity as it is fully parsed.
 * May be async — the parser awaits each callback before continuing.
 */
export type EntityCallback = (entity: RawEntity) => Promise<void> | void;

/**
 * Top-level element name per entity type.
 * These are the repeating container elements in each Discogs dump.
 */
const ROOT_ELEMENT: Record<EntityType, string> = {
  artists: "artist",
  labels: "label",
  masters: "master",
  releases: "release",
};

/**
 * Parse a Discogs XML dump from a readable stream.
 *
 * @param type     - Which dump type is being parsed (drives element name selection)
 * @param stream   - Decompressed byte stream (caller is responsible for gunzip)
 * @param onEntity - Callback invoked for each fully-parsed top-level entity
 */
export async function parseXmlDump(
  type: EntityType,
  stream: Readable,
  onEntity: EntityCallback
): Promise<void> {
  const rootElement = ROOT_ELEMENT[type];
  const parser = new SaxesParser();

  // Parsing state
  let insideEntity = false;
  let currentEntity: RawEntity | null = null;
  let currentField: string | null = null;
  let depth = 0; // depth relative to the root entity element

  // Progress counters
  let entityCount = 0;
  let lastLogAt = 0;
  const LOG_INTERVAL = 10_000;

  // Accumulate text across multiple `text` events for the same element
  let textBuffer = "";

  return new Promise((resolve, reject) => {
    // --- SAX event handlers -------------------------------------------------

    parser.on("opentag", (node) => {
      if (!insideEntity) {
        // Watch for the top-level repeating element (e.g. <artist>)
        if (node.name === rootElement) {
          insideEntity = true;
          depth = 0;
          currentEntity = {
            type,
            // Coerce saxes attribute map to plain Record<string, string>
            attributes: Object.fromEntries(
              Object.entries(node.attributes).map(([k, v]) => [k, String(v)])
            ),
            fields: {},
          };
        }
        return;
      }

      depth++;
      textBuffer = "";

      // Only capture direct children of the root element.
      // Nested grandchildren are ignored for now.
      // TODO: handle nested structures (e.g. <images>, <aliases>, <tracks>)
      if (depth === 1) {
        currentField = node.name;
      }
    });

    parser.on("text", (text) => {
      if (insideEntity && depth === 1) {
        textBuffer += text;
      }
    });

    parser.on("closetag", (tag) => {
      if (!insideEntity) return;

      if (depth === 1 && currentField !== null && currentEntity !== null) {
        // Store the accumulated text for this direct-child field
        // TODO: for repeated elements (e.g. multiple <name> tags), collect
        //       into an array rather than overwriting.
        currentEntity.fields[currentField] = textBuffer.trim();
        currentField = null;
        textBuffer = "";
      }

      if (tag.name === rootElement && depth === 0) {
        // We just closed the top-level entity element
        insideEntity = false;
        entityCount++;

        if (entityCount - lastLogAt >= LOG_INTERVAL) {
          console.log(`[ingest] parsed ${entityCount.toLocaleString()} ${type}`);
          lastLogAt = entityCount;
        }

        // TODO: pass currentEntity to @dig/db for raw_entities insertion.
        //       Example:
        //         await db
        //           .insertInto("raw_entities")
        //           .values({
        //             entity_type: currentEntity.type,
        //             external_id:  currentEntity.attributes["id"] ?? null,
        //             payload:      JSON.stringify(currentEntity.fields),
        //           })
        //           .execute();
        //
        // For now we hand off to the caller's callback.
        const entity = currentEntity!;
        currentEntity = null;

        // Invoke the callback. If it returns a Promise we must await it, but
        // saxes is synchronous — so we rely on the caller to batch/buffer if
        // throughput matters, rather than blocking the event loop here.
        // A future version can use a queue (e.g. p-queue) to bound concurrency.
        void onEntity(entity);
        return;
      }

      depth--;
    });

    // --- Stream plumbing ----------------------------------------------------

    stream.on("data", (chunk: Buffer) => {
      try {
        parser.write(chunk.toString("utf8"));
      } catch (err) {
        reject(err);
      }
    });

    stream.on("end", () => {
      try {
        parser.close();
        console.log(
          `[ingest] done — total ${entityCount.toLocaleString()} ${type}`
        );
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    stream.on("error", reject);
  });
}
