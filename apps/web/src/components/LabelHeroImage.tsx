/**
 * LabelHeroImage — fetches enrich.entity_images for a label and renders the
 * best available mark.
 *
 * Resolution priority:
 *   1. logo  (Wikidata P154 — typically a clean wordmark / monochrome)
 *   2. photo (P18 — could be a building/founder photo, used as fallback hero)
 *
 * Render mode:
 *   - "mark" (default): big logo image + tiny attribution caption.
 *     Falls back to nothing if no image exists (the wordmark plate already
 *     handles that case in the parent layout).
 *   - "hero": full-bleed background photo with subtle gradient overlay.
 *
 * Image URLs come back as Wikimedia Commons Special:FilePath URLs which
 * support `?width=NNN` for in-flight thumbnailing — we request 800px for
 * marks (sharp on 2x retina, light over the wire) and 1600px for heros.
 *
 * No image proxy yet — Commons CDN serves directly. We keep the option
 * open via api.image_proxy_path on the response when we ship it.
 */

import { digFetch } from "@/lib/api";
import { isEntityImagesResponse, type EntityImagesResponse, type EntityImage } from "@/lib/types";
import styles from "./LabelHeroImage.module.css";

interface Props {
  discogsId: number;
  labelName: string;
  mode?: "mark" | "hero";
}

export async function LabelHeroImage({ discogsId, labelName, mode = "mark" }: Props) {
  const width = mode === "hero" ? 1600 : 800;
  let data: EntityImagesResponse;
  try {
    data = await digFetch<EntityImagesResponse>(
      `/v1/labels/${discogsId}/images?width=${width}`,
      { revalidate: 86_400 },
    );
  } catch {
    return null;
  }
  if (!isEntityImagesResponse(data) || data.images.length === 0) return null;

  const logo = data.images.find((i) => i.kind === "logo");
  const hero = data.images.find((i) => i.kind === "hero");
  const photo = data.images.find((i) => i.kind === "photo");

  if (mode === "hero") {
    const bg = hero ?? photo ?? logo;
    if (!bg) return null;
    // Force https on the raw source_url to avoid mixed-content warnings.
    const bgHttps = bg.source_url.replace(/^http:\/\//, "https://");
    return (
      <div
        className={styles.hero}
        role="img"
        aria-label={labelName}
        style={{ backgroundImage: `url("${bgHttps}?width=1600")` }}
      >
        <div className={styles.heroOverlay} aria-hidden />
        <ImageAttribution image={bg} className={styles.heroAttrib} />
      </div>
    );
  }

  const mark = logo ?? hero ?? photo;
  if (!mark) return null;
  // eslint-disable-next-line @next/next/no-img-element — Commons URLs are not
  //  in next.config remotePatterns, and we deliberately want the CDN to serve
  //  + cache the original. next/image would re-encode through Vercel and add
  //  cost without benefit at our scale.
  return (
    <figure className={styles.mark}>
      <img
        src={mark.url}
        alt={`${labelName} logo`}
        className={styles.markImg}
        loading="eager"
      />
      <ImageAttribution image={mark} className={styles.markAttrib} />
    </figure>
  );
}

function ImageAttribution({ image, className }: { image: EntityImage; className?: string }) {
  if (!image.attribution) return null;
  const sourceLabel =
    image.source === "wikidata"
      ? "Wikimedia Commons"
      : image.source === "musicbrainz"
        ? "MusicBrainz"
        : image.source;
  // Wikidata QID → entity page on Wikidata
  const sourceHref =
    image.source === "wikidata" && image.source_id
      ? `https://www.wikidata.org/wiki/${image.source_id}`
      : null;
  return (
    <figcaption className={className}>
      Image via{" "}
      {sourceHref ? (
        <a href={sourceHref} target="_blank" rel="noopener noreferrer">
          {sourceLabel}
        </a>
      ) : (
        sourceLabel
      )}
    </figcaption>
  );
}
