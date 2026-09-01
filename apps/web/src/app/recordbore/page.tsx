import type { Metadata } from "next";
import { digFetch } from "@/lib/api";
import type { ListScenesResponse, ScenePlaylistResponse } from "@/lib/types";
import { RecordBoreClient } from "./RecordBoreClient";

export const metadata: Metadata = {
  title: "Record Bore.",
  description:
    "A record shop bore with 80,000 house and techno records behind the counter. 1985–2008. He has opinions.",
};

// The Bore speaks first, about a real record. Regenerated every 5 minutes so
// the opener rotates without costing an API call per visitor.
export const revalidate = 300;

// Rule 1 of the format: never introduces himself — he's mid-sentence when you
// walk in. Every template is grounded in a record pulled from the corpus.
const OPENER_TEMPLATES = [
  "Mind the boxes. Someone was in earlier asking for {artist} and couldn't name a single record — [{title}]({url}), {year}, since you're wondering. What are you after?",
  "That's not for sale, it's mine. If you want something decent off the shelf: {artist}, [{title}]({url}), {year}. Or tell me what you're actually after.",
  "Just had [{title}]({url}) on — {artist}, {year}. Nobody buys it because nobody asks. Anyway. What do you want?",
  "Don't lean on that rack. I've been refiling the {year}s all morning — {artist}'s [{title}]({url}) was in the wrong section, which tells you everything about the last customer. Go on then.",
  "You've just missed the good copy of [{title}]({url}) — {artist}, {year}. There's another one about if you know how to ask. So?",
  "Kettle's just gone on, so make it quick or make it interesting. Interesting looks like {artist}, [{title}]({url}), {year} — that sort of thing. Quick looks like the door.",
  "I know the sleeve's ringworn, it's {year}, what do you expect. [{title}]({url}), {artist} — priced for someone who knows what it is. Are you that someone or are you browsing?",
  "Phone's been going all day about records I haven't got. What I have got is [{title}]({url}) — {artist}, {year} — and no one's asked. Typical. What are you after?",
];

interface OpenerRecord {
  id: number;
  title: string;
  artist: string;
  year: number;
  video_id: string;
}

async function pickOpenerRecord(): Promise<OpenerRecord | null> {
  try {
    const { scenes } = await digFetch<ListScenesResponse>("/v1/scenes", { revalidate: 300 });
    if (scenes.length === 0) return null;
    const scene = scenes[Math.floor(Math.random() * scenes.length)];
    const { playlist } = await digFetch<ScenePlaylistResponse>(
      `/v1/scenes/${scene.slug}/playlist`,
      { revalidate: 300 },
    );
    // Full records only — a template with a hole in it breaks the bit.
    const pool = playlist.records.filter((r) => r.primary_artist_name && r.year);
    if (pool.length === 0) return null;
    const r = pool[Math.floor(Math.random() * pool.length)];
    return {
      id: r.master_discogs_id,
      title: r.title,
      artist: (r.primary_artist_name as string).replace(/\s+\(\d+\)$/, ""),
      year: r.year as number,
      video_id: r.video_id,
    };
  } catch {
    return null;
  }
}

export default async function RecordBorePage() {
  const record = await pickOpenerRecord();
  if (!record) {
    // Corpus unreachable — stay in voice, skip the record rather than fake one.
    return <RecordBoreClient opener="Racks are half-sorted, don't touch anything. What are you after?" />;
  }
  const template = OPENER_TEMPLATES[Math.floor(Math.random() * OPENER_TEMPLATES.length)];
  const opener = template
    .replaceAll("{artist}", record.artist)
    .replaceAll("{title}", record.title)
    .replaceAll("{year}", String(record.year))
    .replaceAll("{url}", `/master/${record.id}`);
  // The record goes on the counter as a playable card, same shape as a real
  // answer's media rail — dig link in the card meta, video behind the thumb.
  const media = [{
    discogs_id: record.id,
    title: record.title,
    artist: record.artist,
    youtube_url: `https://www.youtube.com/watch?v=${record.video_id}`,
  }];
  return <RecordBoreClient opener={opener} media={media} />;
}
