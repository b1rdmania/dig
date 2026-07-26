import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "How we built it — Dig",
  description: "The architecture: a monthly data dump, a scoped database artifact, a fast API, an LLM layer, and an MCP server.",
};

const REPO = "https://github.com/b1rdmania/dig";
const BLOB = `${REPO}/blob/main`;

const SRC = {
  ingest: `${REPO}/tree/main/apps/ingest`,
  buildScoped: `${BLOB}/scripts/build-scoped-db.ts`,
  manifests: `${REPO}/tree/main/packages/db/scope-manifests`,
  scenes: `${BLOB}/packages/db/seeds/scenes_v1.json`,
  search: `${BLOB}/packages/domain/src/search.ts`,
  credits: `${BLOB}/packages/domain/src/credits.ts`,
  essentials: `${BLOB}/packages/domain/src/label-essentials.ts`,
  api: `${REPO}/tree/main/apps/api`,
  ask: `${REPO}/tree/main/apps/api/src/routes/v1/ask`,
  loop: `${BLOB}/apps/api/src/routes/v1/ask/loop.ts`,
  binding: `${BLOB}/apps/api/src/routes/v1/ask/binding.ts`,
  mcp: `${BLOB}/apps/mcp/src/server.ts`,
  instructions: `${BLOB}/apps/mcp/src/instructions.ts`,
};

function Sources({ items }: { items: Array<{ label: string; href: string }> }) {
  return (
    <p className={styles.sources}>
      <span className={styles.sourcesLabel}>Source:</span>
      {items.map((it) => (
        <a key={it.label} href={it.href} target="_blank" rel="noreferrer">{it.label}</a>
      ))}
    </p>
  );
}

function PipelineDiagram() {
  const box = { fill: "none", stroke: "#1a1a1a", strokeWidth: 1 } as const;
  const label = { fontSize: 13, fill: "#1a1a1a", fontFamily: "inherit" } as const;
  const small = { fontSize: 11, fill: "#6f6d68", fontFamily: "inherit" } as const;
  const arrow = { stroke: "#1a1a1a", strokeWidth: 1, markerEnd: "url(#a)" } as const;
  return (
    <svg viewBox="0 0 720 210" className={styles.diagram} role="img" aria-label="Pipeline: Discogs dump, local ingest, scoped artifact, Postgres, API, then web, chat, and MCP">
      <defs>
        <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="#1a1a1a" strokeWidth="1.5" />
        </marker>
      </defs>
      <rect x="8" y="20" width="128" height="44" {...box} />
      <text x="20" y="40" {...label}>Discogs dump</text>
      <text x="20" y="56" {...small}>monthly · CC0 · XML</text>
      <line x1="136" y1="42" x2="168" y2="42" {...arrow} />
      <rect x="170" y="20" width="128" height="44" {...box} />
      <text x="182" y="40" {...label}>Local ingest</text>
      <text x="182" y="56" {...small}>full catalog · offline</text>
      <line x1="298" y1="42" x2="330" y2="42" {...arrow} />
      <rect x="332" y="20" width="128" height="44" {...box} />
      <text x="344" y="40" {...label}>Scoped artifact</text>
      <text x="344" y="56" {...small}>~10 GB · scenes only</text>
      <line x1="460" y1="42" x2="492" y2="42" {...arrow} />
      <rect x="494" y="20" width="100" height="44" {...box} />
      <text x="506" y="40" {...label}>Postgres</text>
      <text x="506" y="56" {...small}>one small box</text>
      <line x1="544" y1="64" x2="544" y2="96" {...arrow} />
      <rect x="494" y="98" width="100" height="40" {...box} />
      <text x="506" y="122" {...label}>API</text>
      <line x1="544" y1="138" x2="544" y2="162" {...arrow} />
      <line x1="544" y1="150" x2="380" y2="150" stroke="#1a1a1a" strokeWidth="1" />
      <line x1="380" y1="150" x2="380" y2="162" {...arrow} />
      <line x1="544" y1="150" x2="668" y2="150" stroke="#1a1a1a" strokeWidth="1" />
      <line x1="668" y1="150" x2="668" y2="162" {...arrow} />
      <rect x="330" y="164" width="100" height="36" {...box} />
      <text x="342" y="186" {...label}>Web</text>
      <rect x="494" y="164" width="100" height="36" {...box} />
      <text x="506" y="186" {...label}>AI chat</text>
      <rect x="618" y="164" width="100" height="36" {...box} />
      <text x="630" y="186" {...label}>MCP</text>
    </svg>
  );
}

export default function ProgressPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>How we built it.</h1>

      <p className={styles.lede}>
        In March I rebuilt Discogs: the full catalog, a fast API, videos wired
        into every page, and a trial MCP server. It worked. It also cost about
        $2,000 in database bills, because the full catalog is 300 GB of
        Postgres that never sleeps. So I parked it, kept the ideas, and rebuilt
        the whole thing around one trick: the database is a build artifact.
      </p>

      <p className={styles.pullquote}>
        ngl rebuilding the database was a cunt of a job. took 2 weeks running
        locally, then we parsed, tidied and moved to a Fly host. i think it was
        200m lines of data.
      </p>

      <PipelineDiagram />

      <section className={styles.section}>
        <h2 className={styles.heading}>The pipeline</h2>
        <p>
          Discogs publishes its whole catalog every month as CC0 XML. Each
          cycle, a local machine ingests the full dump, streams it through SAX
          parsers into a staging Postgres, and then cuts it down with scope
          manifests: style allowlists, era bounds, and a tier-one label list.
          What ships to production is the result, a ~10 GB database of house
          and techno, 1985 to 2008, with everything cross-linked. No always-on
          big-data infrastructure, no $2,000 bills. When the scope changes,
          you rebuild the artifact, not the product.
        </p>
        <Sources items={[
          { label: "apps/ingest", href: SRC.ingest },
          { label: "build-scoped-db.ts", href: SRC.buildScoped },
          { label: "scope-manifests", href: SRC.manifests },
        ]} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>The catalog</h2>
        <p>
          Three public entities: artists, labels, masters. Search is Postgres
          full-text with trigram fuzzing, ranked master-first, with filters
          for style, country, and year. Underneath sits the part most catalogs
          throw away: a full credit and remix graph, so the data knows who
          remixed what, who engineered what, and which names keep appearing on
          the same records. On top sits the editorial layer, which is ours:
          fifteen curated scenes, a core run of essential records per label,
          and directional edges between labels. Deeper, harder, rawer, weirder.
        </p>
        <Sources items={[
          { label: "search.ts", href: SRC.search },
          { label: "credits.ts", href: SRC.credits },
          { label: "label-essentials.ts", href: SRC.essentials },
          { label: "scenes_v1.json", href: SRC.scenes },
        ]} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>The AI chat</h2>
        <p>
          The chat is an agentic loop: the model gets tools over the same
          domain layer as the site, and hard rules. Every record it names must
          come from a tool call in that turn, every one must link to its page,
          and videos render only for records actually cited in the answer. No
          tool result, no claim. The model is Moonshot&apos;s Kimi, routed
          through OpenRouter; swap one environment variable and it runs on
          Anthropic instead. Progress streams to the page while it digs, and a
          session can be bagged up into one YouTube playlist plus a Discogs
          marketplace link per record.
        </p>
        <Sources items={[
          { label: "ask/", href: SRC.ask },
          { label: "loop.ts", href: SRC.loop },
          { label: "binding.ts", href: SRC.binding },
        ]} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>The MCP server</h2>
        <p>
          The same catalog, served to any AI client that speaks the Model
          Context Protocol. Add one URL in Claude&apos;s settings and Claude
          can search the catalog, walk the credit graph, pull label essentials,
          and build session playlists, with no code and no API key. The server
          ships its own instructions at connect time, so a client knows how to
          talk about the records and where the catalog&apos;s edges are.
        </p>
        <Sources items={[
          { label: "server.ts", href: SRC.mcp },
          { label: "instructions.ts", href: SRC.instructions },
        ]} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>What it runs on</h2>
        <p>
          Four small machines on Fly.io: the web app, the API, the MCP server,
          and one Postgres box holding the artifact. Redis for caching. The
          LLM spend is pennies per conversation. The point of the whole
          architecture is that a catalog of eighty thousand records, with an
          AI layer on top, runs for about the price of two coffees a month.
        </p>
        <Sources items={[{ label: "the repository", href: REPO }]} />
      </section>
    </div>
  );
}
