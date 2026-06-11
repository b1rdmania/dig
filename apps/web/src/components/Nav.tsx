"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/design";
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
        {isSubpage ? (
          <form className={styles.searchForm} onSubmit={onSearchSubmit}>
            <span className={styles.searchPrompt} aria-hidden>/</span>
            <input
              className={styles.searchInput}
              type="search"
              placeholder="preview search..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <button className={styles.searchBtn} type="submit">↵</button>
          </form>
        ) : null}
      </div>
    </nav>
  );
}
