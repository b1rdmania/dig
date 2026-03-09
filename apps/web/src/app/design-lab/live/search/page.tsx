import Link from "next/link";
import { digFetch, ApiRequestError } from "@/lib/api";
import { isSearchResponse, type SearchResponse } from "@/lib/types";
import styles from "../live.module.css";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DesignLabSearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const type = typeof sp.type === "string" ? sp.type : "";

  let data: SearchResponse | null = null;
  let error: string | null = null;

  if (q) {
    const params = new URLSearchParams({ q, limit: "20" });
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

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>Live Template / Search</p>
        <h1 className={styles.title}>Search Lab</h1>
        <div className={styles.links}>
          <Link className={styles.pill} href="/design-lab/live">Back to lab</Link>
        </div>
      </section>

      <section className={styles.section}>
        <form className={styles.form} action="/design-lab/live/search" method="get">
          <input className={styles.input} name="q" defaultValue={q} placeholder="Search artists, releases, labels..." />
          <button className={styles.btn} type="submit">Search</button>
        </form>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Results {q ? `for “${q}”` : ""}</h2>
        {!q && <p className={styles.warn}>Run a query to view live results in the new template.</p>}
        {error && <p className={styles.warn}>{error}</p>}
        {data && (
          <div className={styles.list}>
            {data.results.map((r) => {
              const label = r.name || r.title || `${r.type} ${r.discogs_id}`;
              const href = r.type === "artist"
                ? `/design-lab/live/artist/${r.discogs_id}`
                : r.type === "master"
                ? `/design-lab/live/release/${r.discogs_id}`
                : r.type === "release"
                ? `/version/${r.discogs_id}`
                : `/label/${r.discogs_id}`;
              return (
                <div key={`${r.type}-${r.discogs_id}`} className={styles.row}>
                  <Link className={styles.mainLink} href={href}>{label}</Link>
                  <span className={styles.meta}>{r.type} {r.year ? `• ${r.year}` : ""}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
