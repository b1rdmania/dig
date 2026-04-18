import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { digFetch } from "@/lib/api";
import type { ApiUsageSnapshotInternal } from "@/lib/types";
import styles from "@/app/usage/page.module.css";

export const metadata: Metadata = {
  title: "Internal Usage — dig",
  description: "Internal usage diagnostics for Dig API.",
};
export const dynamic = "force-dynamic";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

export default async function InternalUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = process.env.USAGE_DASHBOARD_TOKEN;
  const params = await searchParams;
  const provided = typeof params.token === "string" ? params.token : "";

  if (token && provided !== token) notFound();

  const apiUsage = await digFetch<ApiUsageSnapshotInternal>("/v1/usage/internal", {
    cache: "no-store",
  });

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Internal</p>
        <h1 className={styles.title}>Usage diagnostics.</h1>
        <p className={styles.lede}>Top API routes and error rates.</p>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <p className={styles.label}>API Errors</p>
          <p className={styles.value}>{formatNumber(apiUsage.errors_total)}</p>
          <p className={styles.sub}>since process start</p>
        </article>
      </section>

      <section className={styles.section}>
        <h2>Top API routes</h2>
        <dl className={styles.list}>
          {apiUsage.routes.map((row) => (
            <div className={styles.row} key={row.route}>
              <dt>{row.route}</dt>
              <dd>
                {formatNumber(row.count)} req · {row.avg_ms}ms avg · {formatNumber(row.errors)} err
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
