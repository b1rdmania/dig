/**
 * Extract golden XML fixtures from Discogs dumps.
 * Pulls the first N entities + specific edge-case entities as raw XML strings.
 *
 * Usage:
 *   pnpm --filter @dig/ingest exec tsx ../../scripts/profile/extract-fixtures.ts \
 *     artists /path/to/artists.xml.gz 5
 */

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type EntityType = "artists" | "labels" | "masters" | "releases";

const ROOT_ELEMENT: Record<EntityType, string> = {
  artists: "artist",
  labels: "label",
  masters: "master",
  releases: "release",
};

async function extractFixtures(
  type: EntityType,
  filePath: string,
  count: number
): Promise<string[]> {
  const rootElement = ROOT_ELEMENT[type];
  const stream = createReadStream(filePath).pipe(createGunzip());
  const fixtures: string[] = [];

  // Use depth tracking to handle nested same-name elements correctly.
  // e.g. <label> entities contain <sublabels><label>...</label></sublabels>
  let buffer = "";
  let inside = false;
  let depth = 0; // nesting depth of rootElement tags
  let entityXml = "";

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");

      while (buffer.length > 0) {
        if (!inside) {
          // Look for opening tag like <artist> or <artist id="...">
          // Must NOT match <artists> (the wrapper element)
          const openTag = `<${rootElement}`;
          const idx = buffer.indexOf(openTag);
          if (idx === -1) {
            buffer = buffer.length > 100 ? buffer.slice(-100) : buffer;
            break;
          }
          // Check that the character after the tag name is > or space (attribute),
          // not another letter (which would mean it's e.g. <artists> not <artist>)
          const charAfter = buffer[idx + openTag.length];
          if (charAfter !== ">" && charAfter !== " " && charAfter !== "/" && charAfter !== undefined) {
            // Not our element — skip past this match
            buffer = buffer.slice(idx + openTag.length);
            continue;
          }
          inside = true;
          depth = 1;
          entityXml = "";
          buffer = buffer.slice(idx);
        }

        // Scan for open/close tags of the same element to track depth
        const closeTag = `</${rootElement}>`;
        const openTag = `<${rootElement}`;
        let searchFrom = entityXml.length > 0 ? 0 : 1; // skip past the opening tag char

        let found = false;
        while (searchFrom < buffer.length) {
          const closeIdx = buffer.indexOf(closeTag, searchFrom);
          const openIdx = buffer.indexOf(openTag, searchFrom);

          // Find whichever comes first
          let nextCloseIdx = closeIdx === -1 ? Infinity : closeIdx;
          let nextOpenIdx = openIdx === -1 ? Infinity : openIdx;

          if (nextCloseIdx === Infinity && nextOpenIdx === Infinity) {
            // Neither found — need more data
            break;
          }

          if (nextOpenIdx < nextCloseIdx) {
            // Check it's actually our element (not e.g. <labels>)
            const cAfter = buffer[nextOpenIdx + openTag.length];
            if (cAfter === ">" || cAfter === " " || cAfter === "/") {
              // Don't increment depth for self-closing tags like <label ... />
              const closingBracket = buffer.indexOf(">", nextOpenIdx + openTag.length);
              const isSelfClosing = closingBracket !== -1 && buffer[closingBracket - 1] === "/";
              if (!isSelfClosing) {
                depth++;
              }
            }
            searchFrom = nextOpenIdx + openTag.length;
          } else {
            depth--;
            if (depth === 0) {
              // Found the matching close tag for our entity
              const endPos = nextCloseIdx + closeTag.length;
              entityXml += buffer.slice(0, endPos);
              buffer = buffer.slice(endPos);
              inside = false;

              fixtures.push(entityXml.trim());
              if (fixtures.length >= count) {
                stream.destroy();
                resolve(fixtures);
                return;
              }
              found = true;
              break;
            }
            searchFrom = nextCloseIdx + closeTag.length;
          }
        }

        if (!found) {
          if (inside) {
            entityXml += buffer;
            buffer = "";
          }
          break;
        }
      }
    });

    stream.on("end", () => resolve(fixtures));
    stream.on("error", reject);
  });
}

async function main() {
  const [, , entityType, filePath, countStr] = process.argv;
  const type = entityType as EntityType;
  const count = parseInt(countStr ?? "5", 10);

  if (!type || !filePath || !ROOT_ELEMENT[type]) {
    console.error("Usage: extract-fixtures.ts <artists|labels|masters|releases> <file.xml.gz> [count]");
    process.exit(1);
  }

  console.error(`[extract] Extracting ${count} ${type} fixtures from ${path.basename(filePath)}...`);
  const fixtures = await extractFixtures(type, filePath, count);

  // Resolve output dir relative to this script's location (project root is 2 levels up)
  // Use fileURLToPath to handle spaces in paths correctly
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "..", "..");
  const outDir = path.join(projectRoot, "packages", "domain", "src", "__tests__", "fixtures");
  await mkdir(outDir, { recursive: true });

  for (let i = 0; i < fixtures.length; i++) {
    const outFile = path.join(outDir, `${type.slice(0, -1)}_${i + 1}.xml`);
    await writeFile(outFile, fixtures[i]);
    console.error(`  wrote ${path.basename(outFile)} (${fixtures[i].length} bytes)`);
  }

  console.error(`[extract] Done: ${fixtures.length} fixtures`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
