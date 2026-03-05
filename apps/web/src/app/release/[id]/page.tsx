import { Suspense } from "react";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ApiRequestError, digFetch } from "@/lib/api";
import {
  isMasterVideosResponse,
  isMasterResponse,
  isReleaseResponse,
  isTraversalResponse,
  type MasterVideosResponse,
  type MasterResponse,
  type ReleaseResponse,
  type TraversalResponse,
} from "@/lib/types";
import { discogsUrl } from "@/lib/format";
import { entityMetadata } from "@/lib/seo";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Tracklist } from "@/components/Tracklist";
import { Credits } from "@/components/Credits";
import { Provenance } from "@/components/Provenance";
import { PageViewTracker } from "@/components/PageViewTracker";
import { OutboundLink } from "@/components/OutboundLink";
import { MediaSection } from "@/components/MediaSection";
import { SectionSkeleton } from "@/components/SectionSkeleton";
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
      const m = data.master;
      const artist = m.artists[0]?.name || "Unknown";
      const title = `${m.title} — ${artist}`;
      const parts = [m.title, "by", artist];
      if (m.genres.length) parts.push(m.genres.join(", "));
      if (m.year) parts.push(String(m.year));

      // Try to get cover art for OG image
      let coverUrl: string | null = null;
      if (m.main_release_discogs_id) {
        coverUrl = await digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${m.main_release_discogs_id}/cover`, { revalidate: 3600 })
          .then((d) => d?.cover?.url ?? null)
          .catch(() => null);
      }

      return entityMetadata({ title, description: `${parts.join(". ")}.`, path: `/release/${id}`, type: "release", coverUrl });
    }
  } catch {
    // Not a master — try release
    try {
      const data = await digFetch<ReleaseResponse>(`/v1/releases/${id}`, { revalidate: 300 });
      if (isReleaseResponse(data)) {
        const r = data.release;
        const artist = r.artists[0]?.name || "Unknown";
        const title = `${r.title} — ${artist}`;
        return entityMetadata({ title, description: `${r.title} by ${artist}.`, path: `/release/${id}`, type: "release" });
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
    const master = masterData.master;
    const artistLine = master.artists.map((a) => a.name).join(", ");

    return (
      <div className={styles.page}>
        <PageViewTracker type="release" entityId={master.discogs_id} title={master.title} />

        {/* ── Hero: renders immediately from master data ── */}
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <div className={styles.cover}>
              {/* Cover streams in via ReleaseDetails; show placeholder initially */}
              <Suspense fallback={<CoverPlaceholder />}>
                <ReleaseCover id={id} mainReleaseId={master.main_release_discogs_id} title={master.title} />
              </Suspense>
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
                <OutboundLink
                  href={discogsUrl("master", master.discogs_id)}
                  entityType="master"
                  entityId={master.discogs_id}
                  className={styles.link}
                >
                  Open on Discogs
                </OutboundLink>
              </div>
            </div>
          </div>
        </section>

        {/* ── Tracklist + Credits + Notes: stream in from main release fetch ── */}
        <Suspense fallback={<SectionSkeleton lines={6} />}>
          <ReleaseDetails mainReleaseId={master.main_release_discogs_id} />
        </Suspense>

        {/* ── Media: streams in from master videos fetch ── */}
        <Suspense fallback={<SectionSkeleton lines={3} />}>
          <ReleaseMedia id={id} />
        </Suspense>

        {/* ── Versions: streams in from traversal fetch ── */}
        <Suspense fallback={<SectionSkeleton lines={4} />}>
          <ReleaseVersions id={id} />
        </Suspense>

        <Provenance provenance={master.provenance} />
      </div>
    );
  }

  // Not a master — redirect to /version/:id (it's a specific pressing)
  redirect(`/version/${id}`);
}

/* ── Async streamed sections ── */

function CoverPlaceholder() {
  return (
    <div className={styles.coverPlaceholder}>
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.vinylIcon}>
        <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
        <circle cx="24" cy="24" r="15" stroke="currentColor" strokeWidth="0.75" opacity="0.2" />
        <circle cx="24" cy="24" r="8" stroke="currentColor" strokeWidth="0.75" opacity="0.2" />
        <circle cx="24" cy="24" r="3" fill="currentColor" opacity="0.3" />
      </svg>
    </div>
  );
}

/** Cover art: fetches cover for main release, shows image or placeholder. */
async function ReleaseCover({ id, mainReleaseId, title }: { id: string; mainReleaseId: number | null; title: string }) {
  if (!mainReleaseId) return <CoverPlaceholder />;

  const coverData = await digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${mainReleaseId}/cover`, { revalidate: 3600 })
    .catch(() => null);

  const coverUrl = coverData?.cover?.url ?? null;

  if (!coverUrl) return <CoverPlaceholder />;

  return (
    <img
      src={coverUrl}
      alt={`${title} cover art`}
      className={styles.coverImg}
      loading="eager"
    />
  );
}

/** Tracklist + Credits + Notes from the main release. */
async function ReleaseDetails({ mainReleaseId }: { mainReleaseId: number | null }) {
  if (!mainReleaseId) return null;

  const releaseDetail = await digFetch<ReleaseResponse>(`/v1/releases/${mainReleaseId}`, { revalidate: 300 })
    .catch(() => null);

  const mainRelease = releaseDetail && isReleaseResponse(releaseDetail) ? releaseDetail.release : null;
  if (!mainRelease) return null;

  return (
    <>
      <Tracklist tracks={mainRelease.tracks} />
      <Credits credits={mainRelease.credits} />
      {mainRelease.notes && (
        <section className={styles.section}>
          <h2 className={styles.heading}>Notes</h2>
          <p className={styles.copy}>{mainRelease.notes}</p>
        </section>
      )}
    </>
  );
}

/** Media section: fetches aggregated master videos. */
async function ReleaseMedia({ id }: { id: string }) {
  const defaultVideos = { videos: [], meta: { source_type: "master" as const, source_discogs_id: Number(id), elapsed_ms: 0 } };

  const data = await digFetch<MasterVideosResponse>(`/v1/masters/${id}/videos?limit=200`, { revalidate: 300 })
    .then((d) => (isMasterVideosResponse(d) ? d : defaultVideos))
    .catch(() => defaultVideos);

  if (data.videos.length === 0) return null;

  return <MediaSection videos={data.videos} />;
}

/** Versions list: fetches releases traversal for this master. */
async function ReleaseVersions({ id }: { id: string }) {
  const defaultTraversal: TraversalResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "master", source_discogs_id: Number(id), link_type: "releases", elapsed_ms: 0 },
  };

  const data = await digFetch<TraversalResponse>(`/v1/masters/${id}/releases?limit=40`, { revalidate: 300 })
    .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
    .catch(() => defaultTraversal);

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        Versions ({data.links.length})
      </h2>
      {data.links.length === 0 && (
        <div className={styles.small}>No versions found.</div>
      )}
      {data.links.map((link) => (
        <div key={link.discogs_id} className={styles.versionRow}>
          <Link href={`/version/${link.discogs_id}`} className={styles.releaseTitle}>
            {link.title || `Version ${link.discogs_id}`}
          </Link>
          <span className={styles.versionMeta}>
            {link.format && <span className={styles.versionTag}>{link.format}</span>}
            {link.country && <span className={styles.versionTag}>{link.country}</span>}
            <span>{link.year || "—"}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
