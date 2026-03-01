import { SkeletonHeading, SkeletonLine, SkeletonBlock } from "@/components/Skeleton";

export default function ReleaseLoading() {
  return (
    <div style={{ maxWidth: "var(--max-width)", margin: "0 auto", padding: "1rem 0" }}>
      <SkeletonHeading />
      <SkeletonLine width="medium" />
      <SkeletonLine width="short" />
      <div style={{ height: "1rem" }} />
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonLine key={i} />
      ))}
      <div style={{ height: "1rem" }} />
      <SkeletonBlock />
      <SkeletonBlock />
    </div>
  );
}
