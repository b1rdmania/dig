import { Suspense } from "react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ApiRequestError, digFetch } from "@/lib/api";
import {
  isMasterResponse,
  isReleaseShadowResponse,
  isTraversalResponse,
  type MasterResponse,
  type ReleaseShadowResponse,
  type TraversalResponse,
  type LabelResponse,
} from "@/lib/types";
import { discogsUrl, formatDuration } from "@/lib/format";
import { entityMetadata, BASE_URL } from "@/lib/seo";
import { musicAlbumJsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { JsonLd } from "@/components/JsonLd";
import { firstYoutubeThumb } from "@/lib/media";
import { ErrorMessage } from "@/components/ErrorMessage";
import { MediaSection } from "@/components/MediaSection";
import { Provenance } from "@/components/Provenance";
import { PageViewTracker } from "@/components/PageViewTracker";
import { OutboundLink } from "@/components/OutboundLink";
import { ShareBar } from "@/components/ShareBar";
import { SectionSkeleton } from "@/components/SectionSkeleton";
import { ReleaseNavRenderer } from "@/components/ReleaseNav";
import styles from "./page.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

/* ── Metadata ───────────────────────────────────────────────────────── */

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return { title: "Master — dig" };

  try {
    const data = await digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 });
    if (!isMasterResponse(data)) return { title: "Master — dig" };
    const m = data.master;
    const artistName = m.primary_artist.name ?? m.artists[0]?.name ?? "Unknown";
    const title = `${m.title} — ${artistName}`;

    let coverUrl: string | null = null;
    if (m.main_release_discogs_id) {
      coverUrl = await digFetch<{ cover: { url: string | null } | null }>(
        `/v1/releases/${m.main_release_discogs_id}/cover`,
        { revalidate: 3600 },
      )
        .then((d) => d?.cover?.url ?? null)
        .catch(() => null);
    }

    const desc = [
      m.title,
      "by",
      artistName,
      m.primary_label.name ? `on ${m.primary_label.name}` : "",
      m.genres.length ? m.genres.join(", ") : "",
      m.year ? String(m.year) : "",
    ]
      .filter(Boolean)
      .join(". ");

    return entityMetadata({
      title,
      description: desc,
      path: `/master/${id}`,
      type: "release",
      coverUrl,
      videos: m.videos,
    });
  } catch {
    return { title: "Master — dig" };
  }
}

/* ── Page entry ─────────────────────────────────────────────────────── */

export default async function MasterPage({ params }: Props) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  // Resolve the master (or shadow → redirect) BEFORE opening Suspense.
  // permanentRedirect works by throwing NEXT_REDIRECT for upstream Next.js
  // to intercept; if we let it fire from inside <Suspense> the response
  // headers are already locked to 200 and Next falls back to a meta-refresh
  // tag instead of a real 308. Doing this lookup at the page boundary adds
  // ~80ms of blocking TTFB but eliminates the meta-refresh hop on every
  // /release/:id → /master/:release_id → /master/:master_id chain.
  let masterData: MasterResponse | null = null;
  let masterErr: ApiRequestError | null = null;
  try {
    const data = await digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 });
    if (isMasterResponse(data)) masterData = data;
  } catch (err) {
    if (err instanceof ApiRequestError) masterErr = err;
  }

  if (!masterData) {
    if (!masterErr || masterErr.code === "NOT_FOUND") {
      // Try shadow lookup (this id might be a release id, not a master id).
      // Wrap only the FETCH in try/catch — call permanentRedirect outside,
      // otherwise the NEXT_REDIRECT throw would be swallowed.
      let shadowMasterId: number | null = null;
      try {
        const data = await digFetch<ReleaseShadowResponse>(`/v1/release_shadow/${id}`, {
          revalidate: 300,
        });
        if (isReleaseShadowResponse(data) && data.release_shadow.master_discogs_id) {
          shadowMasterId = data.release_shadow.master_discogs_id;
        }
      } catch {
        // No shadow row either → genuine 404 below.
      }
      if (shadowMasterId !== null) {
        permanentRedirect(`/master/${shadowMasterId}`);
      }
      notFound();
    }
    if (masterErr.code === "TIMEOUT" || masterErr.status >= 500) {
      return (
        <div className={styles.page}>
          <section className={styles.section} style={{ paddingTop: "3rem", textAlign: "center" }}>
            <p className={styles.copy}>Unable to load this master right now.</p>
            <p className={styles.small} style={{ marginTop: "0.5rem" }}>
              <Link href="/" className={styles.link}>Back to search</Link>
            </p>
          </section>
        </div>
      );
    }
    return (
      <div className={styles.page}>
        <ErrorMessage code={masterErr.code} message={masterErr.message} />
      </div>
    );
  }

  return (
    <div className={styles.page} data-dig-entity="master" data-dig-id={id}>
      <Suspense fallback={<SectionSkeleton lines={4} />}>
        <MasterContent id={id} masterData={masterData} />
      </Suspense>
    </div>
  );
}

/* ── Render helpers ─────────────────────────────────────────────────── */

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

function CoverRenderer({
  coverUrl,
  title,
  videos,
}: {
  coverUrl: string | null;
  title: string;
  videos: Array<{ url: string }>;
}) {
  if (coverUrl) {
    return <img src={coverUrl} alt={`${title} cover art`} className={styles.coverImg} loading="eager" />;
  }
  const thumbUrl = firstYoutubeThumb(videos);
  if (thumbUrl) {
    return <img src={thumbUrl} alt={`${title} preview`} className={styles.coverImg} loading="eager" />;
  }
  return <CoverPlaceholder />;
}

function MasterTracklistRenderer({ tracks }: { tracks: MasterResponse["master"]["tracks"] }) {
  if (tracks.length === 0) return null;
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Tracklist</h2>
      {tracks.map((t, i) => (
        <div key={`${t.position ?? i}-${i}`} className={styles.track}>
          <span className={styles.position}>{t.position ?? "—"}</span>
          <span className={styles.trackTitle}>
            {t.title ?? "(untitled)"}
            {t.artists_text && <span className={styles.trackArtists}>— {t.artists_text}</span>}
          </span>
          <span className={styles.duration}>{formatDuration(t.duration_seconds)}</span>
        </div>
      ))}
    </section>
  );
}

function NotableVersionsRenderer({
  data,
  videosByRelease,
}: {
  data: TraversalResponse;
  videosByRelease: Map<number, { url: string; title: string | null }>;
}) {
  if (data.links.length === 0) return null;
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Notable Versions ({data.links.length})</h2>
      {data.links.map((link) => {
        const video = videosByRelease.get(link.discogs_id);
        const isMain = (link as unknown as { is_main_release?: boolean }).is_main_release === true;
        return (
          <div key={link.discogs_id} className={styles.versionRow}>
            <span className={styles.versionMain}>
              {isMain && <span className={styles.mainBadge}>Main</span>}
              <span className={styles.versionTitle}>{link.title || `Version ${link.discogs_id}`}</span>
            </span>
            <span className={styles.versionMeta}>
              {link.format && <span className={styles.versionTag}>{link.format}</span>}
              {link.country && <span className={styles.versionTag}>{link.country}</span>}
              <span>{link.year || "—"}</span>
              {video && (
                <a
                  href={video.url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.versionLink}
                  title={video.title ?? "Watch on YouTube"}
                >
                  ▶ Listen
                </a>
              )}
              <OutboundLink
                href={discogsUrl("release", link.discogs_id)}
                entityType="release"
                entityId={link.discogs_id}
                className={styles.versionLink}
              >
                Discogs
              </OutboundLink>
            </span>
          </div>
        );
      })}
    </section>
  );
}

/* ── Main streaming component ───────────────────────────────────────── */

async function MasterContent({ id, masterData }: { id: string; masterData: MasterResponse }) {
  const master = masterData.master;
  const mainReleaseId = master.main_release_discogs_id;
  const primaryArtistId =
    master.primary_artist.discogs_id ?? master.artists[0]?.discogs_id ?? null;
  const primaryArtistName =
    master.primary_artist.name ?? master.artists[0]?.name ?? null;
  const primaryLabelId = master.primary_label.discogs_id;
  const primaryLabelName = master.primary_label.name;

  const defaultTraversal: TraversalResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "master", source_discogs_id: Number(id), link_type: "releases", elapsed_ms: 0 },
  };

  // Phase 2: parallel — cover art, notable versions, label tier, artist nav rail.
  const [coverUrl, versionsData, labelTier, navData] = await Promise.all([
    mainReleaseId
      ? digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${mainReleaseId}/cover`, {
          revalidate: 3600,
        })
          .then((d) => d?.cover?.url ?? null)
          .catch(() => null)
      : Promise.resolve<string | null>(null),
    digFetch<TraversalResponse>(`/v1/masters/${id}/releases?limit=40`, { revalidate: 300 })
      .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
      .catch(() => defaultTraversal),
    primaryLabelId
      ? digFetch<LabelResponse>(`/v1/labels/${primaryLabelId}`, { revalidate: 3600 })
          .then((d) => (d as LabelResponse | undefined)?.label?.tier ?? null)
          .catch(() => null)
      : Promise.resolve<"tier1" | "denylist" | null>(null),
    primaryArtistId
      ? digFetch<TraversalResponse>(`/v1/artists/${primaryArtistId}/masters?sort=newest&limit=500`, {
          revalidate: 300,
        })
          .then((d) => (isTraversalResponse(d) ? d.links : []))
          .catch(() => [])
      : Promise.resolve<TraversalResponse["links"]>([]),
  ]);

  // Build a map: release_id → first YouTube video for that pressing.
  // Lets us put "▶ Listen" buttons inline with each Notable Version row.
  const videosByRelease = new Map<number, { url: string; title: string | null }>();
  for (const v of master.videos) {
    if (
      v.source_type === "release" &&
      typeof v.source_release_discogs_id === "number" &&
      !videosByRelease.has(v.source_release_discogs_id)
    ) {
      videosByRelease.set(v.source_release_discogs_id, { url: v.url, title: v.title });
    }
  }

  const isTier1 = labelTier === "tier1";

  return (
    <>
      <PageViewTracker type="release" entityId={master.discogs_id} title={master.title} />

      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.cover}>
            <CoverRenderer coverUrl={coverUrl} title={master.title} videos={master.videos} />
          </div>
          <div className={styles.info}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{master.title}</h1>
              {isTier1 && <span className={styles.tier1Badge} title="Canonical scene label">Tier 1</span>}
            </div>

            {(primaryArtistName || primaryLabelName) && (
              <div className={styles.byline}>
                {primaryArtistName && (
                  primaryArtistId ? (
                    <Link href={`/artist/${primaryArtistId}`} className={styles.artistLink}>
                      {primaryArtistName}
                    </Link>
                  ) : (
                    <span>{primaryArtistName}</span>
                  )
                )}
                {primaryArtistName && primaryLabelName && " · "}
                {primaryLabelName && (
                  primaryLabelId ? (
                    <Link href={`/label/${primaryLabelId}`} className={styles.labelLink}>
                      {primaryLabelName}
                    </Link>
                  ) : (
                    <span>{primaryLabelName}</span>
                  )
                )}
              </div>
            )}

            <div className={styles.meta}>
              {master.year && <span>{master.year}</span>}
              {master.primary_country && <span>{master.primary_country}</span>}
              {master.primary_format && <span>{master.primary_format}</span>}
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
              <ShareBar
                url={`${BASE_URL}/master/${master.discogs_id}`}
                title={master.title}
                entityType="release"
                entityId={master.discogs_id}
              />
            </div>
          </div>
        </div>
      </section>

      <ReleaseNavRenderer masters={navData} currentMasterId={master.discogs_id} />

      <MediaSection
        videos={master.videos.map((v) => ({
          url: v.url,
          title: v.title,
          duration_seconds: v.duration_seconds,
        }))}
      />

      <MasterTracklistRenderer tracks={master.tracks} />

      <NotableVersionsRenderer data={versionsData} videosByRelease={videosByRelease} />

      <JsonLd
        data={[
          musicAlbumJsonLd({
            discogs_id: master.discogs_id,
            title: master.title,
            year: master.year,
            artists: master.artists,
            genres: master.genres,
          }),
          breadcrumbJsonLd([
            { name: "dig", url: BASE_URL },
            { name: master.title, url: `${BASE_URL}/master/${master.discogs_id}` },
          ]),
        ]}
      />

      <Provenance provenance={master.provenance} />
    </>
  );
}
