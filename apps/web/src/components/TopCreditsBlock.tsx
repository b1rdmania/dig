/**
 * Label page → "Top remixers / producers" sidebar block.
 *
 * Pulls /v1/labels/:id/top-credits, which aggregates Rule A credits inside
 * the scope (so this is "who shows up on this label, doing what"). Rendered
 * defensively: if the endpoint or table isn't ready yet, the block silently
 * disappears.
 */
import Link from "next/link";
import { digFetch } from "@/lib/api";
import {
  isLabelTopCreditsResponse,
  type LabelTopCreditsResponse,
} from "@/lib/types";
import styles from "./TopCreditsBlock.module.css";

interface Props {
  labelDiscogsId: number;
  limit?: number;
}

export async function TopCreditsBlock({ labelDiscogsId, limit = 12 }: Props) {
  let data: LabelTopCreditsResponse | null = null;
  try {
    const res = await digFetch<LabelTopCreditsResponse>(
      `/v1/labels/${labelDiscogsId}/top-credits?limit=${limit}`,
      { revalidate: 600 },
    );
    if (isLabelTopCreditsResponse(res)) data = res;
  } catch {
    return null;
  }
  if (!data || data.entries.length === 0) return null;

  return (
    <section className={styles.block}>
      <header className={styles.head}>
        <h2 className={styles.title}>Studio Hands</h2>
        <span className={styles.meta}>top {data.entries.length} · remixes &amp; productions</span>
      </header>
      <ul className={styles.list}>
        {data.entries.map((e) => (
          <li className={styles.row} key={e.artist_discogs_id}>
            <Link href={`/artist/${e.artist_discogs_id}#credits`} className={styles.name}>
              {e.artist_name}
            </Link>
            <div className={styles.rolesRow}>
              {e.roles.slice(0, 3).map((r) => (
                <span className={styles.roleChip} key={`${e.artist_discogs_id}-${r}`}>
                  {r}
                </span>
              ))}
              <span className={styles.count} title={`${e.credit_count} credit lines`}>
                {e.master_count}× master{e.master_count === 1 ? "" : "s"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
