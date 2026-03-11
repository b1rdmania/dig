import VariantDigLiveV2Shell from "@/components/design-lab/VariantDigLiveV2Shell";
import { digFetch } from "@/lib/api";
import { displayName } from "@/lib/format";
import { isSearchResponse, type SearchResponse } from "@/lib/types";
import { hrefForSearchResult, summarizeResultLine } from "../shared";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DesignLabLiveV2SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const type = typeof sp.type === "string" ? sp.type : "";

  let data: SearchResponse | null = null;
  if (q) {
    const params = new URLSearchParams({ q, limit: "24" });
    if (type) params.set("type", type);
    const res = await digFetch<SearchResponse>(`/v1/search?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    if (res && isSearchResponse(res)) data = res;
  }

  const results = data?.results || [];
  const releases = results.filter((r) => r.type === "master" || r.type === "release").slice(0, 8);
  const artists = results.filter((r) => r.type === "artist").slice(0, 6);
  const labels = results.filter((r) => r.type === "label").slice(0, 6);

  return (
    <VariantDigLiveV2Shell
      eyebrow="Design Lab / Search"
      title={q ? `Search: ${q}` : "Search Dig"}
      subtitle={q ? `${results.length} results from live API` : "Run a query to load live data"}
      queryValue={q}
      searchTarget="/design-lab/live-v2/search"
      facts={[
        { label: "Query", value: q || "none" },
        { label: "Type", value: type || "all" },
        { label: "Results", value: String(results.length) },
      ]}
      actions={[
        { label: "All", href: `/design-lab/live-v2/search?q=${encodeURIComponent(q || "kasra v")}`, primary: type === "" },
        { label: "Artists", href: `/design-lab/live-v2/search?q=${encodeURIComponent(q || "kasra v")}&type=artist`, primary: type === "artist" },
        { label: "Releases", href: `/design-lab/live-v2/search?q=${encodeURIComponent(q || "kasra v")}&type=master`, primary: type === "master" },
        { label: "Labels", href: `/design-lab/live-v2/search?q=${encodeURIComponent(q || "kasra v")}&type=label`, primary: type === "label" },
      ]}
      primaryTitle="Results"
      primaryItems={results.slice(0, 14).map((r, i) => ({
        index: String(i + 1).padStart(2, "0"),
        title: displayName(r),
        subtitle: summarizeResultLine(r),
        href: hrefForSearchResult(r),
      }))}
      secondaryTitle="Releases"
      secondaryItems={releases.map((r, i) => ({
        index: String(i + 1).padStart(2, "0"),
        title: displayName(r),
        subtitle: summarizeResultLine(r),
        href: hrefForSearchResult(r),
      }))}
      sideTopTitle="Artists"
      sideTopItems={artists.map((r) => ({
        title: displayName(r),
        subtitle: summarizeResultLine(r),
        href: hrefForSearchResult(r),
      }))}
      sideBottomTitle="Labels"
      sideBottomItems={labels.map((r) => ({
        title: displayName(r),
        subtitle: summarizeResultLine(r),
        href: hrefForSearchResult(r),
      }))}
      footerNote="Live v2 status: Search is fully wired to /v1/search with entity routing into live-v2 pages."
    />
  );
}
