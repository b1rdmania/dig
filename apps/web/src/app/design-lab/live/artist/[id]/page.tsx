import Link from "next/link";
import { digFetch } from "@/lib/api";
import {
  isArtistResponse,
  isTraversalResponse,
  isArtistCreditsResponse,
  type ArtistResponse,
  type TraversalResponse,
  type ArtistCreditsResponse,
} from "@/lib/types";
import { urlLabel } from "@/lib/format";
import { hrefForTraversalLink } from "../../shared";
import styles from "../../live.module.css";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const RELEASE_TYPES = ["all", "album", "single_ep", "compilation", "other"] as const;

type ReleaseType = (typeof RELEASE_TYPES)[number];

function readReleaseType(value: string | string[] | undefined): ReleaseType {
  if (typeof value !== "string") return "all";
  return (RELEASE_TYPES as readonly string[]).includes(value) ? (value as ReleaseType) : "all";
}

export default async function DesignLabArtistPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const releaseType = readReleaseType(sp.release_type);

  const [artistRes, releasesRes, creditsRes] = await Promise.all([
    digFetch<ArtistResponse>(`/v1/artists/${id}`, { revalidate: 300 }).catch(() => null),
    digFetch<TraversalResponse>(
      `/v1/artists/${id}/catalog_releases?limit=60&sort=newest${releaseType !== "all" ? `&release_type=${releaseType}` : ""}`,
      { revalidate: 300 },
    ).catch(() => null),
    digFetch<ArtistCreditsResponse>(`/v1/artists/${id}/credits?limit=30`, { revalidate: 300 }).catch(() => null),
  ]);

  const artist = artistRes && isArtistResponse(artistRes) ? artistRes.artist : null;
  const releases = releasesRes && isTraversalResponse(releasesRes) ? releasesRes.links : [];
  const credits = creditsRes && isArtistCreditsResponse(creditsRes) ? creditsRes.links : [];

  if (!artist) {
    return (
      <main className={styles.page}>
        <section className={styles.section}>
          <p className={styles.warn}>Artist not found.</p>
          <div className={styles.links}><Link className={styles.pill} href="/design-lab/live/search">Back to search</Link></div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>Live Template / Artist</p>
        <h1 className={styles.title}>{artist.name}</h1>
        {artist.real_name && <p className={styles.sub}>Real name: {artist.real_name}</p>}
        <div className={styles.links}>
          <Link className={styles.pill} href="/design-lab/live">Lab home</Link>
          <Link className={styles.pill} href="/design-lab/live/search">Search</Link>
          <a className={styles.pill} href={`https://www.discogs.com/artist/${artist.discogs_id}`} target="_blank" rel="noreferrer">Open on Discogs</a>
        </div>
        {(artist.aliases.length > 0 || artist.groups.length > 0) && (
          <div className={styles.badges}>
            {artist.aliases.slice(0, 6).map((a) => (
              <span key={`alias-${a.name}`} className={styles.badge}>Alias: {a.name}</span>
            ))}
            {artist.groups.slice(0, 6).map((g) => (
              <span key={`group-${g.name}`} className={styles.badge}>Group: {g.name}</span>
            ))}
          </div>
        )}
      </section>

      {artist.profile && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>About</h2>
          <p className={styles.warn} style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, color: "var(--lab-text)" }}>{artist.profile}</p>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Releases (main artist) • {releases.length}</h2>
        <div className={styles.tabs}>
          {RELEASE_TYPES.map((rt) => {
            const href = `/design-lab/live/artist/${id}${rt === "all" ? "" : `?release_type=${rt}`}`;
            const label = rt === "all" ? "All" : rt === "album" ? "Albums / LPs" : rt === "single_ep" ? "Singles / EPs" : rt === "compilation" ? "Compilations" : "Other";
            const className = rt === releaseType ? styles.tabActive : styles.tab;
            return (
              <Link key={rt} href={href} className={className}>{label}</Link>
            );
          })}
        </div>
        {releases.length === 0 && <div className={styles.emptyCard}>No releases found for this filter.</div>}
        <div className={styles.list}>
          {releases.map((r) => (
            <div className={styles.row} key={`${r.type}-${r.discogs_id}`}>
              <div>
                <Link className={styles.mainLink} href={hrefForTraversalLink(r)}>
                  {r.title || `Release ${r.discogs_id}`}
                </Link>
                <div className={styles.subMeta}>{r.country || "—"}</div>
              </div>
              <span className={styles.meta}>{r.release_type_label || r.type}{r.year ? ` • ${r.year}` : ""}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Credits &amp; Appearances • {credits.length}</h2>
        {credits.length === 0 && <div className={styles.emptyCard}>No credits found.</div>}
        <div className={styles.list}>
          {credits.map((c) => (
            <div className={styles.row} key={`${c.release_discogs_id}-${c.roles.join("|")}-${c.credit_source}`}>
              <div>
                <Link className={styles.mainLink} href={`/design-lab/live/version/${c.release_discogs_id}`}>
                  {c.title || `Release ${c.release_discogs_id}`}
                </Link>
                <div className={styles.subMeta}>{c.roles.slice(0, 3).join(", ")}</div>
              </div>
              <span className={styles.meta}>{c.role_family}{c.year ? ` • ${c.year}` : ""}</span>
            </div>
          ))}
        </div>
      </section>

      {artist.urls.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>External Links</h2>
          <div className={styles.links}>
            {artist.urls.slice(0, 10).map((url) => (
              <a key={url} className={styles.pill} href={url} target="_blank" rel="noreferrer">{urlLabel(url)}</a>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <p className={styles.meta}>discogs|{artist.provenance.dump_date}|#{artist.discogs_id}</p>
      </section>
    </main>
  );
}
