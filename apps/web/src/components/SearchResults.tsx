import type { SearchResponse } from "@/lib/types";
import { normalizedTitle } from "@/lib/format";
import { ResultCard } from "./ResultCard";
import styles from "./SearchResults.module.css";

interface Props {
  data: SearchResponse;
}

export function SearchResults({ data }: Props) {
  const masters = data.results.filter((r) => r.type === "master");
  const artists = data.results.filter((r) => r.type === "artist");
  const labels = data.results.filter((r) => r.type === "label");
  const releases = data.results.filter((r) => r.type === "release");

  // Master-first dedupe: collapse release duplicates where a matching master exists.
  const masterKeys = new Set(
    masters.map((m) => `${normalizedTitle(m.title || "")}|${m.year || ""}`),
  );
  const dedupedReleases = releases.filter((r) => {
    const key = `${normalizedTitle(r.title || "")}|${r.year || ""}`;
    return !masterKeys.has(key);
  });
  const collapsedReleaseCount = releases.length - dedupedReleases.length;

  const sections: Array<{ title: string; items: typeof data.results }> = [
    { title: "Artists", items: artists },
    { title: "Masters", items: masters },
    { title: "Releases", items: dedupedReleases },
    { title: "Labels", items: labels },
  ].filter((s) => s.items.length > 0);

  return (
    <div className={styles.list}>
      <div className={styles.meta}>
        {data.pagination.total_estimate != null
          ? `~${data.pagination.total_estimate.toLocaleString()} results`
          : `${data.results.length} results`}
        {" \u00B7 "}
        {data.meta.elapsed_ms}ms
      </div>
      {data.meta.degraded && (
        <div className={styles.degraded}>
          Results may be incomplete{data.meta.hint ? ` \u2014 ${data.meta.hint}` : ""}
        </div>
      )}
      {collapsedReleaseCount > 0 && (
        <div className={styles.collapsed}>
          Collapsed {collapsedReleaseCount} duplicate release matches under master releases.
        </div>
      )}
      {sections.map((section) => (
        <section key={section.title} className={styles.section}>
          <h2 className={styles.sectionHeading}>
            {section.title}
            <span className={styles.sectionCount}>{section.items.length}</span>
          </h2>
          {section.items.map((r) => (
            <ResultCard key={`${r.type}-${r.discogs_id}`} result={r} />
          ))}
        </section>
      ))}
    </div>
  );
}
