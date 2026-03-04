import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiRequestError, digFetch } from "@/lib/api";
import {
  isArtistResponse,
  isTraversalResponse,
  isRelationshipsResponse,
  isContextResponse,
  isTimelineResponse,
  type ArtistResponse,
  type TraversalResponse,
  type RelationshipsResponse,
  type ContextResponse,
  type TimelineResponse,
  type TimelineEvent,
} from "@/lib/types";
import { discogsUrl } from "@/lib/format";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Provenance } from "@/components/Provenance";
import { CollapsibleList } from "@/components/CollapsibleList";
import { DiscogsProfile, extractProfileRefs } from "@/components/DiscogsProfile";
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

/** Render context blocks from Wikidata enrichment. */
function ArtistContext({ context }: { context: Array<{ context_type: string; content_json: unknown; provenance: { source: string } }> }) {
  const bio = context.find((c) => c.context_type === "bio");
  const timeline = context.find((c) => c.context_type === "timeline_note");

  const bioJson = bio?.content_json as Record<string, unknown> | undefined;
  const tlJson = timeline?.content_json as Record<string, string> | undefined;

  const details: string[] = [];
  if (bioJson?.summary) details.push(String(bioJson.summary));
  if (tlJson?.formed) details.push(`Formed: ${tlJson.formed}`);
  if (tlJson?.born) details.push(`Born: ${tlJson.born}`);
  if (tlJson?.dissolved) details.push(`Dissolved: ${tlJson.dissolved}`);
  if (tlJson?.died) details.push(`Died: ${tlJson.died}`);

  if (details.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>About</h2>
      {details.map((d, i) => (
        <p key={i} className={styles.copy} style={i > 0 ? { marginTop: "0.3rem", fontSize: "0.82rem" } : undefined}>
          {d}
        </p>
      ))}
      <div className={styles.contextSource}>Source: Wikidata</div>
    </section>
  );
}

/** Render performance timeline from setlist.fm enrichment. */
function ArtistTimeline({ events, total }: { events: TimelineEvent[]; total: number }) {
  if (events.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Live Performances{total > events.length ? ` (${total} total)` : ""}</h2>
      {events.map((e) => (
        <div className={styles.row} key={e.setlistfm_url}>
          <a href={e.setlistfm_url} target="_blank" rel="noreferrer" className={styles.item}>
            {e.venue_name || "Unknown venue"}{e.city_name ? `, ${e.city_name}` : ""}{e.country_code ? ` (${e.country_code})` : ""}
          </a>
          <span className={styles.small}>{e.event_date?.slice(0, 10) || "—"}</span>
        </div>
      ))}
      <div className={styles.contextSource}>
        Source: <a href="https://www.setlist.fm" target="_blank" rel="noreferrer">setlist.fm</a>
      </div>
    </section>
  );
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
    const defaultContext: ContextResponse = {
      context: [],
      meta: { source_type: "artist", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, enrichment_sources: [], enrichment_edge_count: 0 },
    };
    const defaultTimeline: TimelineResponse = {
      events: [],
      meta: { source_type: "artist", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, total_events: 0 },
    };

    const [artistData, mastersData, relData, ctxData, tlData] = await Promise.all([
      digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 }),
      digFetch<TraversalResponse>(`/v1/artists/${id}/masters?limit=30`, { revalidate: 300 })
        .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
        .catch(() => defaultTraversal),
      digFetch<RelationshipsResponse>(`/v1/artists/${id}/relationships?include_enrichment=true&limit=50`, { revalidate: 3600 })
        .then((d) => (isRelationshipsResponse(d) ? d : defaultRelationships))
        .catch(() => defaultRelationships),
      digFetch<ContextResponse>(`/v1/artists/${id}/context?include_enrichment=true`, { revalidate: 3600 })
        .then((d) => (isContextResponse(d) ? d : defaultContext))
        .catch(() => defaultContext),
      digFetch<TimelineResponse>(`/v1/artists/${id}/timeline?include_enrichment=true&limit=20`, { revalidate: 3600 })
        .then((d) => (isTimelineResponse(d) ? d : defaultTimeline))
        .catch(() => defaultTimeline),
    ]);

    if (!isArtistResponse(artistData)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    const artist = artistData.artist;

    // Collect all artist IDs that need name resolution:
    // 1. Profile markup refs [aXXX]/[lXXX]
    // 2. Related artist edges with missing names
    const artistIdsToResolve = new Set<number>();
    const labelIdsToResolve = new Set<number>();

    if (artist.profile) {
      const refs = extractProfileRefs(artist.profile);
      refs.artists.forEach((id) => artistIdsToResolve.add(id));
      refs.labels.forEach((id) => labelIdsToResolve.add(id));
    }

    for (const edge of relData.edges) {
      if (edge.target_entity.discogs_id && !edge.target_entity.name) {
        artistIdsToResolve.add(edge.target_entity.discogs_id);
      }
    }

    // Batch-resolve all names in parallel (internal network, ~1ms each)
    const resolvedNames: Record<string, string> = {};
    const fetches = [
      ...[...artistIdsToResolve].map(async (aid) => {
        try {
          const d = await digFetch<ArtistResponse>(`/v1/artists/${aid}`, { revalidate: 3600 });
          if (isArtistResponse(d)) resolvedNames[`a${aid}`] = d.artist.name;
        } catch { /* skip */ }
      }),
      ...[...labelIdsToResolve].map(async (lid) => {
        try {
          const d = await digFetch<import("@/lib/types").LabelResponse>(`/v1/labels/${lid}`, { revalidate: 3600 });
          if ((d as any)?.label?.name) resolvedNames[`l${lid}`] = (d as any).label.name;
        } catch { /* skip */ }
      }),
    ];
    await Promise.all(fetches);

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
            <DiscogsProfile text={artist.profile} className={styles.copy} names={resolvedNames} />
          </section>
        )}

        {ctxData.context.length > 0 && <ArtistContext context={ctxData.context} />}

        {tlData.events.length > 0 && <ArtistTimeline events={tlData.events} total={tlData.meta.total_events} />}

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
                        {target.name || resolvedNames[`a${target.discogs_id}`] || `Artist ${target.discogs_id}`}
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
