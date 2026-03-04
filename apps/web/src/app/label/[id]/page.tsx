import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiRequestError, digFetch } from "@/lib/api";
import {
  isLabelResponse,
  isTraversalResponse,
  isLinkoutsResponse,
  type LabelResponse,
  type TraversalResponse,
  type LabelLinkoutsResponse,
  type LabelLinkout,
} from "@/lib/types";
import { discogsUrl } from "@/lib/format";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Provenance } from "@/components/Provenance";
import styles from "../../artist/[id]/page.module.css";

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
    if (!isLabelResponse(data)) return { title: "Label — Dig" };
    return {
      title: `${data.label.name} — Dig`,
      description: `Label page for ${data.label.name}.`,
    };
  } catch {
    return { title: "Label — Dig" };
  }
}

export default async function LabelPage({ params }: Props) {
  const { id } = await params;

  try {
    const defaultTraversal: TraversalResponse = {
      links: [],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: { source_type: "label", source_discogs_id: Number(id), link_type: "releases", elapsed_ms: 0 },
    };
    const defaultLinkouts: LabelLinkoutsResponse = {
      linkouts: [],
      meta: { source_type: "label", source_discogs_id: Number(id), elapsed_ms: 0, enrichment_included: false, enrichment_sources: [] },
    };

    const [labelData, releasesData, linkoutsData] = await Promise.all([
      digFetch<LabelResponse>(`/v1/labels/${id}`, { revalidate: 300 }),
      digFetch<TraversalResponse>(`/v1/labels/${id}/releases?limit=30`, { revalidate: 300 })
        .then((d) => (isTraversalResponse(d) ? d : defaultTraversal))
        .catch(() => defaultTraversal),
      digFetch<LabelLinkoutsResponse>(`/v1/labels/${id}/linkouts?include_enrichment=true`, { revalidate: 3600 })
        .then((d) => (isLinkoutsResponse(d) ? d : defaultLinkouts))
        .catch(() => defaultLinkouts),
    ]);

    if (!isLabelResponse(labelData)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    const label = labelData.label;

    return (
      <div className={styles.page}>
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

        {label.profile && (
          <section className={styles.section}>
            <h2 className={styles.heading}>Profile</h2>
            <p className={styles.copy}>{label.profile}</p>
          </section>
        )}

        {linkoutsData.linkouts.length > 0 && <LabelLinkouts linkouts={linkoutsData.linkouts} />}

        <section className={styles.section}>
          <h2 className={styles.heading}>Releases</h2>
          {releasesData.links.length === 0 && (
            <div className={styles.small}>No linked releases found.</div>
          )}
          {releasesData.links.map((link) => (
            <div className={styles.row} key={link.discogs_id}>
              <Link href={`/version/${link.discogs_id}`} className={styles.item}>
                {link.title || `Release ${link.discogs_id}`}
              </Link>
              <span className={styles.small}>{link.year || "—"}</span>
            </div>
          ))}
        </section>

        {label.urls.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.heading}>External Links</h2>
            <div className={styles.list}>
              {label.urls.slice(0, 10).map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className={styles.pill}>
                  {url}
                </a>
              ))}
            </div>
          </section>
        )}

        <Provenance provenance={label.provenance} />
      </div>
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") notFound();
    if (err instanceof ApiRequestError) return <ErrorMessage code={err.code} message={err.message} />;
    return <ErrorMessage message="Failed to load label" />;
  }
}
