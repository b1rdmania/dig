import { readFileSync } from "node:fs";
import { clampConfidence, emitNdjson, type AdapterRecord } from "./types.js";

interface Args {
  input: string;
  entity: "artist" | "label";
}

function parseArgs(argv: string[]): Args {
  const inputIndex = argv.indexOf("--input");
  const entityIndex = argv.indexOf("--entity");
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error("Missing --input <path>");
  }
  const entityRaw = (entityIndex !== -1 ? argv[entityIndex + 1] : "artist") as Args["entity"];
  if (!["artist", "label"].includes(entityRaw)) {
    throw new Error("Invalid --entity (artist|label)");
  }
  return { input: argv[inputIndex + 1], entity: entityRaw };
}

function getLabel(entity: any): string | null {
  return entity?.labels?.en?.value ?? entity?.labels?.["en-gb"]?.value ?? null;
}

function getDescription(entity: any): string | null {
  return entity?.descriptions?.en?.value ?? entity?.descriptions?.["en-gb"]?.value ?? null;
}

function toRecords(payload: any, entityType: Args["entity"]): AdapterRecord[] {
  const entities = payload?.entities ? Object.values(payload.entities) : [];
  return (entities as any[]).flatMap((entity) => {
    const qid = String(entity.id ?? "");
    if (!qid.startsWith("Q")) return [];

    const records: AdapterRecord[] = [
      {
        source: "wikidata",
        source_id: qid,
        source_entity_type: entityType,
        context_type: "bio",
        content_json: {
          label: getLabel(entity),
          description: getDescription(entity),
        },
        confidence: clampConfidence(0.8),
        match_method: "deterministic_metadata",
        raw: {
          id: entity.id,
          labels: entity.labels,
          descriptions: entity.descriptions,
        },
      },
    ];

    const claims = entity.claims ?? {};
    if (claims.P19 || claims.P20 || claims.P740) {
      records.push({
        source: "wikidata",
        source_id: `${qid}:location`,
        source_entity_type: entityType,
        context_type: "location",
        content_json: {
          place_of_birth: claims.P19 ?? null,
          place_of_death: claims.P20 ?? null,
          location_of_formation: claims.P740 ?? null,
        },
        confidence: clampConfidence(0.75),
        match_method: "heuristic",
      });
    }

    return records;
  });
}

function main(): void {
  const { input, entity } = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(readFileSync(input, "utf8"));
  const records = toRecords(payload, entity);
  emitNdjson(records);
}

main();

