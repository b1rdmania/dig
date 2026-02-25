/**
 * Streaming SAX parser for Discogs XML dumps.
 *
 * Discogs dumps are multi-GB gzipped XML files. This parser uses saxes
 * (SAX-style event-driven) to process the byte stream incrementally —
 * constant memory regardless of file size. Each top-level entity is
 * fully built as a JSON tree before being emitted to the callback.
 *
 * The output is a nested JSON structure that preserves:
 * - Element attributes (as @attr object)
 * - Text content (as #text string)
 * - Nested child elements (as arrays of objects)
 * - Repeated same-name elements collected into arrays
 *
 * Usage:
 *   const stream = createReadStream(file).pipe(createGunzip());
 *   await parseXmlDump("artists", stream, async (entity) => {
 *     await db.insertInto("ingest.raw_entities").values({...}).execute();
 *   });
 */

import { SaxesParser } from "saxes";
import type { Readable } from "node:stream";

export type EntityType = "artists" | "labels" | "masters" | "releases";

/**
 * A parsed XML node. Children with the same tag name are grouped into arrays.
 * Attributes are stored under @attr. Text content under #text.
 */
export interface XmlNode {
  /** Element attributes (e.g. { id: "123", name: "Svek" }) */
  "@attr"?: Record<string, string>;
  /** Text content of the element */
  "#text"?: string;
  /** Child elements, keyed by tag name → array of nodes */
  [key: string]: XmlNode[] | Record<string, string> | string | undefined;
}

/**
 * A raw entity as it comes out of the parser — the full XML subtree
 * converted to a JSON structure.
 */
export interface RawEntity {
  type: EntityType;
  /** The complete entity as a nested JSON tree */
  data: XmlNode;
}

/**
 * Called once per top-level entity as it is fully parsed.
 */
export type EntityCallback = (entity: RawEntity) => Promise<void> | void;

/**
 * Top-level element name per entity type.
 */
const ROOT_ELEMENT: Record<EntityType, string> = {
  artists: "artist",
  labels: "label",
  masters: "master",
  releases: "release",
};

/** Internal node used during SAX tree building */
interface BuildNode {
  name: string;
  attributes: Record<string, string>;
  text: string;
  children: BuildNode[];
}

/**
 * Convert internal build node to output XmlNode format.
 * - Leaf nodes with no children: just text (or @attr + #text if attributes exist)
 * - Branch nodes: children grouped by tag name into arrays
 */
function buildNodeToXml(node: BuildNode): XmlNode {
  const hasAttrs = Object.keys(node.attributes).length > 0;
  const result: XmlNode = {};

  if (hasAttrs) {
    result["@attr"] = node.attributes;
  }

  const text = node.text.trim();
  if (text) {
    result["#text"] = text;
  }

  if (node.children.length === 0) {
    return result;
  }

  // Group children by tag name
  for (const child of node.children) {
    const key = child.name;
    const childNode = buildNodeToXml(child);
    const existing = result[key];
    if (Array.isArray(existing)) {
      existing.push(childNode);
    } else {
      result[key] = [childNode];
    }
  }

  return result;
}

/**
 * Parse a Discogs XML dump from a readable stream.
 *
 * @param type     - Which dump type is being parsed
 * @param stream   - Decompressed byte stream (caller handles gunzip)
 * @param onEntity - Callback invoked for each fully-parsed entity
 * @returns Promise that resolves when the stream is fully consumed
 */
export async function parseXmlDump(
  type: EntityType,
  stream: Readable,
  onEntity: EntityCallback
): Promise<{ entityCount: number }> {
  const rootElement = ROOT_ELEMENT[type];
  const parser = new SaxesParser();

  // Tree building state
  let insideEntity = false;
  const nodeStack: BuildNode[] = [];

  // Progress counters
  let entityCount = 0;
  let errorCount = 0;
  let lastLogAt = 0;
  const LOG_INTERVAL = 10_000;

  return new Promise((resolve, reject) => {
    parser.on("opentag", (node) => {
      if (!insideEntity) {
        if (node.name === rootElement) {
          insideEntity = true;
          // Push the root entity node onto the stack
          nodeStack.length = 0;
          nodeStack.push({
            name: node.name,
            attributes: Object.fromEntries(
              Object.entries(node.attributes).map(([k, v]) => [k, String(v)])
            ),
            text: "",
            children: [],
          });
        }
        return;
      }

      // Push a new child node
      nodeStack.push({
        name: node.name,
        attributes: Object.fromEntries(
          Object.entries(node.attributes).map(([k, v]) => [k, String(v)])
        ),
        text: "",
        children: [],
      });
    });

    parser.on("text", (text) => {
      if (!insideEntity || nodeStack.length === 0) return;
      // Append text to the current (top-of-stack) node
      nodeStack[nodeStack.length - 1].text += text;
    });

    parser.on("closetag", (tag) => {
      if (!insideEntity) return;

      if (tag.name === rootElement && nodeStack.length === 1) {
        // Closed the root entity element
        insideEntity = false;
        entityCount++;

        if (entityCount - lastLogAt >= LOG_INTERVAL) {
          console.log(`[ingest] parsed ${entityCount.toLocaleString()} ${type}`);
          lastLogAt = entityCount;
        }

        const rootNode = nodeStack[0];
        nodeStack.length = 0;

        try {
          const data = buildNodeToXml(rootNode);
          void onEntity({ type, data });
        } catch (err) {
          errorCount++;
          if (errorCount <= 10) {
            console.error(`[ingest] error converting entity #${entityCount}:`, err);
          }
        }
        return;
      }

      // Pop the current node and attach it as a child of its parent
      if (nodeStack.length > 1) {
        const completed = nodeStack.pop()!;
        nodeStack[nodeStack.length - 1].children.push(completed);
      }
    });

    // --- Stream plumbing ---

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
          `[ingest] done — total ${entityCount.toLocaleString()} ${type}` +
          (errorCount > 0 ? ` (${errorCount} errors)` : "")
        );
        resolve({ entityCount });
      } catch (err) {
        reject(err);
      }
    });

    stream.on("error", reject);
  });
}
