import Link from "next/link";
import type { ReleaseCredit } from "@/lib/types";
import styles from "./Credits.module.css";

interface Props {
  credits: ReleaseCredit[];
}

export function Credits({ credits }: Props) {
  if (credits.length === 0) return null;

  // Group by role, preserving artist IDs for linking
  const grouped = new Map<string, Array<{ name: string; id: number }>>();
  for (const c of credits) {
    const role = c.role || "Other";
    const entries = grouped.get(role) || [];
    entries.push({ name: c.artist_name, id: c.artist_discogs_id });
    grouped.set(role, entries);
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Credits</h2>
      {Array.from(grouped.entries()).map(([role, artists]) => (
        <div key={role} className={styles.group}>
          <div className={styles.role}>{role}</div>
          <div className={styles.names}>
            {artists.map((artist, i) => (
              <span key={`${artist.id}-${i}`}>
                <Link href={`/artist/${artist.id}`} className={styles.artistLink}>
                  {artist.name}
                </Link>
                {i < artists.length - 1 ? ", " : ""}
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
