/**
 * ArtistPhoto — small portrait/avatar fetched from enrich.entity_images for
 * an artist (Wikidata P18). Sits next to the H1 in the artist identity block.
 *
 * Renders nothing if the artist has no image — the H1 alone holds up fine.
 */

import { digFetch } from "@/lib/api";
import { isEntityImagesResponse, type EntityImagesResponse } from "@/lib/types";
import styles from "./ArtistPhoto.module.css";

interface Props {
  discogsId: number;
  artistName: string;
  /** Pixel size of the rendered tile (also drives the Commons thumb width). */
  size?: number;
}

export async function ArtistPhoto({ discogsId, artistName, size = 160 }: Props) {
  let data: EntityImagesResponse;
  try {
    data = await digFetch<EntityImagesResponse>(
      // Request 2x for retina sharpness; CSS clamps display size.
      `/v1/artists/${discogsId}/images?width=${size * 2}`,
      { revalidate: 86_400 },
    );
  } catch {
    return null;
  }
  if (!isEntityImagesResponse(data) || data.images.length === 0) return null;

  const photo = data.images.find((i) => i.kind === "photo") ?? data.images[0];
  if (!photo) return null;

  // Resolve a click-through attribution link. Wikidata-sourced rows point at
  // the Wikidata entity; hand-curated Commons rows (source='manual') point
  // back to the Commons File page so the license claim stays auditable.
  const commonsFile = photo.source_id?.startsWith("Commons:File:")
    ? photo.source_id.slice("Commons:".length)
    : null;
  const sourceHref =
    photo.source === "wikidata" && photo.source_id
      ? `https://www.wikidata.org/wiki/${photo.source_id}`
      : commonsFile
        ? `https://commons.wikimedia.org/wiki/${encodeURI(commonsFile)}`
        : null;

  return (
    <figure className={styles.wrap} style={{ ["--photo-size" as string]: `${size}px` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- see LabelHeroImage */}
      <img
        src={photo.url}
        alt={artistName}
        className={styles.img}
        loading="eager"
        width={size}
        height={size}
      />
      <figcaption className={styles.attrib}>
        Photo via{" "}
        {sourceHref ? (
          <a href={sourceHref} target="_blank" rel="noopener noreferrer">
            Wikimedia Commons
          </a>
        ) : (
          "Wikimedia Commons"
        )}
      </figcaption>
    </figure>
  );
}
