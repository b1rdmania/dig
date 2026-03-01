import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiRequestError, digFetch } from "@/lib/api";
import {
  isMasterResponse,
  isTraversalResponse,
  type MasterResponse,
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
    const data = await digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 });
    if (!isMasterResponse(data)) return { title: "Master — Dig" };
    const artist = data.master.artists[0]?.name || "Unknown";
    return {
      title: `${data.master.title} — ${artist} — Dig`,
      description: `Master release for ${data.master.title}.`,
    };
  } catch {
    return { title: "Master — Dig" };
  }
}

export default async function MasterPage({ params }: Props) {
  const { id } = await params;

  try {
    const [masterData, releasesData] = await Promise.all([
      digFetch<MasterResponse>(`/v1/masters/${id}`, { revalidate: 300 }),
      digFetch<TraversalResponse>(`/v1/masters/${id}/releases?limit=100`, { revalidate: 300 }),
    ]);

    if (!isMasterResponse(masterData) || !isTraversalResponse(releasesData)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    const master = masterData.master;
    const artistLine = master.artists.map((a) => a.name).join(", ");

    return (
      <div className={styles.page}>
        <section className={styles.hero}>
          <h1 className={styles.title}>{master.title}</h1>
          {artistLine && <div className={styles.subtitle}>{artistLine}</div>}
          <div className={styles.meta}>
            {master.year && <span>{master.year}</span>}
            <span>Master #{master.discogs_id}</span>
          </div>
          {(master.genres.length > 0 || master.styles.length > 0) && (
            <div className={styles.tags}>
              {master.genres.map((g) => (
                <span className={styles.tag} key={`g-${g}`}>{g}</span>
              ))}
              {master.styles.map((s) => (
                <span className={styles.tag} key={`s-${s}`}>{s}</span>
              ))}
            </div>
          )}
          <div className={styles.links}>
            <a
              href={discogsUrl("master", master.discogs_id)}
              target="_blank"
              rel="noreferrer"
              className={styles.link}
            >
              Open Master on Discogs
            </a>
            {master.main_release_discogs_id && (
              <Link href={`/release/${master.main_release_discogs_id}`} className={styles.link}>
                Open Main Release
              </Link>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.heading}>Versions</h2>
          {releasesData.links.length === 0 && (
            <div className={styles.small}>No linked releases found.</div>
          )}
          {releasesData.links.map((link) => (
            <div key={link.discogs_id} className={styles.row}>
              <Link href={`/release/${link.discogs_id}`} className={styles.releaseTitle}>
                {link.title || `Release ${link.discogs_id}`}
              </Link>
              <span className={styles.small}>{link.year || "—"}</span>
              <a
                href={discogsUrl("release", link.discogs_id)}
                target="_blank"
                rel="noreferrer"
                className={styles.small}
              >
                Discogs
              </a>
            </div>
          ))}
        </section>

        <Provenance provenance={master.provenance} />
      </div>
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") notFound();
    if (err instanceof ApiRequestError) return <ErrorMessage code={err.code} message={err.message} />;
    return <ErrorMessage message="Failed to load master release" />;
  }
}
