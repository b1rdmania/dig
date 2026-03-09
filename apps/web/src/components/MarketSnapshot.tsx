import { digFetch } from "@/lib/api";
import type { MarketResponse } from "@/lib/types";
import styles from "./MarketSnapshot.module.css";

interface Props {
  releaseId: number;
  discogsReleaseId?: number | null;
}

function formatPrice(price: number | null, currency: string): string {
  if (price == null) return "—";
  return `${currency} ${price.toFixed(2)}`;
}

function dataAge(fetchedAt: string): string {
  const days = Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/** Discogs market snapshot block. Fails silently if data unavailable. Server component. */
export async function MarketSnapshot({ releaseId, discogsReleaseId }: Props) {
  const id = discogsReleaseId ?? releaseId;
  const data = await digFetch<MarketResponse>(`/v1/releases/${id}/market`, { revalidate: 3600 })
    .catch(() => null);

  const market = data?.market;
  if (!market) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Discogs market snapshot</h2>
      <div className={styles.grid}>
        {market.lowest_price != null && (
          <div className={styles.stat}>
            <span className={styles.label}>Lowest listed</span>
            <span className={styles.value}>{formatPrice(market.lowest_price, market.currency)}</span>
          </div>
        )}
        {market.num_for_sale != null && (
          <div className={styles.stat}>
            <span className={styles.label}>For sale</span>
            <span className={styles.value}>{market.num_for_sale}</span>
          </div>
        )}
        {market.last_sold_price != null && (
          <div className={styles.stat}>
            <span className={styles.label}>Last sold (reported by Discogs)</span>
            <span className={styles.value}>{formatPrice(market.last_sold_price, market.currency)}</span>
          </div>
        )}
      </div>
      <div className={styles.footer}>
        <span className={styles.age}>Updated {dataAge(market.fetched_at)}</span>
        <a
          href={`https://www.discogs.com/sell/release/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.cta}
        >
          Open on Discogs →
        </a>
      </div>
    </section>
  );
}
