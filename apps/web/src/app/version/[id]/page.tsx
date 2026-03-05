import { Suspense } from "react";
import { notFound } from "next/navigation";
import { digFetch, ApiRequestError } from "@/lib/api";
import { isReleaseResponse, type ReleaseResponse } from "@/lib/types";
import { ReleaseHero } from "@/components/ReleaseHero";
import { Tracklist } from "@/components/Tracklist";
import { Credits } from "@/components/Credits";
import { MediaSection } from "@/components/MediaSection";
import { Provenance } from "@/components/Provenance";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PageViewTracker } from "@/components/PageViewTracker";
import styles from "../../release/[id]/page.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  try {
    const data = await digFetch<ReleaseResponse>(`/v1/releases/${id}`, {
      revalidate: 300,
    });
    if (!isReleaseResponse(data)) return { title: "Version — Dig" };
    const r = data.release;
    const artist = r.artists[0]?.name || "Unknown";
    return {
      title: `${r.title} — ${artist} — Dig`,
      description: `${r.title} by ${artist}. ${r.genres.join(", ")}. ${r.release_year || ""}`.trim(),
    };
  } catch {
    return { title: "Version — Dig" };
  }
}

export default async function VersionPage({ params }: Props) {
  const { id } = await params;

  if (!/^\d+$/.test(id)) notFound();

  try {
    // Fetch release data (needed for everything). Cover streams in separately.
    const data = await digFetch<ReleaseResponse>(`/v1/releases/${id}`, { revalidate: 300 });

    if (!isReleaseResponse(data)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    const release = data.release;

    return (
      <div className={styles.page}>
        <PageViewTracker type="version" entityId={release.discogs_id} title={release.title} />
        <Suspense fallback={<ReleaseHero release={release} coverUrl={null} />}>
          <VersionHeroWithCover release={release} id={id} />
        </Suspense>
        <Tracklist tracks={release.tracks} />
        <Credits credits={release.credits} />
        <MediaSection videos={release.videos} />
        {release.notes && (
          <section className={styles.section}>
            <h2 className={styles.heading}>Notes</h2>
            <p className={styles.copy}>{release.notes}</p>
          </section>
        )}
        <Provenance provenance={release.provenance} />
      </div>
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") {
      notFound();
    }
    if (err instanceof ApiRequestError) {
      return <ErrorMessage code={err.code} message={err.message} />;
    }
    return <ErrorMessage message="Failed to load version" />;
  }
}

/** Hero with cover art streamed in. */
async function VersionHeroWithCover({ release, id }: { release: ReleaseResponse["release"]; id: string }) {
  const coverData = await digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${id}/cover`, { revalidate: 3600 })
    .catch(() => null);

  const coverUrl = coverData?.cover?.url ?? null;

  return <ReleaseHero release={release} coverUrl={coverUrl} />;
}
