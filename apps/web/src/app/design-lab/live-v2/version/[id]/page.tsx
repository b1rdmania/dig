import VariantDigLiveV2Shell from "@/components/design-lab/VariantDigLiveV2Shell";
import { digFetch } from "@/lib/api";
import { artistNames } from "@/lib/format";
import { isMasterResponse, isReleaseResponse, type MasterResponse, type ReleaseResponse } from "@/lib/types";
import { topVideos } from "../../shared";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignLabLiveV2VersionPage({ params }: Props) {
  const { id } = await params;

  const releaseRes = await digFetch<ReleaseResponse>(`/v1/releases/${id}`, { revalidate: 300 }).catch(() => null);
  const release = releaseRes && isReleaseResponse(releaseRes) ? releaseRes.release : null;

  if (!release) {
    return (
      <VariantDigLiveV2Shell
        eyebrow="Design Lab / Version"
        title="Version not found"
        subtitle="No pressing for this ID in current batch."
        actions={[{ label: "Back to search", href: "/design-lab/live-v2/search", primary: true }]}
        primaryTitle="Navigation"
        primaryItems={[{ index: "01", title: "Search", subtitle: "Find another version", href: "/design-lab/live-v2/search" }]}
        secondaryTitle="Status"
        secondaryItems={[{ index: "S1", title: "Live v2", subtitle: "Version fetch failed for this ID" }]}
      />
    );
  }

  const masterRes = release.master_discogs_id
    ? await digFetch<MasterResponse>(`/v1/masters/${release.master_discogs_id}`, { revalidate: 300 }).catch(() => null)
    : null;
  const master = masterRes && isMasterResponse(masterRes) ? masterRes.master : null;

  const tracks = release.tracks || [];
  const videos = topVideos(release.videos || [], 6);
  const leadVideoThumb = videos[0]?.thumb || null;

  return (
    <VariantDigLiveV2Shell
      eyebrow="Design Lab / Version"
      title={release.title}
      subtitle={artistNames(release.artists)}
      queryValue={release.title}
      searchTarget="/design-lab/live-v2/search"
      coverImage={leadVideoThumb}
      facts={[
        { label: "Year", value: release.release_year ? String(release.release_year) : "Unknown" },
        { label: "Country", value: release.country || "Unknown" },
        { label: "Tracks", value: String(tracks.length) },
        { label: "Videos", value: String(videos.length) },
      ]}
      actions={[
        ...(master ? [{ label: "Parent release", href: `/design-lab/live-v2/release/${master.discogs_id}`, primary: true }] : []),
        { label: "Open Discogs", href: `https://www.discogs.com/release/${release.discogs_id}`, external: true },
      ]}
      primaryTitle="Tracklist"
      primaryItems={tracks.slice(0, 18).map((t, i) => ({
        index: t.position_raw || String(i + 1).padStart(2, "0"),
        title: t.title,
        subtitle: t.credits[0] ? `${t.credits[0].role}: ${t.credits[0].artist_name}` : "Track",
      }))}
      secondaryTitle="Formats"
      secondaryItems={release.formats.slice(0, 12).map((f, i) => ({
        index: String(i + 1).padStart(2, "0"),
        title: f.name,
        subtitle: f.descriptions.join(", ") || "Format",
      }))}
      sideTopTitle="Media (YouTube)"
      sideTopItems={videos.map((v) => ({
        title: v.title,
        subtitle: v.duration || "YouTube",
        href: v.url,
        external: true,
      }))}
      sideBottomTitle="Artists"
      sideBottomItems={release.artists.slice(0, 8).map((a) => ({
        title: a.name,
        subtitle: a.role || "Artist",
        href: `/design-lab/live-v2/artist/${a.discogs_id}`,
      }))}
      footerNote="Live v2 status: Version page is fully wired (pressing + parent release link + media). Media is promoted to top-right." 
    />
  );
}
