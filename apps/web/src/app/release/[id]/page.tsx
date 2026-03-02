import Link from "next/link";
import { redirect, notFound } from "next/navigation";
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
    // Try master first
    const data = await digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 });
    if (isMasterResponse(data)) {
      const artist = data.master.artists[0]?.name || "Unknown";
      return {
        title: `${data.master.title} — ${artist} — Dig`,
        description: `${data.master.title} by ${artist}.`,
      };
    }
  } catch {
    // Not a master — try release
    try {
      const data = await digFetch<ReleaseResponse>(`/v1/releases/${id}`, { revalidate: 300 });
      if (isReleaseResponse(data)) {
        const r = data.release;
        const artist = r.artists[0]?.name || "Unknown";
        return {
          title: `${r.title} — ${artist} — Dig`,
          description: `${r.title} by ${artist}.`,
        };
      }
    } catch {
      // Fall through
    }
  }
  return { title: "Release — Dig" };
}

export default async function ReleasePage({ params }: Props) {
  const { id } = await params;

  if (!/^\d+$/.test(id)) notFound();

  // Try master first — this is the "release" in user-facing terms
  let masterData: MasterResponse | null = null;
  try {
    const data = await digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 });
    if (isMasterResponse(data)) masterData = data;
  } catch (err) {
    if (!(err instanceof ApiRequestError && err.code === "NOT_FOUND")) {
      if (err instanceof ApiRequestError) return <ErrorMessage code={err.code} message={err.message} />;
    }
  }

  // If it's a master, render the full release page
  if (masterData) {
    return <MasterAsRelease master={masterData} id={id} />;
  }

  // Not a master — redirect to /version/:id (it's a specific pressing)
  redirect(`/version/${id}`);
}

async function MasterAsRelease({ master: masterData, id }: { master: MasterResponse; id: string }) {
  const master = masterData.master;
  const artistLine = master.artists.map((a) => a.name).join(", ");

  const defaultTraversal: TraversalResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "master", source_discogs_id: Number(id), link_type: "releases", elapsed_ms: 0 },
  };

  // Fetch versions, main release detail, and cover art in parallel
  const mainReleaseId = master.main_release_discogs_id;

  const [releasesData, releaseDetail, coverData] = await Promise.all([
    digFetch<TraversalResponse>(`/v1/masters/${id}/releases?limit=40`, { revalidate: 300 })
      .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
      .catch(() => defaultTraversal),
    mainReleaseId
      ? digFetch<ReleaseResponse>(`/v1/releases/${mainReleaseId}`, { revalidate: 300 }).catch(() => null)
      : Promise.resolve(null),
    mainReleaseId
      ? digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${mainReleaseId}/cover`, { revalidate: 3600 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const mainRelease = releaseDetail && isReleaseResponse(releaseDetail) ? releaseDetail.release : null;
  const coverUrl = coverData?.cover?.url ?? null;

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
          <div className={styles.small}>No versions found.</div>
        )}
        {releasesData.links.map((link) => (
          <div key={link.discogs_id} className={styles.row}>
            <Link href={`/version/${link.discogs_id}`} className={styles.releaseTitle}>
              {link.title || `Version ${link.discogs_id}`}
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
}
