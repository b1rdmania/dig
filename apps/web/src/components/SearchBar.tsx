"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./SearchBar.module.css";

const DEBOUNCE_MS = 350;

export function SearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [type, setType] = useState(searchParams.get("type") || "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushParams = useCallback(
    (q: string, t: string) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (t) params.set("type", t);
      // Preserve other existing filters
      for (const [key, val] of searchParams.entries()) {
        if (key !== "q" && key !== "type" && key !== "cursor") {
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
      pushParams(query, type);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, type, pushParams]);

  // Sync from URL on back/forward navigation
  useEffect(() => {
    setQuery(searchParams.get("q") || "");
    setType(searchParams.get("type") || "");
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
      <select
        className={styles.typeSelect}
        value={type}
        onChange={(e) => setType(e.target.value)}
      >
        <option value="">All</option>
        <option value="artist">Artist</option>
        <option value="label">Label</option>
        <option value="master">Master</option>
        <option value="release">Release</option>
      </select>
    </div>
  );
}
