import type { Metadata } from "next";
import { digFetch, fetchMcpUsage } from "@/lib/api";
import type { ApiUsageSnapshot, UsageWindow } from "@/lib/types";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Usage — dig",
  description: "Live public usage stats for Dig web, API, and MCP beta.",
};
export const dynamic = "force-dynamic";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

function formatPct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function mapRows(map: Record<string, number>) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

interface WindowRowProps {
  label: string;
  window: UsageWindow | null | undefined;
}

function WindowRow({ label, window }: WindowRowProps) {
  if (!window) {
    return (
      <tr>
        <td className={styles.tdLabel}>{label}</td>
        <td className={styles.tdNum}>—</td>
        <td className={styles.tdNum}>—</td>
        <td className={styles.tdNum}>—</td>
      </tr>
    );
  }
  return (
    <tr>
      <td className={styles.tdLabel}>{label}</td>
      <td className={styles.tdNum}>{formatNumber(window.requests_total)}</td>
      <td className={styles.tdNum}>{formatNumber(window.errors_total)}</td>
      <td className={styles.tdNum}>{formatNumber(window.telemetry_events_total)}</td>
    </tr>
  );
}

export default async function UsagePage() {
  const [apiUsageResult, mcpUsageResult] = await Promise.allSettled([
    // Cache briefly to avoid burst/crawler amplification on API usage route.
    digFetch<ApiUsageSnapshot>("/v1/usage", { revalidate: 30 }),
    fetchMcpUsage(),
  ]);

  if (apiUsageResult.status !== "fulfilled") {
    return (
      <div className={styles.page}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Usage</p>
          <h1 className={styles.title}>Dig in the wild.</h1>
          <p className={styles.warn}>
            Usage stats are temporarily unavailable. Please check back shortly.
          </p>
        </section>
      </div>
    );
  }

  const apiUsage = apiUsageResult.value;
  const mcpUsage = mcpUsageResult.status === "fulfilled" ? mcpUsageResult.value : null;

  const categoryRows = mapRows(apiUsage.requests_by_category);
  const eventRows = mapRows(apiUsage.telemetry_by_event);
  const mcpRows = mcpUsage ? mapRows(mcpUsage.calls_by_tool) : [];
  const lifetimeCategoryRows = apiUsage.lifetime ? mapRows(apiUsage.lifetime.requests_by_category) : [];
  const lifetimeEventRows = apiUsage.lifetime ? mapRows(apiUsage.lifetime.telemetry_by_event) : [];

  const hasWindows =
    apiUsage.windows != null &&
    (apiUsage.windows.last_24h != null ||
      apiUsage.windows.last_7d != null ||
      apiUsage.windows.last_30d != null);

  // Funnel: use 7d window if available, else fall back to lifetime telemetry_by_event
  const funnelSource: Record<string, number> =
    apiUsage.windows?.last_7d?.telemetry_by_event ??
    apiUsage.lifetime?.telemetry_by_event ??
    apiUsage.telemetry_by_event;

  const funnelSearches = funnelSource["search_submitted"] ?? 0;
  const funnelClicks = funnelSource["search_result_clicked"] ?? 0;
  const funnelReleaseViews =
    (funnelSource["release_page_viewed"] ?? 0) + (funnelSource["version_page_viewed"] ?? 0);
  const hasFunnel = funnelSearches > 0 || funnelClicks > 0 || funnelReleaseViews > 0;
  const funnelPeriod = apiUsage.windows?.last_7d != null ? "last 7 days" : "lifetime";

  // Share funnel — use 7d window if available
  const shareWindow = apiUsage.windows?.last_7d ?? null;
  const sharesTotal = shareWindow?.shares_total ?? 0;
  const sharesByChannel = shareWindow?.shares_by_channel ?? apiUsage.lifetime?.shares_by_channel ?? {};
  const shareToPageview = shareWindow?.share_to_pageview_ratio ?? null;
  const hasShareData = sharesTotal > 0 || Object.keys(sharesByChannel).length > 0;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Usage</p>
        <h1 className={styles.title}>Dig in the wild.</h1>
        <p className={styles.lede}>
          Public beta usage snapshots. API totals are now cumulative across deploys, with process-window counters also
          shown for live diagnostics.
        </p>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <p className={styles.label}>API Requests (Lifetime)</p>
          <p className={styles.value}>{formatNumber(apiUsage.lifetime?.requests_total ?? apiUsage.requests_total)}</p>
          <p className={styles.sub}>{apiUsage.lifetime ? "cumulative since launch" : "fallback: since process start"}</p>
        </article>
        <article className={styles.card}>
          <p className={styles.label}>MCP Calls</p>
          <p className={styles.value}>{formatNumber(mcpUsage?.calls_total ?? 0)}</p>
          <p className={styles.sub}>{mcpUsage ? "since process start" : "unavailable"}</p>
        </article>
        <article className={styles.card}>
          <p className={styles.label}>Unique Sessions</p>
          <p className={styles.value}>{formatNumber(apiUsage.unique_sessions_estimate)}</p>
          <p className={styles.sub}>telemetry estimate</p>
        </article>
        <article className={styles.card}>
          <p className={styles.label}>Telemetry Events (Lifetime)</p>
          <p className={styles.value}>
            {formatNumber(apiUsage.lifetime?.telemetry_events_total ?? apiUsage.telemetry_events_total)}
          </p>
          <p className={styles.sub}>client events accepted</p>
        </article>
        <article className={styles.card}>
          <p className={styles.label}>API Requests (Process)</p>
          <p className={styles.value}>{formatNumber(apiUsage.requests_total)}</p>
          <p className={styles.sub}>since current service start</p>
        </article>
      </section>

      {hasWindows && (
        <section className={styles.section}>
          <h2>Activity windows</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thLabel}>Period</th>
                  <th className={styles.thNum}>Requests</th>
                  <th className={styles.thNum}>Errors</th>
                  <th className={styles.thNum}>Events</th>
                </tr>
              </thead>
              <tbody>
                <WindowRow label="Last 24h" window={apiUsage.windows?.last_24h} />
                <WindowRow label="Last 7d" window={apiUsage.windows?.last_7d} />
                <WindowRow label="Last 30d" window={apiUsage.windows?.last_30d} />
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hasFunnel && (
        <section className={styles.section}>
          <h2>Search funnel ({funnelPeriod})</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thLabel}>Step</th>
                  <th className={styles.thNum}>Count</th>
                  <th className={styles.thNum}>vs. Searches</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={styles.tdLabel}>Searches submitted</td>
                  <td className={styles.tdNum}>{formatNumber(funnelSearches)}</td>
                  <td className={styles.tdNum}>—</td>
                </tr>
                <tr>
                  <td className={styles.tdLabel}>Result clicked</td>
                  <td className={styles.tdNum}>{formatNumber(funnelClicks)}</td>
                  <td className={styles.tdNum}>{formatPct(funnelClicks, funnelSearches)}</td>
                </tr>
                <tr>
                  <td className={styles.tdLabel}>Release / version page views</td>
                  <td className={styles.tdNum}>{formatNumber(funnelReleaseViews)}</td>
                  <td className={styles.tdNum}>{formatPct(funnelReleaseViews, funnelSearches)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hasShareData && (
        <section className={styles.section}>
          <h2>Share funnel (last 7 days)</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thLabel}>Channel</th>
                  <th className={styles.thNum}>Shares</th>
                  <th className={styles.thNum}>% of total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(sharesByChannel).sort((a, b) => b[1] - a[1]).map(([channel, count]) => (
                  <tr key={channel}>
                    <td className={styles.tdLabel}>{channel}</td>
                    <td className={styles.tdNum}>{formatNumber(count)}</td>
                    <td className={styles.tdNum}>{formatPct(count, sharesTotal)}</td>
                  </tr>
                ))}
                <tr>
                  <td className={styles.tdLabel}><strong>Total</strong></td>
                  <td className={styles.tdNum}><strong>{formatNumber(sharesTotal)}</strong></td>
                  <td className={styles.tdNum}>
                    {shareToPageview != null ? `${shareToPageview} share/view` : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2>API request categories (lifetime)</h2>
        <dl className={styles.list}>
          {(apiUsage.lifetime ? lifetimeCategoryRows : categoryRows).map(([k, v]) => (
            <div className={styles.row} key={k}>
              <dt>{k}</dt>
              <dd>{formatNumber(v)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section}>
        <h2>Telemetry events (lifetime)</h2>
        <dl className={styles.list}>
          {(apiUsage.lifetime ? lifetimeEventRows : eventRows).map(([k, v]) => (
            <div className={styles.row} key={k}>
              <dt>{k}</dt>
              <dd>{formatNumber(v)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section}>
        <h2>MCP tool calls</h2>
        {mcpUsage ? (
          <dl className={styles.list}>
            {mcpRows.map(([k, v]) => (
              <div className={styles.row} key={k}>
                <dt>{k}</dt>
                <dd>{formatNumber(v)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={styles.warn}>MCP usage endpoint is currently unavailable.</p>
        )}
      </section>

      <p className={styles.note}>
        Data source: Dig API persistent counters + process diagnostics, and MCP process counters.
      </p>
    </div>
  );
}
