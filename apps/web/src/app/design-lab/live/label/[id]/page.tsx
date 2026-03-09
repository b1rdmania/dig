import Variant3LiveShell from "@/components/design-lab/Variant3LiveShell";
import { digFetch } from "@/lib/api";
import { isLabelResponse, isTraversalResponse, type LabelResponse, type TraversalResponse } from "@/lib/types";
import { hrefForTraversalLink } from "../../shared";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignLabLabelPage({ params }: Props) {
  const { id } = await params;

  const [labelRes, releasesRes] = await Promise.all([
    digFetch<LabelResponse>(`/v1/labels/${id}`, { revalidate: 300 }).catch(() => null),
    digFetch<TraversalResponse>(`/v1/labels/${id}/releases?limit=30`, { revalidate: 300 }).catch(() => null),
  ]);

  const label = labelRes && isLabelResponse(labelRes) ? labelRes.label : null;
  const releases = releasesRes && isTraversalResponse(releasesRes) ? releasesRes.links : [];

  if (!label) {
    return (
      <Variant3LiveShell
        sectionLabel="/ LABEL"
        title="Label not found"
        queryValue="Try another label id"
        pills={[{ label: "not found", active: true }]}
        columns={[
          { title: "RELEASES", items: [] },
          { title: "CATALOG", items: [] },
          { title: "PROFILE", items: [] },
          { title: "NAV", items: [{ index: "001", title: "Back to search", subtitle: "Find label", href: "/design-lab/live/search", type: "label" }] },
        ]}
      />
    );
  }

  return (
    <Variant3LiveShell
      sectionLabel="/ LABEL"
      title={label.name}
      queryValue={label.profile?.slice(0, 90) || `Label #${label.discogs_id}`}
      pills={[
        { label: `${releases.length} releases`, active: true, href: `/design-lab/live/label/${id}` },
        { label: label.parent_label?.name || "no parent", href: `/design-lab/live/label/${id}` },
        { label: `${label.urls.length} links`, href: `/design-lab/live/label/${id}` },
      ]}
      nowPlaying={{ title: label.name, artist: "Label catalog" }}
      columns={[
        {
          title: "RELEASES",
          items: releases.slice(0, 8).map((r, i) => ({
            index: String(i + 1).padStart(2, "0"),
            title: r.title || `Release ${r.discogs_id}`,
            subtitle: `${r.country || "—"}${r.year ? ` • ${r.year}` : ""}`,
            href: hrefForTraversalLink(r),
            type: "release",
          })),
        },
        {
          title: "FEATURED",
          items: releases.slice(0, 2).map((r, i) => ({
            index: String(i + 1).padStart(3, "0"),
            title: r.title || `Release ${r.discogs_id}`,
            subtitle: r.format || "Release",
            href: hrefForTraversalLink(r),
            type: "release",
          })),
        },
        {
          title: "LINKS",
          items: label.urls.slice(0, 2).map((u, i) => ({
            index: String(i + 3).padStart(3, "0"),
            title: u.replace(/^https?:\/\//, "").slice(0, 42),
            subtitle: "External",
            href: u,
            type: "label",
          })),
        },
        {
          title: "NAV",
          items: [
            { index: "005", title: "Open on Discogs", subtitle: "Label page", href: `https://www.discogs.com/label/${label.discogs_id}`, type: "label" },
            { index: "006", title: "Back to lab", subtitle: "Design Lab Live", href: "/design-lab/live", type: "label" },
          ],
        },
      ]}
    />
  );
}
