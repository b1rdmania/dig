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
        <details key={`${track.position_raw}-${i}`} className={styles.track}>
          <summary className={styles.summary}>
            <span className={styles.position}>{track.position_raw}</span>
            <span className={styles.title}>{track.title}</span>
            <span className={styles.duration}>
              {formatDuration(track.duration_seconds)}
            </span>
          </summary>
          {track.credits.length > 0 && (
            <div className={styles.credits}>
              {Object.entries(
                track.credits.reduce<Record<string, string[]>>((acc, credit) => {
                  const role = credit.role || "Other";
                  acc[role] = acc[role] || [];
                  acc[role].push(credit.artist_name);
                  return acc;
                }, {}),
              ).map(([role, names]) => (
                <div key={`${track.position_raw}-${role}`} className={styles.creditRow}>
                  <span className={styles.creditRole}>{role}</span>
                  <span className={styles.creditNames}>{names.join(", ")}</span>
                </div>
              ))}
            </div>
          )}
        </details>
      ))}
    </section>
  );
}
