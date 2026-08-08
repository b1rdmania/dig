import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiRequestError, digFetch } from "@/lib/api";
import {
  isLabelResponse,
  isTraversalResponse,
  isLinkoutsResponse,
  isLabelRosterResponse,
  isLabelStylesResponse,
  isArtistResponse,
  type LabelResponse,
  type TraversalResponse,
  type LabelLinkoutsResponse,
  type LabelRosterResponse,
  type LabelStylesResponse,
  type LabelPlaylistResponse,
  type LabelSleevesResponse,
  type ArtistResponse,
} from "@/lib/types";
import { discogsUrl, urlLabel } from "@/lib/format";
import { entityMetadata, BASE_URL } from "@/lib/seo";
import { labelJsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { JsonLd } from "@/components/JsonLd";
import { DiscogsProfile, extractProfileRefs } from "@/components/DiscogsProfile";
import { SectionSkeleton } from "@/components/SectionSkeleton";
import {
  Page,
  CatalogSpine,
  RosterColumn,
  LinerNotes,
  GenreBar,
  SublabelTree,
  CoreRun,
  RelatedLabels,
  type SpineRow,
  type RosterRow,
} from "@/components/design";
import { TopCreditsBlock } from "@/components/TopCreditsBlock";
import styles from "./page.module.css";

/**
 * ISR. Without these two exports the route is fully dynamic and Next emits
 * `cache-control: private, no-cache, no-store` — so every crawler hit on any
 * of ~80k catalog pages was a fresh render plus several dig-api round-trips
 * on one shared vCPU. That load is what wedged dig-web on 2026-08-07 and
 * 08-08.
 *
 * `revalidate` ALONE does nothing here — verified: with only that export the
 * route still built as `ƒ (Dynamic)` and still served `no-store`. Next needs
 * the explicit static opt-in as well. The pair together produce
 * `x-nextjs-cache: HIT` on the second request.
 *
 * `dynamic = "error"` rather than "force-static" deliberately: both force
 * static rendering, but "error" FAILS THE BUILD if someone later introduces a
 * dynamic API here, while "force-static" would silently hand that code empty
 * values at runtime. A loud build break beats a quiet wrong page. (This route
 * uses no dynamic APIs today — the build passes, which is how the diagnosis
 * above was confirmed.)
 *
 * Effective TTL is 600s, not 3600: nested components (Labelmates, SeeAlso,
 * TopCreditsBlock) fetch with `revalidate: 600` and Next takes the minimum
 * across the tree. Correct behaviour, and 10 minutes is conservative for a
 * catalog that only changes on a monthly scoped-artifact rebuild.
 *
 * Also emits a real `s-maxage`, which is the precondition for putting a CDN
 * in front — see docs/cloudflare-edge-plan.md.
 */
export const revalidate = 3600;
export const dynamic = "error";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  try {
    const data = await digFetch<LabelResponse>(`/v1/labels/${id}`, { revalidate: 3600 });
    if (!isLabelResponse(data)) return { title: "Label — dig" };
    const l = data.label;
    const ed = l.editorial;
    const tierTag = (ed?.tier ?? l.tier) === "tier1" ? "Canonical scene label. " : "";
    const blurb = ed?.blurb?.trim();
    const profileSnippet = l.profile ? l.profile.replace(/\[.*?\]/g, "").trim().slice(0, 120) : null;
    const desc = blurb ?? (profileSnippet ? `${tierTag}${l.name}. ${profileSnippet}` : `${tierTag}${l.name} — record label on dig`);
    return entityMetadata({ title: l.name, description: desc, path: `/label/${id}`, type: "label" });
  } catch {
    return { title: "Label — dig" };
  }
}

export default async function LabelPage({ params }: Props) {
  const { id } = await params;
  return (
    <Suspense fallback={<SectionSkeleton lines={6} />}>
      <LabelContent id={id} />
    </Suspense>
  );
}

async function LabelContent({ id }: { id: string }) {
  const defaultTraversal: TraversalResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "label", source_discogs_id: Number(id), link_type: "releases", elapsed_ms: 0 },
  };
  const defaultLinkouts: LabelLinkoutsResponse = {
    linkouts: [],
    meta: { source_type: "label", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, enrichment_sources: [] },
  };
  const defaultRoster: LabelRosterResponse = {
    roster: [],
    meta: { source_type: "label", source_discogs_id: Number(id), link_type: "roster", elapsed_ms: 0, total_artists: 0 },
  };
  const defaultStyles: LabelStylesResponse = {
    styles: [],
    meta: { source_type: "label", source_discogs_id: Number(id), link_type: "styles", total_tagged_masters: 0, elapsed_ms: 0 },
  };

  // These six only need `id`, so start them now rather than after the label
  // fetch resolves. Previously this page was a two-stage waterfall and paid
  // two serial round-trips (and, on a bad call, two serial 12s timeouts).
  // Only the profile name lookups genuinely depend on labelData.
  const releasesPromise = digFetch<TraversalResponse>(`/v1/labels/${id}/releases?limit=200&sort=chronological`, { revalidate: 3600 })
    .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
    .catch(() => defaultTraversal);
  const rosterPromise = digFetch<LabelRosterResponse>(`/v1/labels/${id}/roster?limit=12`, { revalidate: 3600 })
    .then((d) => (isLabelRosterResponse(d) ? d : defaultRoster))
    .catch(() => defaultRoster);
  const linkoutsPromise = digFetch<LabelLinkoutsResponse>(`/v1/labels/${id}/linkouts?include_enrichment=true`, { revalidate: 3600 })
    .then((d) => (isLinkoutsResponse(d) ? d : defaultLinkouts))
    .catch(() => defaultLinkouts);
  const stylesPromise = digFetch<LabelStylesResponse>(`/v1/labels/${id}/styles?limit=8`, { revalidate: 3600 })
    .then((d) => (isLabelStylesResponse(d) ? d : defaultStyles))
    .catch(() => defaultStyles);
  const playlistPromise = digFetch<LabelPlaylistResponse>(`/v1/labels/${id}/playlist`, { revalidate: 3600 })
    .then((d) => d.playlist ?? null)
    .catch(() => null);
  const sleevesPromise = digFetch<LabelSleevesResponse>(`/v1/labels/${id}/sleeves`, { revalidate: 3600 })
    .then((d) => d.sleeves ?? [])
    .catch(() => [] as LabelSleevesResponse["sleeves"]);

  let labelData: LabelResponse;
  try {
    labelData = await digFetch<LabelResponse>(`/v1/labels/${id}`, { revalidate: 3600 });
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") notFound();
    return (
      <Page entityType="label" entityId={id}>
        <p className={styles.error}>
          Unable to load this label right now. <Link href="/">Back to search</Link>.
        </p>
      </Page>
    );
  }

  if (!isLabelResponse(labelData)) {
    return (
      <Page entityType="label" entityId={id}>
        <p className={styles.error}>Unexpected API response format.</p>
      </Page>
    );
  }

  const label = labelData.label;
  const ed = label.editorial;
  const coreRun = labelData.core_run ?? [];
  const relatedLabels = labelData.related ?? [];

  const profileRefs = label.profile ? extractProfileRefs(label.profile) : { artists: [], labels: [] };
  const artistIdsToResolve = [...new Set(profileRefs.artists)].slice(0, 10);
  const labelIdsToResolve = [...new Set(profileRefs.labels)].slice(0, 5);

  const [releasesData, rosterData, linkoutsData, stylesData, playlistData, sleeves, ...nameResults] = await Promise.all([
    releasesPromise,
    rosterPromise,
    linkoutsPromise,
    stylesPromise,
    playlistPromise,
    sleevesPromise,
    ...artistIdsToResolve.map((aid) =>
      digFetch<ArtistResponse>(`/v1/artists/${aid}`, { revalidate: 3600 })
        .then((d) => (isArtistResponse(d) ? [`a${aid}`, d.artist.name] as [string, string] : null))
        .catch(() => null),
    ),
    ...labelIdsToResolve.map((lid) =>
      digFetch<LabelResponse>(`/v1/labels/${lid}`, { revalidate: 3600 })
        .then((d) => (isLabelResponse(d) ? [`l${lid}`, d.label.name] as [string, string] : null))
        .catch(() => null),
    ),
  ]);

  const resolvedNames: Record<string, string> = {};
  for (const entry of nameResults) {
    if (entry) resolvedNames[entry[0]] = entry[1];
  }

  const spineRows: SpineRow[] = releasesData.links.map((link, idx) => ({
    position: idx + 1,
    // For type="master" links the API now sets master_discogs_id explicitly
    // (mirrors discogs_id). The discogs_id fallback stays for older deploys
    // / cached responses, but is no longer the load-bearing path.
    master_discogs_id:
      typeof link.master_discogs_id === "number" ? link.master_discogs_id : link.discogs_id,
    title: link.title ?? null,
    artist: typeof link.role === "string" ? null : null,
    year: link.year ?? null,
    format: link.format ?? null,
    catalog_number: getCatalogNumber(link),
    in_scope: true,
  }));

  // The traversal API includes role on master rows as primary_artist; future-
  // proof against the field landing under a different key by checking common
  // shapes. We deliberately don't blow up if it's missing.
  for (let i = 0; i < releasesData.links.length; i++) {
    const linkAny = releasesData.links[i] as unknown as Record<string, unknown>;
    const primary = (linkAny.primary_artist ?? linkAny.artist ?? null) as string | null;
    if (typeof primary === "string" && primary.trim()) {
      spineRows[i].artist = primary.trim();
    }
  }

  const rosterRows: RosterRow[] = rosterData.roster.map((r) => ({
    artist_discogs_id: r.artist_discogs_id,
    name: r.name,
    master_count: r.master_count,
    first_year: r.first_year,
    last_year: r.last_year,
  }));

  return (
    <Page entityType="label" entityId={label.discogs_id}>
      <div className={styles.identity}>
        {ed?.location && <div className={styles.eyebrow}>{ed.location}</div>}
        <h1 className={styles.title}>
          <span>{label.name}</span>
        </h1>

        {label.parent_label?.name && (
          <div className={styles.parent}>
            Parent label:{" "}
            {label.parent_label.discogs_id ? (
              <Link href={`/label/${label.parent_label.discogs_id}`}>{label.parent_label.name}</Link>
            ) : (
              label.parent_label.name
            )}
          </div>
        )}

        {ed?.blurb && <div className={styles.blurb}>{ed.blurb}</div>}

      </div>

      {sleeves.length >= 4 && (
        <div className={styles.sleeveWall} aria-label="Sleeve wall">
          {sleeves.map((s) => (
            <Link
              key={s.master_discogs_id}
              href={`/master/${s.master_discogs_id}`}
              className={styles.sleeve}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.cover_url} alt="" loading="lazy" />
            </Link>
          ))}
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.spineCol}>
          {coreRun.length > 0 && (
            <section className={styles.coreRunBlock}>
              <header className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Core Run</h2>
                <span className={styles.sectionMeta}>
                  essential listening · {coreRun.length} {coreRun.length === 1 ? "master" : "masters"}
                </span>
              </header>
              {playlistData && playlistData.video_count > 1 && (
                <iframe
                  className={styles.coreRunPlayer}
                  src={`https://www.youtube-nocookie.com/embed/${playlistData.records[0].video_id}?playlist=${playlistData.records
                    .slice(1)
                    .map((r) => r.video_id)
                    .join(",")}&rel=0`}
                  title={`Core run, ${playlistData.video_count} records`}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              )}
              <CoreRun rows={coreRun} />
            </section>
          )}
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Catalog Spine</h2>
          </header>
          <CatalogSpine
            rows={spineRows}
            emptyMessage="No in-scope masters yet on this label. The catalog spine fills in as masters land in the scene-scoped dataset."
          />
        </div>

        <div className={styles.sideCol}>
          {relatedLabels.length > 0 && (
            <section className={styles.sideBlock}>
              <header className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>If you like this</h2>
                <span className={styles.sectionMeta}>
                  {relatedLabels.length} related {relatedLabels.length === 1 ? "label" : "labels"}
                </span>
              </header>
              <RelatedLabels rows={relatedLabels} />
            </section>
          )}

          {rosterRows.length > 0 && (
            <RosterColumn rows={rosterRows} title="Roster" maxVisible={12} />
          )}

          <Suspense fallback={null}>
            <TopCreditsBlock labelDiscogsId={label.discogs_id} limit={10} />
          </Suspense>

          {(label.parent_label?.discogs_id || (label.sublabels && label.sublabels.length > 0)) && (
            <section className={styles.sideBlock}>
              <header className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Family Tree</h2>
                <span className={styles.sectionMeta}>
                  {label.sublabels?.length
                    ? `${label.sublabels.length} sublabel${label.sublabels.length === 1 ? "" : "s"}`
                    : "parent label"}
                </span>
              </header>
              <SublabelTree
                parent={{ discogs_id: label.discogs_id, name: label.name }}
                grandParent={
                  label.parent_label?.discogs_id && label.parent_label.name
                    ? {
                        discogs_id: label.parent_label.discogs_id,
                        name: label.parent_label.name,
                      }
                    : null
                }
                children={label.sublabels ?? []}
                maxVisible={12}
              />
            </section>
          )}

          {stylesData.styles.length > 0 && (
            <section className={styles.sideBlock}>
              <header className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Genre Profile</h2>
                <span className={styles.sectionMeta}>top {stylesData.styles.length}</span>
              </header>
              <GenreBar
                styles={stylesData.styles}
                totalTagged={stylesData.meta.total_tagged_masters}
              />
            </section>
          )}
        </div>
      </div>

      <div className={styles.linerSection}>
        <LinerNotes eyebrow="LINER NOTES">
          {label.profile && (
            <LinerNotes.Section label="Profile">
              <DiscogsProfile text={label.profile} className={styles.profile} names={resolvedNames} />
            </LinerNotes.Section>
          )}

          {label.aliases.length > 0 && (
            <LinerNotes.Section label="Also known as">
              <div className={styles.aliases}>
                {label.aliases.map((name) => (
                  <span className={styles.alias} key={`alias-${name}`}>{name}</span>
                ))}
              </div>
            </LinerNotes.Section>
          )}

          {(label.urls.length > 0 || linkoutsData.linkouts.length > 0) && (
            <LinerNotes.Section label="External links">
              <div className={styles.linkRow}>
                {linkoutsData.linkouts.map((l) => (
                  <a
                    key={`${l.provider}-${l.handle}`}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.linkPill}
                  >
                    {l.provider === "bandcamp" ? "Bandcamp" : "Instagram"}
                    {l.handle ? ` · @${l.handle}` : ""}
                  </a>
                ))}
                {label.urls.slice(0, 12).map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className={styles.linkPill}>
                    {urlLabel(url)}
                  </a>
                ))}
              </div>
            </LinerNotes.Section>
          )}

          <LinerNotes.Section label="Source">
            <div className={styles.linkRow}>
              <a
                href={discogsUrl("label", label.discogs_id)}
                target="_blank"
                rel="noreferrer"
                className={styles.linkPill}
              >
                Open on Discogs
              </a>
            </div>
          </LinerNotes.Section>
        </LinerNotes>
      </div>

      <JsonLd data={[
        labelJsonLd({ discogs_id: label.discogs_id, name: label.name, urls: label.urls }),
        breadcrumbJsonLd([
          { name: "dig", url: BASE_URL },
          { name: label.name, url: `${BASE_URL}/label/${label.discogs_id}` },
        ]),
      ]} />
    </Page>
  );
}


/**
 * The traversal endpoint returns catalog_number on the chronological label
 * release list (after migration 027 + the API's `sort=chronological` flag).
 * Older API versions don't include it — just fall back to null.
 */
function getCatalogNumber(link: unknown): string | null {
  if (!link || typeof link !== "object") return null;
  const v = (link as Record<string, unknown>).catalog_number;
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}
