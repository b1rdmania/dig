import Link from "next/link";
import { notFound } from "next/navigation";
import { digFetch, ApiRequestError } from "@/lib/api";
import type {
  SceneDetailResponse,
  ScenePlaylistResponse,
  SceneWallResponse,
  WallStripLabel,
} from "@/lib/types";
import { CatalogWall, type WallScene } from "@/components/wall";
import { ErrorMessage } from "@/components/ErrorMessage";
import { TrailRecorder } from "@/components/TrailRecorder";
import { ScenePlaylistPlayer } from "./ScenePlaylistPlayer";
import styles from "./page.module.css";

interface Props {
  params: Promise<{ slug: string }>;
}

export const revalidate = 600;

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  try {
    const data = await digFetch<SceneWallResponse>(`/v1/scenes/${slug}/wall?density=compact`, {
      revalidate: 600,
    });
    const era =
      data.wall.era_start && data.wall.era_end
        ? `${data.wall.era_start}–${data.wall.era_end}`
        : null;
    const titleEra = era ? `, ${era}` : "";
    const title = `${data.wall.name}${titleEra} — dig`;
    const description =
      data.wall.blurb ??
      `${data.wall.name}: ${data.wall.label_count} labels in the dig catalog wall.`;
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

const AXIS_LABEL: Record<string, string> = {
  geography: "scene",
  cluster: "cluster",
  sound: "sound",
  era: "era",
  bridge: "bridge",
  micro: "micro",
};

function formatEra(start: number | null, end: number | null): string | null {
  if (start == null && end == null) return null;
  if (start != null && end != null) return `${start}–${end}`;
  if (start != null) return `${start}–`;
  if (end != null) return `?–${end}`;
  return null;
}

export default async function ScenePage({ params }: Props) {
  const { slug } = await params;

  const [wallResult, detailResult, playlistResult] = await Promise.all([
    digFetch<SceneWallResponse>(`/v1/scenes/${slug}/wall?density=medium`, {
      revalidate: 600,
    })
      .then((d) => ({ ok: true as const, data: d }))
      .catch((err: unknown) => ({ ok: false as const, err })),
    digFetch<SceneDetailResponse>(`/v1/scenes/${slug}`, { revalidate: 600 })
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
  const era = formatEra(wall.era_start, wall.era_end);
  const accent = wall.palette?.accent ?? "#1a1a1a";

  const scene: WallScene = sceneWallToWallScene(wall);

  return (
    <div className={styles.page} style={{ "--scene-accent": accent } as React.CSSProperties}>
      <TrailRecorder
        kind="scene"
        id={wall.slug}
        name={wall.name}
        subtitle={wall.city ?? undefined}
      />
      <header className={styles.pageHeader}>
        <div className={styles.crumbs}>
          <Link href="/scene" className={styles.crumbLink}>
            ← all scenes
          </Link>
        </div>
        <div className={styles.eyebrow}>
          <span className={styles.axisBadge}>{AXIS_LABEL[wall.axis] ?? wall.axis}</span>
          {wall.city && <span>{wall.city}</span>}
          {era && (
            <>
              <span className={styles.metaSep}>·</span>
              <span className={styles.eyebrowEra}>{era}</span>
            </>
          )}
        </div>
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
