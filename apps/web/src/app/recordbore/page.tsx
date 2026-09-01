import type { Metadata } from "next";
import { digFetch } from "@/lib/api";
import type { ListScenesResponse, ScenePlaylistResponse } from "@/lib/types";
import { RecordBoreClient } from "./RecordBoreClient";

export const metadata: Metadata = {
  title: "Record Bore.",
  description:
    "Ask me anything. I’ll answer something better. House and techno, 1985–2008, and opinions to match.",
};

// The strip and opener regenerate every 5 minutes so he's always mid-record
// without costing an API call per visitor.
export const revalidate = 300;

// The now-playing strip carries the record (whitepaper §7 P3); the quip is
// the tail of the strip line. Grounded: record comes from the corpus.
const STRIP_QUIPS = [
  "nobody buys it because nobody asks",
  "the good copy went on Tuesday",
  "wasted on the lot of you",
  "filed wrong for a decade, found it this morning",
  "louder than it needs to be, exactly right",
  "don’t ask what it’s worth, ask why it matters",
  "better than whatever you came in for",
  "shop copy — not for sale, obviously",
];

// Rule 1 of the constitution: he never introduces himself — the page opens on
// a centred quote, mid-conversation. Pure voice; the record lives in the strip.
const OPENER_QUOTES = [
  "Anyway. What do you want? And don’t say Daft Punk — the answer’s Roulé and we both know it.",
  "Mind the boxes. Browsing is fine, buying is better, asking is best.",
  "Don’t lean on that rack. Ask me something worth dropping the needle for.",
  "You’ve got the look of someone about to say ‘deep house’. Be more specific.",
  "Kettle’s just gone on. Make it quick or make it interesting.",
  "The good stuff isn’t in the window. It never is. Go on then.",
  "I was in the middle of refiling the 12-inches, so this had better be good.",
  "If you heard it on an advert, the door’s behind you. Otherwise — speak.",
];

interface StripRecord {
  id: number;
  title: string;
  artist: string;
  year: number;
}

async function pickStripRecord(): Promise<StripRecord | null> {
  try {
    const { scenes } = await digFetch<ListScenesResponse>("/v1/scenes", { revalidate: 300 });
    if (scenes.length === 0) return null;
    const scene = scenes[Math.floor(Math.random() * scenes.length)];
    const { playlist } = await digFetch<ScenePlaylistResponse>(
      `/v1/scenes/${scene.slug}/playlist`,
      { revalidate: 300 },
    );
    const pool = playlist.records.filter((r) => r.primary_artist_name && r.year);
    if (pool.length === 0) return null;
    const r = pool[Math.floor(Math.random() * pool.length)];
    return {
      id: r.master_discogs_id,
      title: r.title,
      artist: (r.primary_artist_name as string).replace(/\s+\(\d+\)$/, ""),
      year: r.year as number,
    };
  } catch {
    return null;
  }
}

export default async function RecordBorePage() {
  const record = await pickStripRecord();
  const quip = STRIP_QUIPS[Math.floor(Math.random() * STRIP_QUIPS.length)];
  // Corpus unreachable — strip stays in voice without inventing a record.
  const strip = record
    ? `Just had on — ${record.artist} · ${record.title} · ${record.year} · ${quip}`
    : "Just had something on — you missed it";
  const opener = OPENER_QUOTES[Math.floor(Math.random() * OPENER_QUOTES.length)];
  return <RecordBoreClient strip={strip} opener={opener} />;
}
