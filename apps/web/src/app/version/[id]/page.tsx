import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { digFetch, ApiRequestError } from "@/lib/api";
import { isReleaseResponse, type ReleaseResponse, type MarketResponse } from "@/lib/types";
import { entityMetadata, BASE_URL } from "@/lib/seo";
import { versionJsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { JsonLd } from "@/components/JsonLd";
import { ReleaseHero } from "@/components/ReleaseHero";
import { Tracklist } from "@/components/Tracklist";
import { Credits } from "@/components/Credits";
import { MediaSection } from "@/components/MediaSection";
import { Provenance } from "@/components/Provenance";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PageViewTracker } from "@/components/PageViewTracker";
import { ReleaseNav } from "@/components/ReleaseNav";
import { SectionSkeleton } from "@/components/SectionSkeleton";
import styles from "../../release/[id]/page.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  try {
    const data = await digFetch<ReleaseResponse>(`/v1/releases/${id}`, { revalidate: 300 });
    if (!isReleaseResponse(data)) return { title: "Version — dig" };
    const r = data.release;
    const artist = r.artists[0]?.name || "Unknown";
    const title = `${r.title} — ${artist}`;
    const desc = [r.title, "by", artist, r.genres.join(", "), r.release_year ? String(r.release_year) : ""].filter(Boolean).join(". ");

    const coverUrl = await digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${id}/cover`, { revalidate: 3600 })
      .then((d) => d?.cover?.url ?? null)
      .catch(() => null);

    const canonical = r.master_discogs_id
      ? `${BASE_URL}/release/${r.master_discogs_id}`
      : undefined;
    return entityMetadata({ title, description: desc, path: `/version/${id}`, type: "version", coverUrl, videos: r.videos, indexable: false, canonical });
  } catch {
    return { title: "Version — dig" };
  }
}

export default async function VersionPage({ params }: Props) {
  const { id } = await params;

  if (!/^\d+$/.test(id)) notFound();

  // Shell renders immediately. Release data streams in via Suspense so a slow
  // API response degrades gracefully instead of producing an error page.
  // data-dig-entity lets the no-dead-ends canary distinguish a stream-broken
  // shell (infrastructure fault) from a structural dead-end (data issue).
  return (
    <div className={styles.page} data-dig-entity="version" data-dig-id={id}>
      <Suspense fallback={<SectionSkeleton lines={4} />}>
        <VersionContent id={id} />
      </Suspense>
    </div>
  );
}

async function VersionContent({ id }: { id: string }) {
  try {
    const data = await digFetch<ReleaseResponse>(`/v1/releases/${id}`, { revalidate: 300 });

    if (!isReleaseResponse(data)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    const release = data.release;

    return (
      <>
        <PageViewTracker type="version" entityId={release.discogs_id} title={release.title} />
        <Suspense fallback={<ReleaseHero release={release} coverUrl={null} />}>
          <VersionHeroWithCover release={release} id={id} />
        </Suspense>
        {release.artists[0]?.discogs_id && release.master_discogs_id ? (
          <Suspense fallback={null}>
            <ReleaseNav artistId={release.artists[0].discogs_id} currentMasterId={release.master_discogs_id} />
          </Suspense>
        ) : null}
        <MediaSection videos={release.videos} />
        <Tracklist tracks={release.tracks} />
        <Credits credits={release.credits} />
        {release.notes && (
          <section className={styles.section}>
            <h2 className={styles.heading}>Notes</h2>
            <p className={styles.copy}>{release.notes}</p>
          </section>
        )}
        {release.tracks.length === 0 && release.credits.length === 0 && !release.master_discogs_id && (
          <section className={styles.section}>
            <p className={styles.small}>
              Limited data available for this pressing.{" "}
              <a href="/" className={styles.link}>Search Dig</a> for related releases.
            </p>
          </section>
        )}
        <JsonLd data={[
          versionJsonLd({ discogs_id: release.discogs_id, title: release.title, release_year: release.release_year, artists: release.artists, genres: release.genres, country: release.country, master_discogs_id: release.master_discogs_id }),
          breadcrumbJsonLd([
            { name: "dig", url: BASE_URL },
            { name: release.title, url: `${BASE_URL}/version/${release.discogs_id}` },
          ]),
        ]} />
        <Provenance provenance={release.provenance} />
      </>
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") notFound();
    if (err instanceof ApiRequestError && (err.code === "TIMEOUT" || err.status >= 500)) {
      // Slow or unavailable — graceful fallback (no TIMEOUT text in HTML)
      return (
        <section className={styles.section} style={{ paddingTop: "3rem", textAlign: "center" }}>
          <p className={styles.copy}>Unable to load this version right now.</p>
          <p className={styles.small} style={{ marginTop: "0.5rem" }}>
            <Link href="/" className={styles.link}>Back to search</Link>
          </p>
        </section>
      );
    }
    if (err instanceof ApiRequestError) {
      return <ErrorMessage code={err.code} message={err.message} />;
    }
    return <ErrorMessage message="Failed to load version" />;
  }
}

/** Hero with cover art and market data streamed in. */
async function VersionHeroWithCover({ release, id }: { release: ReleaseResponse["release"]; id: string }) {
  const [coverData, marketData] = await Promise.all([
    digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${id}/cover`, { revalidate: 3600 }).catch(() => null),
    digFetch<MarketResponse>(`/v1/releases/${id}/market`, { revalidate: 3600 }).catch(() => null),
  ]);

  const coverUrl = coverData?.cover?.url ?? null;
  const market = marketData?.market ?? null;

  return <ReleaseHero release={release} coverUrl={coverUrl} market={market} />;
}
