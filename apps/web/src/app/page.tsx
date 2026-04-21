import { Suspense } from "react";
import Link from "next/link";
import { ApiRequestError } from "@/lib/api";
import { fetchAllSceneWalls } from "@/lib/wall";
import { CatalogWall } from "@/components/wall";
import { ErrorMessage } from "@/components/ErrorMessage";
import { SearchContent } from "@/components/SearchContent";
import { IncrementalSearchWrapper } from "@/components/IncrementalSearchWrapper";
import styles from "./page.module.css";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * The homepage is the catalog wall. Search is pinned at the top so people
 * who know what they want can type and go; everyone else gets pulled into
 * the wall as the dominant payoff. When a query is present, results replace
 * the wall in the same slot — the wall is the empty state, not the entry.
 */

function HomeHero() {
  return (
    <section className={styles.hero}>
      <div className={styles.eyebrow}>[ v2 ] · house &amp; techno · 1988–2008</div>
      <h1 className={styles.heading}>Dig.</h1>
      <p className={styles.lede}>
        House and techno, 1988 to 2008. Every label, every record, every scene — read the
        wall, or search by name.
      </p>
    </section>
  );
}

async function HomeWall() {
  try {
    const scenes = await fetchAllSceneWalls("compact", null);
    if (scenes.length === 0) {
      return <ErrorMessage message="No scenes loaded" />;
    }
    return (
      <>
        <header className={styles.wallHeader}>
          <div className={styles.wallEyebrow}>[ wall ] · catalog · v0.1</div>
          <h2 className={styles.wallHeading}>The catalog, as a wall.</h2>
          <p className={styles.wallLede}>
            Every scene grouped by axis. Strips read top-down, earliest first. Click a
            label to drop into its catalog. Click a scene title to read it as an essay.
          </p>
          <div className={styles.wallToolbar}>
            <Link href="/wall?density=medium" className={styles.toolbarLink}>
              Open the full wall →
            </Link>
            <span className={styles.toolbarSep}>·</span>
            <Link href="/scene" className={styles.toolbarLink}>
              Browse scenes by axis →
            </Link>
            <span className={styles.toolbarSep}>·</span>
            <Link href="/about" className={styles.toolbarLink}>
              About dig
            </Link>
          </div>
        </header>
        <CatalogWall scenes={scenes} density="compact" />
      </>
    );
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return <ErrorMessage code={err.code} message={err.message} />;
    }
    return <ErrorMessage message="Failed to load the wall" />;
  }
}

export default async function HomePage({ searchParams }: Props) {
  const resolved = await searchParams;
  const hasQuery = typeof resolved.q === "string" && resolved.q.trim().length > 0;

  return (
    <>
      {!hasQuery && <HomeHero />}
      <Suspense>
        <IncrementalSearchWrapper>
          {hasQuery ? (
            <SearchContent searchParams={resolved} />
          ) : (
            <Suspense fallback={<div className={styles.loading}>Loading wall…</div>}>
              <HomeWall />
            </Suspense>
          )}
        </IncrementalSearchWrapper>
      </Suspense>
    </>
  );
}
