import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "MCP — archived — dig",
  description:
    "The Dig MCP server is archived. Use the in-app chat or the REST API. Source remains open on GitHub for self-hosters.",
};

export default function McpPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>MCP · Archived</p>
        <h1 className={styles.title}>
          The MCP server<br />
          <em>is archived.</em>
        </h1>
        <p className={styles.lede}>
          Dig&rsquo;s public MCP endpoint at <code>dig-mcp.fly.dev</code> is offline.
          The hosted instance saw negligible traffic; the chat at{" "}
          <Link href="/llm-beta">/llm-beta</Link> now talks to the catalog directly
          via internal routing, so the MCP layer was redundant for the only consumer
          we had.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Where to go instead</h2>
        <div className={styles.list}>
          <div className={styles.item}>
            <strong>Want to chat with the catalog?</strong>
            <span>
              Use <Link href="/llm-beta">the in-app chat</Link>. It runs Claude
              against the same six tools the MCP exposed (plus three new v2 tools
              for scenes and label essentials), with citation-bound video
              rendering. Bring your own Anthropic key.
            </span>
          </div>
          <div className={styles.item}>
            <strong>Want to query the catalog programmatically?</strong>
            <span>
              The REST API at{" "}
              <a href="https://dig-api.fly.dev/v1/health" target="_blank" rel="noreferrer">
                dig-api.fly.dev
              </a>{" "}
              is the canonical surface — search, entities, traversals, scenes,
              label essentials. See{" "}
              <a
                href="https://github.com/b1rdmania/dig/blob/main/docs/quickstart.md"
                target="_blank"
                rel="noreferrer"
              >
                docs/quickstart.md
              </a>{" "}
              for endpoints and example requests.
            </span>
          </div>
          <div className={styles.item}>
            <strong>Want to run an MCP yourself?</strong>
            <span>
              The MCP server source lives in{" "}
              <a
                href="https://github.com/b1rdmania/dig/tree/main/apps/mcp"
                target="_blank"
                rel="noreferrer"
              >
                apps/mcp
              </a>{" "}
              of the repo. It&rsquo;s a Fastify + MCP SDK SSE server that wraps the
              same domain layer the REST API uses. Clone, point it at the public
              API, and run wherever you like.
            </span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Why we retired it</h2>
        <p className={styles.copy}>
          The MCP was built before the in-product chat existed and aimed at
          external agents (Claude Desktop, IDE plugins). With the chat now
          serving the same retrieval needs through internal routing, the public
          MCP became dead infrastructure with no consumers. Rather than leave it
          running at low utilisation, we&rsquo;ve archived it. The Fly app remains
          parked (zero machines, zero cost) so the name doesn&rsquo;t get squatted;
          the source remains in the repo for anyone who wants to revive or
          self-host it.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Links</h2>
        <div className={styles.links}>
          <Link href="/llm-beta" className={styles.link}>In-app chat</Link>
          <Link href="/about" className={styles.link}>About</Link>
          <Link href="/progress" className={styles.link}>Progress</Link>
          <a href="https://github.com/b1rdmania/dig" target="_blank" rel="noreferrer" className={styles.link}>GitHub</a>
        </div>
      </section>
    </div>
  );
}
