import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About — dig",
  description: "The music data layer for agents and humans. Built on the Discogs CC0 dataset.",
};

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>About</p>
        <h1 className={styles.title}>
          Music search.<br />
          <em>Finally.</em>
        </h1>
        <p className={styles.lede}>
          There&rsquo;s no agent-ready music data layer on the internet. Every AI asked about music
          guesses&thinsp;&mdash;&thinsp;confidently, fluently, wrongly. Dig is the canonical music data layer
          that should already exist.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>What this is</h2>
        <p className={styles.copy}>
          Dig is a structured search engine and data layer built on the full{" "}
          <a href="https://www.discogs.com/developers" target="_blank" rel="noreferrer">Discogs CC0 dataset</a>
          &thinsp;&mdash;&thinsp;24 million records, 2.5 million masters, 580,000 artists, and 2.3 million labels.
          Every entity is cross-linked: artists to releases, releases to credits, credits to labels. Click anything,
          follow the thread.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Agent first, human second</h2>
        <div className={styles.points}>
          <div className={styles.point}>
            <span className={styles.num}>01</span>
            <div>
              <h3 className={styles.pointTitle}>Open by default</h3>
              <p className={styles.pointCopy}>
                Fully open REST API and MCP server. No keys required, no signup.
                Any agent, any LLM workflow&thinsp;&mdash;&thinsp;just point at it.
              </p>
            </div>
          </div>
          <div className={styles.point}>
            <span className={styles.num}>02</span>
            <div>
              <h3 className={styles.pointTitle}>Deterministic retrieval</h3>
              <p className={styles.pointCopy}>
                No inference in the retrieval path. Structured data only. When an agent asks for
                a record, it gets the real thing&thinsp;&mdash;&thinsp;not a hallucination dressed as an answer.
              </p>
            </div>
          </div>
          <div className={styles.point}>
            <span className={styles.num}>03</span>
            <div>
              <h3 className={styles.pointTitle}>Human search that works</h3>
              <p className={styles.pointCopy}>
                Because the data&rsquo;s already there, humans finally get the deep catalog search tool that
                should have existed years ago. Fast, mobile-first, connected.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Enrichment layers</h2>
        <p className={styles.copy}>
          Beyond the core Discogs catalog, Dig cross-references MusicBrainz (1.2M artist mappings, 1.8M release
          crosswalks), Wikidata (bios, locations, genres for 200K artists), and setlist.fm (live performance
          history). All enrichment is additive and source-attributed.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Stack</h2>
        <p className={styles.copy}>
          TypeScript, Postgres, Kysely, Fastify, Next.js. Hosted on Fly.io.
          Full-text search via Postgres FTS + pg_trgm. Redis for caching. Cover art from the
          Cover Art Archive. No external AI services in the data path.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Status</h2>
        <p className={styles.copy}>
          Early stage, active alpha. Building in public.
          The API, MCP server, and web frontend are all live.
          See <Link href="/progress">how we built it</Link> for the full build log.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Links</h2>
        <div className={styles.linkList}>
          <a href="https://github.com/b1rdmania/dig" target="_blank" rel="noreferrer" className={styles.extLink}>
            GitHub
          </a>
          <a href="https://x.com/baborelux" target="_blank" rel="noreferrer" className={styles.extLink}>
            @baborelux on X
          </a>
          <a href="https://dig-api.fly.dev/v1/health" target="_blank" rel="noreferrer" className={styles.extLink}>
            API health
          </a>
        </div>
      </section>

      <footer className={styles.footer}>
        <p className={styles.footerNote}>
          Built by <a href="https://x.com/baborelux" target="_blank" rel="noreferrer">birdmania</a>.
          The music tool agents reach for. And the one humans actually wanted.
        </p>
      </footer>
    </div>
  );
}
