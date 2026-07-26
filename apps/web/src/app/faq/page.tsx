import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "FAQ — dig",
  description: "What dig is, what's in the catalog, and where the data comes from.",
};

const FAQS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "What is this?",
    a: "I rebuilt Discogs in March because I was bored and wanted the mobile site to work better — videos wired in, a fast API, and a trial run as an MCP server. The full catalog cost about $2k in database bills, so I parked it.",
  },
  {
    q: "What is Dig now?",
    a: (
      <>
        Slimmed down to house and techno, with an LLM layer on top: query the
        catalog directly, chat about your collection and the artists you like,
        get recommendations with YouTube links. Works pretty well — it runs on
        a Kimi backend. The search database needs a bit of tweaking (some
        tracks and artists are missing), but as a beta demo I&apos;m happy with
        it. I built it as an experiment in what the fun end of big open data
        looks like — which is really something Discogs should be doing
        themselves in 2026. They should probably pay me to build the proper
        pilot. The long version of the build is at{" "}
        <a href="/progress">how we built it</a>.
      </>
    ),
  },
  {
    q: "Where does the data come from?",
    a: (
      <>
        The monthly{" "}
        <a href="https://www.discogs.com/data/" target="_blank" rel="noreferrer">Discogs data dumps</a>{" "}
        (CC0), cover art from the{" "}
        <a href="https://coverartarchive.org/" target="_blank" rel="noreferrer">Cover Art Archive</a>,
        crosswalks from{" "}
        <a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">MusicBrainz</a>{" "}
        (CC0). The editorial layer — the scenes, the core runs, the
        related-label edges — is mine.
      </>
    ),
  },
  {
    q: "Is this Discogs?",
    a: "No. Independent, built on their openly licensed data. Pressing-level detail — versions, matrix numbers, marketplace listings — lives on Discogs, and every record here links straight to it.",
  },
  {
    q: "Why is a record missing?",
    a: "Either it's outside the scope — wrong genre or era, the catalog is deliberately narrow — or it landed since the last monthly dump. If it's in scope and still missing, tell me.",
  },
];

export default function FaqPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>FAQ</h1>
      <dl className={styles.list}>
        {FAQS.map(({ q, a }) => (
          <div key={q} className={styles.item}>
            <dt className={styles.q}>{q}</dt>
            <dd className={styles.a}>{a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
