/**
 * Discogs XML dump ingest CLI.
 *
 * Usage:
 *   pnpm ingest artists  --file /path/to/discogs_artists.xml.gz
 *   pnpm ingest labels   --file /path/to/discogs_labels.xml.gz
 *   pnpm ingest masters  --file /path/to/discogs_masters.xml.gz
 *   pnpm ingest releases --file /path/to/discogs_releases.xml.gz
 */

type EntityType = "artists" | "labels" | "masters" | "releases";

const VALID_TYPES: EntityType[] = ["artists", "labels", "masters", "releases"];

function parseArgs(argv: string[]): { type: EntityType; file: string } {
  // argv[0] = node, argv[1] = script path, argv[2] = command, rest = flags
  const [, , command, ...rest] = argv;

  if (!VALID_TYPES.includes(command as EntityType)) {
    console.error(
      `Error: first argument must be one of: ${VALID_TYPES.join(", ")}`
    );
    console.error(`Got: ${JSON.stringify(command)}`);
    process.exit(1);
  }

  let file: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--file" && rest[i + 1]) {
      file = rest[i + 1];
      i++;
    }
  }

  if (!file) {
    console.error("Error: --file <path> is required");
    process.exit(1);
  }

  return { type: command as EntityType, file };
}

async function main() {
  const databaseUrl = process.env["DATABASE_URL"];

  if (!databaseUrl) {
    console.error("Error: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const { type, file } = parseArgs(process.argv);

  console.log(`Would parse ${type} from ${file}`);

  // TODO: Replace the placeholder above with the real ingest pipeline:
  //
  //   import { createReadStream } from "node:fs";
  //   import { createGunzip } from "node:zlib";
  //   import { parseXmlDump } from "./parser.js";
  //   import { createDb } from "@dig/db";
  //
  //   const db = createDb(databaseUrl);
  //   const stream = createReadStream(file).pipe(createGunzip());
  //
  //   await parseXmlDump(type, stream, async (entity) => {
  //     // insert into raw_entities table via @dig/db
  //   });
  //
  //   await db.destroy();

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
