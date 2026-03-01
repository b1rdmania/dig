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
    const [artistData, mastersData] = await Promise.all([
      digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 }),
      digFetch<TraversalResponse>(`/v1/artists/${id}/masters?limit=50`, { revalidate: 300 }),
    ]);

    if (!isArtistResponse(artistData) || !isTraversalResponse(mastersData)) {
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
              {artist.aliases.map((alias) => (
                <span className={styles.pill} key={`alias-${alias.discogs_id || alias.name}`}>
                  {alias.name}
                </span>
              ))}
              {artist.name_variations.map((nv) => (
                <span className={styles.pill} key={`nv-${nv}`}>{nv}</span>
              ))}
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
