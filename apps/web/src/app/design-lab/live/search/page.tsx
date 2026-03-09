import Link from "next/link";
import { digFetch, ApiRequestError } from "@/lib/api";
import { isSearchResponse, type SearchResponse, type SearchResult } from "@/lib/types";
import { displayName, typeLabel } from "@/lib/format";
import { hrefForSearchResult, summarizeResultLine } from "../shared";
import styles from "../live.module.css";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const TYPE_OPTIONS = ["", "artist", "master", "release", "label"] as const;

function groupResults(results: SearchResult[]): Array<{ label: string; items: SearchResult[] }> {
  const groups: Array<{ key: SearchResult["type"]; label: string }> = [
    { key: "artist", label: "Artists" },
    { key: "master", label: "Releases" },
    { key: "release", label: "Versions" },
    { key: "label", label: "Labels" },
  ];
  return groups
    .map((g) => ({ label: g.label, items: results.filter((r) => r.type === g.key) }))
    .filter((g) => g.items.length > 0);
}

export default async function DesignLabSearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const type = typeof sp.type === "string" && TYPE_OPTIONS.includes(sp.type as any) ? sp.type : "";

  let data: SearchResponse | null = null;
  let error: string | null = null;

  if (q) {
    const params = new URLSearchParams({ q, limit: "30" });
    if (type) params.set("type", type);
    try {
      const res = await digFetch<SearchResponse>(`/v1/search?${params.toString()}`, { cache: "no-store" });
      if (isSearchResponse(res)) data = res;
      else error = "Unexpected API format";
    } catch (err) {
      if (err instanceof ApiRequestError) error = `${err.code}: ${err.message}`;
      else error = "Search failed";
    }
  }

  const groups = data ? groupResults(data.results) : [];

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>Live Template / Search</p>
        <h1 className={styles.title}>Search</h1>
        <p className={styles.sub}>Type once, inspect cross-entity results in the full lab style.</p>
        <div className={styles.links}>
          <Link className={styles.pill} href="/design-lab/live">Lab home</Link>
        </div>
      </section>

      <section className={styles.section}>
        <form className={styles.controls} action="/design-lab/live/search" method="get">
          <input className={styles.input} name="q" defaultValue={q} placeholder="Search artists, labels, releases..." />
          <select className={styles.select} name="type" defaultValue={type} aria-label="Entity type">
            <option value="">All types</option>
            <option value="artist">Artist</option>
            <option value="master">Release</option>
            <option value="release">Version</option>
            <option value="label">Label</option>
          </select>
          <button className={styles.btn} type="submit">Search</button>
        </form>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Results{q ? ` for “${q}”` : ""}</h2>
        {!q && <p className={styles.warn}>Run a query to preview the production data in this template.</p>}
        {error && <p className={styles.warn}>{error}</p>}
        {data && (
          <>
            <p className={styles.resultsMeta}>
              {data.results.length} shown • {data.meta.elapsed_ms}ms
              {data.meta.degraded ? ` • degraded (${data.meta.degraded_reason || "unknown"})` : ""}
            </p>
            {groups.length === 0 && <div className={styles.emptyCard}>No matching rows for this query.</div>}
            {groups.map((group) => (
              <div key={group.label} style={{ marginTop: "0.8rem" }}>
                <h3 className={styles.sectionTitle}>{group.label}</h3>
                <div className={styles.list}>
                  {group.items.map((r) => (
                    <div key={`${r.type}-${r.discogs_id}`} className={styles.row}>
                      <div>
                        <Link className={styles.mainLink} href={hrefForSearchResult(r)}>
                          {displayName(r)}
                        </Link>
                        <div className={styles.subMeta}>{summarizeResultLine(r)}</div>
                      </div>
                      <span className={styles.meta}>{typeLabel(r.type)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </section>
    </main>
  );
}
