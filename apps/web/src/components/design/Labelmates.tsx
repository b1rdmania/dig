import Link from "next/link";
import { digFetch } from "@/lib/api";
import {
  isArtistPrimaryLabelsResponse,
  isLabelRosterResponse,
  type ArtistPrimaryLabelsResponse,
  type LabelRosterResponse,
} from "@/lib/types";
import styles from "./Labelmates.module.css";

interface Props {
  artistDiscogsId: number;
  /** Number of labelmates to show (default 6). */
  limit?: number;
}

/**
 * Server component that derives an artist's primary label and renders the
 * top other artists on that label. Used in the sidebar of the artist page.
 *
 * Logic:
 *   1. Fetch the artist's top primary labels (`/v1/artists/:id/labels`).
 *   2. Take the first (highest master count). If none, render nothing.
 *   3. Fetch that label's roster (`/v1/labels/:id/roster?limit=12`).
 *   4. Filter out the source artist; show up to `limit` others.
 *
 * If any fetch fails the section silently renders nothing — labelmates
 * is decorative context, not core info.
 */
export async function Labelmates({ artistDiscogsId, limit = 6 }: Props) {
  let labelsData: ArtistPrimaryLabelsResponse;
  try {
    labelsData = await digFetch<ArtistPrimaryLabelsResponse>(
      `/v1/artists/${artistDiscogsId}/labels?limit=3`,
      { revalidate: 600 },
    );
  } catch {
    return null;
  }
  if (!isArtistPrimaryLabelsResponse(labelsData)) return null;

  const primary = labelsData.labels[0];
  if (!primary) return null;

  let rosterData: LabelRosterResponse;
  try {
    rosterData = await digFetch<LabelRosterResponse>(
      `/v1/labels/${primary.discogs_label_id}/roster?limit=${limit + 4}`,
      { revalidate: 600 },
    );
  } catch {
    return null;
  }
  if (!isLabelRosterResponse(rosterData)) return null;

  const mates = rosterData.roster
    .filter((r) => r.artist_discogs_id !== artistDiscogsId)
    .slice(0, limit);

  if (mates.length === 0) return null;

  return (
    <section className={styles.block} aria-label="Labelmates">
      <p className={styles.eyebrow}>LABELMATES</p>
      <h3 className={styles.title}>
        On{" "}
        <Link href={`/label/${primary.discogs_label_id}`}>{primary.name}</Link>
      </h3>
      <ul className={styles.list}>
        {mates.map((mate) => (
          <li className={styles.item} key={mate.artist_discogs_id}>
            <Link href={`/artist/${mate.artist_discogs_id}`} className={styles.name}>
              {mate.name}
            </Link>
            <span className={styles.count}>
              {mate.master_count} master{mate.master_count === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.foot}>
        Top in-scope artists on this label · {primary.master_count} share{primary.master_count === 1 ? "" : "d"} master{primary.master_count === 1 ? "" : "s"} with you
      </p>
    </section>
  );
}
