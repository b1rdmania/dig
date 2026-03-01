import { SkeletonHeading, SkeletonLine, SkeletonBlock } from "@/components/Skeleton";

export default function ReleaseLoading() {
  return (
    <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
      {/* Hero skeleton with cover art placeholder */}
      <div style={{ display: "flex", gap: "1.5rem", padding: "1.5rem 0", borderBottom: "1px solid var(--line)" }}>
        <div
          style={{
            width: 200,
            height: 200,
            flexShrink: 0,
            borderRadius: "var(--radius)",
            background: "var(--surface)",
            border: "1px solid var(--line)",
          }}
        />
        <div style={{ flex: 1 }}>
          <SkeletonHeading />
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
          <div style={{ height: "0.5rem" }} />
          <SkeletonLine width="short" />
        </div>
      </div>
      {/* Tracklist skeleton */}
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
