import { SkeletonLine, SkeletonBlock } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div style={{ maxWidth: "var(--max-width)", margin: "0 auto", padding: "1rem 0" }}>
      <SkeletonBlock />
      {Array.from({ length: 8 }).map((_, i) => (
        <SkeletonLine key={i} width={i % 3 === 0 ? "short" : "medium"} />
      ))}
    </div>
  );
}
