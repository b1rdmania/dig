import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Dig. Pilot.",
  description: "Two ways to try it.",
  robots: { index: false, follow: false },
};

const ACCESS_KEY = "dig-beta-1504eb2560f5b76b991e472b";

export default function RussPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Dig. Pilot.</h1>
      <p className={styles.lede}>
        80,000 house and techno records, 1985–2008, built on Discogs open data.
        Two ways to try it.
      </p>

      <section className={styles.section}>
        <h2 className={styles.heading}>1 · On the web</h2>
        <p>
          Open <a href="https://app.dig.baby/llm-beta">app.dig.baby/llm-beta</a>.
          Enter this key:
        </p>
        <p className={styles.key}>{ACCESS_KEY}</p>
        <p>
          Ask it for records. Try <em>&ldquo;what did Larry Heard remix between 92
          and 96?&rdquo;</em> Every record it names is real, linked, with the video
          under the answer.
        </p>
        <p>
          Press <strong>Bag it up</strong> when you have a pile. You get one
          YouTube link that plays the lot, and each record&apos;s Discogs
          marketplace link.
        </p>
        <img src="/pilot/chat.png" alt="A bagged session: video rail, play-the-lot link, and each record with listen, buy, and dig links" className={styles.shot} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>2 · In the Claude app</h2>
        <p>
          <strong>Settings → Connectors → Add custom connector.</strong> Paste
          this URL. Leave the rest blank.
        </p>
        <p className={styles.key}>https://dig-mcp.fly.dev/mcp</p>
        <p>
          Turn it on in a chat. Claude can then search the catalog, follow remix
          credits, and bag up a session the same way. Ask it{" "}
          <em>&ldquo;who did Larry Heard actually work with?&rdquo;</em>
        </p>
        <img src="/pilot/connector.png" alt="Claude's Connectors settings with Dig MCP added as a custom connector" className={styles.shot} />
      </section>
    </div>
  );
}
