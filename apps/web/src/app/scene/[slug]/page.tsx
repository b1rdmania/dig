import Link from "next/link";
import { notFound } from "next/navigation";
import { digFetch, ApiRequestError } from "@/lib/api";
import type {
  ListScenesResponse,
  SceneDetailResponse,
  ScenePlaylistResponse,
  SceneWallResponse,
  WallStripLabel,
} from "@/lib/types";
import { CatalogWall, type WallScene } from "@/components/wall";
import { ErrorMessage } from "@/components/ErrorMessage";
import { ScenePlaylistPlayer } from "./ScenePlaylistPlayer";
import styles from "./page.module.css";

interface Props {
  params: Promise<{ slug: string }>;
}

export const revalidate = 3600;

// All scenes are prebuilt at deploy — 15 curated slugs, static HTML from
// the first request. New scenes appear via ISR without a redeploy.
export async function generateStaticParams() {
  try {
    const data = await digFetch<ListScenesResponse>("/v1/scenes", { revalidate: 3600 });
    return data.scenes.map((s) => ({ slug: s.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  try {
    const data = await digFetch<SceneDetailResponse>(`/v1/scenes/${slug}`, {
      revalidate: 3600,
    });
    const s = data.scene;
    const era = s.era_start && s.era_end ? `${s.era_start}–${s.era_end}` : null;
    const titleEra = era ? `, ${era}` : "";
    const title = `${s.name}${titleEra} — dig`;
    const description =
      s.blurb ?? `${s.name}: ${s.label_count} labels in the dig catalog wall.`;
    const ogUrl = `/api/og?kind=scene&slug=${encodeURIComponent(slug)}`;
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        images: [{ url: ogUrl, width: 1200, height: 630, alt: title }],
      },
      twitter: {
        card: "summary_large_image" as const,
        title,
        description,
        images: [ogUrl],
      },
    };
  } catch {
    return { title: "Scene — dig" };
  }
}

function sceneWallToWallScene(wall: SceneWallResponse["wall"]): WallScene {
  return {
    slug: wall.slug,
    name: wall.name,
    city: wall.city,
    era_start: wall.era_start,
    era_end: wall.era_end,
    axis: wall.axis,
    blurb: wall.blurb,
    palette: wall.palette,
    labels: wall.labels.map((l: WallStripLabel) => ({
      discogs_id: l.discogs_id,
      name: l.name,
      role: l.role,
      rank: l.rank,
      palette: l.palette,
      founded_year: l.founded_year,
      closed_year: l.closed_year,
      is_active: l.is_active,
      location: l.location,
      total_masters: l.total_masters,
      releases: l.releases.map((r) => ({
        master_discogs_id: r.master_discogs_id,
        title: r.title,
        primary_artist_name: r.primary_artist_name,
        year: r.year,
      })),
    })),
  };
}

export default async function ScenePage({ params }: Props) {
  const { slug } = await params;

  const [wallResult, detailResult, playlistResult] = await Promise.all([
    digFetch<SceneWallResponse>(`/v1/scenes/${slug}/wall?density=medium`, {
      revalidate: 3600,
    })
      .then((d) => ({ ok: true as const, data: d }))
      .catch((err: unknown) => ({ ok: false as const, err })),
    digFetch<SceneDetailResponse>(`/v1/scenes/${slug}`, { revalidate: 3600 })
      .then((d) => ({ ok: true as const, data: d }))
      .catch(() => ({ ok: false as const, err: null })),
    digFetch<ScenePlaylistResponse>(`/v1/scenes/${slug}/playlist`, { revalidate: 3600 })
      .then((d) => ({ ok: true as const, data: d }))
      .catch(() => ({ ok: false as const, err: null })),
  ]);

  if (!wallResult.ok) {
    const err = wallResult.err;
    if (err instanceof ApiRequestError) {
      if (err.status === 404) notFound();
      return <ErrorMessage code={err.code} message={err.message} />;
    }
    return <ErrorMessage message="Failed to load scene. Try again in a moment." />;
  }

  const wallData: SceneWallResponse = wallResult.data;
  const detailData: SceneDetailResponse | null = detailResult.ok ? detailResult.data : null;
  const playlist = playlistResult.ok ? playlistResult.data.playlist : null;

  const wall = wallData.wall;

  const scene: WallScene = sceneWallToWallScene(wall);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.heading}>{wall.name}</h1>
        {wall.blurb && <p className={styles.lede}>{wall.blurb}</p>}
      </header>

      {playlist && playlist.video_count > 0 && (
        <ScenePlaylistPlayer
          videoIds={playlist.records.map((r) => r.video_id)}
          watchUrl={playlist.playlist_url}
          count={playlist.video_count}
        />
      )}

      <CatalogWall
        scenes={[scene]}
        density="medium"
        showTitleBlock={false}
        showSceneHeaders={false}
      />

      {detailData && (detailData.scene.bridges_out.length > 0 || detailData.scene.bridges_in.length > 0) && (
        <BridgesSection scene={detailData.scene} />
      )}
    </div>
  );
}

function BridgesSection({ scene }: { scene: SceneDetailResponse["scene"] }) {
  const out = scene.bridges_out ?? [];
  const inn = scene.bridges_in ?? [];

  return (
    <section className={styles.bridges}>
      <h2 className={styles.bridgesHeading}>Bridges</h2>
      <div className={styles.bridgesGrid}>
        {out.map((b, i) => (
          <Link
            key={`out-${i}`}
            href={`/scene/${b.to_slug}`}
            className={styles.bridgeCard}
          >
            <div className={styles.bridgeHeader}>
              <span className={styles.bridgeArrow}>→</span>
              <span className={styles.bridgeKind}>{b.via_kind}</span>
              <span className={styles.bridgeName}>{b.via_name ?? "—"}</span>
            </div>
            <div className={styles.bridgeTo}>{b.to_slug}</div>
            {b.blurb && <p className={styles.bridgeBlurb}>{b.blurb}</p>}
          </Link>
        ))}
        {inn.map((b, i) => (
          <Link
            key={`in-${i}`}
            href={`/scene/${b.from_slug}`}
            className={`${styles.bridgeCard} ${styles.bridgeCardIn}`}
          >
            <div className={styles.bridgeHeader}>
              <span className={styles.bridgeArrow}>←</span>
              <span className={styles.bridgeKind}>{b.via_kind}</span>
              <span className={styles.bridgeName}>{b.via_name ?? "—"}</span>
            </div>
            <div className={styles.bridgeTo}>{b.from_slug}</div>
            {b.blurb && <p className={styles.bridgeBlurb}>{b.blurb}</p>}
          </Link>
        ))}
      </div>
    </section>
  );
}
