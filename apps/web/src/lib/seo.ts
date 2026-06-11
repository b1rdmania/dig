import type { Metadata } from "next";
import { firstYoutubeThumb } from "./media";

export const BASE_URL = "https://app.dig.baby";

interface EntityMeta {
  title: string;
  description: string;
  path: string;
  type?: "artist" | "release" | "version" | "label";
  coverUrl?: string | null;
  videos?: Array<{ url?: string | null }>;
  /** Whether search engines should index this page. Defaults to true. */
  indexable?: boolean;
  /** Override the canonical URL (e.g. point version pages to parent release). */
  canonical?: string;
}

export function entityMetadata(meta: EntityMeta): Metadata {
  const indexable = meta.indexable ?? true;
  const pageTitle = `${meta.title} — dig`;
  const url = `${BASE_URL}${meta.path}`;
  const canonicalUrl = meta.canonical ?? url;
  const ogTitle = meta.title;

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
    alternates: { canonical: canonicalUrl },
    robots: { index: indexable, follow: true },
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
