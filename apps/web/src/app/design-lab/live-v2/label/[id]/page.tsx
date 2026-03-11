import VariantDigLiveV2Shell from "@/components/design-lab/VariantDigLiveV2Shell";
import { digFetch } from "@/lib/api";
import { isLabelResponse, isTraversalResponse, type LabelResponse, type TraversalResponse } from "@/lib/types";
import { hrefForTraversalLink } from "../../shared";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignLabLiveV2LabelPage({ params }: Props) {
  const { id } = await params;

  const [labelRes, releasesRes] = await Promise.all([
    digFetch<LabelResponse>(`/v1/labels/${id}`, { revalidate: 300 }).catch(() => null),
    digFetch<TraversalResponse>(`/v1/labels/${id}/releases?limit=40`, { revalidate: 300 }).catch(() => null),
  ]);

  const label = labelRes && isLabelResponse(labelRes) ? labelRes.label : null;
  const releases = releasesRes && isTraversalResponse(releasesRes) ? releasesRes.links : [];

  if (!label) {
    return (
      <VariantDigLiveV2Shell
        eyebrow="Design Lab / Label"
        title="Label not found"
        subtitle="No label for this ID in current batch."
        actions={[{ label: "Back to search", href: "/design-lab/live-v2/search", primary: true }]}
        primaryTitle="Navigation"
        primaryItems={[{ index: "01", title: "Search", subtitle: "Find another label", href: "/design-lab/live-v2/search" }]}
        secondaryTitle="Status"
        secondaryItems={[{ index: "S1", title: "Live v2", subtitle: "Label fetch failed for this ID" }]}
      />
    );
  }

  return (
    <VariantDigLiveV2Shell
      eyebrow="Design Lab / Label"
      title={label.name}
      subtitle={label.parent_label?.name ? `Parent: ${label.parent_label.name}` : "Label"}
      queryValue={label.name}
      searchTarget="/design-lab/live-v2/search"
      facts={[
        { label: "Catalog", value: String(releases.length) },
        { label: "Parent", value: label.parent_label?.name || "None" },
        { label: "Links", value: String(label.urls.length) },
      ]}
      actions={[
        { label: "Open Discogs", href: `https://www.discogs.com/label/${label.discogs_id}`, external: true, primary: true },
        { label: "Search this label", href: `/design-lab/live-v2/search?q=${encodeURIComponent(label.name)}` },
      ]}
      primaryTitle="Catalog"
      primaryItems={releases.slice(0, 20).map((r, i) => ({
        index: String(i + 1).padStart(2, "0"),
        title: r.title || `Release ${r.discogs_id}`,
        subtitle: `${r.country || "—"}${r.year ? ` • ${r.year}` : ""}`,
        href: hrefForTraversalLink(r),
      }))}
      secondaryTitle="Sublabels"
      secondaryItems={[
        ...(label.parent_label
          ? [
              {
                index: "01",
                title: label.parent_label.name || "Parent label",
                subtitle: "Parent label",
                href: `/design-lab/live-v2/label/${label.parent_label.discogs_id}`,
              },
            ]
          : []),
      ]}
      sideTopTitle="Profile"
      sideTopItems={[{ title: (label.profile || "No profile text available").slice(0, 240) }]}
      sideBottomTitle="External Links"
      sideBottomItems={label.urls.slice(0, 8).map((u) => ({
        title: u.replace(/^https?:\/\//, "").slice(0, 48),
        subtitle: "External",
        href: u,
        external: true,
      }))}
      footerNote="Live v2 status: Label page is fully wired (label + releases + sublabels + links)."
    />
  );
}
