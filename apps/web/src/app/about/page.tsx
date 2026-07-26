import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About — dig",
  description: "House and techno, 1988–2008. A catalog you can search, chat to, or plug into Claude.",
  openGraph: {
    title: "About — dig",
    description: "House and techno, 1988–2008. A catalog you can search, chat to, or plug into Claude.",
    images: [{ url: "/api/og?kind=home", width: 1200, height: 630, alt: "dig" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "About — dig",
    description: "House and techno, 1988–2008. A catalog you can search, chat to, or plug into Claude.",
    images: ["/api/og?kind=home"],
  },
};

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.title}>About.</h1>
        <p className={styles.lede}>
          Dig is a catalog of house and techno, 1988 to 2008: around 80,000
          records with their labels, credits, and scenes, built on Discogs open
          data. Opinionated by humans, structured for machines, open to both.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Three ways in</h2>
        <p className={styles.copy}>
          <Link href="/">Search it</Link> like Discogs: artists, labels,
          records, with the video right there. <Link href="/llm-beta">Chat to
          it</Link>: an AI that only recommends records that exist, links every
          one, and bags a session up into a playlist plus marketplace links
          (private beta, key required). Or plug it into Claude as an MCP
          connector and ask questions Discogs search can&apos;t answer, like
          who someone actually worked with.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>The catalog is scoped on purpose</h2>
        <p className={styles.copy}>
          Not a mirror of everything: house, techno, and their neighbours,
          picked by scene. Fifteen curated scenes, a core run of essential
          records per label, and directional edges between labels. Pressing
          detail lives on Discogs and every record links straight to it.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>More</h2>
        <p className={styles.copy}>
          The build story and architecture: <Link href="/progress">how we
          built it</Link>. Questions: <Link href="/faq">FAQ</Link>. Code:{" "}
          <a href="https://github.com/b1rdmania/dig" target="_blank" rel="noreferrer">GitHub</a>.
          Person: <a href="https://x.com/b1rdmania" target="_blank" rel="noreferrer">@b1rdmania</a>.
        </p>
      </section>
    </div>
  );
}
