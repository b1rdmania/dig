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
import { FavoriteButton } from "@/components/FavoriteButton";
import { ShareBar } from "@/components/ShareBar";
import { hrefForTraversalLink, hrefForArtistCredit } from "@/lib/routes";
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

/* ── Sync render helpers (receive pre-fetched data) ── */

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

function ReleasesSection({
  id,
  releaseType,
  data,
}: {
  id: string;
  releaseType: string;
  data: TraversalResponse;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        Releases{data.pagination.total_estimate != null
          ? ` (${data.pagination.total_estimate})`
          : data.links.length > 0
          ? ` (${data.links.length})`
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
      {data.links.length === 0 && (
        <div className={styles.small}>No releases found.</div>
      )}
      {data.links.map((link) => (
        <div className={styles.row} key={link.discogs_id}>
          <Link href={hrefForTraversalLink(link)} className={styles.item}>
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

function CreditsSection({
  id,
  roleFamily,
  data,
}: {
  id: string;
  roleFamily: string;
  data: ArtistCreditsResponse;
}) {
  if (data.links.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        Credits &amp; Appearances{data.pagination.total_estimate != null
          ? ` (${data.pagination.total_estimate})`
          : ` (${data.links.length})`}
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
      {data.links.map((link) => (
        <div className={styles.row} key={link.release_discogs_id}>
          <Link href={hrefForArtistCredit(link)} className={styles.item}>
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
      {data.pagination.has_more && (
        <div className={styles.small} style={{ marginTop: "0.5rem" }}>
          Showing first 30 — <Link href={`/artist/${id}/credits`} className={styles.link}>view all credits</Link>
        </div>
      )}
    </section>
  );
}

function AboutSection({
  profile,
  ctxData,
  resolvedNames,
}: {
  profile: string | null;
  ctxData: ContextResponse;
  resolvedNames: Record<string, string>;
}) {
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

function TimelineSection({ events, total }: { events: TimelineEvent[]; total: number }) {
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

function ConnectionsSection({
  artist,
  relData,
  tlData,
  resolvedNames,
}: {
  artist: {
    aliases: Array<{ name: string; discogs_id: number | null }>;
    name_variations: string[];
    members: Array<{ name: string; discogs_id: number | null }>;
    groups: Array<{ name: string; discogs_id: number | null }>;
  };
  relData: RelationshipsResponse;
  tlData: TimelineResponse;
  resolvedNames: Record<string, string>;
}) {
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

      {tlData.events.length > 0 && <TimelineSection events={tlData.events} total={tlData.meta.total_events} />}
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
    const namePart = a.real_name ? `${a.name} (${a.real_name})` : a.name;
    const profileSnippet = a.profile ? a.profile.replace(/\[.*?\]/g, "").trim().slice(0, 120) : null;
    const desc = profileSnippet ? `${namePart}. ${profileSnippet}` : namePart;
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

  // One streaming boundary — outer Suspense only. ArtistContent fans out all API
  // calls with Promise.all (parallel), then does name resolution in a second
  // bounded pass. No nested Suspense = no concurrent transform stream collisions.
  return (
    <div className={styles.page} data-dig-entity="artist" data-dig-id={id}>
      <Suspense fallback={<SectionSkeleton lines={4} />}>
        <ArtistContent id={id} releaseType={releaseType} roleFamily={roleFamily} />
      </Suspense>
    </div>
  );
}

async function ArtistContent({ id, releaseType, roleFamily }: { id: string; releaseType: string; roleFamily: string }) {
  const defaultTraversal: TraversalResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "artist", source_discogs_id: Number(id), link_type: "catalog_releases", elapsed_ms: 0 },
  };
  const defaultCredits: ArtistCreditsResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "artist", source_discogs_id: Number(id), link_type: "credits", elapsed_ms: 0 },
  };
  const defaultContext: ContextResponse = {
    context: [],
    meta: { source_type: "artist", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, enrichment_sources: [], enrichment_edge_count: 0 },
  };
  const defaultRelationships: RelationshipsResponse = {
    edges: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "artist", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, enrichment_sources: [], enrichment_edge_count: 0 },
  };
  const defaultTimeline: TimelineResponse = {
    events: [],
    meta: { source_type: "artist", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, total_events: 0 },
  };

  try {
    // Phase 1: fan out all primary fetches in parallel
    const releasesUrl = `/v1/artists/${id}/catalog_releases?limit=30&sort=newest${releaseType !== "all" ? `&release_type=${releaseType}` : ""}`;
    const creditsUrl = `/v1/artists/${id}/credits?limit=30${roleFamily !== "all" ? `&role_family=${roleFamily}` : ""}`;

    const [artistData, releasesData, creditsData, ctxData, relData, tlData] = await Promise.all([
      digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 }),
      digFetch<TraversalResponse>(releasesUrl, { revalidate: 300 })
        .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
        .catch(() => defaultTraversal),
      digFetch<ArtistCreditsResponse>(creditsUrl, { revalidate: 300 })
        .then((d) => (isArtistCreditsResponse(d) ? d : defaultCredits))
        .catch(() => defaultCredits),
      digFetch<ContextResponse>(`/v1/artists/${id}/context?include_enrichment=true`, { revalidate: 3600 })
        .then((d) => (isContextResponse(d) ? d : defaultContext))
        .catch(() => defaultContext),
      digFetch<RelationshipsResponse>(`/v1/artists/${id}/relationships?include_enrichment=true&limit=50`, { revalidate: 3600 })
        .then((d) => (isRelationshipsResponse(d) ? d : defaultRelationships))
        .catch(() => defaultRelationships),
      digFetch<TimelineResponse>(`/v1/artists/${id}/timeline?include_enrichment=true&limit=20`, { revalidate: 3600 })
        .then((d) => (isTimelineResponse(d) ? d : defaultTimeline))
        .catch(() => defaultTimeline),
    ]);

    if (!isArtistResponse(artistData)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    const artist = artistData.artist;

    // Phase 2: name resolution — collect all IDs from profile refs + relationship edges,
    // deduplicate, cap at 10 to bound latency, fetch in parallel.
    const resolvedNames: Record<string, string> = {};
    const profileRefs = artist.profile ? extractProfileRefs(artist.profile) : { artists: [], labels: [] };
    const edgeArtistIds = relData.edges
      .filter((e) => e.target_entity.discogs_id && !e.target_entity.name)
      .map((e) => e.target_entity.discogs_id!);

    const artistIdsToResolve = [...new Set([...profileRefs.artists, ...edgeArtistIds])].slice(0, 10);
    const labelIdsToResolve = [...new Set(profileRefs.labels)].slice(0, 5);

    await Promise.all([
      ...artistIdsToResolve.map(async (aid) => {
        try {
          const d = await digFetch<ArtistResponse>(`/v1/artists/${aid}`, { revalidate: 3600 });
          if (isArtistResponse(d)) resolvedNames[`a${aid}`] = d.artist.name;
        } catch { /* skip */ }
      }),
      ...labelIdsToResolve.map(async (lid) => {
        try {
          const d = await digFetch<import("@/lib/types").LabelResponse>(`/v1/labels/${lid}`, { revalidate: 3600 });
          if ((d as any)?.label?.name) resolvedNames[`l${lid}`] = (d as any).label.name;
        } catch { /* skip */ }
      }),
    ]);

    return (
      <>
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
            <FavoriteButton entityType="artist" discogsId={artist.discogs_id} />
          </div>
          <div style={{ marginTop: "0.6rem" }}>
            <ShareBar
              url={`${BASE_URL}/artist/${artist.discogs_id}`}
              title={artist.name}
              entityType="artist"
              entityId={artist.discogs_id}
            />
          </div>
        </section>

        <AboutSection
          profile={artist.profile}
          ctxData={ctxData}
          resolvedNames={resolvedNames}
        />
        <ReleasesSection id={id} releaseType={releaseType} data={releasesData} />
        <CreditsSection id={id} roleFamily={roleFamily} data={creditsData} />
        <ConnectionsSection
          artist={{
            aliases: artist.aliases,
            name_variations: artist.name_variations,
            members: artist.members,
            groups: artist.groups,
          }}
          relData={relData}
          tlData={tlData}
          resolvedNames={resolvedNames}
        />

        <JsonLd data={[
          musicGroupJsonLd({ discogs_id: artist.discogs_id, name: artist.name, urls: artist.urls }),
          breadcrumbJsonLd([
            { name: "dig", url: BASE_URL },
            { name: artist.name, url: `${BASE_URL}/artist/${artist.discogs_id}` },
          ]),
        ]} />
        <Provenance provenance={artist.provenance} />
      </>
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") notFound();
    return (
      <section className={styles.section} style={{ paddingTop: "3rem", textAlign: "center" }}>
        <p className={styles.copy}>Unable to load this page right now.</p>
        <p className={styles.small} style={{ marginTop: "0.5rem" }}>
          <Link href="/" className={styles.link}>Back to search</Link>
        </p>
      </section>
    );
  }
}
