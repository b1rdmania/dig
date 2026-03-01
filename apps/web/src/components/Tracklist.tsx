import type { Track } from "@/lib/types";
import { formatDuration } from "@/lib/format";
import styles from "./Tracklist.module.css";

interface Props {
  tracks: Track[];
}

export function Tracklist({ tracks }: Props) {
  if (tracks.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Tracklist</h2>
      {tracks.map((track, i) => (
        <div key={`${track.position_raw}-${i}`} className={styles.track}>
          <span className={styles.position}>{track.position_raw}</span>
          <span className={styles.title}>{track.title}</span>
          <span className={styles.duration}>
            {formatDuration(track.duration_seconds)}
          </span>
        </div>
      ))}
    </section>
  );
}
