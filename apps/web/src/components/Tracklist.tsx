import Link from "next/link";
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
                track.credits.reduce<Record<string, Array<{ name: string; id: number }>>>((acc, credit) => {
                  const role = credit.role || "Other";
                  acc[role] = acc[role] || [];
                  acc[role].push({ name: credit.artist_name, id: credit.artist_discogs_id });
                  return acc;
                }, {}),
              ).map(([role, artists]) => (
                <div key={`${track.position_raw}-${role}`} className={styles.creditRow}>
                  <span className={styles.creditRole}>{role}</span>
                  <span className={styles.creditNames}>
                    {artists.map((artist, j) => (
                      <span key={`${artist.id}-${j}`}>
                        <Link href={`/artist/${artist.id}`} className={styles.creditLink}>
                          {artist.name}
                        </Link>
                        {j < artists.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </details>
      ))}
    </section>
  );
}
