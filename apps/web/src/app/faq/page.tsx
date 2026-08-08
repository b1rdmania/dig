import type { Metadata } from "next";
import { PageHeading } from "@/components/design";
import { KEY_REQUEST_MAILTO } from "@/lib/keyRequest";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "FAQ — dig",
  description: "What dig is and what it is now.",
};

const FAQS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "What is this?",
    a: (
      <>
        I&apos;m Andy. I rebuilt Discogs in March because I wanted the mobile
        site to work better: video, a fast API and an MCP server. The full
        catalogue cost about $2k in database bills, so I parked it.
        <span className={styles.follow}>
          <span>Follow me here:</span>
          <span className={styles.social}>
            <a href="https://github.com/b1rdmania" target="_blank" rel="noreferrer" aria-label="GitHub">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.26 5.66.41.36.78 1.06.78 2.14 0 1.54-.02 2.79-.02 3.17 0 .31.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
              </svg>
            </a>
            <a href="https://x.com/b1rdmania" target="_blank" rel="noreferrer" aria-label="X (Twitter)">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
                <path d="M18.9 2.1h3.4l-7.4 8.5 8.7 11.3h-6.8l-5.3-6.9-6.1 6.9H1.9l7.9-9L1.4 2.1h7l4.8 6.3 5.7-6.3Zm-1.2 17.8h1.9L7.4 4H5.4l12.3 15.9Z" />
              </svg>
            </a>
          </span>
        </span>
      </>
    ),
  },
  {
    q: "What is Dig now?",
    a: (
      <>
        A smaller experiment focused on house and techno, with an LLM on top.
        <span className={styles.block}>
          Search the catalogue conversationally, talk about artists and records
          you like, and get recommendations with YouTube links.
        </span>
        <span className={styles.block}>
          Think of it as a demo of what Discogs could do with its dataset.
        </span>
        <span className={styles.block}>
          No logins. No commercial product. It runs on my API credits.{" "}
          <a href={KEY_REQUEST_MAILTO}>Request access here</a>.
        </span>
        <span className={styles.block}>
          The longer build story is <a href="/progress">here</a>.
        </span>
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <div className={styles.page}>
      <PageHeading title="FAQ." />
      <dl className={styles.list}>
        {FAQS.map(({ q, a }) => (
          <div key={q} className={styles.item}>
            <dt className={styles.q}>{q}</dt>
            <dd className={styles.a}>{a}</dd>
          </div>
        ))}
      </dl>

      <p className={styles.aside}>
        Also: we built a drum-pattern generator from some of these scenes.{" "}
        <a href="https://ghost-pattern.pages.dev/" target="_blank" rel="noreferrer">Try it</a>.
      </p>
    </div>
  );
}
