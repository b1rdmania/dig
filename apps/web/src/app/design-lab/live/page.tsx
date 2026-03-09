import Variant3LiveShell from "@/components/design-lab/Variant3LiveShell";

export const metadata = {
  title: "Design Lab Live — dig",
};

export default function DesignLabLiveHome() {
  return (
    <Variant3LiveShell
      sectionLabel="/ DESIGN LAB"
      title="Dig Live"
      queryValue="Try Kasra V, Larry Heard, Warp Records"
      pills={[
        { label: "Search", active: true, href: "/design-lab/live/search?q=kasra%20v" },
        { label: "Artist", href: "/design-lab/live/artist/4506398" },
        { label: "Release", href: "/design-lab/live/release/22044" },
      ]}
      nowPlaying={{ title: "Design Lab Live", artist: "Dig" }}
      columns={[
        {
          title: "PAGES",
          items: [
            { index: "01", title: "Search", subtitle: "Live API query page", href: "/design-lab/live/search?q=kasra%20v", type: "release" },
            { index: "02", title: "Artist", subtitle: "Kasra V", href: "/design-lab/live/artist/4506398", type: "artist" },
            { index: "03", title: "Release", subtitle: "Master page", href: "/design-lab/live/release/22044", type: "release" },
            { index: "04", title: "Version", subtitle: "Pressing page", href: "/design-lab/live/version/9267745", type: "release" },
          ],
        },
        {
          title: "RELEASES",
          items: [
            { index: "001", title: "Release sample", subtitle: "Tracks + versions + media", href: "/design-lab/live/release/22044", type: "release" },
            { index: "002", title: "Version sample", subtitle: "Pressing details", href: "/design-lab/live/version/9267745", type: "release" },
          ],
        },
        {
          title: "ARTISTS",
          items: [
            { index: "003", title: "Kasra V", subtitle: "Releases + credits", href: "/design-lab/live/artist/4506398", type: "artist" },
            { index: "004", title: "Larry Heard", subtitle: "Another artist profile", href: "/design-lab/live/artist/148", type: "artist" },
          ],
        },
        {
          title: "LABELS",
          items: [
            { index: "005", title: "Blue Note", subtitle: "Catalog view", href: "/design-lab/live/label/1", type: "label" },
            { index: "006", title: "Warp Records", subtitle: "Catalog view", href: "/design-lab/live/label/804", type: "label" },
          ],
        },
      ]}
    />
  );
}
