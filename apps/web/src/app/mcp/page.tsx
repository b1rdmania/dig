import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "MCP Setup — dig",
  description: "Connect Dig MCP in under a minute. Endpoint, tools, limits, and error behavior.",
};

export default function McpPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>MCP Setup</p>
        <h1 className={styles.title}>
          Plug in Dig.<br />
          <em>Start querying music data.</em>
        </h1>
        <p className={styles.lede}>
          Dig MCP is open beta and anonymous by default. Connect once, then use tools for search, entity detail, and
          graph traversal.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Endpoint</h2>
        <p className={styles.copy}>Use this SSE endpoint in MCP clients:</p>
        <pre className={styles.code}>https://dig-mcp.fly.dev/sse</pre>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Quickstart</h2>
        <p className={styles.copy}>Claude Code:</p>
        <pre className={styles.code}>
{`claude mcp add --transport sse --scope user dig-catalog "https://dig-mcp.fly.dev/sse"`}
        </pre>
        <p className={styles.copy}>Claude Desktop (`claude_desktop_config.json`):</p>
        <pre className={styles.code}>
{`{
  "mcpServers": {
    "dig-catalog": {
      "url": "https://dig-mcp.fly.dev/sse"
    }
  }
}`}
        </pre>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Tools</h2>
        <div className={styles.list}>
          <div className={styles.item}><strong>search_catalog</strong><span>FTS + filters</span></div>
          <div className={styles.item}><strong>get_artist</strong><span>Artist detail + provenance</span></div>
          <div className={styles.item}><strong>get_label</strong><span>Label detail + provenance</span></div>
          <div className={styles.item}><strong>get_master</strong><span>Canonical release detail</span></div>
          <div className={styles.item}><strong>get_release</strong><span>Version/pressing detail</span></div>
          <div className={styles.item}><strong>traverse_links</strong><span>Artist/label/master/release graph links</span></div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Beta limits</h2>
        <div className={styles.list}>
          <div className={styles.item}><strong>Anonymous rate</strong><span>20 requests/minute per IP</span></div>
          <div className={styles.item}><strong>Daily cap</strong><span>100 requests/day per IP</span></div>
          <div className={styles.item}><strong>Over limit</strong><span>429 RATE_LIMITED</span></div>
          <div className={styles.item}><strong>Capacity lock</strong><span>503 BETA_CAPACITY when protection is active</span></div>
        </div>
        <p className={styles.note}>
          Limits may tighten temporarily during heavy load to keep service stable for all users.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Error shape</h2>
        <pre className={styles.code}>
{`{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Per-minute anonymous limit reached",
    "details": { "bucket": "ip_minute" }
  }
}`}
        </pre>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Links</h2>
        <div className={styles.links}>
          <Link href="/usage" className={styles.link}>Usage</Link>
          <Link href="/progress" className={styles.link}>Progress</Link>
          <Link href="/about" className={styles.link}>About</Link>
          <a href="https://github.com/b1rdmania/dig" target="_blank" rel="noreferrer" className={styles.link}>GitHub</a>
        </div>
      </section>
    </div>
  );
}
