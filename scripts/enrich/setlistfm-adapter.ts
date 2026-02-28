import { readFileSync } from "node:fs";
import { clampConfidence, emitNdjson, type AdapterRecord } from "./types.js";

interface Args {
  input: string;
}

function parseArgs(argv: string[]): Args {
  const inputIndex = argv.indexOf("--input");
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error("Missing --input <path>");
  }
  return { input: argv[inputIndex + 1] };
}

function toRecords(payload: any): AdapterRecord[] {
  const setlists: any[] = Array.isArray(payload?.setlist)
    ? payload.setlist
    : Array.isArray(payload)
      ? payload
      : [];

  return setlists.flatMap((setlist) => {
    const setlistId = String(setlist.id ?? "");
    const artistId = String(setlist.artist?.mbid ?? setlist.artist?.["@mbid"] ?? "");
    if (!setlistId) return [];

    const location = {
      venue: setlist.venue?.name ?? null,
      city: setlist.venue?.city?.name ?? null,
      country: setlist.venue?.city?.country?.name ?? null,
      eventDate: setlist.eventDate ?? null,
    };

    const records: AdapterRecord[] = [
      {
        source: "setlistfm",
        source_id: setlistId,
        source_entity_type: "artist",
        target_entity_type: "external",
        target_external_id: artistId || undefined,
        edge_type: "performed_at",
        confidence: clampConfidence(0.7),
        match_method: artistId ? "deterministic_metadata" : "heuristic",
        raw: {
          id: setlist.id,
          artist: setlist.artist,
          venue: setlist.venue,
          eventDate: setlist.eventDate,
        },
      },
      {
        source: "setlistfm",
        source_id: `${setlistId}:timeline`,
        source_entity_type: "artist",
        context_type: "timeline_note",
        content_json: location,
        confidence: clampConfidence(0.7),
        match_method: "deterministic_metadata",
      },
    ];

    return records;
  });
}

function main(): void {
  const { input } = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(readFileSync(input, "utf8"));
  const records = toRecords(payload);
  emitNdjson(records);
}

main();

