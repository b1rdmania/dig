import Variant3LiveShell from "@/components/design-lab/Variant3LiveShell";
import { digFetch } from "@/lib/api";
import {
  isArtistResponse,
  isTraversalResponse,
  isArtistCreditsResponse,
  type ArtistResponse,
  type TraversalResponse,
  type ArtistCreditsResponse,
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

export default async function DesignLabArtistPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const releaseType = readReleaseType(sp.release_type);

  const [artistRes, releasesRes, creditsRes] = await Promise.all([
    digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 }).catch(() => null),
    digFetch<TraversalResponse>(`/v1/artists/${id}/catalog_releases?limit=30&sort=newest${releaseType !== "all" ? `&release_type=${releaseType}` : ""}`, { revalidate: 300 }).catch(() => null),
    digFetch<ArtistCreditsResponse>(`/v1/artists/${id}/credits?limit=20`, { revalidate: 300 }).catch(() => null),
  ]);

  const artist = artistRes && isArtistResponse(artistRes) ? artistRes.artist : null;
  const releases = releasesRes && isTraversalResponse(releasesRes) ? releasesRes.links : [];
  const credits = creditsRes && isArtistCreditsResponse(creditsRes) ? creditsRes.links : [];

  if (!artist) {
    return (
      <Variant3LiveShell
        sectionLabel="/ ARTIST"
        title="Artist not found"
        queryValue="No matching artist"
        pills={[{ label: "not found", active: true }]}
        columns={[
          { title: "RESULTS", items: [] },
          { title: "RELEASES", items: [] },
          { title: "CREDITS", items: [] },
          { title: "NAV", items: [{ index: "001", title: "Back to search", subtitle: "Find another artist", href: "/design-lab/live/search", type: "label" }] },
        ]}
      />
    );
  }

  return (
    <Variant3LiveShell
      sectionLabel="/ ARTIST"
      title={artist.name}
      queryValue={artist.profile?.slice(0, 90) || `Artist #${artist.discogs_id}`}
      pills={[
        { label: `${releases.length} releases`, active: true },
        { label: `${credits.length} credits` },
        { label: releaseType },
      ]}
      nowPlaying={{ title: artist.name, artist: artist.real_name || "Artist" }}
      columns={[
        {
          title: "RELEASES",
          items: releases.slice(0, 8).map((r, i) => ({
            index: String(i + 1).padStart(2, "0"),
            title: r.title || `Release ${r.discogs_id}`,
            subtitle: `${r.release_type_label || r.type}${r.year ? ` • ${r.year}` : ""}`,
            href: hrefForTraversalLink(r),
            type: "release",
          })),
        },
        {
          title: "MAIN",
          items: releases.slice(0, 2).map((r, i) => ({
            index: String(i + 1).padStart(3, "0"),
            title: r.title || `Release ${r.discogs_id}`,
            subtitle: r.country || "Release",
            href: hrefForTraversalLink(r),
            type: "release",
          })),
        },
        {
          title: "ALIASES",
          items: (artist.aliases.length ? artist.aliases : artist.groups).slice(0, 2).map((a, i) => ({
            index: String(i + 3).padStart(3, "0"),
            title: a.name,
            subtitle: artist.aliases.length ? "Alias" : "Group",
            href: a.discogs_id ? `/design-lab/live/artist/${a.discogs_id}` : undefined,
            type: "artist",
          })),
        },
        {
          title: "CREDITS",
          items: credits.slice(0, 2).map((c, i) => ({
            index: String(i + 5).padStart(3, "0"),
            title: c.title || `Release ${c.release_discogs_id}`,
            subtitle: c.roles.slice(0, 2).join(", ") || "Credit",
            href: `/design-lab/live/version/${c.release_discogs_id}`,
            type: "release",
          })),
        },
      ]}
    />
  );
}
