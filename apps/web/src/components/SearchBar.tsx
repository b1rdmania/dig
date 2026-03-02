"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./SearchBar.module.css";

const DEBOUNCE_MS = 350;

export function SearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushParams = useCallback(
    (q: string) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      // Preserve existing filters (type, genre, etc.)
      for (const [key, val] of searchParams.entries()) {
        if (key !== "q" && key !== "cursor") {
          params.set(key, val);
        }
      }
      router.push(`/?${params.toString()}`);
    },
    [router, searchParams],
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      pushParams(query);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, pushParams]);

  // Sync from URL on back/forward navigation
  useEffect(() => {
    setQuery(searchParams.get("q") || "");
  }, [searchParams]);

  return (
    <div className={styles.wrapper}>
      <input
        className={styles.input}
        type="search"
        placeholder="Search artists, labels, releases..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
    </div>
  );
}
