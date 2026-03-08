import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiRequestError, digFetch } from "@/lib/api";
import {
  isLabelResponse,
  isTraversalResponse,
  isLinkoutsResponse,
  isArtistResponse,
  type LabelResponse,
  type TraversalResponse,
  type LabelLinkoutsResponse,
  type LabelLinkout,
  type ArtistResponse,
} from "@/lib/types";
import { discogsUrl, urlLabel } from "@/lib/format";
import { entityMetadata, BASE_URL } from "@/lib/seo";
import { labelJsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { JsonLd } from "@/components/JsonLd";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Provenance } from "@/components/Provenance";
import { DiscogsProfile, extractProfileRefs } from "@/components/DiscogsProfile";
import { SectionSkeleton } from "@/components/SectionSkeleton";
import { hrefForTraversalLink } from "@/lib/routes";
import styles from "../../artist/[id]/page.module.css";

function BandcampIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 512 512" fill="currentColor" style={{ verticalAlign: "-2px" }}>
      <path d="M256 0C114.6 0 0 114.6 0 256s114.6 256 256 256 256-114.6 256-256S397.4 0 256 0zm-38.3 352H104l86.3-192h113.7L217.7 352z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "-2px" }}>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function LabelLinkouts({ linkouts }: { linkouts: LabelLinkout[] }) {
  if (linkouts.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Store &amp; Social</h2>
      <div className={styles.list}>
        {linkouts.map((l) => (
          <a
            key={`${l.provider}-${l.handle}`}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className={styles.pillLink}
          >
            {l.provider === "bandcamp" ? <BandcampIcon /> : <InstagramIcon />}
            {" "}
            {l.provider === "bandcamp" ? "Bandcamp" : "Instagram"}
            {l.handle ? ` (@${l.handle})` : ""}
          </a>
        ))}
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
    const data = await digFetch<LabelResponse>(`/v1/labels/${id}`, { revalidate: 300 });
    if (!isLabelResponse(data)) return { title: "Label — dig" };
    return entityMetadata({ title: data.label.name, description: data.label.name, path: `/label/${id}`, type: "label" });
  } catch {
    return { title: "Label — dig" };
  }
}

export default async function LabelPage({ params }: Props) {
  const { id } = await params;

  // Shell renders bare layout immediately. Full content (including entity lookup)
  // streams in via Suspense — prevents slow API responses from producing error pages.
  return (
    <div className={styles.page}>
      <Suspense fallback={<SectionSkeleton lines={4} />}>
        <LabelContent id={id} />
      </Suspense>
    </div>
  );
}

async function LabelContent({ id }: { id: string }) {
  try {
    const labelData = await digFetch<LabelResponse>(`/v1/labels/${id}`, { revalidate: 300 });

    if (!isLabelResponse(labelData)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    const label = labelData.label;

    return (
      <>
        {/* ── Hero: renders immediately after entity lookup ── */}
        <section className={styles.hero}>
          <h1 className={styles.title}>{label.name}</h1>
          {label.parent_label?.name && (
            <div className={styles.subtitle}>
              Parent: {label.parent_label.discogs_id ? (
                <Link href={`/label/${label.parent_label.discogs_id}`}>{label.parent_label.name}</Link>
              ) : (
                label.parent_label.name
              )}
            </div>
          )}
          <div className={styles.links}>
            <a
              href={discogsUrl("label", label.discogs_id)}
              target="_blank"
              rel="noreferrer"
              className={styles.link}
            >
              Open on Discogs
            </a>
          </div>
        </section>

        {/* ── Releases: streams in independently — fast for small labels, graceful for large ── */}
        <Suspense fallback={<SectionSkeleton lines={5} />}>
          <LabelReleases id={id} />
        </Suspense>

        {/* ── Profile + Linkouts: stream in (name resolution + enrichment fetch) ── */}
        <Suspense fallback={<SectionSkeleton lines={3} />}>
          <LabelDetails id={id} profile={label.profile} urls={label.urls} />
        </Suspense>

        <JsonLd data={[
          labelJsonLd({ discogs_id: label.discogs_id, name: label.name, urls: label.urls }),
          breadcrumbJsonLd([
            { name: "dig", url: BASE_URL },
            { name: label.name, url: `${BASE_URL}/label/${label.discogs_id}` },
          ]),
        ]} />
        <Provenance provenance={label.provenance} />
      </>
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") notFound();
    // Slow/failed fetches: show graceful fallback with search link (not an error code)
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

/* ── Async streamed sections ── */

/** Releases list: fetches independently so shell renders without waiting. */
async function LabelReleases({ id }: { id: string }) {
  const defaultTraversal: TraversalResponse = {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: null },
    meta: { source_type: "label", source_discogs_id: Number(id), link_type: "releases", elapsed_ms: 0 },
  };
  const releasesData = await digFetch<TraversalResponse>(`/v1/labels/${id}/releases?limit=30`, { revalidate: 300 })
    .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
    .catch(() => defaultTraversal);

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Releases</h2>
      {releasesData.links.length === 0 && (
        <div className={styles.small}>No linked releases found.</div>
      )}
      {releasesData.links.map((link) => (
        <div className={styles.row} key={link.discogs_id}>
          <Link href={hrefForTraversalLink(link)} className={styles.item}>
            {link.title || `Release ${link.discogs_id}`}
          </Link>
          <span className={styles.small}>{link.year || "—"}</span>
        </div>
      ))}
    </section>
  );
}

/** Profile + linkouts + external links: fetches linkouts and resolves profile names. */
async function LabelDetails({ id, profile, urls }: { id: string; profile: string | null; urls: string[] }) {
  const defaultLinkouts: LabelLinkoutsResponse = {
    linkouts: [],
    meta: { source_type: "label", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, enrichment_sources: [] },
  };

  // Fetch linkouts + resolve profile names in parallel
  const [linkoutsData, profileNames] = await Promise.all([
    digFetch<LabelLinkoutsResponse>(`/v1/labels/${id}/linkouts?include_enrichment=true`, { revalidate: 3600 })
      .then((d) => (isLinkoutsResponse(d) ? d : defaultLinkouts))
      .catch(() => defaultLinkouts),
    profile ? resolveProfileNames(profile) : Promise.resolve({}),
  ]);

  const hasContent = profile || linkoutsData.linkouts.length > 0 || urls.length > 0;
  if (!hasContent) return null;

  return (
    <>
      {profile && (
        <section className={styles.section}>
          <h2 className={styles.heading}>Profile</h2>
          <DiscogsProfile text={profile} className={styles.copy} names={profileNames} />
        </section>
      )}

      {linkoutsData.linkouts.length > 0 && <LabelLinkouts linkouts={linkoutsData.linkouts} />}

      {urls.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.heading}>External Links</h2>
          <div className={styles.list}>
            {urls.slice(0, 10).map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className={styles.pillLink}>
                {urlLabel(url)}
              </a>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** Resolve Discogs profile [aXXX]/[lXXX] refs to display names */
async function resolveProfileNames(profile: string): Promise<Record<string, string>> {
  const refs = extractProfileRefs(profile);
  const names: Record<string, string> = {};

  const fetches = [
    ...refs.artists.map(async (aid) => {
      try {
        const data = await digFetch<ArtistResponse>(`/v1/artists/${aid}`, { revalidate: 3600 });
        if (isArtistResponse(data)) names[`a${aid}`] = data.artist.name;
      } catch { /* skip */ }
    }),
    ...refs.labels.map(async (lid) => {
      try {
        const data = await digFetch<LabelResponse>(`/v1/labels/${lid}`, { revalidate: 3600 });
        if (isLabelResponse(data)) names[`l${lid}`] = data.label.name;
      } catch { /* skip */ }
    }),
  ];

  await Promise.all(fetches);
  return names;
}
