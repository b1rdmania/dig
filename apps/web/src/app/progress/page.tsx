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
  schema: `${BLOB}/packages/db/src/schema.ts`,
  migrations: `${REPO}/tree/main/packages/db/migrations`,
  parityAudit: `${BLOB}/scripts/migration-parity-audit.ts`,
  deadEnds: `${BLOB}/scripts/no-dead-ends-check.ts`,
  smoke: `${BLOB}/scripts/regression-smoke.ts`,
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
      <text x="344" y="56" {...small}>~10 GB · house + techno</text>
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

function AskLoopDiagram() {
  const box = { fill: "none", stroke: "#1a1a1a", strokeWidth: 1 } as const;
  const label = { fontSize: 13, fill: "#1a1a1a", fontFamily: "inherit" } as const;
  const small = { fontSize: 11, fill: "#6f6d68", fontFamily: "inherit" } as const;
  const arrow = { stroke: "#1a1a1a", strokeWidth: 1, markerEnd: "url(#b)" } as const;
  return (
    <svg viewBox="0 0 720 120" className={styles.diagram} role="img" aria-label="The ask loop: a question goes to the model, the model calls tools against the catalog, and the answer carries links and videos">
      <defs>
        <marker id="b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="#1a1a1a" strokeWidth="1.5" />
        </marker>
      </defs>
      <rect x="8" y="36" width="110" height="44" {...box} />
      <text x="20" y="56" {...label}>Question</text>
      <text x="20" y="72" {...small}>the counter</text>
      <line x1="118" y1="58" x2="150" y2="58" {...arrow} />
      <rect x="152" y="36" width="110" height="44" {...box} />
      <text x="164" y="56" {...label}>Model</text>
      <text x="164" y="72" {...small}>Kimi · rules</text>
      <line x1="262" y1="48" x2="294" y2="48" {...arrow} />
      <line x1="294" y1="68" x2="262" y2="68" {...arrow} />
      <rect x="296" y="36" width="110" height="44" {...box} />
      <text x="308" y="56" {...label}>Tools</text>
      <text x="308" y="72" {...small}>search · credits</text>
      <line x1="406" y1="58" x2="438" y2="58" {...arrow} />
      <rect x="440" y="36" width="110" height="44" {...box} />
      <text x="452" y="56" {...label}>Catalog</text>
      <text x="452" y="72" {...small}>Postgres</text>
      <line x1="207" y1="80" x2="207" y2="104" {...arrow} />
      <rect x="8" y="36" width="0" height="0" fill="none" />
      <text x="220" y="100" {...small}>answer: every record a tool result, linked, with its video</text>
    </svg>
  );
}

function BatchFlipDiagram() {
  const box = { fill: "none", stroke: "#1a1a1a", strokeWidth: 1 } as const;
  const faded = { fill: "none", stroke: "#97938a", strokeWidth: 1, strokeDasharray: "3 3" } as const;
  const label = { fontSize: 13, fill: "#1a1a1a", fontFamily: "inherit" } as const;
  const small = { fontSize: 11, fill: "#6f6d68", fontFamily: "inherit" } as const;
  const arrow = { stroke: "#1a1a1a", strokeWidth: 1, markerEnd: "url(#c)" } as const;
  return (
    <svg viewBox="0 0 720 130" className={styles.diagram} role="img" aria-label="A rebuild writes a fresh batch next to the live one, the checks run, and the product flips only when they pass">
      <defs>
        <marker id="c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="#1a1a1a" strokeWidth="1.5" />
        </marker>
      </defs>
      <rect x="8" y="20" width="110" height="44" {...box} />
      <text x="20" y="40" {...label}>New dump</text>
      <text x="20" y="56" {...small}>monthly</text>
      <line x1="118" y1="42" x2="150" y2="42" {...arrow} />
      <rect x="152" y="20" width="130" height="44" {...box} />
      <text x="164" y="40" {...label}>Batch N+1</text>
      <text x="164" y="56" {...small}>written alongside</text>
      <rect x="152" y="74" width="130" height="36" {...faded} />
      <text x="164" y="96" {...small}>batch N · still live</text>
      <line x1="282" y1="42" x2="314" y2="42" {...arrow} />
      <rect x="316" y="20" width="200" height="44" {...box} />
      <text x="328" y="40" {...label}>Checks</text>
      <text x="328" y="56" {...small}>parity · dead-ends · smoke</text>
      <line x1="516" y1="42" x2="548" y2="42" {...arrow} />
      <rect x="550" y="20" width="110" height="44" {...box} />
      <text x="562" y="40" {...label}>Flip</text>
      <text x="562" y="56" {...small}>only on pass</text>
    </svg>
  );
}

export default function ProgressPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>How we built it.</h1>

      <p className={styles.lede}>
        In March I rebuilt Discogs: the full catalog, a fast API, videos on
        every page and a trial MCP server.
      </p>

      <p className={styles.lede}>
        It worked. It also cost about $2,000 in database bills. The full
        catalog is roughly 300 GB of Postgres, so I parked it and rebuilt
        around one idea: <strong>the database is a build artifact.</strong>
      </p>

      <p className={styles.pullquote}>
        Rebuilding it was a cunt of a job. About two weeks locally, parsing and
        cleaning roughly 200 million lines of data before shipping the result
        to Fly.
      </p>

      <PipelineDiagram />

      <section className={styles.section}>
        <h2 className={styles.heading}>The pipeline</h2>
        <p>
          Discogs publishes its catalog monthly as CC0 XML.
        </p>
        <p>
          A local machine ingests the full dump, then cuts it down by style,
          era and label. Production gets the result: about 10 GB of house and
          techno from 1985 to 2008.
        </p>
        <p>
          No permanent big-data infrastructure. Change the scope, rebuild the
          artifact.
        </p>
        <Sources items={[
          { label: "apps/ingest", href: SRC.ingest },
          { label: "build-scoped-db.ts", href: SRC.buildScoped },
          { label: "scope manifests", href: SRC.manifests },
        ]} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>The catalog</h2>
        <p>
          Artists, labels and masters, searchable with Postgres full-text and
          fuzzy matching.
        </p>
        <p>
          Underneath is the useful bit: the credit and remix graph, so the
          system knows who remixed, engineered and repeatedly worked with whom.
        </p>
        <p>
          Then there&apos;s the editorial layer: fifteen curated scenes,
          essential records for each label and directional relationships
          between labels.
        </p>
        <p>Deeper, harder, rawer, weirder.</p>
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
          The model gets tools over the same catalog as the site.
        </p>
        <p>
          Every record it names must come from a tool call in that turn and
          link back to its page. Videos only render for records actually cited.
        </p>
        <p>
          <strong>No tool result, no claim.</strong>
        </p>
        <p>
          It currently runs on Kimi through OpenRouter, but the model is
          swappable. A session can also become one YouTube playlist plus
          Discogs marketplace links.
        </p>
        <AskLoopDiagram />
        <img src="/build/chat-bag.png" alt="A chat session bagged up: the video rail, one play-the-lot YouTube link, and each record with listen, buy, and dig links" className={styles.shot} />
        <Sources items={[
          { label: "ask/", href: SRC.ask },
          { label: "loop.ts", href: SRC.loop },
          { label: "binding.ts", href: SRC.binding },
        ]} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>The MCP server</h2>
        <p>
          The same catalog is available to any AI client that speaks MCP.
        </p>
        <p>
          Claude can search records, follow the credit graph, pull label
          essentials and build playlists directly from the catalog.
        </p>
        <img src="/build/claude-mcp.png" alt="Claude using the dig connector: loading the tools, finding the Italo House style tag, and pulling recommendations" className={styles.shot} />
        <Sources items={[
          { label: "server.ts", href: SRC.mcp },
          { label: "instructions.ts", href: SRC.instructions },
        ]} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>The database</h2>
        <p>
          New monthly dumps are written as a fresh batch alongside the live
          one.
        </p>
        <p>
          Before anything flips over, automated checks test schema parity,
          broken links, API regressions and search quality. If the new build
          fails, the old one stays live.
        </p>
        <BatchFlipDiagram />
        <Sources items={[
          { label: "schema.ts", href: SRC.schema },
          { label: "migrations", href: SRC.migrations },
          { label: "migration parity", href: SRC.parityAudit },
          { label: "dead-end check", href: SRC.deadEnds },
          { label: "smoke tests", href: SRC.smoke },
        ]} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>What it runs on</h2>
        <p>
          Four small Fly.io machines: web, API, MCP and Postgres, plus Redis
          for caching.
        </p>
        <p>The LLM costs pennies per conversation.</p>
        <p>
          The point is that a catalog of roughly 80,000 records with an AI
          layer on top can run for about the price of two coffees a month.
        </p>
        <Sources items={[{ label: "GitHub", href: REPO }]} />
      </section>
    </div>
  );
}
