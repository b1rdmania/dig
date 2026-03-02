import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiRequestError, digFetch } from "@/lib/api";
import {
  isMasterResponse,
  isReleaseResponse,
  isTraversalResponse,
  type MasterResponse,
  type ReleaseResponse,
  type TraversalResponse,
} from "@/lib/types";
import { discogsUrl } from "@/lib/format";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Tracklist } from "@/components/Tracklist";
import { Credits } from "@/components/Credits";
import { Provenance } from "@/components/Provenance";
import styles from "./page.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  try {
    const data = await digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 });
    if (!isMasterResponse(data)) return { title: "Master — Dig" };
    const artist = data.master.artists[0]?.name || "Unknown";
    return {
      title: `${data.master.title} — ${artist} — Dig`,
      description: `Master release for ${data.master.title}.`,
    };
  } catch {
    return { title: "Master — Dig" };
  }
}

export default async function MasterPage({ params }: Props) {
  const { id } = await params;

  try {
    const defaultTraversal: TraversalResponse = {
      links: [],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: { source_type: "master", source_discogs_id: Number(id), link_type: "releases", elapsed_ms: 0 },
    };

    const [masterData, releasesData] = await Promise.all([
      digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 }),
      digFetch<TraversalResponse>(`/v1/masters/${id}/releases?limit=40`, { revalidate: 300 })
        .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
        .catch(() => defaultTraversal),
    ]);

    if (!isMasterResponse(masterData)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    const master = masterData.master;
    const artistLine = master.artists.map((a) => a.name).join(", ");

    // Fetch main release detail + cover art for full content display
    const mainReleaseId = master.main_release_discogs_id;
    let mainRelease: ReleaseResponse["release"] | null = null;
    let coverUrl: string | null = null;

    if (mainReleaseId) {
      const [releaseData, coverData] = await Promise.all([
        digFetch<ReleaseResponse>(`/v1/releases/${mainReleaseId}`, { revalidate: 300 }).catch(() => null),
        digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${mainReleaseId}/cover`, { revalidate: 3600 }).catch(() => null),
      ]);
      if (releaseData && isReleaseResponse(releaseData)) {
        mainRelease = releaseData.release;
      }
      coverUrl = coverData?.cover?.url ?? null;
    }

    return (
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <div className={styles.cover}>
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={`${master.title} cover art`}
                  className={styles.coverImg}
                  loading="eager"
                />
              ) : (
                <div className={styles.coverPlaceholder}>
                  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.vinylIcon}>
                    <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
                    <circle cx="24" cy="24" r="15" stroke="currentColor" strokeWidth="0.75" opacity="0.2" />
                    <circle cx="24" cy="24" r="8" stroke="currentColor" strokeWidth="0.75" opacity="0.2" />
                    <circle cx="24" cy="24" r="3" fill="currentColor" opacity="0.3" />
                  </svg>
                </div>
              )}
            </div>
            <div className={styles.info}>
              <h1 className={styles.title}>{master.title}</h1>
              {artistLine && (
                <div className={styles.artists}>
                  {master.artists.map((artist, index) => (
                    <span key={`${artist.discogs_id}-${index}`}>
                      <Link href={`/artist/${artist.discogs_id}`} className={styles.artistLink}>
                        {artist.name}
                      </Link>
                      {index < master.artists.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.meta}>
                {master.year && <span>{master.year}</span>}
                <span>Master #{master.discogs_id}</span>
              </div>
              {(master.genres.length > 0 || master.styles.length > 0) && (
                <div className={styles.tags}>
                  {master.genres.map((g) => (
                    <span className={styles.tag} key={`g-${g}`}>{g}</span>
                  ))}
                  {master.styles.map((s) => (
                    <span className={styles.tag} key={`s-${s}`}>{s}</span>
                  ))}
                </div>
              )}
              <div className={styles.links}>
                <a
                  href={discogsUrl("master", master.discogs_id)}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.link}
                >
                  Open on Discogs
                </a>
              </div>
            </div>
          </div>
        </section>

        {mainRelease && <Tracklist tracks={mainRelease.tracks} />}
        {mainRelease && <Credits credits={mainRelease.credits} />}

        {mainRelease?.notes && (
          <section className={styles.section}>
            <h2 className={styles.heading}>Notes</h2>
            <p className={styles.copy}>{mainRelease.notes}</p>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.heading}>
            Versions ({releasesData.links.length})
          </h2>
          {releasesData.links.length === 0 && (
            <div className={styles.small}>No linked releases found.</div>
          )}
          {releasesData.links.map((link) => (
            <div key={link.discogs_id} className={styles.row}>
              <Link href={`/release/${link.discogs_id}`} className={styles.releaseTitle}>
                {link.title || `Release ${link.discogs_id}`}
              </Link>
              <span className={styles.small}>{link.year || "—"}</span>
              <a
                href={discogsUrl("release", link.discogs_id)}
                target="_blank"
                rel="noreferrer"
                className={styles.small}
              >
                Discogs
              </a>
            </div>
          ))}
        </section>

        <Provenance provenance={master.provenance} />
      </div>
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") notFound();
    if (err instanceof ApiRequestError) return <ErrorMessage code={err.code} message={err.message} />;
    return <ErrorMessage message="Failed to load master release" />;
  }
}
