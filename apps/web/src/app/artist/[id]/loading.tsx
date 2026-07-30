import { SkeletonBlock, SkeletonHeading, SkeletonLine } from "@/components/Skeleton";

export default function LoadingArtist() {
  return (
    <div style={{ maxWidth: "var(--max-width)", margin: "0 auto 0 0" }}>
      <SkeletonHeading />
      <SkeletonLine width="medium" />
      <SkeletonBlock />
      <SkeletonBlock />
    </div>
  );
}
