import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Build Progress — Dig",
  description:
    "Implementation progress tracker for Dig: ingest, transforms, gates, and roadmap status.",
};

export default function ProgressPage() {
  return (
    <div className={styles.page}>
      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Build Tracking</div>
        <h1 className={styles.title}>
          Database build, <em>not vibes.</em>
        </h1>
        <p className={styles.lede}>
          Execution tracker for the Dig implementation plan. This page is a
          manual progress snapshot for ingest, transforms, gates, and the next
          actions needed to move from data loading to retrieval/API work.
        </p>
        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <div className={styles.metaKey}>Current focus</div>
            <div className={styles.metaVal}>
              Phase 5 — Enrichment pipeline live. MusicBrainz crosswalks (1.2M
              artists, 1.8M releases), relationship edges (423K), label linkouts
              (53K Bandcamp/Instagram), setlist.fm timeline.
            </div>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaKey}>Latest milestone commit</div>
            <div className={styles.metaVal}>
              <code>8f986f5</code>
            </div>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaKey}>Tests</div>
            <div className={styles.metaVal}>
              65 unit + 47 MCP smoke (18 contract, 47 remote)
            </div>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaKey}>Live surfaces</div>
            <div className={styles.metaVal}>
              <a href="https://app.dig.baby">app.dig.baby</a> (search UI) +
              dig-api.fly.dev (REST) + dig-mcp.fly.dev (MCP SSE)
            </div>
          </div>
        </div>
      </section>

      {/* Roadmap pills */}
      <div className={styles.roadmapPills}>
        {roadmapPhases.map((p) => (
          <div key={p.label} className={styles.pill}>
            <span
              className={`${styles.dot} ${p.status === "done" ? styles.dotDone : p.status === "warn" ? styles.dotWarn : styles.dotInfo}`}
            />
            <span className={styles.pillLabel}>{p.label}</span>
            <span className={styles.pillState}>{p.state}</span>
          </div>
        ))}
      </div>

      {/* Live Build Snapshot */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Live Build Snapshot</h2>
          <div className={styles.sectionSub}>Manual update from overnight runs</div>
        </div>
        <div className={styles.statsGrid}>
          {buildStats.map((s) => (
            <div key={s.key} className={styles.stat}>
              <div className={styles.statKey}>{s.key}</div>
              <div className={styles.statVal}>{s.val}</div>
              <div className={styles.statNote}>{s.note}</div>
            </div>
          ))}
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Process</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Rate / note</th>
            </tr>
          </thead>
          <tbody>
            {buildProcesses.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>
                  <span className={styles.badge}>{p.status}</span>
                </td>
                <td>{p.progress}</td>
                <td>{p.rate}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.notes}>
          Full-corpus restore complete. Run 8 benchmark passed (7/7 warm SLOs).
          Phase 5 Week 1 shipped: search IA upgrade, track-level credits,
          product telemetry, alpha ops pack. Cover Art Archive integrated: 1.77M
          crosswalks, Redis cache. Frontend on Fly.io (always-on).
        </div>
      </section>

      {/* Search Benchmark */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Search Benchmark</h2>
          <div className={styles.sectionSub}>
            Run 9 — Full corpus (18.9M releases), Fly.io production — 46
            queries × 2 runs, 0 errors
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Category</th>
              <th>p50</th>
              <th>p95</th>
              <th>Warm SLO</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {benchmarkRows.map((r) => (
              <tr key={r.category}>
                <td>{r.category}</td>
                <td>{r.p50}</td>
                <td>{r.p95}</td>
                <td>{r.slo}</td>
                <td>
                  <span
                    className={`${styles.badge} ${r.pass ? styles.badgePass : styles.badgeWarn}`}
                  >
                    {r.label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.scorecard}>
          <div className={styles.scorecardItem}>
            <div className={`${styles.scorecardVal} ${styles.scorecardValGood}`}>
              122ms
            </div>
            <div className={styles.scorecardKey}>Overall p50</div>
          </div>
          <div className={styles.scorecardItem}>
            <div className={styles.scorecardVal}>412ms</div>
            <div className={styles.scorecardKey}>Overall p95</div>
          </div>
          <div className={styles.scorecardItem}>
            <div className={`${styles.scorecardVal} ${styles.scorecardValGood}`}>
              7 / 7
            </div>
            <div className={styles.scorecardKey}>SLOs pass</div>
          </div>
        </div>
        <div className={styles.notes}>
          <strong>Run 9 (live, 2026-03-05):</strong> 46 queries × 2 runs against
          full 18.9M-release corpus on Fly.io. 0 errors. All 7 SLO categories
          pass. Fuzzy search (pg_trgm) is the slowest category at p50 266ms —
          expected under contention.
        </div>
      </section>

      {/* Dig vs Discogs */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Dig vs Discogs API</h2>
          <div className={styles.sectionSub}>
            Run 9 (live, 2026-03-05) — Sequential, throttled to Discogs 60 req/min limit
          </div>
        </div>
        <div className={styles.chartLegend}>
          <span>
            <span
              className={styles.legendSwatch}
              style={{ background: "var(--link)" }}
            />{" "}
            Dig (Fly.io)
          </span>
          <span>
            <span
              className={styles.legendSwatch}
              style={{ background: "var(--fg-faint)" }}
            />{" "}
            Discogs API
          </span>
        </div>
        {comparisonRows.map((r) => (
          <div key={r.label} className={styles.chartRow}>
            <div className={styles.chartLabel}>{r.label}</div>
            <div className={styles.chartBars}>
              <div className={styles.chartBarWrap}>
                <span className={styles.chartBarTag}>Dig</span>
                <div
                  className={`${styles.chartBar} ${styles.chartBarDig}`}
                  style={{ width: `${(r.dig / 350) * 100}%` }}
                />
                <span className={styles.chartBarMs}>{r.dig}ms</span>
              </div>
              <div className={styles.chartBarWrap}>
                <span className={styles.chartBarTag}>Discogs</span>
                <div
                  className={`${styles.chartBar} ${styles.chartBarDiscogs}`}
                  style={{ width: `${(r.discogs / 350) * 100}%` }}
                />
                <span className={styles.chartBarMs}>{r.discogs}ms</span>
              </div>
            </div>
            <div
              className={`${styles.chartWinner} ${r.digWins ? styles.chartWinnerGood : ""}`}
            >
              {r.winner}
            </div>
          </div>
        ))}
        <div className={styles.scorecard}>
          <div className={styles.scorecardItem}>
            <div className={`${styles.scorecardVal} ${styles.scorecardValGood}`}>
              122ms
            </div>
            <div className={styles.scorecardKey}>Dig p50</div>
          </div>
          <div className={styles.scorecardItem}>
            <div className={styles.scorecardVal}>213ms</div>
            <div className={styles.scorecardKey}>Discogs p50</div>
          </div>
          <div className={styles.scorecardItem}>
            <div className={`${styles.scorecardVal} ${styles.scorecardValGood}`}>
              6 / 7
            </div>
            <div className={styles.scorecardKey}>Categories Dig wins</div>
          </div>
        </div>
        <div className={styles.notes}>
          Queries run sequentially, paced at 1.1s between requests to stay within Discogs&apos;s 60 req/min authenticated limit.
          Dig was idle during each throttle window — latency figures reflect single-connection p50, not burst capacity.
          Under real concurrent load (see stress test below), Dig handles 56 req/s at c100 with 0 errors.
          Discogs would rate-limit immediately at that volume.
        </div>
      </section>

      {/* Enrichment Pipeline */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Enrichment Pipeline</h2>
          <div className={styles.sectionSub}>EN-A through EN-E — complete</div>
        </div>
        <div className={styles.roadmap}>
          <ul className={styles.phaseList}>
            <li>
              <span className={`${styles.tick} ${styles.tickDone}`}>✓</span>
              <span>
                <strong>EN-A — Schema:</strong> <code>enrich.*</code> schema (8
                tables) applied local + Fly. Crosswalks, edges, context,
                linkouts, events.
              </span>
            </li>
            <li>
              <span className={`${styles.tick} ${styles.tickDone}`}>✓</span>
              <span>
                <strong>EN-B — API:</strong> Enrichment endpoints live —
                relationships, context, timeline, linkouts. Query params:{" "}
                <code>include_enrichment</code>, <code>min_confidence</code>,{" "}
                <code>sources</code>.
              </span>
            </li>
            <li>
              <span className={`${styles.tick} ${styles.tickDone}`}>✓</span>
              <span>
                <strong>EN-C — MusicBrainz:</strong> 1.77M release crosswalks,
                1.21M artist crosswalks (200K with Wikidata QIDs), 423K
                relationship edges (23 edge types).
              </span>
            </li>
            <li>
              <span className={`${styles.tick} ${styles.tickDone}`}>✓</span>
              <span>
                <strong>EN-D — Setlist.fm:</strong> Timeline pipeline live. 1,778
                events across 208 artists. API endpoint + frontend display.
              </span>
            </li>
            <li>
              <span className={`${styles.tick} ${styles.tickDone}`}>✓</span>
              <span>
                <strong>EN-E — Label linkouts:</strong> 53,233 label linkouts
                (34K Bandcamp, 19K Instagram). Verification queue with URL health
                checks. 6,808 verified.
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/* Frontend + UX Polish */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Frontend + UX Polish</h2>
          <div className={styles.sectionSub}>shipped</div>
        </div>
        <div className={styles.roadmap}>
          <ul className={styles.phaseList}>
            {uxItems.map((item) => (
              <li key={item.text.slice(0, 30)}>
                <span
                  className={`${styles.tick} ${item.done ? styles.tickDone : styles.tickProgress}`}
                >
                  {item.done ? "✓" : "◐"}
                </span>
                <span dangerouslySetInnerHTML={{ __html: item.text }} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Roadmap & Checklist */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Roadmap &amp; Checklist</h2>
          <div className={styles.sectionSub}>
            Implementation plan execution tracker
          </div>
        </div>
        <div className={styles.roadmap}>
          {fullRoadmap.map((phase) => (
            <div key={phase.name} className={styles.phase}>
              <div className={styles.phaseTop}>
                <div>
                  <div className={styles.phaseName}>{phase.name}</div>
                  <div className={styles.phaseMeta}>{phase.meta}</div>
                </div>
                <span className={styles.badge}>{phase.status}</span>
              </div>
              <ul className={styles.phaseList}>
                {phase.items.map((item, i) => (
                  <li key={i}>
                    <span
                      className={`${styles.tick} ${item.state === "done" ? styles.tickDone : item.state === "progress" ? styles.tickProgress : ""}`}
                    >
                      {item.state === "done"
                        ? "✓"
                        : item.state === "progress"
                          ? "◐"
                          : "·"}
                    </span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className={styles.notes}>
          <strong>Data layer:</strong> 18.9M releases + 2.5M masters + 2.3M
          labels + 289K artists (full re-ingest in progress). Discogs CC0
          February 2026 dump on Fly.io. Disk: 158GB / 300GB.
          <br />
          <strong>Enrichment:</strong> 1.77M release crosswalks + 1.21M artist
          crosswalks + 423K relationship edges + 53K label linkouts + 1.8K
          setlist events.
          <br />
          <strong>Search:</strong> Postgres FTS with exact/prefix name boosting,
          pg_trgm fuzzy, FK-based dedup, per-type result caps. Run 9: 7/7 warm
          SLOs pass.
          <br />
          <strong>Live:</strong>{" "}
          <a href="https://app.dig.baby">app.dig.baby</a> (search UI) +
          dig-api.fly.dev (REST) + dig-mcp.fly.dev (MCP SSE). Cover art via CAA
          (1.77M releases). Enrichment API live.
        </div>
      </section>

      {/* Concurrent Stress Test */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Concurrent Stress Test</h2>
          <div className={styles.sectionSub}>
            2026-03-05 — Live API (Fly.io, shared-cpu-1x), mixed query workload
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Test</th>
              <th>Concurrency</th>
              <th>Requests</th>
              <th>p50</th>
              <th>p95</th>
              <th>p99</th>
              <th>Success</th>
              <th>Throughput</th>
            </tr>
          </thead>
          <tbody>
            {stressRows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{r.concurrency}</td>
                <td>{r.total}</td>
                <td>{r.p50}</td>
                <td>{r.p95}</td>
                <td>{r.p99}</td>
                <td>
                  <span className={`${styles.badge} ${r.ok ? styles.badgePass : styles.badgeWarn}`}>
                    {r.success}
                  </span>
                </td>
                <td>{r.throughput}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.notes}>
          Mixed workload: search (FTS, fuzzy, filtered, cross-entity), entity retrieval, and traversal queries in random rotation.
          Zero application errors at both pressure levels. Rate limiting (429) is expected at c100 — triggered correctly after ~300 keyed req/min.
          Fuzzy search (pg_trgm) dominates the tail latency; retrieval and traversal stay under 250ms p50 at full concurrency.
        </div>
      </section>
    </div>
  );
}

/* ── Static data ── */

const roadmapPhases = [
  { label: "Phase 0A — System foundations", status: "done", state: "done" },
  { label: "Phase 0B — Profiling + normalization", status: "done", state: "done" },
  { label: "Gate A — Passed", status: "done", state: "closed" },
  { label: "Phase 1 — Ingest + canonical transforms", status: "done", state: "done" },
  { label: "Gate B — Closed with caveats", status: "done", state: "closed" },
  { label: "Phase 2 — Retrieval core", status: "done", state: "done" },
  { label: "Gate C — Passed", status: "done", state: "closed" },
  { label: "Phase 3 — REST + MCP alpha", status: "done", state: "done" },
  { label: "Gate D — GO (staging)", status: "done", state: "closed" },
  { label: "Phase 4 — Data + search UI", status: "done", state: "done" },
  { label: "Gate E — GO (soft alpha)", status: "done", state: "closed" },
  { label: "Phase 5 — Alpha hardening", status: "done", state: "week 1 done" },
  { label: "EN-A — Enrichment schema", status: "done", state: "done" },
  { label: "EN-B — Enrichment API", status: "done", state: "done" },
  { label: "EN-C — MusicBrainz import", status: "done", state: "done" },
  { label: "EN-D — Setlist.fm timeline", status: "done", state: "done" },
  { label: "EN-E — Label linkouts", status: "done", state: "done" },
  { label: "Full artist catalog re-ingest", status: "warn", state: "in progress" },
];

const buildStats = [
  { key: "Raw entities", val: "24,025,633", note: "All 4 entity types ingested" },
  { key: "raw_entities size", val: "81 GB", note: "Main disk pressure driver" },
  { key: "DB size (post-transform)", val: "192 GB", note: "After full releases transform + FTS" },
  { key: "Search benchmark", val: "0 errors / 96", note: "Run 8: p50 108ms, 7/7 warm SLOs pass" },
];

const buildProcesses = [
  { name: "Full restore to Fly", status: "done", progress: "~555M rows across 12 tables", rate: "pg_restore -j4, ~14h" },
  { name: "Releases ingest", status: "done", progress: "18,876,362 releases loaded", rate: "~3,958/s" },
  { name: "Artists transform", status: "done", progress: "Complete", rate: "48s" },
  { name: "Labels transform", status: "done", progress: "Complete", rate: "626s (~10 min)" },
  { name: "Masters transform", status: "done", progress: "Complete", rate: "1,822s (~30 min)" },
  { name: "Releases transform", status: "done", progress: "18,876,362 transformed", rate: "Cursor-pagination validated" },
  { name: "Gate B checklist", status: "closed w/ caveats", progress: "6/6 checked", rate: "Partial artists dump caveat" },
];

const benchmarkRows = [
  { category: "Release FTS", p50: "111ms", p95: "181ms", slo: "p95 < 500ms", pass: true, label: "pass" },
  { category: "Common-term", p50: "104ms", p95: "208ms", slo: "p99 < 1,000ms", pass: true, label: "pass" },
  { category: "Fuzzy", p50: "266ms", p95: "412ms", slo: "p95 < 500ms", pass: true, label: "pass" },
  { category: "Filtered", p50: "99ms", p95: "337ms", slo: "p95 < 500ms", pass: true, label: "pass" },
  { category: "Multi-entity", p50: "124ms", p95: "210ms", slo: "p95 < 500ms", pass: true, label: "pass" },
  { category: "Unicode", p50: "103ms", p95: "129ms", slo: "p95 < 200ms", pass: true, label: "pass" },
  { category: "Retrieval", p50: "131ms", p95: "194ms", slo: "p95 < 200ms", pass: true, label: "pass" },
];

const comparisonRows = [
  { label: "Release FTS", dig: 111, discogs: 184, winner: "Dig 1.7x", digWins: true },
  { label: "Common-term", dig: 104, discogs: 257, winner: "Dig 2.5x", digWins: true },
  { label: "Fuzzy", dig: 266, discogs: 213, winner: "Even", digWins: false },
  { label: "Filtered", dig: 99, discogs: 203, winner: "Dig 2.0x", digWins: true },
  { label: "Multi-entity", dig: 124, discogs: 186, winner: "Dig 1.5x", digWins: true },
  { label: "Unicode", dig: 103, discogs: 186, winner: "Dig 1.8x", digWins: true },
  { label: "Retrieval", dig: 131, discogs: 193, winner: "Dig 1.5x", digWins: true },
];

const stressRows = [
  { label: "Warm-up run", concurrency: 50, total: 200, p50: "255ms", p95: "3,145ms", p99: "3,415ms", success: "200/200 (100%)", throughput: "20.7 req/s", ok: true },
  { label: "Full pressure", concurrency: 100, total: 300, p50: "426ms", p95: "1,986ms", p99: "2,091ms", success: "295/300 (98.3%)", throughput: "56.4 req/s", ok: true },
];

const uxItems = [
  { done: true, text: "<strong>Discogs profile parsing:</strong> [aXXX]/[lXXX] refs rendered as clickable links." },
  { done: true, text: "<strong>Label linkout display:</strong> Bandcamp + Instagram pills with brand SVG icons." },
  { done: true, text: "<strong>Related artists:</strong> MusicBrainz relationship edges with human-readable labels." },
  { done: true, text: "<strong>External URLs:</strong> Domain name display instead of raw URLs." },
  { done: true, text: "<strong>Nav cleanup:</strong> Simplified navigation, reliable back link, clean search on sub-pages." },
  { done: true, text: "<strong>Media embeds:</strong> YouTube/video embeds on release pages from Discogs video data." },
  { done: true, text: "<strong>OG share cards:</strong> Dynamic Open Graph + Twitter Card metadata on all entity pages." },
  { done: false, text: "<strong>Artist catalog gap:</strong> Full artist re-ingest in progress (~9.8M from Discogs dump)." },
];

const fullRoadmap: Array<{
  name: string;
  meta: string;
  status: string;
  items: Array<{ state: "done" | "progress" | "todo"; text: string }>;
}> = [
  {
    name: "Phase 0A / 0B + Gate A",
    meta: "Foundations, profiling, normalization",
    status: "passed",
    items: [
      { state: "done", text: "System scaffold (monorepo, Fastify, Kysely, migrations, local Postgres/Redis, CI)" },
      { state: "done", text: "Full profiling for artists/labels/masters + 500k release sample" },
      { state: "done", text: "Normalization Dictionary v1 + Preserve/Normalize matrix + QA Gate Spec" },
      { state: "done", text: "Parser fixtures/tests and LEGAL draft completed; Gate A closed" },
    ],
  },
  {
    name: "Phase 1 + Gate B",
    meta: "Raw ingest, canonical transforms, QA, idempotency",
    status: "closed w/ caveats",
    items: [
      { state: "done", text: "Ingest infra tables + catalog schema + indexes + FTS columns" },
      { state: "done", text: "Full-tree parser and ingest pipeline hardening; 52 tests passing" },
      { state: "done", text: "Raw ingest complete for all 4 entity types" },
      { state: "done", text: "Canonical upserts complete for releases, including child fanout tables" },
      { state: "done", text: "QA/reconciliation report completed and thresholds recalibrated" },
      { state: "done", text: "Idempotency and restart behavior validated with cursor-based rerun" },
      { state: "done", text: "FTS vectors populated (all 18,876,362 releases)" },
      { state: "done", text: "Gate B closed with caveats documented" },
    ],
  },
  {
    name: "Phase 2",
    meta: "Retrieval core (search + entity retrieval + traversal)",
    status: "done",
    items: [
      { state: "done", text: "Query envelope + response contracts locked" },
      { state: "done", text: "Multi-entity FTS search with filters + fuzzy fallback" },
      { state: "done", text: "Entity retrieval services: artist, label, master, release" },
      { state: "done", text: "Traversal services: 5 link types" },
      { state: "done", text: "Benchmark runner: 32-query suite, 8 categories" },
      { state: "done", text: "Statement timeout enforcement + broad query detection" },
      { state: "done", text: "Two-path release search rewrite + stop-word fix" },
      { state: "done", text: "Discogs API comparison: Dig faster in 7/7 categories" },
      { state: "done", text: "Run 5-6: 0 errors / 96 queries, warm SLOs improving" },
    ],
  },
  {
    name: "Phase 3",
    meta: "REST API + MCP public alpha",
    status: "done",
    items: [
      { state: "done", text: "REST API: two-tier rate limiting, CORS, structured logging" },
      { state: "done", text: "MCP server: 6 tools, SSE transport, 47 smoke tests passing" },
      { state: "done", text: "Deployed to Fly.io: dig-api + dig-mcp + Fly Postgres + Upstash Redis" },
      { state: "done", text: "Run 7: 32 queries, 0 errors, p50 117ms" },
      { state: "done", text: "Gate D: GO (staging alpha)" },
      { state: "done", text: "Docs: quickstart, ops runbook, alpha invite, Phase 4 prerequisites" },
    ],
  },
  {
    name: "Phase 4",
    meta: "Full data load + human search UI + Gate E",
    status: "done",
    items: [
      { state: "done", text: "Full releases dataset migration (~555M rows, 12 tables)" },
      { state: "done", text: "Run 8: 0/96 errors, p50 108ms, 7/7 warm SLOs pass" },
      { state: "done", text: "Next.js frontend: search + entity pages, CSS Modules, server-side API" },
      { state: "done", text: "Deployed to Fly.io (always-on), migrated from Vercel" },
      { state: "done", text: "Master-first search IA, entity pages, URL restructure" },
      { state: "done", text: "Cover Art Archive: 1.77M crosswalks, cover proxy + Redis cache" },
      { state: "done", text: "Gate E: GO for soft alpha (5-10 testers)" },
    ],
  },
  {
    name: "Phase 5 — Week 1",
    meta: "Alpha hardening, UX depth, instrumentation",
    status: "in progress",
    items: [
      { state: "done", text: "Day 1 — SLO Baseline: Froze alpha SLO table, load tested c100" },
      { state: "done", text: "Day 2 — Filtered Query Hardening: Zero 5xx under c100" },
      { state: "done", text: "Day 3 — Track-Level Credits UX: Per-track credits grouped by role" },
      { state: "done", text: "Day 4 — Search IA Upgrade: Exact/prefix boost, FK dedup, per-type cap" },
      { state: "done", text: "Day 5 — Product Instrumentation: 5 event types, structured JSON to Fly logs" },
      { state: "done", text: "Day 6 — Alpha Ops Pack: Events rate limiting, issue templates, runbook" },
      { state: "done", text: "Day 7 — UX Polish: Version format/country tags, collapsible aliases" },
      { state: "progress", text: "Soft Alpha: Invites ready, 5 keys issued, monitoring pending" },
      { state: "todo", text: "User auth + collections remain post-alpha scope" },
    ],
  },
];
