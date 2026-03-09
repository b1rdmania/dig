import Link from "next/link";
import { digFetch } from "@/lib/api";
import {
  isLabelResponse,
  isTraversalResponse,
  type LabelResponse,
  type TraversalResponse,
} from "@/lib/types";
import { urlLabel } from "@/lib/format";
import { hrefForTraversalLink } from "../../shared";
import styles from "../../live.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignLabLabelPage({ params }: Props) {
  const { id } = await params;

  const [labelRes, releasesRes] = await Promise.all([
    digFetch<LabelResponse>(`/v1/labels/${id}`, { revalidate: 300 }).catch(() => null),
    digFetch<TraversalResponse>(`/v1/labels/${id}/releases?limit=50`, { revalidate: 300 }).catch(() => null),
  ]);

  const label = labelRes && isLabelResponse(labelRes) ? labelRes.label : null;
  const releases = releasesRes && isTraversalResponse(releasesRes) ? releasesRes.links : [];

  if (!label) {
    return (
      <main className={styles.page}>
        <section className={styles.section}>
          <p className={styles.warn}>Label not found.</p>
          <div className={styles.links}><Link className={styles.pill} href="/design-lab/live/search">Back to search</Link></div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>Live Template / Label</p>
        <h1 className={styles.title}>{label.name}</h1>
        {label.parent_label?.name && <p className={styles.sub}>Parent label: {label.parent_label.name}</p>}
        <div className={styles.links}>
          <Link className={styles.pill} href="/design-lab/live">Lab home</Link>
          <Link className={styles.pill} href="/design-lab/live/search?type=label">Search labels</Link>
          <a className={styles.pill} href={`https://www.discogs.com/label/${label.discogs_id}`} target="_blank" rel="noreferrer">Open on Discogs</a>
        </div>
      </section>

      {label.profile && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>About</h2>
          <p className={styles.warn} style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, color: "var(--lab-text)" }}>{label.profile}</p>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Catalog Releases • {releases.length}</h2>
        {releases.length === 0 && <div className={styles.emptyCard}>No releases found for this label.</div>}
        <div className={styles.list}>
          {releases.map((r) => (
            <div className={styles.row} key={`${r.type}-${r.discogs_id}`}>
              <div>
                <Link className={styles.mainLink} href={hrefForTraversalLink(r)}>
                  {r.title || `Release ${r.discogs_id}`}
                </Link>
                <div className={styles.subMeta}>{r.country || "—"}</div>
              </div>
              <span className={styles.meta}>{r.format || r.type}{r.year ? ` • ${r.year}` : ""}</span>
            </div>
          ))}
        </div>
      </section>

      {label.urls.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>External Links</h2>
          <div className={styles.links}>
            {label.urls.slice(0, 10).map((url) => (
              <a key={url} className={styles.pill} href={url} target="_blank" rel="noreferrer">{urlLabel(url)}</a>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <p className={styles.meta}>discogs|{label.provenance.dump_date}|#{label.discogs_id}</p>
      </section>
    </main>
  );
}
