import type { Metadata } from "next";
import { firstYoutubeThumb } from "./media";

const BASE_URL = "https://app.dig.baby";

interface EntityMeta {
  title: string;
  description: string;
  path: string;
  type?: "artist" | "release" | "version" | "label";
  coverUrl?: string | null;
  videos?: Array<{ url?: string | null }>;
}

export function entityMetadata(meta: EntityMeta): Metadata {
  const fullTitle = `${meta.title} — Dig`;
  const url = `${BASE_URL}${meta.path}`;

  // Image priority: cover art > YouTube thumbnail > dynamic OG
  let imageUrl = meta.coverUrl || null;
  if (!imageUrl) {
    imageUrl = firstYoutubeThumb(meta.videos);
  }
  if (!imageUrl) {
    imageUrl = `${BASE_URL}/api/og?title=${encodeURIComponent(meta.title)}&type=${meta.type || "release"}`;
  }

  return {
    title: fullTitle,
    description: meta.description,
    openGraph: {
      title: fullTitle,
      description: meta.description,
      url,
      siteName: "Dig",
      type: "website",
      locale: "en_US",
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: meta.description,
      images: [imageUrl],
    },
  };
}
