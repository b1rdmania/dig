"use client";

import { useState } from "react";
import type { ReleaseVideo } from "@/lib/types";
import { trackMediaPlayClicked, trackMediaShowMoreClicked } from "@/lib/analytics";
import styles from "./MediaSection.module.css";

const MAX_EMBEDS = 3;

interface VideoItem {
  youtubeId: string;
  url: string;
  title: string | null;
}

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    let raw: string | null = null;
    if (u.hostname.includes("youtube.com")) {
      raw = u.searchParams.get("v");
    } else if (u.hostname.includes("youtu.be")) {
      raw = u.pathname.slice(1).split("/")[0] || null;
    }
    if (raw && YT_ID_RE.test(raw)) return raw;
  } catch {
    // malformed URL
  }
  return null;
}

function dedupeVideos(videos: ReleaseVideo[]): VideoItem[] {
  const seen = new Set<string>();
  const items: VideoItem[] = [];
  for (const v of videos) {
    const id = extractYouTubeId(v.url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({ youtubeId: id, url: v.url, title: v.title });
  }
  return items;
}

function EmbedCard({ video, index }: { video: VideoItem; index: number }) {
  const [playing, setPlaying] = useState(false);

  const handlePlay = () => {
    setPlaying(true);
    trackMediaPlayClicked(video.youtubeId, index);
  };

  if (playing) {
    return (
      <div>
        <div className={styles.embed}>
          <iframe
            className={styles.iframe}
            src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1`}
            allow="autoplay; encrypted-media"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            title={video.title || "YouTube video"}
          />
        </div>
        {video.title && <div className={styles.videoTitle}>{video.title}</div>}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.embed} onClick={handlePlay}>
        <img
          className={styles.thumbnail}
          src={`https://img.youtube.com/vi/${video.youtubeId}/mqdefault.jpg`}
          alt={video.title || "Video thumbnail"}
          loading="lazy"
        />
        <div className={styles.playOverlay}>
          <svg className={styles.playIcon} viewBox="0 0 48 48" fill="currentColor">
            <path d="M16 10v28l22-14z" />
          </svg>
        </div>
      </div>
      {video.title && <div className={styles.videoTitle}>{video.title}</div>}
    </div>
  );
}

export function MediaSection({ videos }: { videos: ReleaseVideo[] }) {
  const items = dedupeVideos(videos);
  if (items.length === 0) return null;

  const embeds = items.slice(0, MAX_EMBEDS);
  const remaining = items.slice(MAX_EMBEDS);
  const [showMore, setShowMore] = useState(false);

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <h2 className={styles.heading}>Media</h2>
        <span className={styles.headMeta}>{items.length}</span>
      </header>
      <div className={styles.grid}>
        {embeds.map((v, i) => (
          <EmbedCard key={v.youtubeId} video={v} index={i} />
        ))}
      </div>
      {remaining.length > 0 && !showMore && (
        <button className={styles.showMore} onClick={() => { setShowMore(true); trackMediaShowMoreClicked(remaining.length); }}>
          +{remaining.length} more
        </button>
      )}
      {showMore && (
        <div className={styles.moreGrid}>
          {remaining.map((v, i) => (
            <EmbedCard key={v.youtubeId} video={v} index={MAX_EMBEDS + i} />
          ))}
        </div>
      )}
    </section>
  );
}
