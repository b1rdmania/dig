import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiRequestError, digFetch } from "@/lib/api";
import {
  isArtistResponse,
  isTraversalResponse,
  isArtistCreditsResponse,
  isRelationshipsResponse,
  isContextResponse,
  isTimelineResponse,
  type ArtistResponse,
  type TraversalResponse,
  type ArtistCreditsResponse,
  type RelationshipsResponse,
  type ContextResponse,
  type TimelineResponse,
  type TimelineEvent,
} from "@/lib/types";
import { discogsUrl, urlLabel } from "@/lib/format";
import { entityMetadata, BASE_URL } from "@/lib/seo";
import { musicGroupJsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { JsonLd } from "@/components/JsonLd";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Provenance } from "@/components/Provenance";
import { CollapsibleList } from "@/components/CollapsibleList";
import { DiscogsProfile, extractProfileRefs } from "@/components/DiscogsProfile";
import { SectionSkeleton } from "@/components/SectionSkeleton";
import styles from "./page.module.css";

/* ── Helpers ── */

function formatEdgeLabel(edgeType: string, direction: "outbound" | "inbound"): string {
  const LABELS: Record<string, [string, string]> = {
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
  const humanized = edgeType.replace(/_/g, " ");
  return direction === "inbound" ? `Has ${humanized}` : humanized;
}

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

/* ── Async streamed sections ── */

const RELEASE_FILTERS = [
  { value: "all", label: "All" },
  { value: "album", label: "Albums / LPs" },
  { value: "single_ep", label: "Singles / EPs" },
  { value: "compilation", label: "Compilations" },
  { value: "other", label: "Other" },
] as const;

const CREDIT_FILTERS = [
  { value: "all", label: "All" },
  { value: "writing", label: "Writing" },
  { value: "arranging", label: "Arranging" },
  { value: "performance", label: "Performance" },
  { value: "production", label: "Production" },
  { value: "other", label: "Other" },
] as const;

/** Releases section: fetches masters independently so shell renders without waiting. */
async function ArtistReleases({ id, releaseType }: { id: string; releaseType: string }) {
  const defaultTraversal: TraversalResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "artist", source_discogs_id: Number(id), link_type: "masters", elapsed_ms: 0 },
  };
  const mastersUrl = `/v1/artists/${id}/masters?limit=30&sort=newest${releaseType !== "all" ? `&release_type=${releaseType}` : ""}`;
  const mastersData = await digFetch<TraversalResponse>(mastersUrl, { revalidate: 300 })
    .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
    .catch(() => defaultTraversal);

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        Releases{mastersData.pagination.total_estimate != null
          ? ` (${mastersData.pagination.total_estimate})`
          : mastersData.links.length > 0
          ? ` (${mastersData.links.length})`
          : ""}
      </h2>
      <div className={styles.filterChips}>
        {RELEASE_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? `/artist/${id}` : `/artist/${id}?release_type=${f.value}`}
            className={releaseType === f.value ? styles.chipActive : styles.chip}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {mastersData.links.length === 0 && (
        <div className={styles.small}>No primary releases found.</div>
      )}
      {mastersData.links.map((link) => (
        <div className={styles.row} key={link.discogs_id}>
          <Link href={`/release/${link.discogs_id}`} className={styles.item}>
            {link.title || `Release ${link.discogs_id}`}
          </Link>
          <span className={styles.releaseRight}>
            {link.release_type_label && (
              <span className={styles.badge}>{link.release_type_label}</span>
            )}
            <span className={styles.small}>{link.year || "—"}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

/** Credits section: fetches credits independently so shell renders without waiting. */
async function ArtistCredits({ id, roleFamily }: { id: string; roleFamily: string }) {
  const defaultCredits: ArtistCreditsResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "artist", source_discogs_id: Number(id), link_type: "credits", elapsed_ms: 0 },
  };
  const creditsUrl = `/v1/artists/${id}/credits?limit=30${roleFamily !== "all" ? `&role_family=${roleFamily}` : ""}`;
  const creditsData = await digFetch<ArtistCreditsResponse>(creditsUrl, { revalidate: 300 })
    .then((d) => (isArtistCreditsResponse(d) ? d : defaultCredits))
    .catch(() => defaultCredits);

  if (creditsData.links.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        Credits &amp; Appearances{creditsData.pagination.total_estimate != null
          ? ` (${creditsData.pagination.total_estimate})`
          : ` (${creditsData.links.length})`}
      </h2>
      <div className={styles.filterChips}>
        {CREDIT_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? `/artist/${id}` : `/artist/${id}?role_family=${f.value}`}
            className={roleFamily === f.value ? styles.chipActive : styles.chip}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {creditsData.links.map((link) => (
        <div className={styles.row} key={link.release_discogs_id}>
          <Link href={`/release/${link.release_discogs_id}`} className={styles.item}>
            {link.title || `Release ${link.release_discogs_id}`}
          </Link>
          <span className={styles.releaseRight}>
            {link.roles.slice(0, 2).map((r) => (
              <span key={r} className={styles.badge}>{r}</span>
            ))}
            <span className={styles.small}>{link.year || "—"}</span>
          </span>
        </div>
      ))}
      {creditsData.pagination.has_more && (
        <div className={styles.small} style={{ marginTop: "0.5rem" }}>
          Showing first 30 — <Link href={`/artist/${id}/credits`} className={styles.link}>view all credits</Link>
        </div>
      )}
    </section>
  );
}

/** About section: fetches context + resolves profile names, then renders. */
async function ArtistAbout({ id, profile }: { id: string; profile: string | null }) {
  const defaultContext: ContextResponse = {
    context: [],
    meta: { source_type: "artist", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, enrichment_sources: [], enrichment_edge_count: 0 },
  };

  const ctxData = await digFetch<ContextResponse>(`/v1/artists/${id}/context?include_enrichment=true`, { revalidate: 3600 })
    .then((d) => (isContextResponse(d) ? d : defaultContext))
    .catch(() => defaultContext);

  // Resolve profile names
  const resolvedNames: Record<string, string> = {};
  if (profile) {
    const refs = extractProfileRefs(profile);
    const fetches = [
      ...refs.artists.map(async (aid) => {
        try {
          const d = await digFetch<ArtistResponse>(`/v1/artists/${aid}`, { revalidate: 3600 });
          if (isArtistResponse(d)) resolvedNames[`a${aid}`] = d.artist.name;
        } catch { /* skip */ }
      }),
      ...refs.labels.map(async (lid) => {
        try {
          const d = await digFetch<import("@/lib/types").LabelResponse>(`/v1/labels/${lid}`, { revalidate: 3600 });
          if ((d as any)?.label?.name) resolvedNames[`l${lid}`] = (d as any).label.name;
        } catch { /* skip */ }
      }),
    ];
    await Promise.all(fetches);
  }

  const bioCtx = ctxData.context.find((c) => c.context_type === "bio");
  const bioSummary = (bioCtx?.content_json as Record<string, unknown>)?.summary as string | undefined;
  const hasContent = profile || bioSummary;

  if (!hasContent) return null;

  const combined = [bioSummary, profile].filter(Boolean).join("\n\n");
  const shouldCollapse = combined.length > 520;
  const preview = shouldCollapse ? `${combined.slice(0, 520).trimEnd()}…` : combined;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>About</h2>
      {!shouldCollapse && bioSummary && <p className={styles.copy}>{bioSummary}</p>}
      {!shouldCollapse && profile && (
        <DiscogsProfile
          text={profile}
          className={styles.copy}
          names={resolvedNames}
          style={bioSummary ? { marginTop: "0.5rem", fontSize: "0.82rem", opacity: 0.8 } : undefined}
        />
      )}
      {shouldCollapse && (
        <>
          <p className={styles.copy}>{preview}</p>
          <details className={styles.expandBlock}>
            <summary className={styles.expandToggle}>More info</summary>
            {bioSummary && <p className={styles.copy}>{bioSummary}</p>}
            {profile && (
              <DiscogsProfile
                text={profile}
                className={styles.copy}
                names={resolvedNames}
                style={bioSummary ? { marginTop: "0.5rem", fontSize: "0.82rem", opacity: 0.8 } : undefined}
              />
            )}
          </details>
        </>
      )}
      {bioSummary && <div className={styles.contextSource}>Source: Wikidata</div>}
    </section>
  );
}

/** Connections section: fetches relationships + timeline + resolves edge names. */
async function ArtistConnections({
  id,
  artist,
}: {
  id: string;
  artist: {
    aliases: Array<{ name: string; discogs_id: number | null }>;
    name_variations: string[];
    members: Array<{ name: string; discogs_id: number | null }>;
    groups: Array<{ name: string; discogs_id: number | null }>;
  };
}) {
  const defaultRelationships: RelationshipsResponse = {
    edges: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "artist", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, enrichment_sources: [], enrichment_edge_count: 0 },
  };
  const defaultTimeline: TimelineResponse = {
    events: [],
    meta: { source_type: "artist", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, total_events: 0 },
  };

  const [relData, tlData] = await Promise.all([
    digFetch<RelationshipsResponse>(`/v1/artists/${id}/relationships?include_enrichment=true&limit=50`, { revalidate: 3600 })
      .then((d) => (isRelationshipsResponse(d) ? d : defaultRelationships))
      .catch(() => defaultRelationships),
    digFetch<TimelineResponse>(`/v1/artists/${id}/timeline?include_enrichment=true&limit=20`, { revalidate: 3600 })
      .then((d) => (isTimelineResponse(d) ? d : defaultTimeline))
      .catch(() => defaultTimeline),
  ]);

  // Resolve edge names
  const resolvedNames: Record<string, string> = {};
  const idsToResolve = relData.edges
    .filter((e) => e.target_entity.discogs_id && !e.target_entity.name)
    .map((e) => e.target_entity.discogs_id!);

  if (idsToResolve.length > 0) {
    await Promise.all(
      [...new Set(idsToResolve)].map(async (aid) => {
        try {
          const d = await digFetch<ArtistResponse>(`/v1/artists/${aid}`, { revalidate: 3600 });
          if (isArtistResponse(d)) resolvedNames[`a${aid}`] = d.artist.name;
        } catch { /* skip */ }
      }),
    );
  }

  const hasAliases = artist.aliases.length > 0 || artist.name_variations.length > 0;
  const hasContent = hasAliases || artist.members.length > 0 || artist.groups.length > 0
    || relData.edges.length > 0 || tlData.events.length > 0;

  if (!hasContent) return null;

  return (
    <>
      {hasAliases && (
        <section className={styles.section}>
          <h2 className={styles.heading}>Aliases</h2>
          <CollapsibleList maxVisible={8} className={styles.list}>
            {artist.aliases.map((alias) =>
              alias.discogs_id ? (
                <Link href={`/artist/${alias.discogs_id}`} className={styles.pillLink} key={`alias-${alias.discogs_id}`}>
                  {alias.name}
                </Link>
              ) : (
                <span className={styles.pill} key={`alias-${alias.name}`}>{alias.name}</span>
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
                <Link href={`/artist/${member.discogs_id}`} className={styles.pillLink} key={`member-${member.discogs_id}`}>
                  {member.name}
                </Link>
              ) : (
                <span className={styles.pill} key={`member-${member.name}`}>{member.name}</span>
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
                <Link href={`/artist/${group.discogs_id}`} className={styles.pillLink} key={`group-${group.discogs_id}`}>
                  {group.name}
                </Link>
              ) : (
                <span className={styles.pill} key={`group-${group.name}`}>{group.name}</span>
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

      {tlData.events.length > 0 && <ArtistTimeline events={tlData.events} total={tlData.meta.total_events} />}
    </>
  );
}

/* ── Main page ── */

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  try {
    const data = await digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 });
    if (!isArtistResponse(data)) return { title: "Artist — dig" };
    const a = data.artist;
    const desc = a.real_name ? `${a.name} (${a.real_name})` : a.name;
    return entityMetadata({ title: a.name, description: desc, path: `/artist/${id}`, type: "artist" });
  } catch {
    return { title: "Artist — dig" };
  }
}

export default async function ArtistPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const releaseType = typeof sp.release_type === "string" && ["album", "single_ep", "compilation", "other"].includes(sp.release_type)
    ? sp.release_type
    : "all";
  const roleFamily = typeof sp.role_family === "string" && ["writing", "arranging", "performance", "production", "other"].includes(sp.role_family)
    ? sp.role_family
    : "all";

  try {
    // Shell only awaits the single artist lookup (~50ms). All traversal sections
    // stream in independently via Suspense, so high-catalog artists (Nirvana,
    // Madonna, etc.) show the header immediately rather than hanging for 10s.
    const artistData = await digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 });

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
            <a href={discogsUrl("artist", artist.discogs_id)} target="_blank" rel="noreferrer" className={styles.link}>
              Open on Discogs
            </a>
            {artist.urls.slice(0, 4).map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className={styles.link}>
                {urlLabel(url)}
              </a>
            ))}
          </div>
        </section>

        {/* About: streams in (context + name resolution) */}
        <Suspense fallback={<SectionSkeleton lines={4} />}>
          <ArtistAbout id={id} profile={artist.profile} />
        </Suspense>

        {/* Credits: streams in independently — fast for small catalogs, graceful for large */}
        <Suspense fallback={<SectionSkeleton lines={5} />}>
          <ArtistCredits id={id} roleFamily={roleFamily} />
        </Suspense>

        {/* Releases: streams in independently — fast for small catalogs, graceful for large */}
        <Suspense fallback={<SectionSkeleton lines={5} />}>
          <ArtistReleases id={id} releaseType={releaseType} />
        </Suspense>

        {/* Connections: streams in (relationships + timeline + name resolution) */}
        <Suspense fallback={<SectionSkeleton lines={3} />}>
          <ArtistConnections
            id={id}
            artist={{
              aliases: artist.aliases,
              name_variations: artist.name_variations,
              members: artist.members,
              groups: artist.groups,
            }}
          />
        </Suspense>

        <JsonLd data={[
          musicGroupJsonLd({ discogs_id: artist.discogs_id, name: artist.name, urls: artist.urls }),
          breadcrumbJsonLd([
            { name: "dig", url: BASE_URL },
            { name: artist.name, url: `${BASE_URL}/artist/${artist.discogs_id}` },
          ]),
        ]} />
        <Provenance provenance={artist.provenance} />
      </div>
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") notFound();
    if (err instanceof ApiRequestError) return <ErrorMessage code={err.code} message={err.message} />;
    return <ErrorMessage message="Failed to load artist" />;
  }
}
