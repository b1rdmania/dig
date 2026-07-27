/**
 * Master page → grouped credits panel.
 *
 * Track-level credits roll up by track position; release-level credits
 * (Mastered By, A&R, etc.) get their own grouping at the bottom. Roles
 * become inline chips. Each artist is a link to their page so users can
 * trail-walk into adjacent productions.
 */
import Link from "next/link";
import { digFetch } from "@/lib/api";
import {
  isMasterCreditsResponse,
  type MasterCreditsResponse,
  type MasterTrackCreditLine,
} from "@/lib/types";
import styles from "./MasterCreditsSection.module.css";

interface Props {
  masterDiscogsId: number;
}

interface ArtistRow {
  artist_discogs_id: number;
  artist_name: string;
  anv: string | null;
  roles: string[];
}

function rollupArtists(lines: Array<{ artist_discogs_id: number; artist_name: string; anv: string | null; role: string }>): ArtistRow[] {
  const byArtist = new Map<number, ArtistRow>();
  for (const l of lines) {
    let row = byArtist.get(l.artist_discogs_id);
    if (!row) {
      row = { artist_discogs_id: l.artist_discogs_id, artist_name: l.artist_name, anv: l.anv, roles: [] };
      byArtist.set(l.artist_discogs_id, row);
    }
    if (!row.roles.includes(l.role)) row.roles.push(l.role);
  }
  return Array.from(byArtist.values());
}

function ArtistList({ rows }: { rows: ArtistRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className={styles.artistList}>
      {rows.map((r) => (
        <li key={r.artist_discogs_id} className={styles.artistRow}>
          <Link href={`/artist/${r.artist_discogs_id}`} className={styles.artistName}>
            {r.anv && r.anv.trim() !== "" ? r.anv : r.artist_name}
          </Link>
          <span className={styles.roles}>
            {r.roles.map((role) => (
              <span key={role} className={styles.roleChip}>
                {role}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export async function MasterCreditsSection({ masterDiscogsId }: Props) {
  let data: MasterCreditsResponse | null = null;
  try {
    const res = await digFetch<MasterCreditsResponse>(
      `/v1/masters/${masterDiscogsId}/credits`,
      { revalidate: 600 },
    );
    if (isMasterCreditsResponse(res)) data = res;
  } catch {
    return null;
  }
  if (!data) return null;
  if (data.track_credits.length === 0 && data.release_credits.length === 0) return null;

  // Group track credits by position. Tracks with no position fall into a
  // "Throughout" bucket so we never lose them.
  const byPosition = new Map<string, MasterTrackCreditLine[]>();
  const positionOrder: string[] = [];
  for (const line of data.track_credits) {
    const key = line.track_position?.trim() || "—";
    if (!byPosition.has(key)) {
      byPosition.set(key, []);
      positionOrder.push(key);
    }
    byPosition.get(key)!.push(line);
  }

  const releaseRows = rollupArtists(
    data.release_credits.map((l) => ({
      artist_discogs_id: l.artist_discogs_id,
      artist_name: l.artist_name,
      anv: l.anv,
      role: l.role,
    })),
  );

  const totalTrackCredits = data.track_credits.length;
  const totalReleaseCredits = data.release_credits.length;

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <h2 className={styles.heading}>Credits</h2>
        <span className={styles.headMeta}>{totalTrackCredits + totalReleaseCredits}</span>
      </header>

      {positionOrder.length > 0 && (
        <div className={styles.trackBlock}>
          {positionOrder.map((pos) => {
            const lines = byPosition.get(pos)!;
            const title = lines.find((l) => l.track_title)?.track_title ?? null;
            const rows = rollupArtists(lines);
            return (
              <div key={pos} className={styles.trackGroup}>
                <div className={styles.trackHeader}>
                  <span className={styles.position}>{pos}</span>
                  {title && <span className={styles.trackTitle}>{title}</span>}
                </div>
                <ArtistList rows={rows} />
              </div>
            );
          })}
        </div>
      )}

      {releaseRows.length > 0 && (
        <div className={styles.releaseBlock}>
          <div className={styles.releaseHeading}>Release</div>
          <ArtistList rows={releaseRows} />
        </div>
      )}
    </section>
  );
}
