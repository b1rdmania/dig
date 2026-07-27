import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Dig. Beta Access.",
  description: "Three ways to try it.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Dig. Beta Access.",
    description: "Three ways to try it.",
    images: [{ url: "/api/og?kind=home&v=3", width: 1200, height: 630, alt: "Dig. Beta Access." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dig. Beta Access.",
    description: "Three ways to try it.",
    images: ["/api/og?kind=home&v=3"],
  },
};

const ACCESS_KEY = "dig-beta-1504eb2560f5b76b991e472b";

export default function RussPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Dig. Beta Access.</h1>
      <p className={styles.lede}>
        80,000 house and techno records, 1985–2008, built on Discogs open data.
        Three ways to try it.
      </p>
      <p className={styles.ledeAside}>
        For more about Dig, check the <a href="/faq">FAQ</a>.
      </p>

      <section className={styles.section}>
        <h2 className={styles.heading}>1 · Search it</h2>
        <p>
          <a href="https://app.dig.baby/">app.dig.baby</a> works like Discogs:
          search an artist, a label, a record, watch the video.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>2 · AI chat</h2>
        <p>
          Open <a href="https://app.dig.baby/llm-beta">app.dig.baby/llm-beta</a>.
          Enter this key:
        </p>
        <p className={styles.key}>{ACCESS_KEY}</p>
        <p>Ask it about records.</p>
        <p>
          Press <strong>Bag it up</strong> when you have a pile. You get one
          YouTube link with a playlist, and each record&apos;s Discogs
          marketplace link.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>3 · In the Claude app</h2>
        <p>
          <strong>Settings → Connectors → Add custom connector.</strong> Paste
          this URL. Leave the rest blank.
        </p>
        <p className={styles.key}>https://dig-mcp.fly.dev/mcp</p>
        <p>
          Turn it on in a chat. Claude can then search the catalog, follow remix
          credits, and bag up a session the same way.
        </p>
        <img src="/pilot/connector.png" alt="Claude's Connectors settings with Dig MCP added as a custom connector" className={styles.shot} />
      </section>
    </div>
  );
}
