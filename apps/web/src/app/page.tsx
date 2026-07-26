import { Suspense } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/design";
import { SearchBar } from "@/components/SearchBar";
import { SearchContent } from "@/components/SearchContent";
import { MaintenanceLanding } from "@/components/maintenance/Landing";
import { MAINTENANCE_MODE } from "@/lib/maintenance";
import styles from "./page.module.css";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * The homepage is the catalog wall. Search is pinned at the top so people
 * who know what they want can type and go; everyone else gets pulled into
 * the wall as the dominant payoff. When a query is present, results replace
 * the wall in the same slot — the wall is the empty state, not the entry.
 *
 * During the maintenance window (MAINTENANCE_MODE) the rebuild landing
 * renders instead; flipping the flag restores the wall.
 */

function HomeHero() {
  return (
    <PageHeading title="Dig." lede="House and techno, 1988 to 2008.">
      <div className={styles.wallToolbar}>
        <Link href="/scene" className={styles.toolbarLink}>Scenes →</Link>
        <span className={styles.toolbarSep}>·</span>
        <Link href="/llm-beta" className={styles.toolbarLink}>LLM (Beta) →</Link>
        <span className={styles.toolbarSep}>·</span>
        <Link href="/faq" className={styles.toolbarLink}>FAQ →</Link>
      </div>
    </PageHeading>
  );
}

export default async function HomePage({ searchParams }: Props) {
  if (MAINTENANCE_MODE) {
    return <MaintenanceLanding />;
  }

  const resolved = await searchParams;
  const hasQuery = typeof resolved.q === "string" && resolved.q.trim().length > 0;

  return (
    <>
      {!hasQuery && <HomeHero />}
      <Suspense>
        <SearchBar />
      </Suspense>
      <div className={styles.resultsSlot}>
        {hasQuery && <SearchContent searchParams={resolved} />}
      </div>
    </>
  );
}
