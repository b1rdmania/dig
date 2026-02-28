import { readFileSync } from "node:fs";
import { clampConfidence, emitNdjson, type AdapterRecord } from "./types.js";

interface Args {
  input: string;
  entity: "artist" | "label" | "release";
}

function parseArgs(argv: string[]): Args {
  const inputIndex = argv.indexOf("--input");
  const entityIndex = argv.indexOf("--entity");
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error("Missing --input <path>");
  }
  const entityRaw = (entityIndex !== -1 ? argv[entityIndex + 1] : "artist") as Args["entity"];
  if (!["artist", "label", "release"].includes(entityRaw)) {
    throw new Error("Invalid --entity (artist|label|release)");
  }
  return { input: argv[inputIndex + 1], entity: entityRaw };
}

function toRecords(payload: any, entity: Args["entity"]): AdapterRecord[] {
  const rows: any[] = Array.isArray(payload) ? payload : (payload?.items ?? []);
  return rows.flatMap((row) => {
    const sourceId = String(row.id ?? row.mbid ?? "");
    if (!sourceId) return [];
    const relations: any[] = Array.isArray(row.relations) ? row.relations : [];
    const relationRecords = relations.map((rel) => ({
      source: "musicbrainz" as const,
      source_id: String(rel.id ?? `${sourceId}:${rel.type ?? "relation"}`),
      source_entity_type: entity,
      target_entity_type: "external" as const,
      target_external_id: String(rel.target_credit ?? rel["target-id"] ?? ""),
      edge_type: String(rel.type ?? "related_to"),
      confidence: clampConfidence(rel.score ?? 0.85),
      match_method: "deterministic_metadata" as const,
      raw: rel,
    }));

    return [
      ...relationRecords,
      {
        source: "musicbrainz" as const,
        source_id: sourceId,
        source_entity_type: entity,
        context_type: "history" as const,
        content_json: {
          name: row.name ?? row.title ?? null,
          area: row.area?.name ?? null,
          disambiguation: row.disambiguation ?? null,
        },
        confidence: clampConfidence(row.score ?? 0.9),
        match_method: "exact_id" as const,
        raw: row,
      },
    ];
  });
}

function main(): void {
  const { input, entity } = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(readFileSync(input, "utf8"));
  const records = toRecords(payload, entity);
  emitNdjson(records);
}

main();

