import Variant3LiveShell from "@/components/design-lab/Variant3LiveShell";
import { digFetch } from "@/lib/api";
import { isSearchResponse, type SearchResponse } from "@/lib/types";
import { displayName } from "@/lib/format";
import { hrefForSearchResult } from "../shared";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DesignLabSearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const type = typeof sp.type === "string" ? sp.type : "";

  let data: SearchResponse | null = null;
  if (q) {
    const params = new URLSearchParams({ q, limit: "20" });
    if (type) params.set("type", type);
    const res = await digFetch<SearchResponse>(`/v1/search?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    if (res && isSearchResponse(res)) data = res;
  }

  const results = data?.results || [];
  const artists = results.filter((r) => r.type === "artist").slice(0, 2);
  const releases = results.filter((r) => r.type === "master" || r.type === "release").slice(0, 4);
  const labels = results.filter((r) => r.type === "label").slice(0, 2);

  return (
    <Variant3LiveShell
      sectionLabel="/ SEARCH"
      title="Dig Search"
      queryValue={q || "Search artists, labels, releases..."}
      pills={[
        { label: type || "all", active: true },
        { label: `${results.length} results` },
        { label: data ? `${data.meta.elapsed_ms}ms` : "live" },
      ]}
      nowPlaying={{ title: q || "No query", artist: data ? `${results.length} results` : "Run search" }}
      columns={[
        {
          title: "RESULTS",
          items: results.slice(0, 8).map((r, i) => ({
            index: String(i + 1).padStart(2, "0"),
            title: displayName(r),
            subtitle: `${r.type}${r.year ? ` • ${r.year}` : ""}`,
            href: hrefForSearchResult(r),
            type: r.type === "master" || r.type === "release" ? "release" : r.type,
          })),
        },
        {
          title: "RELEASES",
          items: releases.map((r, i) => ({
            index: String(i + 1).padStart(3, "0"),
            title: displayName(r),
            subtitle: `${r.type}${r.year ? ` • ${r.year}` : ""}`,
            href: hrefForSearchResult(r),
            type: "release",
          })),
        },
        {
          title: "ARTISTS",
          items: artists.map((r, i) => ({
            index: String(i + 3).padStart(3, "0"),
            title: displayName(r),
            subtitle: r.country || "Artist",
            href: hrefForSearchResult(r),
            type: "artist",
          })),
        },
        {
          title: "LABELS",
          items: labels.map((r, i) => ({
            index: String(i + 5).padStart(3, "0"),
            title: displayName(r),
            subtitle: r.country || "Label",
            href: hrefForSearchResult(r),
            type: "label",
          })),
        },
      ]}
    />
  );
}
