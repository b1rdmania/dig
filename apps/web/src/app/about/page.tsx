import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About — dig",
  description:
    "Dig v2 — a curated catalog of house and techno from 1988 to 2008. The labels, the records, the scenes that built the form.",
  openGraph: {
    title: "About — dig",
    description:
      "Dig v2 — a curated catalog of house and techno from 1988 to 2008. The labels, the records, the scenes that built the form.",
    images: [{ url: "/api/og?kind=home", width: 1200, height: 630, alt: "About dig" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "About — dig",
    description:
      "A curated catalog of house and techno from 1988 to 2008 — the labels, the records, the scenes.",
    images: ["/api/og?kind=home"],
  },
};

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>About · v2</p>
        <h1 className={styles.title}>
          House and techno,<br />
          <em>mapped.</em>
        </h1>
        <p className={styles.lede}>
          Dig is a curated catalog of house and techno from 1988 to 2008 &mdash; the labels, the
          records, and the scenes that built the form. Opinionated by humans, structured for
          machines, open to both.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Where to start</h2>
        <p className={styles.copy}>
          Three doors in. Pick whichever matches the question in your head.
        </p>
        <div className={styles.points}>
          <div className={styles.point}>
            <span className={styles.num}>01</span>
            <div>
              <h3 className={styles.pointTitle}>
                <Link href="/">The catalog wall</Link>
              </h3>
              <p className={styles.pointCopy}>
                The whole catalog rendered as a single readable surface. Every scene, every label,
                every release in scope &mdash; arranged by axis, scannable top-down. The dominant entry
                point for browsing without a destination in mind.
              </p>
            </div>
          </div>
          <div className={styles.point}>
            <span className={styles.num}>02</span>
            <div>
              <h3 className={styles.pointTitle}>
                <Link href="/scene">Scenes</Link>
              </h3>
              <p className={styles.pointCopy}>
                Curated groupings of labels: Detroit Core, Berlin Techno, Chicago House, Dub Techno,
                Cologne Minimal and more. Each scene has a city, an era window, and a written
                blurb. Bridges link related scenes through the artists and sounds that carried
                between them.
              </p>
            </div>
          </div>
          <div className={styles.point}>
            <span className={styles.num}>03</span>
            <div>
              <h3 className={styles.pointTitle}>
                <Link href="/search">Search</Link>
              </h3>
              <p className={styles.pointCopy}>
                Type any artist, label, or release. Mixed-type results with a top match,
                fuzzy-spelling rescue, and per-type counts. Pinned at the top of every page so
                you&rsquo;re never more than one keystroke from the catalog.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>The scope</h2>
        <p className={styles.copy}>
          Twenty years, two genres at the centre, and everything they fed. House and techno
          are the gravity well: Chicago and Detroit at the start, Berlin and the UK underground
          in the middle, the global circuit by the end. Around them sit the forms that grew
          out of them &mdash; trance, IDM, electro, jungle, dub techno, ambient, downtempo. They&rsquo;re
          all in here, because they&rsquo;re all the same family tree.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>What&rsquo;s in the cut</h2>
        <div className={styles.points}>
          <div className={styles.point}>
            <span className={styles.num}>01</span>
            <div>
              <h3 className={styles.pointTitle}>~81,000 masters</h3>
              <p className={styles.pointCopy}>
                Canonical works, not pressings. Every one sits inside the 1988&ndash;2008 window. Each one
                links out to its individual releases (~2.7M), tracks (~580K), credits, and labels.
              </p>
            </div>
          </div>
          <div className={styles.point}>
            <span className={styles.num}>02</span>
            <div>
              <h3 className={styles.pointTitle}>~168,000 labels &middot; ~112,000 artists</h3>
              <p className={styles.pointCopy}>
                Every label and every artist credited on an in-scope master, fully cross-linked.
                Click anything, follow the thread &mdash; artist to label to master to credit to
                another artist.
              </p>
            </div>
          </div>
          <div className={styles.point}>
            <span className={styles.num}>03</span>
            <div>
              <h3 className={styles.pointTitle}>Half house and techno, half family</h3>
              <p className={styles.pointCopy}>
                Strict house and techno (and their immediate sub-styles) make up about half the
                catalog. The rest is the connected family: trance, IDM, electro, jungle, ambient,
                dub. The split reflects how the era actually sounded.
              </p>
            </div>
          </div>
          <div className={styles.point}>
            <span className={styles.num}>04</span>
            <div>
              <h3 className={styles.pointTitle}>An editorial layer on top</h3>
              <p className={styles.pointCopy}>
                Hand-curated labels with palettes, blurbs, and stickers. Curated scenes group
                labels by geography, sound, and era. Each label page carries a Core Run (essential
                listening) and directional related-label cards (deeper, harder, rawer, weirder,
                earlier, later). Editorial as data, all versioned in git.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Why these years</h2>
        <p className={styles.copy}>
          1988 is when acid house broke in the UK, when the Belleville Three&rsquo;s Detroit techno
          first travelled, and when Trax and DJ International were exporting Chicago house at full
          volume. 2008 is where the second arc closes: minimal had peaked and softened, Innervisions
          and Kompakt had matured into the dominant European sound, and the blog-house /
          EDM-bloat era was about to muddy the water. The window isn&rsquo;t arbitrary &mdash; it&rsquo;s
          the full arc of dance music as a self-aware form, from Chicago warehouse to Berlin
          laptop-minimal.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>How it&rsquo;s built</h2>
        <div className={styles.points}>
          <div className={styles.point}>
            <span className={styles.num}>01</span>
            <div>
              <h3 className={styles.pointTitle}>Open by default</h3>
              <p className={styles.pointCopy}>
                Full REST API, public, no keys for the basic tier, no signup. Any agent, any
                LLM workflow &mdash; just point at it. The MCP server has been{" "}
                <Link href="/mcp">archived</Link>; the source remains in the repo for
                self-hosters.
              </p>
            </div>
          </div>
          <div className={styles.point}>
            <span className={styles.num}>02</span>
            <div>
              <h3 className={styles.pointTitle}>Deterministic retrieval</h3>
              <p className={styles.pointCopy}>
                No model in the data path. Structured queries against a Postgres catalog, with
                provenance attached to every response. When an agent asks for a record, it gets
                the real thing &mdash; not a hallucination dressed as one.
              </p>
            </div>
          </div>
          <div className={styles.point}>
            <span className={styles.num}>03</span>
            <div>
              <h3 className={styles.pointTitle}>Editorial as data</h3>
              <p className={styles.pointCopy}>
                Tier markings, palettes, blurbs, scene memberships, and curated essential picks
                all live as seed files in the database. Editable without a redeploy, versioned in
                git, owned by humans.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>What this isn&rsquo;t</h2>
        <p className={styles.copy}>
          Dig isn&rsquo;t the Discogs catalog &mdash; that&rsquo;s our source, not our product. It isn&rsquo;t a
          streaming service or a marketplace. It isn&rsquo;t infinite-genre or all-time; rock, pop,
          hip hop, classical, jazz, and most of the post-2008 electronic continuum live elsewhere.
          And it isn&rsquo;t crowd-sourced &mdash; there are no user accounts, comments, or ratings.
          Other catalogs cover everything; dig covers something.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Sources</h2>
        <p className={styles.copy}>
          Catalog data from{" "}
          <a href="https://www.discogs.com/data/" target="_blank" rel="noreferrer">Discogs</a>{" "}
          (CC0). Cross-referenced with{" "}
          <a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">MusicBrainz</a>{" "}
          (CC0) for artist and release crosswalks, Wikidata for biographical context, and
          setlist.fm for live performance history. Cover art via{" "}
          <a href="https://coverartarchive.org/" target="_blank" rel="noreferrer">Cover Art Archive</a>.
          All enrichment is additive and source-attributed. Editorial classifications are dig&rsquo;s
          own &mdash; independent, opinionated, fixable.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Stack</h2>
        <p className={styles.copy}>
          TypeScript, Postgres 17, Kysely, Fastify, Next.js 15. Hosted on Fly.io across API
          and frontend. Postgres FTS + pg_trgm for search, Redis for caching. No external AI
          services in the data path.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Status</h2>
        <p className={styles.copy}>
          Active alpha, building in public. The catalog wall is the homepage. Curated scenes,
          per-label core runs, directional related-label edges, and a session-level trail
          through the graph are all live. The API and web frontend ship continuously. See{" "}
          <Link href="/progress">how we built it</Link> for the full log.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Links</h2>
        <div className={styles.linkList}>
          <Link href="/" className={styles.extLink}>The wall</Link>
          <Link href="/scene" className={styles.extLink}>Scenes</Link>
          <Link href="/wall" className={styles.extLink}>Full wall</Link>
          <Link href="/search" className={styles.extLink}>Search</Link>
          <Link href="/llm-beta" className={styles.extLink}>LLM beta</Link>
          <a href="https://github.com/b1rdmania/dig" target="_blank" rel="noreferrer" className={styles.extLink}>
            GitHub
          </a>
          <a href="https://x.com/b1rdmania" target="_blank" rel="noreferrer" className={styles.extLink}>
            @b1rdmania on X
          </a>
          <a href="https://dig-api.fly.dev/v1/health" target="_blank" rel="noreferrer" className={styles.extLink}>
            API health
          </a>
        </div>
      </section>

      <footer className={styles.footer}>
        <p className={styles.footerNote}>
          Built by <a href="https://x.com/b1rdmania" target="_blank" rel="noreferrer">b1rdmania</a>.
          The catalog of dance music&rsquo;s first arc &mdash; for the people who lived it, and the
          ones still finding it.
        </p>
      </footer>
    </div>
  );
}
