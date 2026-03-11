import VariantDigLiveV2Shell from "@/components/design-lab/VariantDigLiveV2Shell";
import { digFetch } from "@/lib/api";
import { artistNames } from "@/lib/format";
import {
  isMasterResponse,
  isReleaseResponse,
  isTraversalResponse,
  type MasterResponse,
  type ReleaseResponse,
  type TraversalResponse,
} from "@/lib/types";
import { hrefForTraversalLink, topVideos } from "../../shared";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignLabLiveV2ReleasePage({ params }: Props) {
  const { id } = await params;

  const masterRes = await digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 }).catch(() => null);
  const master = masterRes && isMasterResponse(masterRes) ? masterRes.master : null;

  if (!master) {
    return (
      <VariantDigLiveV2Shell
        eyebrow="Design Lab / Release"
        title="Release not found"
        subtitle="No master for this ID in current batch."
        actions={[{ label: "Back to search", href: "/design-lab/live-v2/search", primary: true }]}
        primaryTitle="Navigation"
        primaryItems={[{ index: "01", title: "Search", subtitle: "Find another release", href: "/design-lab/live-v2/search" }]}
        secondaryTitle="Status"
        secondaryItems={[{ index: "S1", title: "Live v2", subtitle: "Master fetch failed for this ID" }]}
      />
    );
  }

  const [versionsRes, mainReleaseRes] = await Promise.all([
    digFetch<TraversalResponse>(`/v1/masters/${id}/releases?limit=120`, { revalidate: 300 }).catch(() => null),
    master.main_release_discogs_id
      ? digFetch<ReleaseResponse>(`/v1/releases/${master.main_release_discogs_id}`, { revalidate: 300 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const versions = versionsRes && isTraversalResponse(versionsRes) ? versionsRes.links : [];
  const versionsTotal = versionsRes && isTraversalResponse(versionsRes) ? versionsRes.pagination.total_estimate : null;
  const mainRelease = mainReleaseRes && isReleaseResponse(mainReleaseRes) ? mainReleaseRes.release : null;
  const tracks = mainRelease?.tracks || [];
  const videos = topVideos(mainRelease?.videos || master.videos || [], 6);
  const leadVideoThumb = videos[0]?.thumb || null;

  return (
    <VariantDigLiveV2Shell
      eyebrow="Design Lab / Release"
      title={master.title}
      subtitle={artistNames(master.artists)}
      queryValue={master.title}
      searchTarget="/design-lab/live-v2/search"
      coverImage={leadVideoThumb}
      facts={[
        { label: "Year", value: master.year ? String(master.year) : "Unknown" },
        { label: "Tracks", value: String(tracks.length) },
        { label: "Versions", value: versionsTotal ? `${versions.length}/${versionsTotal}` : String(versions.length) },
        { label: "Videos", value: String(videos.length) },
      ]}
      actions={[
        ...(master.main_release_discogs_id
          ? [{ label: "Main pressing", href: `/design-lab/live-v2/version/${master.main_release_discogs_id}`, primary: true }]
          : []),
        { label: "Open Discogs", href: `https://www.discogs.com/master/${master.discogs_id}`, external: true },
      ]}
      primaryTitle="Tracklist"
      primaryItems={tracks.slice(0, 18).map((t, i) => ({
        index: t.position_raw || String(i + 1).padStart(2, "0"),
        title: t.title,
        subtitle: t.credits[0] ? `${t.credits[0].role}: ${t.credits[0].artist_name}` : "Track",
      }))}
      secondaryTitle="Pressings"
      secondaryItems={versions.slice(0, 14).map((v, i) => ({
        index: String(i + 1).padStart(2, "0"),
        title: v.title || `Version ${v.discogs_id}`,
        subtitle: `${v.country || "—"}${v.year ? ` • ${v.year}` : ""}`,
        href: hrefForTraversalLink(v),
      }))}
      sideTopTitle="Media (YouTube)"
      sideTopItems={videos.map((v) => ({
        title: v.title,
        subtitle: v.duration || "YouTube",
        href: v.url,
        external: true,
      }))}
      sideBottomTitle="Artists"
      sideBottomItems={master.artists.slice(0, 8).map((a) => ({
        title: a.name,
        subtitle: "Artist",
        href: `/design-lab/live-v2/artist/${a.discogs_id}`,
      }))}
      mediaVideos={videos}
      footerNote="Live v2 status: Release page is fully wired (master + main release + versions). YouTube block is promoted to top-right and hero media." 
    />
  );
}
