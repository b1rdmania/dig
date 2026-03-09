import Link from "next/link";
import { digFetch } from "@/lib/api";
import {
  isMasterResponse,
  isTraversalResponse,
  type MasterResponse,
  type TraversalResponse,
} from "@/lib/types";
import { firstYoutubeThumb } from "@/lib/media";
import styles from "../../live.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignLabReleasePage({ params }: Props) {
  const { id } = await params;

  const masterRes = await digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 }).catch(() => null);
  const master = masterRes && isMasterResponse(masterRes) ? masterRes.master : null;

  if (!master) {
    return (
      <main className={styles.page}>
        <section className={styles.section}>
          <p className={styles.warn}>Master not found in design lab. Try another release ID.</p>
          <div className={styles.links}><Link className={styles.pill} href="/design-lab/live">Back to lab</Link></div>
        </section>
      </main>
    );
  }

  const versionsRes = await digFetch<TraversalResponse>(`/v1/masters/${id}/releases?limit=20`, { revalidate: 300 }).catch(() => null);
  const versions = versionsRes && isTraversalResponse(versionsRes) ? versionsRes.links : [];
  const coverThumb = firstYoutubeThumb(master.videos);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.grid2}>
          <div className={styles.cover}>{coverThumb ? <img src={coverThumb} alt={master.title} /> : null}</div>
          <div>
            <p className={styles.kicker}>Live Template / Release</p>
            <h1 className={styles.title}>{master.title}</h1>
            <p className={styles.sub}>{master.artists.map((a) => a.name).join(", ")}{master.year ? ` • ${master.year}` : ""}</p>
            <div className={styles.links}>
              <Link className={styles.pill} href="/design-lab/live">Back to lab</Link>
              {master.artists[0] && (
                <Link className={styles.pill} href={`/design-lab/live/artist/${master.artists[0].discogs_id}`}>Artist page</Link>
              )}
              <a className={styles.pill} href={`https://www.discogs.com/master/${master.discogs_id}`} target="_blank" rel="noreferrer">Discogs</a>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Versions</h2>
        {versions.length === 0 && <p className={styles.warn}>No versions found.</p>}
        <div className={styles.list}>
          {versions.map((v) => (
            <div className={styles.row} key={v.discogs_id}>
              <Link className={styles.mainLink} href={`/version/${v.discogs_id}`}>
                {v.title || `Version ${v.discogs_id}`}
              </Link>
              <span className={styles.meta}>{v.format || "Version"}{v.country ? ` • ${v.country}` : ""}{v.year ? ` • ${v.year}` : ""}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
