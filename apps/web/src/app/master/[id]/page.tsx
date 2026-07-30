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
} from "@/lib/types";
import { discogsUrl, formatDuration } from "@/lib/format";
import { entityMetadata, BASE_URL } from "@/lib/seo";
import { musicAlbumJsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { JsonLd } from "@/components/JsonLd";
import { firstYoutubeThumb } from "@/lib/media";
import { ErrorMessage } from "@/components/ErrorMessage";
import { MediaSection } from "@/components/MediaSection";
import { PageViewTracker } from "@/components/PageViewTracker";
import { OutboundLink } from "@/components/OutboundLink";
import { SectionSkeleton } from "@/components/SectionSkeleton";
import { Page, Stamp, LinerNotes } from "@/components/design";
import { MasterCreditsSection } from "@/components/MasterCreditsSection";
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

  // Resolve the master (or shadow → redirect) BEFORE opening Suspense so that
  // permanentRedirect can fire as a real HTTP 308. Same reasoning as before.
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
        <Page entityType="master" entityId={id}>
          <p className={styles.error}>
            Unable to load this master right now. <Link href="/">Back to search</Link>.
          </p>
        </Page>
      );
    }
    return (
      <Page entityType="master" entityId={id}>
        <ErrorMessage code={masterErr.code} message={masterErr.message} />
      </Page>
    );
  }

  return (
    <Suspense fallback={<SectionSkeleton lines={6} />}>
      <MasterContent id={id} masterData={masterData} />
    </Suspense>
  );
}

/* ── Cover ─────────────────────────────────────────────────────────── */

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
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={coverUrl} alt={`${title} cover art`} className={styles.coverImg} loading="eager" />;
  }
  const thumbUrl = firstYoutubeThumb(videos);
  if (thumbUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumbUrl} alt={`${title} preview`} className={styles.coverImg} loading="eager" />;
  }
  return <CoverPlaceholder />;
}

/* ── Tracklist (side-aware) ────────────────────────────────────────── */

function detectSide(position: string | null): string | null {
  if (!position) return null;
  const m = position.trim().match(/^([A-Z])\d+/);
  return m ? m[1] : null;
}

function MasterTracklistRenderer({ tracks }: { tracks: MasterResponse["master"]["tracks"] }) {
  if (tracks.length === 0) return null;

  // Group by detected side label (A/B/C/D…). If no sides detected, the
  // single bucket renders without any side heading.
  const groups: Array<{ side: string | null; tracks: typeof tracks }> = [];
  let current: { side: string | null; tracks: typeof tracks } | null = null;
  for (const t of tracks) {
    const side = detectSide(t.position);
    if (!current || current.side !== side) {
      current = { side, tracks: [] };
      groups.push(current);
    }
    current.tracks.push(t);
  }
  const sided = groups.some((g) => g.side !== null);

  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Tracklist</h2>
        <span className={styles.sectionMeta}>
          {tracks.length} track{tracks.length === 1 ? "" : "s"}
        </span>
      </header>
      {groups.map((g, gi) => (
        <div key={`side-${gi}`}>
          {sided && g.side && (
            <div className={styles.sideHeading}>Side {g.side}</div>
          )}
          {g.tracks.map((t, i) => (
            <div key={`${gi}-${t.position ?? i}-${i}`} className={styles.track}>
              <span className={styles.position}>{t.position ?? "—"}</span>
              <span className={styles.trackTitle}>
                {t.title ?? "(untitled)"}
                {t.artists_text && <span className={styles.trackArtists}>— {t.artists_text}</span>}
              </span>
              <span className={styles.duration}>{formatDuration(t.duration_seconds)}</span>
            </div>
          ))}
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
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Notable Versions</h2>
        <span className={styles.sectionMeta}>{data.links.length}</span>
      </header>
      {data.links.map((link) => {
        const video = videosByRelease.get(link.discogs_id);
        const isMain = (link as unknown as { is_main_release?: boolean }).is_main_release === true;
        return (
          <div key={link.discogs_id} className={styles.versionRow}>
            <span className={styles.versionMain}>
              {isMain && <span className={styles.mainTag}>Main</span>}
              <span className={styles.versionTitle}>{link.title || `Version ${link.discogs_id}`}</span>
            </span>
            <span className={styles.versionMeta}>
              {link.format && <Stamp>{link.format}</Stamp>}
              {link.country && <Stamp>{link.country}</Stamp>}
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

  // Phase 2: parallel — cover art, notable versions.
  const [coverUrl, versionsData] = await Promise.all([
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
  ]);

  // Build a map: release_id → first YouTube video for that pressing.
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


  return (
    <Page
      entityType="master"
      entityId={master.discogs_id}
    >
      <PageViewTracker type="release" entityId={master.discogs_id} title={master.title} />

      <section className={styles.hero}>
        <div className={styles.heroBody}>
          <div className={styles.cover}>
            <CoverRenderer coverUrl={coverUrl} title={master.title} videos={master.videos} />
          </div>
          <div className={styles.info}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{master.title}</h1>
            </div>

            {(primaryArtistName || primaryLabelName) && (
              <div className={styles.byline}>
                {primaryArtistName &&
                  (primaryArtistId ? (
                    <Link href={`/artist/${primaryArtistId}`} className={styles.bylineLink}>
                      {primaryArtistName}
                    </Link>
                  ) : (
                    <span>{primaryArtistName}</span>
                  ))}
                {primaryArtistName && primaryLabelName && <span className={styles.bylineSep}>·</span>}
                {primaryLabelName &&
                  (primaryLabelId ? (
                    <Link href={`/label/${primaryLabelId}`} className={styles.bylineLink}>
                      {primaryLabelName}
                    </Link>
                  ) : (
                    <span>{primaryLabelName}</span>
                  ))}
              </div>
            )}

            <div className={styles.metaStrip}>
              {master.year && (
                <span className={styles.metaItem}>
                  <span className={styles.metaKey}>Year</span>
                  <span className={styles.metaVal}>{master.year}</span>
                </span>
              )}
              {master.primary_country && (
                <span className={styles.metaItem}>
                  <span className={styles.metaKey}>Country</span>
                  <span className={styles.metaVal}>{master.primary_country}</span>
                </span>
              )}
              {master.primary_format && (
                <span className={styles.metaItem}>
                  <span className={styles.metaKey}>Format</span>
                  <span className={styles.metaVal}>{master.primary_format}</span>
                </span>
              )}
              {master.tracks.length > 0 && (
                <span className={styles.metaItem}>
                  <span className={styles.metaKey}>Tracks</span>
                  <span className={styles.metaVal}>{master.tracks.length}</span>
                </span>
              )}
              {versionsData.links.length > 0 && (
                <span className={styles.metaItem}>
                  <span className={styles.metaKey}>Versions</span>
                  <span className={styles.metaVal}>{versionsData.links.length}</span>
                </span>
              )}
            </div>

            {(master.genres.length > 0 || master.styles.length > 0) && (
              <div className={styles.tags}>
                {master.genres.map((g) => (
                  <Link
                    href={`/search?type=master&genre=${encodeURIComponent(g)}`}
                    className={styles.tag}
                    key={`g-${g}`}
                  >
                    {g}
                  </Link>
                ))}
                {master.styles.map((s) => (
                  <Link
                    href={`/search?type=master&style=${encodeURIComponent(s)}`}
                    className={styles.tag}
                    key={`s-${s}`}
                  >
                    {s}
                  </Link>
                ))}
              </div>
            )}

            <div className={styles.actions}>
              <OutboundLink
                href={discogsUrl("master", master.discogs_id)}
                entityType="master"
                entityId={master.discogs_id}
                className={styles.discogsLink}
              >
                Open on Discogs
              </OutboundLink>
            </div>
          </div>
        </div>
      </section>

      <MediaSection
        videos={master.videos.map((v) => ({
          url: v.url,
          title: v.title,
          duration_seconds: v.duration_seconds,
        }))}
      />

      <MasterTracklistRenderer tracks={master.tracks} />

      <Suspense fallback={null}>
        <MasterCreditsSection masterDiscogsId={master.discogs_id} />
      </Suspense>

      <NotableVersionsRenderer data={versionsData} videosByRelease={videosByRelease} />

      {master.artists_credit_text && (
        <div className={styles.section}>
          <LinerNotes eyebrow="LINER NOTES">
            <LinerNotes.Section label="Credits">
              <p>{master.artists_credit_text}</p>
            </LinerNotes.Section>
            {master.genres.length + master.styles.length > 0 && (
              <LinerNotes.Section label="Genres &amp; styles">
                <p>{[...master.genres, ...master.styles].join(" · ")}</p>
              </LinerNotes.Section>
            )}
          </LinerNotes>
        </div>
      )}

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
    </Page>
  );
}
