import VariantDigLiveV2Shell from "@/components/design-lab/VariantDigLiveV2Shell";

export const metadata = {
  title: "Design Lab Live v2 — dig",
};

export default function DesignLabLiveV2Home() {
  return (
    <VariantDigLiveV2Shell
      eyebrow="Design Lab / Live v2"
      title="Dig Live v2"
      subtitle="Variant-Dig shell wired to real API data. Production routes untouched."
      queryValue="kasra v"
      searchTarget="/design-lab/live-v2/search"
      facts={[
        { label: "Status", value: "Live API wired" },
        { label: "Scope", value: "Search • Artist • Release • Version • Label" },
        { label: "Safety", value: "Design Lab only" },
      ]}
      actions={[
        { label: "Search", href: "/design-lab/live-v2/search?q=kasra%20v", primary: true },
        { label: "Artist 4506398", href: "/design-lab/live-v2/artist/4506398" },
        { label: "Release 22044", href: "/design-lab/live-v2/release/22044" },
        { label: "Version 9267745", href: "/design-lab/live-v2/version/9267745" },
        { label: "Label 804", href: "/design-lab/live-v2/label/804" },
      ]}
      primaryTitle="Live v2 Pages"
      primaryItems={[
        { index: "01", title: "Search", subtitle: "Real /v1/search data", href: "/design-lab/live-v2/search?q=kasra%20v" },
        { index: "02", title: "Artist", subtitle: "Releases + credits", href: "/design-lab/live-v2/artist/4506398" },
        { index: "03", title: "Release", subtitle: "Master + versions + tracks", href: "/design-lab/live-v2/release/22044" },
        { index: "04", title: "Version", subtitle: "Pressing detail", href: "/design-lab/live-v2/version/9267745" },
        { index: "05", title: "Label", subtitle: "Catalog list", href: "/design-lab/live-v2/label/804" },
      ]}
      secondaryTitle="Reference"
      secondaryItems={[
        { index: "A1", title: "Design Lab Index", subtitle: "All variants + status", href: "/design-lab" },
        { index: "A2", title: "Legacy live shell", subtitle: "Fallback", href: "/design-lab/live" },
      ]}
      sideTopTitle="Sample IDs"
      sideTopItems={[
        { title: "Kasra V", subtitle: "Artist 4506398", href: "/design-lab/live-v2/artist/4506398" },
        { title: "Larry Heard", subtitle: "Artist 148", href: "/design-lab/live-v2/artist/148" },
        { title: "Warp Records", subtitle: "Label 804", href: "/design-lab/live-v2/label/804" },
      ]}
      sideBottomTitle="Notes"
      sideBottomItems={[
        { title: "No production impact", subtitle: "All routes scoped to /design-lab/live-v2" },
        { title: "Read-only", subtitle: "No DB writes, no migrations" },
      ]}
      footerNote="This is the exact plugged-in mock environment for visual/system testing before production template adoption."
    />
  );
}
