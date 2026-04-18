import { digFetch } from "@/lib/api";
import type { ListScenesResponse, SceneWallResponse, WallStripLabel } from "@/lib/types";
import type { WallScene } from "@/components/wall";

/**
 * Fetch every scene's wall payload in parallel. Returns the projected
 * `WallScene[]` shape consumed by the CatalogWall composer.
 *
 * Failures on a single scene are logged and dropped from the response so a
 * partial outage degrades the wall rather than 500-ing the page.
 *
 * Cached at the digFetch layer (revalidate: 300s) so an entire wall render
 * costs at most one round-trip per scene per 5 minutes.
 */
export async function fetchAllSceneWalls(
  density: "compact" | "medium" | "full",
  perLabel: number | null,
): Promise<WallScene[]> {
  const list = await digFetch<ListScenesResponse>("/v1/scenes", { revalidate: 300 });

  const qs = new URLSearchParams({ density });
  if (perLabel) qs.set("per_label", String(perLabel));

  const walls = await Promise.all(
    list.scenes.map((s) =>
      digFetch<SceneWallResponse>(`/v1/scenes/${s.slug}/wall?${qs.toString()}`, {
        revalidate: 300,
      }).catch((err) => {
        console.error(`Failed to fetch wall for ${s.slug}:`, err);
        return null;
      }),
    ),
  );

  return walls
    .filter((w): w is SceneWallResponse => w !== null)
    .map((w) => sceneWallToWallScene(w.wall));
}

export function sceneWallToWallScene(wall: SceneWallResponse["wall"]): WallScene {
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
