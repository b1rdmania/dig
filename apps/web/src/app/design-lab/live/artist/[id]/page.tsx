import Link from "next/link";
import { digFetch } from "@/lib/api";
import {
  isArtistResponse,
  isTraversalResponse,
  isArtistCreditsResponse,
  type ArtistResponse,
  type TraversalResponse,
  type ArtistCreditsResponse,
} from "@/lib/types";
import styles from "../../live.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignLabArtistPage({ params }: Props) {
  const { id } = await params;

  const [artistRes, releasesRes, creditsRes] = await Promise.all([
    digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 }).catch(() => null),
    digFetch<TraversalResponse>(`/v1/artists/${id}/catalog_releases?limit=25&sort=newest`, { revalidate: 300 }).catch(() => null),
    digFetch<ArtistCreditsResponse>(`/v1/artists/${id}/credits?limit=15`, { revalidate: 300 }).catch(() => null),
  ]);

  const artist = artistRes && isArtistResponse(artistRes) ? artistRes.artist : null;
  const releases = releasesRes && isTraversalResponse(releasesRes) ? releasesRes.links : [];
  const credits = creditsRes && isArtistCreditsResponse(creditsRes) ? creditsRes.links : [];

  if (!artist) {
    return (
      <main className={styles.page}>
        <section className={styles.section}><p className={styles.warn}>Artist not found.</p></section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>Live Template / Artist</p>
        <h1 className={styles.title}>{artist.name}</h1>
        <p className={styles.sub}>{artist.real_name ? `Real name: ${artist.real_name}` : ""}</p>
        <div className={styles.links}>
          <Link className={styles.pill} href="/design-lab/live">Back to lab</Link>
          <a className={styles.pill} href={`https://www.discogs.com/artist/${artist.discogs_id}`} target="_blank" rel="noreferrer">Discogs</a>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Releases (main artist)</h2>
        {releases.length === 0 && <p className={styles.warn}>No releases found.</p>}
        <div className={styles.list}>
          {releases.map((r) => (
            <div className={styles.row} key={`${r.type}-${r.discogs_id}`}>
              <Link className={styles.mainLink} href={r.type === "master" ? `/design-lab/live/release/${r.discogs_id}` : `/version/${r.discogs_id}`}>
                {r.title || `Release ${r.discogs_id}`}
              </Link>
              <span className={styles.meta}>{r.release_type_label || r.type}{r.year ? ` • ${r.year}` : ""}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Credits & Appearances</h2>
        {credits.length === 0 && <p className={styles.warn}>No credits found.</p>}
        <div className={styles.list}>
          {credits.map((c) => (
            <div className={styles.row} key={`${c.release_discogs_id}-${c.roles.join("|")}`}>
              <Link className={styles.mainLink} href={`/version/${c.release_discogs_id}`}>
                {c.title || `Release ${c.release_discogs_id}`}
              </Link>
              <span className={styles.meta}>{c.roles.slice(0, 2).join(", ")}{c.year ? ` • ${c.year}` : ""}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
