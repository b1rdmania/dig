import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "MCP — dig",
  description:
    "Connect Dig’s house and techno catalogue to an MCP-compatible client.",
};

export default function McpPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>MCP · Live</p>
        <h1 className={styles.title}>
          Dig in<br />
          <em>your own client.</em>
        </h1>
        <p className={styles.lede}>
          Dig&rsquo;s public MCP endpoint is live at <code>https://dig-mcp.fly.dev/mcp</code>.
          It exposes the same scoped catalogue, credits, scenes and label relationships
          as the site, and scales to zero when nobody is using it.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Ways in</h2>
        <div className={styles.list}>
          <div className={styles.item}>
            <strong>Want the existing private chat?</strong>
            <span>
              Use <Link href="/llm-beta">the in-app chat</Link>. It runs the same
              grounded Dig ask loop with citation-bound video rendering.
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
            <strong>Want to inspect or self-host it?</strong>
            <span>
              The MCP server source lives in{" "}
              <a
                href="https://github.com/b1rdmania/dig/tree/main/apps/mcp"
                target="_blank"
                rel="noreferrer"
              >
                apps/mcp
              </a>{" "}
              of the repo. It wraps the same domain layer as the REST API and supports
              both Streamable HTTP and the legacy SSE transport.
            </span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>What it is</h2>
        <p className={styles.copy}>
          The connector identifies as <code>dig-catalog</code> and stays focused on
          clean catalogue retrieval. Its instructions describe the collection,
          grounding rules and useful routes through the stock without tying the
          catalogue to one particular client or workflow.
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
