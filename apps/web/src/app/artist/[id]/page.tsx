import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiRequestError, digFetch } from "@/lib/api";
import {
  isArtistResponse,
  isTraversalResponse,
  type ArtistResponse,
  type TraversalResponse,
} from "@/lib/types";
import { discogsUrl } from "@/lib/format";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Provenance } from "@/components/Provenance";
import styles from "./page.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  try {
    const data = await digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 });
    if (!isArtistResponse(data)) return { title: "Artist — Dig" };
    return {
      title: `${data.artist.name} — Dig`,
      description: `Artist page for ${data.artist.name}.`,
    };
  } catch {
    return { title: "Artist — Dig" };
  }
}

export default async function ArtistPage({ params }: Props) {
  const { id } = await params;

  try {
    // Fetch artist detail and masters in parallel; masters fail-soft.
    const defaultTraversal: TraversalResponse = {
      links: [],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: { source_type: "artist", source_discogs_id: Number(id), link_type: "masters", elapsed_ms: 0 },
    };

    const [artistData, mastersData] = await Promise.all([
      digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 }),
      digFetch<TraversalResponse>(`/v1/artists/${id}/masters?limit=30`, { revalidate: 300 })
        .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
        .catch(() => defaultTraversal),
    ]);

    if (!isArtistResponse(artistData)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    const artist = artistData.artist;

    return (
      <div className={styles.page}>
        <section className={styles.hero}>
          <h1 className={styles.title}>{artist.name}</h1>
          {artist.real_name && <div className={styles.subtitle}>Real name: {artist.real_name}</div>}
          <div className={styles.links}>
            <a
              href={discogsUrl("artist", artist.discogs_id)}
              target="_blank"
              rel="noreferrer"
              className={styles.link}
            >
              Open on Discogs
            </a>
          </div>
        </section>

        {artist.profile && (
          <section className={styles.section}>
            <h2 className={styles.heading}>Profile</h2>
            <p className={styles.copy}>{artist.profile}</p>
          </section>
        )}

        {(artist.aliases.length > 0 || artist.name_variations.length > 0) && (
          <section className={styles.section}>
            <h2 className={styles.heading}>Aliases and Name Variations</h2>
            <div className={styles.list}>
              {artist.aliases.map((alias) =>
                alias.discogs_id ? (
                  <Link
                    href={`/artist/${alias.discogs_id}`}
                    className={styles.pillLink}
                    key={`alias-${alias.discogs_id}`}
                  >
                    {alias.name}
                  </Link>
                ) : (
                  <span className={styles.pill} key={`alias-${alias.name}`}>
                    {alias.name}
                  </span>
                ),
              )}
              {artist.name_variations.map((nv) => (
                <span className={styles.pill} key={`nv-${nv}`}>{nv}</span>
              ))}
            </div>
          </section>
        )}

        {artist.members.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.heading}>Members</h2>
            <div className={styles.list}>
              {artist.members.map((member) =>
                member.discogs_id ? (
                  <Link
                    href={`/artist/${member.discogs_id}`}
                    className={styles.pillLink}
                    key={`member-${member.discogs_id}`}
                  >
                    {member.name}
                  </Link>
                ) : (
                  <span className={styles.pill} key={`member-${member.name}`}>
                    {member.name}
                  </span>
                ),
              )}
            </div>
          </section>
        )}

        {artist.groups.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.heading}>Groups</h2>
            <div className={styles.list}>
              {artist.groups.map((group) =>
                group.discogs_id ? (
                  <Link
                    href={`/artist/${group.discogs_id}`}
                    className={styles.pillLink}
                    key={`group-${group.discogs_id}`}
                  >
                    {group.name}
                  </Link>
                ) : (
                  <span className={styles.pill} key={`group-${group.name}`}>
                    {group.name}
                  </span>
                ),
              )}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.heading}>Key Masters</h2>
          {mastersData.links.length === 0 && (
            <div className={styles.small}>No linked masters found.</div>
          )}
          {mastersData.links.map((link) => (
            <div className={styles.row} key={link.discogs_id}>
              <Link href={`/master/${link.discogs_id}`} className={styles.item}>
                {link.title || `Master ${link.discogs_id}`}
              </Link>
              <span className={styles.small}>{link.year || "—"}</span>
            </div>
          ))}
        </section>

        {artist.urls.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.heading}>External Links</h2>
            <div className={styles.list}>
              {artist.urls.slice(0, 10).map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className={styles.pill}>
                  {url}
                </a>
              ))}
            </div>
          </section>
        )}

        <Provenance provenance={artist.provenance} />
      </div>
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") notFound();
    if (err instanceof ApiRequestError) return <ErrorMessage code={err.code} message={err.message} />;
    return <ErrorMessage message="Failed to load artist" />;
  }
}
