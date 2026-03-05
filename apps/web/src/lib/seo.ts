import type { Metadata } from "next";
import { firstYoutubeThumb } from "./media";

const BASE_URL = "https://app.dig.baby";

const TYPE_LABELS: Record<string, string> = {
  artist: "Artist page",
  release: "Release page",
  version: "Version page",
  label: "Label page",
};

interface EntityMeta {
  title: string;
  description: string;
  path: string;
  type?: "artist" | "release" | "version" | "label";
  coverUrl?: string | null;
  videos?: Array<{ url?: string | null }>;
}

export function entityMetadata(meta: EntityMeta): Metadata {
  const pageTitle = `${meta.title} — dig`;
  const url = `${BASE_URL}${meta.path}`;
  const ogTitle = TYPE_LABELS[meta.type || "release"] || "dig";

  // Image priority: cover art > YouTube thumbnail > dynamic OG
  let imageUrl = meta.coverUrl || null;
  if (!imageUrl) {
    imageUrl = firstYoutubeThumb(meta.videos);
  }
  if (!imageUrl) {
    imageUrl = `${BASE_URL}/api/og?title=${encodeURIComponent(meta.title)}&type=${meta.type || "release"}`;
  }

  return {
    title: pageTitle,
    description: meta.description,
    openGraph: {
      title: ogTitle,
      description: meta.description,
      url,
      siteName: "dig",
      type: "website",
      locale: "en_US",
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: meta.description,
      images: [imageUrl],
    },
  };
}
