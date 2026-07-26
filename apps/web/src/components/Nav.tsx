"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/design";
import { MAINTENANCE_MODE } from "@/lib/maintenance";
import styles from "./Nav.module.css";

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") || "");

  useEffect(() => {
    setQ(searchParams.get("q") || "");
  }, [searchParams]);

  const onSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const params = new URLSearchParams();
    const trimmed = q.trim();
    if (trimmed) params.set("q", trimmed);
    router.push(params.toString() ? `/search?${params.toString()}` : "/search");
  };

  const isSubpage = pathname !== "/";
  // The homepage carries the brand itself (hero + footer) — no header there.
  if (!isSubpage) return null;
  // /search renders the canonical SearchBar in-page; the nav's compact
  // search form would duplicate it.
  const showNavSearch = pathname !== "/search";

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <div className={styles.left}>
          {isSubpage && (
            <button
              type="button"
              onClick={() => router.back()}
              className={styles.backBtn}
              aria-label="Back"
            >
              ←
            </button>
          )}
          <Link href="/" className={styles.brand}>
            <Wordmark size="md" />
          </Link>
        </div>
        {showNavSearch ? (
          <form className={styles.searchForm} onSubmit={onSearchSubmit}>
            <input
              className={styles.searchInput}
              type="search"
              placeholder={MAINTENANCE_MODE ? "preview search..." : "search..."}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <button className={styles.searchBtn} type="submit" aria-label="Search">Search</button>
          </form>
        ) : null}
      </div>
    </nav>
  );
}
