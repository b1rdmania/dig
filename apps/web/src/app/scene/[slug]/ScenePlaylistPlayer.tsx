"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

interface Props {
  videoIds: string[];
  /** watch_videos link for people who'd rather have it in YouTube proper. */
  watchUrl: string | null;
  count: number;
}

/**
 * Embedded YouTube player over the scene's records, reshuffled on every
 * visit so the same record never fronts the scene twice. Client-side so
 * the shuffle isn't frozen into the ISR cache.
 */
export function ScenePlaylistPlayer({ videoIds, watchUrl, count }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const idsKey = videoIds.join(",");

  useEffect(() => {
    const ids = idsKey.split(",").filter(Boolean);
    if (ids.length === 0) return;
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setSrc(
      `https://www.youtube-nocookie.com/embed/${ids[0]}?playlist=${ids.slice(1).join(",")}&rel=0`,
    );
  }, [idsKey]);

  if (videoIds.length === 0) return null;

  return (
    <section className={styles.playBlock}>
      <div className={styles.playRow}>
        <span className={styles.playLabel}>Press play</span>
        <span className={styles.playMeta}>
          the scene in {count} records, shuffled
          {watchUrl && (
            <>
              {" · "}
              <a href={watchUrl} target="_blank" rel="noreferrer" className={styles.playOut}>
                open on YouTube
              </a>
            </>
          )}
        </span>
      </div>
      {src && (
        <iframe
          className={styles.playFrame}
          src={src}
          title={`Scene playlist, ${count} records`}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      )}
    </section>
  );
}
