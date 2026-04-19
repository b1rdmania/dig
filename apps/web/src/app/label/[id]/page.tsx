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
  type ArtistResponse,
} from "@/lib/types";
import { discogsUrl, urlLabel } from "@/lib/format";
import { entityMetadata, BASE_URL } from "@/lib/seo";
import { labelJsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { JsonLd } from "@/components/JsonLd";
import { Provenance } from "@/components/Provenance";
import { TrailRecorder } from "@/components/TrailRecorder";
import { DiscogsProfile, extractProfileRefs } from "@/components/DiscogsProfile";
import { SectionSkeleton } from "@/components/SectionSkeleton";
import { ShareBar } from "@/components/ShareBar";
import {
  Page,
  Sticker,
  Stamp,
  CatalogSpine,
  RosterColumn,
  LinerNotes,
  GenreBar,
  SublabelTree,
  LabelWordmark,
  hasCuratedWordmark,
  CoreRun,
  RelatedLabels,
  type SpineRow,
  type RosterRow,
} from "@/components/design";
import { TopCreditsBlock } from "@/components/TopCreditsBlock";
import { LabelHeroImage } from "@/components/LabelHeroImage";
import styles from "./page.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  try {
    const data = await digFetch<LabelResponse>(`/v1/labels/${id}`, { revalidate: 300 });
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
  let labelData: LabelResponse;
  try {
    labelData = await digFetch<LabelResponse>(`/v1/labels/${id}`, { revalidate: 300 });
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
  const tier = ed?.tier ?? label.tier;
  const palette = ed?.palette ?? null;
  const coreRun = labelData.core_run ?? [];
  const relatedLabels = labelData.related ?? [];

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

  const profileRefs = label.profile ? extractProfileRefs(label.profile) : { artists: [], labels: [] };
  const artistIdsToResolve = [...new Set(profileRefs.artists)].slice(0, 10);
  const labelIdsToResolve = [...new Set(profileRefs.labels)].slice(0, 5);

  const [releasesData, rosterData, linkoutsData, stylesData, ...nameResults] = await Promise.all([
    digFetch<TraversalResponse>(`/v1/labels/${id}/releases?limit=200&sort=chronological`, { revalidate: 300 })
      .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
      .catch(() => defaultTraversal),
    digFetch<LabelRosterResponse>(`/v1/labels/${id}/roster?limit=12`, { revalidate: 600 })
      .then((d) => (isLabelRosterResponse(d) ? d : defaultRoster))
      .catch(() => defaultRoster),
    digFetch<LabelLinkoutsResponse>(`/v1/labels/${id}/linkouts?include_enrichment=true`, { revalidate: 3600 })
      .then((d) => (isLinkoutsResponse(d) ? d : defaultLinkouts))
      .catch(() => defaultLinkouts),
    digFetch<LabelStylesResponse>(`/v1/labels/${id}/styles?limit=8`, { revalidate: 600 })
      .then((d) => (isLabelStylesResponse(d) ? d : defaultStyles))
      .catch(() => defaultStyles),
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

  const yearLine = formatYearLine(ed?.founded_year ?? null, ed?.closed_year ?? null, ed?.is_active ?? true);
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

  const totalSpine = releasesData.pagination.total_estimate ?? releasesData.links.length;

  return (
    <Page
      entityType="label"
      entityId={label.discogs_id}
      accent={palette?.accent}
      accentInk={palette?.accent_ink}
    >
      <TrailRecorder
        kind="label"
        id={label.discogs_id}
        name={label.name}
        subtitle={ed?.location ?? undefined}
      />
      <div className={styles.identity}>
        {palette && <div className={styles.accentRule} aria-hidden />}
        <Suspense fallback={null}>
          <LabelHeroImage discogsId={label.discogs_id} labelName={label.name} mode="mark" />
        </Suspense>
        <div className={styles.eyebrow}>
          <span>LABEL</span>
          <span className={styles.eyebrowSep}>·</span>
          <span>#{label.discogs_id}</span>
          {ed?.location && (
            <>
              <span className={styles.eyebrowSep}>·</span>
              <span>{ed.location}</span>
            </>
          )}
        </div>
        <h1 className={styles.title}>
          {hasCuratedWordmark(label.discogs_id) || (tier === "tier1" && palette) ? (
            <LabelWordmark
              discogsId={label.discogs_id}
              name={label.name}
              palette={palette}
              size="md"
            />
          ) : (
            <span>{label.name}</span>
          )}
          {tier === "tier1" && (
            <span className={styles.tier1Sticker}>
              <Sticker tone="tier1" size="md" title="Canonical scene label (editorial tier 1)">
                Tier 1
              </Sticker>
            </span>
          )}
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

        <div className={styles.metaStrip}>
          {yearLine && (
            <span className={styles.item}>
              <span className={styles.key}>Active</span>
              <span className={styles.val}>{yearLine}</span>
            </span>
          )}
          <span className={styles.item}>
            <span className={styles.key}>Catalog</span>
            <span className={styles.val}>{totalSpine.toLocaleString()} masters</span>
          </span>
          {label.aliases.length > 0 && (
            <span className={styles.item}>
              <span className={styles.key}>Aliases</span>
              <span className={styles.val}>{label.aliases.length}</span>
            </span>
          )}
          {ed && !ed.is_active && <Stamp title="Label is dormant or defunct">Inactive</Stamp>}
        </div>

        {ed?.blurb && (
          <>
            <div className={styles.blurb}>“{ed.blurb}”</div>
            <div className={styles.blurbAttrib}>—— editorial · dig</div>
          </>
        )}

        <div className={styles.shareWrap}>
          <ShareBar
            url={`${BASE_URL}/label/${label.discogs_id}`}
            title={label.name}
            entityType="label"
            entityId={label.discogs_id}
          />
        </div>
      </div>

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
              <CoreRun rows={coreRun} />
            </section>
          )}
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Catalog Spine</h2>
            <span className={styles.sectionMeta}>
              {spineRows.length === 0
                ? "no in-scope masters"
                : `${spineRows.length} master${spineRows.length === 1 ? "" : "s"} · chronological`}
            </span>
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

      <div className={styles.provenanceWrap}>
        <Provenance provenance={label.provenance} />
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

function formatYearLine(founded: number | null, closed: number | null, isActive: boolean): string | null {
  if (founded == null && closed == null) {
    return isActive ? null : "Inactive";
  }
  if (founded != null && closed != null) {
    return `${founded}–${String(closed).slice(-2)}`;
  }
  if (founded != null) {
    return isActive ? `${founded}–` : `${founded}–?`;
  }
  return `?–${closed}`;
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
