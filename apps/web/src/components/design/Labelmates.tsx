import Link from "next/link";
import { digFetch } from "@/lib/api";
import styles from "./Labelmates.module.css";

interface Props {
  artistDiscogsId: number;
  /** Number of labelmates to show (default 10). */
  limit?: number;
}

interface Labelmate {
  discogs_id: number;
  name: string | null;
  shared_records: number;
  shared_labels: number;
  labels: string[];
}

interface LabelmatesResponse {
  artist_discogs_id: number;
  labelmates: Labelmate[];
}

function isLabelmatesResponse(x: unknown): x is LabelmatesResponse {
  if (!x || typeof x !== "object") return false;
  return Array.isArray((x as LabelmatesResponse).labelmates);
}

/**
 * "Labelmates" on the artist page. Aggregated across every indie-scene
 * label where the subject released ≥2 masters as primary artist, ranked by
 * IDF-weighted overlap so sprawling major-label contracts don't swamp the
 * tight indies. Each entry shows the names of the shared labels as chips
 * so the user can tell *why* someone is a labelmate at a glance — this
 * was the old component's flaw (it picked a single label and showed its
 * roster without explaining the choice).
 *
 * Self-network (aliases, groups the artist is in, members when the subject
 * is a group) is excluded at the API layer — those show up in "See also"
 * instead.
 *
 * Renders nothing if the artist has no qualifying shared-label peers; that
 * is correct for micro-discographies (one-off releases across scattered
 * labels don't produce meaningful labelmate signal).
 */
export async function Labelmates({ artistDiscogsId, limit = 10 }: Props) {
  let data: LabelmatesResponse;
  try {
    data = await digFetch<LabelmatesResponse>(
      `/v1/artists/${artistDiscogsId}/labelmates?limit=${limit}`,
      { revalidate: 600 },
    );
  } catch {
    return null;
  }
  if (!isLabelmatesResponse(data) || data.labelmates.length === 0) return null;

  return (
    <section className={styles.block} aria-label="Labelmates">
      <p className={styles.eyebrow}>LABELMATES</p>
      <ul className={styles.list}>
        {data.labelmates.map((mate) => (
          <li className={styles.item} key={mate.discogs_id}>
            <Link href={`/artist/${mate.discogs_id}`} className={styles.name}>
              {mate.name ?? `Artist ${mate.discogs_id}`}
            </Link>
            {mate.labels.length > 0 ? (
              <span className={styles.labels}>
                {mate.labels.slice(0, 2).map((label) => (
                  <span key={label} className={styles.label}>
                    {label}
                  </span>
                ))}
                {mate.labels.length > 2 ? (
                  <span className={styles.labelMore}>+{mate.labels.length - 2}</span>
                ) : null}
              </span>
            ) : null}
            <span className={styles.count}>
              {mate.shared_records}{" "}
              <span className={styles.countUnit}>
                record{mate.shared_records === 1 ? "" : "s"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.foot}>
        Other artists on the labels you put records out on.
      </p>
    </section>
  );
}
