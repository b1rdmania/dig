import type { Metadata } from "next";
import { digFetch, fetchMcpUsage } from "@/lib/api";
import type { ApiUsageSnapshot } from "@/lib/types";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Usage — dig",
  description: "Live public usage stats for Dig web, API, and MCP beta.",
};
export const dynamic = "force-dynamic";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

function mapRows(map: Record<string, number>) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

export default async function UsagePage() {
  const [apiUsage, mcpUsage] = await Promise.all([
    digFetch<ApiUsageSnapshot>("/v1/usage", { cache: "no-store" }),
    fetchMcpUsage(),
  ]);

  const categoryRows = mapRows(apiUsage.requests_by_category);
  const eventRows = mapRows(apiUsage.telemetry_by_event);
  const mcpRows = mcpUsage ? mapRows(mcpUsage.calls_by_tool) : [];

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Usage</p>
        <h1 className={styles.title}>Dig in the wild.</h1>
        <p className={styles.lede}>
          Public beta usage snapshots. Values are process-window counters (since service start), not billing-grade
          analytics.
        </p>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <p className={styles.label}>API Requests</p>
          <p className={styles.value}>{formatNumber(apiUsage.requests_total)}</p>
          <p className={styles.sub}>since process start</p>
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
          <p className={styles.label}>Telemetry Events</p>
          <p className={styles.value}>{formatNumber(apiUsage.telemetry_events_total)}</p>
          <p className={styles.sub}>client events accepted</p>
        </article>
      </section>

      <section className={styles.section}>
        <h2>API request categories</h2>
        <dl className={styles.list}>
          {categoryRows.map(([k, v]) => (
            <div className={styles.row} key={k}>
              <dt>{k}</dt>
              <dd>{formatNumber(v)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section}>
        <h2>Telemetry events</h2>
        <dl className={styles.list}>
          {eventRows.map(([k, v]) => (
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
        Data source: Dig API + MCP process counters. For official billing/ops numbers, use internal monitoring.
      </p>
    </div>
  );
}
