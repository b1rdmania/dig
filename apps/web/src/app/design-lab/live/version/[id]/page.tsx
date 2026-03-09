import Link from "next/link";
import { digFetch } from "@/lib/api";
import {
  isReleaseResponse,
  isMasterResponse,
  type ReleaseResponse,
  type MasterResponse,
} from "@/lib/types";
import { artistNames, formatDuration } from "@/lib/format";
import { firstYoutubeThumb } from "@/lib/media";
import { topVideos } from "../../shared";
import styles from "../../live.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignLabVersionPage({ params }: Props) {
  const { id } = await params;

  const releaseRes = await digFetch<ReleaseResponse>(`/v1/releases/${id}`, { revalidate: 300 }).catch(() => null);
  const release = releaseRes && isReleaseResponse(releaseRes) ? releaseRes.release : null;

  if (!release) {
    return (
      <main className={styles.page}>
        <section className={styles.section}>
          <p className={styles.warn}>Version not found.</p>
          <div className={styles.links}><Link className={styles.pill} href="/design-lab/live/search">Back to search</Link></div>
        </section>
      </main>
    );
  }

  const [coverRes, masterRes] = await Promise.all([
    digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${id}/cover`, { revalidate: 3600 }).catch(() => null),
    release.master_discogs_id
      ? digFetch<MasterResponse>(`/v1/masters/${release.master_discogs_id}`, { revalidate: 300 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const coverUrl = coverRes?.cover?.url || firstYoutubeThumb(release.videos) || null;
  const master = masterRes && isMasterResponse(masterRes) ? masterRes.master : null;
  const videos = topVideos(release.videos, 6);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.grid2}>
          <div className={styles.cover}>
            {coverUrl ? (
              <img src={coverUrl} alt={release.title} />
            ) : (
              <div className={styles.coverPlaceholder}><span>No cover</span></div>
            )}
          </div>
          <div>
            <p className={styles.kicker}>Live Template / Version</p>
            <h1 className={styles.title}>{release.title}</h1>
            <p className={styles.sub}>{artistNames(release.artists)}{release.release_year ? ` • ${release.release_year}` : ""}</p>
            <div className={styles.badges}>
              {release.formats.flatMap((f) => f.descriptions).slice(0, 6).map((f) => (
                <span key={f} className={styles.badge}>{f}</span>
              ))}
              {release.genres.slice(0, 4).map((g) => (
                <span key={g} className={styles.badge}>{g}</span>
              ))}
            </div>
            <div className={styles.links}>
              <Link className={styles.pill} href="/design-lab/live">Lab home</Link>
              {master && <Link className={styles.pill} href={`/design-lab/live/release/${master.discogs_id}`}>Release page</Link>}
              <a className={styles.pill} href={`https://www.discogs.com/release/${release.discogs_id}`} target="_blank" rel="noreferrer">Open on Discogs</a>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.split}>
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>Tracklist</h2>
            {release.tracks.length === 0 ? (
              <div className={styles.emptyCard}>No tracklist data.</div>
            ) : (
              release.tracks.map((t, idx) => (
                <div key={`${t.position_raw}-${t.title}-${idx}`} className={styles.trackGrid}>
                  <span className={styles.trackPos}>{t.position_raw || idx + 1}</span>
                  <div>
                    <p className={styles.trackTitle}>{t.title}</p>
                    {t.credits.length > 0 && (
                      <p className={styles.trackCredits}>
                        {t.credits.slice(0, 4).map((c) => `${c.role}: ${c.artist_name}`).join(" • ")}
                      </p>
                    )}
                  </div>
                  <span className={styles.trackDuration}>{formatDuration(t.duration_seconds) || "—"}</span>
                </div>
              ))
            )}
          </div>

          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>Credits</h2>
            {release.credits.length === 0 ? (
              <div className={styles.emptyCard}>No release-level credits.</div>
            ) : (
              <div className={styles.list}>
                {release.credits.slice(0, 18).map((c, idx) => (
                  <div key={`${c.artist_discogs_id}-${c.role}-${idx}`} className={styles.row}>
                    <Link className={styles.mainLink} href={`/design-lab/live/artist/${c.artist_discogs_id}`}>{c.artist_name}</Link>
                    <span className={styles.meta}>{c.role}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Media</h2>
        {videos.length === 0 ? (
          <div className={styles.emptyCard}>No playable YouTube media found.</div>
        ) : (
          <div className={styles.videoGrid}>
            {videos.map((v) => (
              <a key={v.url} className={styles.videoCard} href={v.url} target="_blank" rel="noreferrer">
                <img className={styles.videoThumb} src={v.thumb} alt={v.title} />
                <div className={styles.videoBody}>
                  <p className={styles.videoTitle}>{v.title}</p>
                  <p className={styles.videoMeta}>{v.duration || "YouTube"}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <p className={styles.meta}>discogs|{release.provenance.dump_date}|#{release.discogs_id}</p>
      </section>
    </main>
  );
}
