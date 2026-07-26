"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./SearchBar.module.css";

/**
 * Canonical search bar — the `/` prompt input pinned above search surfaces.
 * Submitting updates the URL (preserving filters), which re-renders the
 * server-fetched results. Home and /search both render results in place;
 * any other surface bounces to /search.
 */
export function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");

  // Sync from URL on back/forward navigation
  useEffect(() => {
    setQuery(searchParams.get("q") || "");
  }, [searchParams]);

  const submitPath = pathname === "/" || pathname === "/search" ? pathname : "/search";

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const params = new URLSearchParams();
    const trimmed = query.trim();
    if (trimmed) params.set("q", trimmed);
    // Preserve existing filters (type, genre, etc.) when re-submitting.
    for (const [key, val] of searchParams.entries()) {
      if (key !== "q" && key !== "cursor") {
        params.set(key, val);
      }
    }
    const qs = params.toString();
    router.push(qs ? `${submitPath}?${qs}` : submitPath);
  };

  return (
    <form className={styles.wrapper} onSubmit={onSubmit}>
      <input
        className={styles.input}
        type="search"
        placeholder="search artists, labels, records…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Search the music catalog"
      />
      <button className={styles.submit} type="submit">Search</button>
    </form>
  );
}
