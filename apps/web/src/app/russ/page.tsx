import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Pilot notes — dig",
  description: "How to try the dig pilot.",
  robots: { index: false, follow: false },
};

const ACCESS_KEY = "dig-beta-1504eb2560f5b76b991e472b";

export default function RussPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Russ — the pilot.</h1>
      <p className={styles.lede}>
        The whole thing is built on the Discogs CC0 data dumps: ~80,000 house and techno
        masters, 1985–2008, with the full credit graph. Two ways in.
      </p>

      <section className={styles.section}>
        <h2 className={styles.heading}>1 · Chat on the web</h2>
        <p>
          Go to <a href="https://app.dig.baby/llm-beta">app.dig.baby/llm-beta</a> and
          enter this access key:
        </p>
        <p className={styles.key}>{ACCESS_KEY}</p>
        <p>
          Then just talk to it like you&apos;d talk across a counter. It only recommends
          records that actually exist — every one linked, with the videos underneath.
          Try: <em>&ldquo;what did Larry Heard remix between 92 and 96?&rdquo;</em> or{" "}
          <em>&ldquo;essential Trax, then take me somewhere weirder.&rdquo;</em>
        </p>
        <p>
          When you&apos;ve got a pile going, hit <strong>Bag it up</strong> under the
          composer. You get one YouTube link that plays the lot in order, plus every
          record with its Discogs marketplace link — straight to copies for sale.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>2 · Straight into Claude</h2>
        <p>
          No code involved. In the Claude app: <strong>Settings → Connectors → Add
          custom connector</strong>, paste this URL, leave everything else blank:
        </p>
        <p className={styles.key}>https://dig-mcp.fly.dev/mcp</p>
        <p>
          Enable it in a chat and Claude can search the catalog, walk the credit and
          remix graph, pull label core runs, and bag up a session the same way —
          playlist plus Discogs buy links. Ask it something Discogs&apos; own search
          can&apos;t answer: <em>&ldquo;who did Larry Heard actually work with, and
          where does that thread go?&rdquo;</em>
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>What this is</h2>
        <p>
          An independent pilot on openly licensed Discogs data. The point: the catalog
          as a conversation, with every answer ending in a listen and a marketplace
          link. Browsing works too — <a href="https://app.dig.baby/">app.dig.baby</a>,
          scenes, labels, the lot.
        </p>
      </section>
    </div>
  );
}
