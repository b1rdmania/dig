import Link from "next/link";
import { digFetch } from "@/lib/api";
import {
  isMasterResponse,
  isTraversalResponse,
  isReleaseResponse,
  type MasterResponse,
  type TraversalResponse,
  type ReleaseResponse,
} from "@/lib/types";
import { artistNames, formatDuration } from "@/lib/format";
import { firstYoutubeThumb } from "@/lib/media";
import { hrefForTraversalLink, topVideos } from "../../shared";
import styles from "../../live.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

function coverFallback(title: string) {
  return (
    <div className={styles.coverPlaceholder}>
      <span>{title ? "No cover" : "No artwork"}</span>
    </div>
  );
}

export default async function DesignLabReleasePage({ params }: Props) {
  const { id } = await params;

  const masterRes = await digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 }).catch(() => null);
  const master = masterRes && isMasterResponse(masterRes) ? masterRes.master : null;

  if (!master) {
    return (
      <main className={styles.page}>
        <section className={styles.section}>
          <p className={styles.warn}>Master not found. Try a different release ID.</p>
          <div className={styles.links}><Link className={styles.pill} href="/design-lab/live/search">Back to search</Link></div>
        </section>
      </main>
    );
  }

  const [versionsRes, mainReleaseRes, coverRes] = await Promise.all([
    digFetch<TraversalResponse>(`/v1/masters/${id}/releases?limit=40`, { revalidate: 300 }).catch(() => null),
    master.main_release_discogs_id
      ? digFetch<ReleaseResponse>(`/v1/releases/${master.main_release_discogs_id}`, { revalidate: 300 }).catch(() => null)
      : Promise.resolve(null),
    master.main_release_discogs_id
      ? digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${master.main_release_discogs_id}/cover`, { revalidate: 3600 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const versions = versionsRes && isTraversalResponse(versionsRes) ? versionsRes.links : [];
  const mainRelease = mainReleaseRes && isReleaseResponse(mainReleaseRes) ? mainReleaseRes.release : null;
  const coverUrl = coverRes?.cover?.url || firstYoutubeThumb(master.videos) || null;
  const videos = topVideos(mainRelease?.videos || master.videos, 6);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.grid2}>
          <div className={styles.cover}>
            {coverUrl ? <img src={coverUrl} alt={master.title} /> : coverFallback(master.title)}
          </div>
          <div>
            <p className={styles.kicker}>Live Template / Release</p>
            <h1 className={styles.title}>{master.title}</h1>
            <p className={styles.sub}>{artistNames(master.artists)}{master.year ? ` • ${master.year}` : ""}</p>
            <div className={styles.badges}>
              {master.genres.slice(0, 4).map((g) => <span key={g} className={styles.badge}>{g}</span>)}
              {master.styles.slice(0, 5).map((s) => <span key={s} className={styles.badge}>{s}</span>)}
            </div>
            <div className={styles.links}>
              <Link className={styles.pill} href="/design-lab/live">Lab home</Link>
              {master.artists[0] && <Link className={styles.pill} href={`/design-lab/live/artist/${master.artists[0].discogs_id}`}>Artist page</Link>}
              <a className={styles.pill} href={`https://www.discogs.com/master/${master.discogs_id}`} target="_blank" rel="noreferrer">Open on Discogs</a>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.split}>
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>Tracklist</h2>
            {!mainRelease || mainRelease.tracks.length === 0 ? (
              <div className={styles.emptyCard}>No track data on the selected main release.</div>
            ) : (
              mainRelease.tracks.map((t, idx) => (
                <div key={`${t.position_raw}-${t.title}-${idx}`} className={styles.trackGrid}>
                  <span className={styles.trackPos}>{t.position_raw || idx + 1}</span>
                  <div>
                    <p className={styles.trackTitle}>{t.title}</p>
                    {t.credits.length > 0 && (
                      <p className={styles.trackCredits}>
                        {t.credits.slice(0, 3).map((c) => c.role).join(", ")}
                      </p>
                    )}
                  </div>
                  <span className={styles.trackDuration}>{formatDuration(t.duration_seconds) || "—"}</span>
                </div>
              ))
            )}
          </div>

          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>Release Credits</h2>
            {!mainRelease || mainRelease.credits.length === 0 ? (
              <div className={styles.emptyCard}>No release-level credits listed.</div>
            ) : (
              <div className={styles.list}>
                {mainRelease.credits.slice(0, 18).map((c, idx) => (
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
          <div className={styles.emptyCard}>No playable YouTube media found on this release.</div>
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
        <h2 className={styles.sectionTitle}>Versions • {versions.length}</h2>
        {versions.length === 0 && <div className={styles.emptyCard}>No versions listed for this master.</div>}
        <div className={styles.list}>
          {versions.map((v) => (
            <div className={styles.row} key={v.discogs_id}>
              <div>
                <Link className={styles.mainLink} href={hrefForTraversalLink(v)}>{v.title || `Version ${v.discogs_id}`}</Link>
                <div className={styles.subMeta}>{v.country || "—"}</div>
              </div>
              <span className={styles.meta}>{v.format || "Version"}{v.year ? ` • ${v.year}` : ""}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <p className={styles.meta}>discogs|{master.provenance.dump_date}|#{master.discogs_id}</p>
      </section>
    </main>
  );
}
