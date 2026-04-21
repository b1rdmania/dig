import Link from "next/link";
import { digFetch } from "@/lib/api";
import styles from "./SeeAlso.module.css";

interface Props {
  artistDiscogsId: number;
  /** Max items per bucket (both Close collaborators and Also in). */
  limitPerBucket?: number;
}

// ── Shapes ──────────────────────────────────────────────────────────────────
// These mirror the API responses narrowly — we don't import from @/lib/types
// because these responses are only consumed here.
interface RelatedEdge {
  discogs_id: number;
  name: string | null;
  master_count: number;
}
interface RelatedResponse {
  artist_discogs_id: number;
  groups: RelatedEdge[];
  members: RelatedEdge[];
  bandmates: RelatedEdge[];
}
interface Collaborator {
  discogs_id: number;
  name: string | null;
  masters_together: number;
  roles: string[];
}
interface CollaboratorsResponse {
  artist_discogs_id: number;
  collaborators: Collaborator[];
}

function isRelatedResponse(x: unknown): x is RelatedResponse {
  if (!x || typeof x !== "object") return false;
  const r = x as RelatedResponse;
  return Array.isArray(r.groups);
}
function isCollaboratorsResponse(x: unknown): x is CollaboratorsResponse {
  if (!x || typeof x !== "object") return false;
  return Array.isArray((x as CollaboratorsResponse).collaborators);
}

/**
 * "See also" surface on the artist page. Two lenses into the scene:
 *
 *   Close collaborators — the credit constellation. People who show up on
 *                         this artist's records (as producer, engineer,
 *                         mix, vocalist, remixer, co-writer), ranked by
 *                         distinct masters together. This is the *actual*
 *                         connective tissue of dance music — Def Mix
 *                         (Knuckles / Morales / Tomiie / Kupper), Murk
 *                         (Oscar G / Ralph Falcon), long-running producer-
 *                         vocalist lines (Larry Heard + Robert Owens).
 *
 *   Also in             — formal groups this artist is a member of. Only
 *                         surfaces where the scene took collective names
 *                         (MAW, Inner City, Fingers Inc., Underground
 *                         Resistance). Silently absent for most artists.
 *
 * If both are empty the whole block renders nothing.
 */
export async function SeeAlso({ artistDiscogsId, limitPerBucket = 10 }: Props) {
  // Fire both lookups in parallel — one read on master_artists +
  // master_track/release_credits, one read on artist_group_members. Each
  // gracefully degrades: a failure on either side still lets the other bucket
  // render, which keeps the block useful even under partial outages.
  const [collabData, relatedData] = await Promise.all([
    digFetch<CollaboratorsResponse>(
      `/v1/artists/${artistDiscogsId}/collaborators?limit=${limitPerBucket}`,
      { revalidate: 600 },
    ).catch(() => null),
    digFetch<RelatedResponse>(
      `/v1/artists/${artistDiscogsId}/related`,
      { revalidate: 600 },
    ).catch(() => null),
  ]);

  const collaborators =
    collabData && isCollaboratorsResponse(collabData) ? collabData.collaborators : [];
  const groups =
    relatedData && isRelatedResponse(relatedData)
      ? relatedData.groups.slice(0, limitPerBucket)
      : [];

  if (collaborators.length === 0 && groups.length === 0) return null;

  return (
    <section className={styles.block} aria-label="See also">
      <p className={styles.eyebrow}>SEE ALSO</p>
      {collaborators.length > 0 ? (
        <Bucket label="Close collaborators">
          {collaborators.map((c) => (
            <li className={styles.item} key={c.discogs_id}>
              <Link href={`/artist/${c.discogs_id}`} className={styles.name}>
                {c.name ?? `Artist ${c.discogs_id}`}
              </Link>
              <RoleChips roles={c.roles} />
              <span className={styles.count}>
                {c.masters_together} master{c.masters_together === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </Bucket>
      ) : null}
      {groups.length > 0 ? (
        <Bucket label="Also in">
          {groups.map((g) => (
            <li className={styles.item} key={g.discogs_id}>
              <Link href={`/artist/${g.discogs_id}`} className={styles.name}>
                {g.name ?? `Artist ${g.discogs_id}`}
              </Link>
              <span className={styles.count}>
                {g.master_count} master{g.master_count === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </Bucket>
      ) : null}
    </section>
  );
}

function Bucket({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.bucket}>
      <h3 className={styles.bucketHead}>{label}</h3>
      <ul className={styles.list}>{children}</ul>
    </div>
  );
}

/**
 * Render up to 3 normalized role names as inline chips. More than 3 would
 * push the row to two lines on mobile — the long tail is signal-poor anyway
 * (someone credited 1 time on 1 record as "Additional Production" doesn't
 * need a chip next to their name).
 */
function RoleChips({ roles }: { roles: string[] }) {
  const primary = roles.slice(0, 3);
  if (primary.length === 0) return null;
  return (
    <span className={styles.roles}>
      {primary.map((r) => (
        <span key={r} className={styles.role}>
          {r}
        </span>
      ))}
    </span>
  );
}
