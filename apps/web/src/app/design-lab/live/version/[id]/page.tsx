import Variant3LiveShell from "@/components/design-lab/Variant3LiveShell";
import { digFetch } from "@/lib/api";
import { isReleaseResponse, isMasterResponse, type ReleaseResponse, type MasterResponse } from "@/lib/types";
import { artistNames } from "@/lib/format";
import { firstYoutubeThumb } from "@/lib/media";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignLabVersionPage({ params }: Props) {
  const { id } = await params;

  const releaseRes = await digFetch<ReleaseResponse>(`/v1/releases/${id}`, { revalidate: 300 }).catch(() => null);
  const release = releaseRes && isReleaseResponse(releaseRes) ? releaseRes.release : null;

  if (!release) {
    return (
      <Variant3LiveShell
        sectionLabel="/ VERSION"
        title="Version not found"
        queryValue="Try another pressing id"
        pills={[{ label: "not found", active: true }]}
        columns={[
          { title: "TRACKS", items: [] },
          { title: "FORMATS", items: [] },
          { title: "ARTISTS", items: [] },
          { title: "NAV", items: [{ index: "001", title: "Back to search", subtitle: "Find version", href: "/design-lab/live/search", type: "label" }] },
        ]}
      />
    );
  }

  const masterRes = release.master_discogs_id
    ? await digFetch<MasterResponse>(`/v1/masters/${release.master_discogs_id}`, { revalidate: 300 }).catch(() => null)
    : null;
  const master = masterRes && isMasterResponse(masterRes) ? masterRes.master : null;

  const tracks = release.tracks || [];
  const media = release.videos || [];

  return (
    <Variant3LiveShell
      sectionLabel="/ VERSION"
      title={release.title}
      queryValue={`${artistNames(release.artists)}${release.release_year ? ` • ${release.release_year}` : ""}`}
      pills={[
        { label: `${tracks.length} tracks`, active: true, href: `/design-lab/live/version/${id}` },
        { label: `${release.formats.length} formats`, href: `/design-lab/live/version/${id}` },
        { label: release.country || "unknown country", href: `/design-lab/live/version/${id}` },
      ]}
      nowPlaying={{ title: tracks[0]?.title || release.title, artist: artistNames(release.artists) }}
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
          title: "FORMATS",
          items: release.formats.slice(0, 2).map((f, i) => ({
            index: String(i + 1).padStart(3, "0"),
            title: f.name,
            subtitle: f.descriptions.join(", ") || "Format",
            type: "release",
          })),
        },
        {
          title: "ARTISTS",
          items: release.artists.slice(0, 2).map((a, i) => ({
            index: String(i + 3).padStart(3, "0"),
            title: a.name,
            subtitle: a.role || "Artist",
            href: `/design-lab/live/artist/${a.discogs_id}`,
            type: "artist",
          })),
        },
        {
          title: "LINKS",
          items: [
            ...(master ? [{ index: "005", title: "Release page", subtitle: master.title, href: `/design-lab/live/release/${master.discogs_id}`, type: "release" }] : []),
            ...(media[0]
              ? [{ index: "006", title: media[0].title || "YouTube", subtitle: "Open media", href: media[0].url, thumb: firstYoutubeThumb([{ url: media[0].url }]) || undefined, type: "release" }]
              : []),
          ],
        },
      ]}
    />
  );
}
