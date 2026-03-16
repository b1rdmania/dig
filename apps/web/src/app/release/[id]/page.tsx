import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
import { entityMetadata, BASE_URL } from "@/lib/seo";
import { musicAlbumJsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { JsonLd } from "@/components/JsonLd";
import { firstYoutubeThumb } from "@/lib/media";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Tracklist } from "@/components/Tracklist";
import { Credits } from "@/components/Credits";
import { Provenance } from "@/components/Provenance";
import { PageViewTracker } from "@/components/PageViewTracker";
import { OutboundLink } from "@/components/OutboundLink";
import { MediaSection } from "@/components/MediaSection";
import { SectionSkeleton } from "@/components/SectionSkeleton";
import { ReleaseNavRenderer } from "@/components/ReleaseNav";
import { FavoriteButton } from "@/components/FavoriteButton";
import { AddToMixtapeButton } from "@/components/AddToMixtapeButton";
import { ShareBar } from "@/components/ShareBar";
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

      let coverUrl: string | null = null;
      if (m.main_release_discogs_id) {
        coverUrl = await digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${m.main_release_discogs_id}/cover`, { revalidate: 3600 })
          .then((d) => d?.cover?.url ?? null)
          .catch(() => null);
      }

      const desc = [m.title, "by", artist, m.genres.length ? m.genres.join(", ") : "", m.year ? String(m.year) : ""].filter(Boolean).join(". ");
      return entityMetadata({ title, description: desc, path: `/release/${id}`, type: "release", coverUrl, videos: m.videos });
    }
  } catch {
    // Not a master — page component will redirect to /version/:id.
  }
  return { title: "Release — dig" };
}

export default async function ReleasePage({ params }: Props) {
  const { id } = await params;

  if (!/^\d+$/.test(id)) notFound();

  // One streaming boundary. ReleaseMasterContent fans out all secondary fetches
  // via Promise.all after the initial master lookup — no nested Suspense boundaries.
  return (
    <div className={styles.page} data-dig-entity="release" data-dig-id={id}>
      <Suspense fallback={<ReleasePageSkeleton />}>
        <ReleaseMasterContent id={id} />
      </Suspense>
    </div>
  );
}

function ReleasePageSkeleton() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroContent}>
        <div className={styles.cover}><CoverPlaceholder /></div>
        <div className={styles.info}>
          <SectionSkeleton lines={4} />
        </div>
      </div>
    </section>
  );
}

/* ── Sync render helpers (accept pre-fetched data) ── */

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

function CoverRenderer({ coverUrl, title, videos }: { coverUrl: string | null; title: string; videos?: Array<{ url?: string | null }> }) {
  if (coverUrl) {
    return <img src={coverUrl} alt={`${title} cover art`} className={styles.coverImg} loading="eager" />;
  }
  const thumbUrl = firstYoutubeThumb(videos);
  if (thumbUrl) {
    return <img src={thumbUrl} alt={`${title} preview`} className={styles.coverImg} loading="eager" />;
  }
  return <CoverPlaceholder />;
}

function ReleaseDetailsRenderer({ release }: { release: ReleaseResponse["release"] | null }) {
  if (!release) return null;
  return (
    <>
      <MediaSection videos={release.videos} />
      <Tracklist tracks={release.tracks} />
      <Credits credits={release.credits} />
      {release.notes && (
        <section className={styles.section}>
          <h2 className={styles.heading}>Notes</h2>
          <p className={styles.copy}>{release.notes}</p>
        </section>
      )}
    </>
  );
}

function ReleaseVersionsRenderer({ data }: { data: TraversalResponse }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Versions ({data.links.length})</h2>
      {data.links.length === 0 && <div className={styles.small}>No versions found.</div>}
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

/* ── Main streaming component ── */

async function ReleaseMasterContent({ id }: { id: string }) {
  // Phase 1: fetch master (needed to determine redirect vs render)
  let masterData: MasterResponse | null = null;
  try {
    const data = await digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 });
    if (isMasterResponse(data)) masterData = data;
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") {
      // Not a master — fall through to pressing redirect below
    } else if (err instanceof ApiRequestError && (err.code === "TIMEOUT" || err.status >= 500)) {
      return (
        <section className={styles.section} style={{ paddingTop: "3rem", textAlign: "center" }}>
          <p className={styles.copy}>Unable to load this release right now.</p>
          <p className={styles.small} style={{ marginTop: "0.5rem" }}>
            <Link href="/" className={styles.link}>Back to search</Link>
          </p>
        </section>
      );
    } else if (err instanceof ApiRequestError) {
      return <ErrorMessage code={err.code} message={err.message} />;
    }
  }

  if (!masterData) {
    redirect(`/version/${id}`);
  }

  const master = masterData.master;
  const mainReleaseId = master.main_release_discogs_id;
  const artistId = master.artists[0]?.discogs_id ?? null;

  const defaultTraversal: TraversalResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "master", source_discogs_id: Number(id), link_type: "releases", elapsed_ms: 0 },
  };

  // Phase 2: fan out all secondary fetches in parallel
  const [coverUrl, releaseDetail, versionsData, navData] = await Promise.all([
    mainReleaseId
      ? digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${mainReleaseId}/cover`, { revalidate: 3600 })
          .then((d) => d?.cover?.url ?? null)
          .catch(() => null)
      : Promise.resolve<string | null>(null),
    mainReleaseId
      ? digFetch<ReleaseResponse>(`/v1/releases/${mainReleaseId}`, { revalidate: 300 })
          .then((d) => (isReleaseResponse(d) ? d.release : null))
          .catch(() => null)
      : Promise.resolve(null),
    digFetch<TraversalResponse>(`/v1/masters/${id}/releases?limit=40`, { revalidate: 300 })
      .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
      .catch(() => defaultTraversal),
    artistId && master.discogs_id
      ? digFetch<TraversalResponse>(`/v1/artists/${artistId}/catalog_releases?sort=newest&limit=500`, { revalidate: 300 })
          .then((d) => (isTraversalResponse(d) ? d.links : []))
          .catch(() => [])
      : Promise.resolve<TraversalResponse["links"]>([]),
  ]);

  const artistLine = master.artists.map((a) => a.name).join(", ");

  return (
    <>
      <PageViewTracker type="release" entityId={master.discogs_id} title={master.title} />

      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.cover}>
            <CoverRenderer coverUrl={coverUrl} title={master.title} videos={master.videos} />
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
                {master.genres.map((g) => <span className={styles.tag} key={`g-${g}`}>{g}</span>)}
                {master.styles.map((s) => <span className={styles.tag} key={`s-${s}`}>{s}</span>)}
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
              <FavoriteButton entityType="release" discogsId={master.discogs_id} />
              <AddToMixtapeButton
                sourceEntityType="master"
                sourceDiscogsId={master.discogs_id}
                name={master.title}
                artist={master.artists[0]?.name ?? null}
              />
              <ShareBar
                url={`${BASE_URL}/release/${master.discogs_id}`}
                title={master.title}
                entityType="release"
                entityId={master.discogs_id}
              />
            </div>
          </div>
        </div>
      </section>

      <ReleaseNavRenderer masters={navData} currentMasterId={master.discogs_id} />
      <ReleaseDetailsRenderer release={releaseDetail} />
      <ReleaseVersionsRenderer data={versionsData} />

      <JsonLd data={[
        musicAlbumJsonLd({ discogs_id: master.discogs_id, title: master.title, year: master.year, artists: master.artists, genres: master.genres }),
        breadcrumbJsonLd([
          { name: "dig", url: BASE_URL },
          { name: master.title, url: `${BASE_URL}/release/${master.discogs_id}` },
        ]),
      ]} />
      <Provenance provenance={master.provenance} />
    </>
  );
}
