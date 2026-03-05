const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      return YT_ID_RE.test(id) ? id : null;
    }
    if (u.hostname.endsWith("youtube.com")) {
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

/** Scan a videos array and return the first valid YouTube thumbnail URL. */
export function firstYoutubeThumb(videos?: Array<{ url?: string | null }>): string | null {
  if (!videos) return null;
  for (const v of videos) {
    if (v.url) {
      const thumb = youtubeThumbUrl(v.url);
      if (thumb) return thumb;
    }
  }
  return null;
}
