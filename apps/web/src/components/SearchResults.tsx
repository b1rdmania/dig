import type { SearchResponse } from "@/lib/types";
import { ResultCard } from "./ResultCard";
import styles from "./SearchResults.module.css";

interface Props {
  data: SearchResponse;
}

export function SearchResults({ data }: Props) {
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
      {data.results.map((r) => (
        <ResultCard key={`${r.type}-${r.discogs_id}`} result={r} />
      ))}
    </div>
  );
}
