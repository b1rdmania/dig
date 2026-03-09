import Variant3LiveShell from "@/components/design-lab/Variant3LiveShell";
import { digFetch } from "@/lib/api";
import {
  isMasterResponse,
  isTraversalResponse,
  isReleaseResponse,
  type MasterResponse,
  type TraversalResponse,
  type ReleaseResponse,
} from "@/lib/types";
import { artistNames } from "@/lib/format";
import { firstYoutubeThumb } from "@/lib/media";
import { hrefForTraversalLink } from "../../shared";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignLabReleasePage({ params }: Props) {
  const { id } = await params;

  const masterRes = await digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 }).catch(() => null);
  const master = masterRes && isMasterResponse(masterRes) ? masterRes.master : null;

  if (!master) {
    return (
      <Variant3LiveShell
        sectionLabel="/ RELEASE"
        title="Release not found"
        queryValue="Try another master id"
        pills={[{ label: "not found", active: true }]}
        columns={[
          { title: "TRACKS", items: [] },
          { title: "RELEASES", items: [] },
          { title: "ARTISTS", items: [] },
          { title: "NAV", items: [{ index: "001", title: "Back to search", subtitle: "Find release", href: "/design-lab/live/search", type: "label" }] },
        ]}
      />
    );
  }

  const [versionsRes, mainReleaseRes] = await Promise.all([
    digFetch<TraversalResponse>(`/v1/masters/${id}/releases?limit=30`, { revalidate: 300 }).catch(() => null),
    master.main_release_discogs_id
      ? digFetch<ReleaseResponse>(`/v1/releases/${master.main_release_discogs_id}`, { revalidate: 300 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const versions = versionsRes && isTraversalResponse(versionsRes) ? versionsRes.links : [];
  const mainRelease = mainReleaseRes && isReleaseResponse(mainReleaseRes) ? mainReleaseRes.release : null;
  const tracks = mainRelease?.tracks || [];
  const videos = mainRelease?.videos || master.videos || [];

  return (
    <Variant3LiveShell
      sectionLabel="/ RELEASE"
      title={master.title}
      queryValue={`${artistNames(master.artists)}${master.year ? ` • ${master.year}` : ""}`}
      pills={[
        { label: `${tracks.length} tracks`, active: true },
        { label: `${versions.length} versions` },
        { label: `${videos.length} videos` },
      ]}
      nowPlaying={{ title: tracks[0]?.title || master.title, artist: artistNames(master.artists) }}
      columns={[
        {
          title: "TRACKS",
          items: tracks.slice(0, 8).map((t, i) => ({
            index: t.position_raw || String(i + 1).padStart(2, "0"),
            title: t.title,
            subtitle: t.credits[0] ? `${t.credits[0].role}: ${t.credits[0].artist_name}` : "Track",
            type: "release",
          })),
        },
        {
          title: "VERSIONS",
          items: versions.slice(0, 2).map((v, i) => ({
            index: String(i + 1).padStart(3, "0"),
            title: v.title || `Version ${v.discogs_id}`,
            subtitle: `${v.country || "—"}${v.year ? ` • ${v.year}` : ""}`,
            href: hrefForTraversalLink(v),
            type: "release",
          })),
        },
        {
          title: "ARTISTS",
          items: master.artists.slice(0, 2).map((a, i) => ({
            index: String(i + 3).padStart(3, "0"),
            title: a.name,
            subtitle: "Artist",
            href: `/design-lab/live/artist/${a.discogs_id}`,
            type: "artist",
          })),
        },
        {
          title: "MEDIA",
          items: videos.slice(0, 2).map((v, i) => ({
            index: String(i + 5).padStart(3, "0"),
            title: v.title || "YouTube video",
            subtitle: "Open media",
            href: v.url,
            thumb: v.url ? firstYoutubeThumb([{ url: v.url }]) || undefined : undefined,
            type: "release",
          })),
        },
      ]}
    />
  );
}
