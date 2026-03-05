import type { Metadata } from "next";

const BASE_URL = "https://app.dig.baby";

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      return YT_ID_RE.test(id) ? id : null;
    }
    if (u.hostname.endsWith("youtube.com")) {
      // /watch?v=ID or /embed/ID
      const vParam = u.searchParams.get("v");
      if (vParam && YT_ID_RE.test(vParam)) return vParam;
      const embedMatch = u.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})$/);
      if (embedMatch) return embedMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function youtubeThumbUrl(videoUrl: string): string | null {
  const id = extractYouTubeId(videoUrl);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

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
  if (!imageUrl && meta.videos) {
    for (const v of meta.videos) {
      if (v.url) {
        const thumb = youtubeThumbUrl(v.url);
        if (thumb) { imageUrl = thumb; break; }
      }
    }
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
