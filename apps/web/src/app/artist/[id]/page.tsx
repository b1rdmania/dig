import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiRequestError, digFetch } from "@/lib/api";
import {
  isArtistResponse,
  isTraversalResponse,
  isRelationshipsResponse,
  type ArtistResponse,
  type TraversalResponse,
  type RelationshipsResponse,
} from "@/lib/types";
import { discogsUrl } from "@/lib/format";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Provenance } from "@/components/Provenance";
import { CollapsibleList } from "@/components/CollapsibleList";
import styles from "./page.module.css";

/** Format edge type + direction into a human-readable label. */
function formatEdgeLabel(edgeType: string, direction: "outbound" | "inbound"): string {
  const LABELS: Record<string, [string, string]> = {
    // [outbound, inbound]
    member_of_band: ["Member of", "Has member"],
    subgroup: ["Subgroup of", "Has subgroup"],
    collaboration: ["Collaborated with", "Collaborated with"],
    is_person: ["Is person", "Has alias"],
    supporting_musician: ["Supporting musician for", "Supported by"],
    vocal_supporting_musician: ["Vocal support for", "Vocal support from"],
    instrumental_supporting_musician: ["Instrumental support for", "Instrumental support from"],
    conductor_position: ["Conductor of", "Conducted by"],
    founder: ["Founded", "Founded by"],
    artistic_director: ["Artistic director of", "Led by"],
  };
  const pair = LABELS[edgeType];
  if (pair) return direction === "outbound" ? pair[0] : pair[1];
  // Fallback: humanize the edge_type
  const humanized = edgeType.replace(/_/g, " ");
  return direction === "inbound" ? `Has ${humanized}` : humanized;
}

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
    // Fetch artist detail, masters, and relationships in parallel; non-critical fail-soft.
    const defaultTraversal: TraversalResponse = {
      links: [],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: { source_type: "artist", source_discogs_id: Number(id), link_type: "masters", elapsed_ms: 0 },
    };
    const defaultRelationships: RelationshipsResponse = {
      edges: [],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: { source_type: "artist", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, enrichment_sources: [], enrichment_edge_count: 0 },
    };

    const [artistData, mastersData, relData] = await Promise.all([
      digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 }),
      digFetch<TraversalResponse>(`/v1/artists/${id}/masters?limit=30`, { revalidate: 300 })
        .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
        .catch(() => defaultTraversal),
      digFetch<RelationshipsResponse>(`/v1/artists/${id}/relationships?include_enrichment=true&limit=50`, { revalidate: 3600 })
        .then((d) => (isRelationshipsResponse(d) ? d : defaultRelationships))
        .catch(() => defaultRelationships),
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
            <CollapsibleList maxVisible={8} className={styles.list}>
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
            </CollapsibleList>
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

        {relData.edges.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.heading}>Related Artists</h2>
            <div className={styles.relatedList}>
              {relData.edges.map((edge) => {
                const target = edge.target_entity;
                const label = formatEdgeLabel(edge.edge_type, edge.edge_direction);
                return (
                  <div className={styles.relatedRow} key={edge.provenance.source_id}>
                    {target.discogs_id ? (
                      <Link href={`/artist/${target.discogs_id}`} className={styles.relatedName}>
                        {target.name || `Artist ${target.discogs_id}`}
                      </Link>
                    ) : (
                      <span className={styles.relatedName}>{target.name || "Unknown"}</span>
                    )}
                    <span className={styles.relatedType}>{label}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.heading}>Releases</h2>
          {mastersData.links.length === 0 && (
            <div className={styles.small}>No releases found.</div>
          )}
          {mastersData.links.map((link) => (
            <div className={styles.row} key={link.discogs_id}>
              <Link href={`/release/${link.discogs_id}`} className={styles.item}>
                {link.title || `Release ${link.discogs_id}`}
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
