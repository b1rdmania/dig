import VariantDigLiveV2Shell from "@/components/design-lab/VariantDigLiveV2Shell";
import { digFetch } from "@/lib/api";
import {
  isArtistCreditsResponse,
  isArtistResponse,
  isTraversalResponse,
  type ArtistCreditsResponse,
  type ArtistResponse,
  type TraversalResponse,
} from "@/lib/types";
import { hrefForTraversalLink } from "../../shared";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const RELEASE_TYPES = ["all", "album", "single_ep", "compilation", "other"] as const;

type ReleaseType = (typeof RELEASE_TYPES)[number];

function readReleaseType(value: string | string[] | undefined): ReleaseType {
  if (typeof value !== "string") return "all";
  return (RELEASE_TYPES as readonly string[]).includes(value) ? (value as ReleaseType) : "all";
}

export default async function DesignLabLiveV2ArtistPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const releaseType = readReleaseType(sp.release_type);

  const [artistRes, releasesRes, creditsRes] = await Promise.all([
    digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 }).catch(() => null),
    digFetch<TraversalResponse>(
      `/v1/artists/${id}/catalog_releases?limit=120&sort=newest${releaseType !== "all" ? `&release_type=${releaseType}` : ""}`,
      { revalidate: 300 },
    ).catch(() => null),
    digFetch<ArtistCreditsResponse>(`/v1/artists/${id}/credits?limit=24`, { revalidate: 300 }).catch(() => null),
  ]);

  const artist = artistRes && isArtistResponse(artistRes) ? artistRes.artist : null;
  const releases = releasesRes && isTraversalResponse(releasesRes) ? releasesRes.links : [];
  const releaseTotal = releasesRes && isTraversalResponse(releasesRes) ? releasesRes.pagination.total_estimate : null;
  const credits = creditsRes && isArtistCreditsResponse(creditsRes) ? creditsRes.links : [];

  if (!artist) {
    return (
      <VariantDigLiveV2Shell
        eyebrow="Design Lab / Artist"
        title="Artist not found"
        subtitle="No matching entity for this ID in current batch."
        actions={[{ label: "Back to search", href: "/design-lab/live-v2/search", primary: true }]}
        primaryTitle="Navigation"
        primaryItems={[{ index: "01", title: "Search", subtitle: "Find another artist", href: "/design-lab/live-v2/search" }]}
        secondaryTitle="Status"
        secondaryItems={[{ index: "S1", title: "Live v2", subtitle: "Entity fetch failed for this ID" }]}
        sideTopTitle="Try"
        sideTopItems={[{ title: "Kasra V", href: "/design-lab/live-v2/artist/4506398" }, { title: "Larry Heard", href: "/design-lab/live-v2/artist/148" }]}
      />
    );
  }

  const profile = artist.profile?.trim() || "No profile text available.";

  return (
    <VariantDigLiveV2Shell
      eyebrow="Design Lab / Artist"
      title={artist.name}
      subtitle={artist.real_name ? `Real name: ${artist.real_name}` : "Artist"}
      queryValue={artist.name}
      searchTarget="/design-lab/live-v2/search"
      facts={[
        { label: "Releases", value: releaseTotal ? `${releases.length}/${releaseTotal}` : String(releases.length) },
        { label: "Credits", value: String(credits.length) },
        { label: "Aliases", value: String(artist.aliases.length) },
      ]}
      actions={[
        { label: "All", href: `/design-lab/live-v2/artist/${id}`, primary: releaseType === "all" },
        { label: "Albums", href: `/design-lab/live-v2/artist/${id}?release_type=album`, primary: releaseType === "album" },
        { label: "Singles", href: `/design-lab/live-v2/artist/${id}?release_type=single_ep`, primary: releaseType === "single_ep" },
        { label: "Compilations", href: `/design-lab/live-v2/artist/${id}?release_type=compilation`, primary: releaseType === "compilation" },
        { label: "Open Discogs", href: `https://www.discogs.com/artist/${artist.discogs_id}`, external: true },
      ]}
      primaryTitle="Releases"
      primaryItems={releases.slice(0, 16).map((r, i) => ({
        index: String(i + 1).padStart(2, "0"),
        title: r.title || `Release ${r.discogs_id}`,
        subtitle: `${r.release_type_label || r.type}${r.year ? ` • ${r.year}` : ""}${r.country ? ` • ${r.country}` : ""}`,
        href: hrefForTraversalLink(r),
      }))}
      secondaryTitle="Credits"
      secondaryItems={credits.slice(0, 12).map((c, i) => ({
        index: String(i + 1).padStart(2, "0"),
        title: c.title || `Release ${c.release_discogs_id}`,
        subtitle: `${c.roles.slice(0, 2).join(", ") || "Credit"}${c.year ? ` • ${c.year}` : ""}`,
        href: `/design-lab/live-v2/version/${c.release_discogs_id}`,
      }))}
      sideTopTitle="Bio"
      sideTopItems={[{ title: profile.slice(0, 220) }]}
      sideBottomTitle="Aliases & Groups"
      sideBottomItems={[
        ...artist.aliases.slice(0, 5).map((a) => ({ title: a.name, subtitle: "Alias", href: a.discogs_id ? `/design-lab/live-v2/artist/${a.discogs_id}` : undefined })),
        ...artist.groups.slice(0, 5).map((g) => ({ title: g.name, subtitle: "Group", href: g.discogs_id ? `/design-lab/live-v2/artist/${g.discogs_id}` : undefined })),
      ]}
      footerNote="Live v2 status: Artist page is fully wired (artist + catalog releases + credits)."
    />
  );
}
