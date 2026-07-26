import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "FAQ — dig",
  description: "What dig is, what's in the catalog, and where the data comes from.",
};

const FAQS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "What is this?",
    a: "A scene browser for house and techno, 1985 to 2008. Around 80,000 master releases with their artists, labels, credits, and fifteen curated scenes — scoped on purpose to the music that matters, not a mirror of everything.",
  },
  {
    q: "What is Ask Dig?",
    a: "An LLM chat over the catalog, in private beta. Every answer is grounded in the actual data — records it names are records that exist, with links to hear and buy them. Access is by key while it's in beta.",
  },
  {
    q: "Where does the data come from?",
    a: (
      <>
        Catalog data from the monthly{" "}
        <a href="https://www.discogs.com/data/" target="_blank" rel="noreferrer">Discogs data dumps</a>{" "}
        (CC0). Cover art from the{" "}
        <a href="https://coverartarchive.org/" target="_blank" rel="noreferrer">Cover Art Archive</a>.
        Crosswalk data from{" "}
        <a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">MusicBrainz</a>{" "}
        (CC0). Editorial classifications — the scenes, core runs, and related-label edges — are dig&apos;s own.
      </>
    ),
  },
  {
    q: "Is this Discogs?",
    a: "No. dig is an independent project built on Discogs' openly licensed data. Pressing-level detail — specific versions, matrix numbers, marketplace listings — lives on Discogs, and dig links there for it.",
  },
  {
    q: "Why is a record missing?",
    a: "Two likely reasons: it's outside the scope (wrong genre or era — the catalog is deliberately narrow), or it arrived since the last monthly data dump. If it's in scope and still missing, that's worth telling us about.",
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
