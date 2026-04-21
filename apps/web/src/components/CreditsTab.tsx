/**
 * Artist page → Rule A credits ("Remixes & productions").
 *
 * Renders one card per master where this artist has at least one credit.
 * Cards link to the master page; the role chips are click-through filters.
 *
 * This is server-component-friendly: it fetches via digFetch and ignores any
 * client interactivity beyond the link surfaces (which are <Link>s).
 */
import Link from "next/link";
import { digFetch } from "@/lib/api";
import { isArtistMasterCreditsResponse, type ArtistMasterCreditsResponse } from "@/lib/types";
import styles from "./CreditsTab.module.css";

interface Props {
  artistDiscogsId: number;
  /** "remix" | "produce" | "mix" | "master" | etc. Falsy = all */
  role?: string | null;
  limit?: number;
  /** When true, hides the default heading + filter strip. Used when the
   *  section is embedded inside another tabbed surface (e.g. the Remixes
   *  tab on the artist page). */
  hideHeader?: boolean;
  /** Text to display when there are zero credits. Null hides the section. */
  emptyMessage?: string | null;
}

const ROLE_FILTERS: Array<{ value: string | null; label: string }> = [
  { value: null,       label: "All credits" },
  { value: "remix",    label: "Remixes / Edits" },
  { value: "produce",  label: "Productions" },
  { value: "mix",      label: "Mixed by" },
  { value: "master",   label: "Mastered by" },
  { value: "vocal",    label: "Vocals" },
  { value: "write",    label: "Written by" },
];

export async function CreditsTab({
  artistDiscogsId,
  role,
  limit = 60,
  hideHeader = false,
  emptyMessage = null,
}: Props) {
  let data: ArtistMasterCreditsResponse | null = null;
  try {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (role) params.set("role", role);
    const res = await digFetch<ArtistMasterCreditsResponse>(
      `/v1/artists/${artistDiscogsId}/credits?${params.toString()}`,
      { revalidate: 600 },
    );
    if (isArtistMasterCreditsResponse(res)) data = res;
  } catch {
    return null;
  }
  if (!data || data.links.length === 0) {
    if (emptyMessage) {
      return <p className={styles.empty}>{emptyMessage}</p>;
    }
    return null;
  }

  const totalLabel =
    data.pagination.total_estimate != null
      ? `${data.pagination.total_estimate}`
      : `${data.links.length}`;

  return (
    <section className={hideHeader ? undefined : styles.section}>
      {!hideHeader && (
        <header className={styles.head}>
          <h2 className={styles.heading}>Remixes &amp; productions ({totalLabel})</h2>
          <div className={styles.filters}>
            {ROLE_FILTERS.map((f) => {
              const isActive = (role ?? null) === f.value;
              const params = new URLSearchParams();
              if (f.value) params.set("credits_role", f.value);
              const href = `/artist/${artistDiscogsId}${params.size ? `?${params.toString()}` : ""}#credits`;
              return (
                <Link
                  key={f.label}
                  href={href}
                  className={isActive ? styles.chipActive : styles.chip}
                  scroll={false}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>
        </header>
      )}

      <ul className={styles.list}>
        {data.links.map((c) => (
          <li className={styles.row} key={c.master_discogs_id}>
            <div className={styles.rowMain}>
              <Link href={`/master/${c.master_discogs_id}`} className={styles.title}>
                {c.master_title || `Master ${c.master_discogs_id}`}
              </Link>
              <div className={styles.byline}>
                {c.primary_artist_discogs_id ? (
                  <Link href={`/artist/${c.primary_artist_discogs_id}`} className={styles.bylineLink}>
                    {c.primary_artist_name ?? "Various"}
                  </Link>
                ) : (
                  <span>{c.primary_artist_name ?? "Various"}</span>
                )}
                {c.primary_label_name && (
                  <>
                    <span className={styles.sep}>·</span>
                    {c.primary_label_discogs_id ? (
                      <Link href={`/label/${c.primary_label_discogs_id}`} className={styles.bylineLink}>
                        {c.primary_label_name}
                      </Link>
                    ) : (
                      <span>{c.primary_label_name}</span>
                    )}
                  </>
                )}
                {c.master_year && (
                  <>
                    <span className={styles.sep}>·</span>
                    <span>{c.master_year}</span>
                  </>
                )}
              </div>
              {c.track_lines.length > 0 && (
                <details className={styles.tracks}>
                  <summary className={styles.tracksToggle}>
                    {c.track_lines.length} track{c.track_lines.length === 1 ? "" : "s"} credited
                  </summary>
                  <ul className={styles.trackList}>
                    {c.track_lines.slice(0, 12).map((t, i) => (
                      <li key={`${c.master_discogs_id}-${t.track_position ?? i}-${i}`} className={styles.trackLine}>
                        <span className={styles.trackPos}>{t.track_position ?? "—"}</span>
                        <span className={styles.trackTitle}>{t.track_title ?? "(untitled)"}</span>
                        <span className={styles.trackRole}>{t.role}</span>
                      </li>
                    ))}
                    {c.track_lines.length > 12 && (
                      <li className={styles.trackOverflow}>
                        +{c.track_lines.length - 12} more
                      </li>
                    )}
                  </ul>
                </details>
              )}
            </div>
            <div className={styles.rowAside}>
              {c.roles.map((r) => (
                <span className={styles.role} key={`${c.master_discogs_id}-${r}`}>
                  {r}
                </span>
              ))}
              {c.has_release_level && (
                <span className={styles.roleSubtle} title="Release-level credit (Mastered By, A&R, etc.)">
                  + release-level
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {data.pagination.has_more && (
        <p className={styles.foot}>
          Showing top {data.links.length} of {totalLabel}. More on Discogs.
        </p>
      )}
    </section>
  );
}
