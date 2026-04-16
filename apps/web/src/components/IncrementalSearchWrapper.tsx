"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useIncrementalSearch } from "@/hooks/useIncrementalSearch";
import type { SearchResult } from "@/lib/types";
import { SearchResults } from "./SearchResults";
import { Empty } from "./Empty";
import styles from "./SearchBar.module.css";

const ENABLED = process.env.NEXT_PUBLIC_INCREMENTAL_SEARCH === "true";

interface Props {
  /** Server-rendered results (canonical path). Shown when incremental is off or idle. */
  children: ReactNode;
}

export function IncrementalSearchWrapper({ children }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const {
    inputValue,
    setInputValue,
    results,
    status,
    error,
    isStale,
    onFocus,
    onBlur,
  } = useIncrementalSearch({
    initialQuery,
    enabled: ENABLED,
  });

  // Canonical submit: updates URL → triggers server-side fetch.
  const onSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const params = new URLSearchParams();
      const trimmed = inputValue.trim();
      if (trimmed) params.set("q", trimmed);
      // Preserve safe filters.
      for (const [key, val] of searchParams.entries()) {
        if (key !== "q" && key !== "cursor") {
          params.set(key, val);
        }
      }
      const qs = params.toString();
      router.push(qs ? `/?${qs}` : "/");
    },
    [inputValue, searchParams, router],
  );

  // Should we show incremental results instead of server-rendered children?
  const showIncremental =
    ENABLED &&
    status !== "idle" &&
    inputValue.trim() !== initialQuery;

  return (
    <>
      {/* Search input */}
      <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
        <form className={styles.wrapper} onSubmit={onSubmit}>
          <input
            className={styles.input}
            type="search"
            placeholder="Search artists, labels, releases..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            autoCorrect="off"
            autoCapitalize="off"
            autoFocus
            aria-label="Search the music catalog"
          />
          <button className={styles.submit} type="submit">
            Search
          </button>
        </form>
      </div>

      {/* Maintenance notice */}
      <div style={{ maxWidth: "var(--max-width)", margin: "0.75rem auto 0", textAlign: "center", fontSize: "0.8rem", color: "var(--fg-faint)" }}>
        under maintenance — back online 26 march
      </div>

      {/* Results area */}
      <div style={{ marginTop: "2rem" }} aria-live="polite">
        {showIncremental ? (
          <IncrementalResults
            results={results}
            status={status}
            error={error}
            isStale={isStale}
            query={inputValue.trim()}
          />
        ) : (
          children
        )}
      </div>
    </>
  );
}

const SPINNER_DELAY_MS = 150;

function IncrementalResults({
  results,
  status,
  error,
  isStale,
  query,
}: {
  results: ReturnType<typeof useIncrementalSearch>["results"];
  status: ReturnType<typeof useIncrementalSearch>["status"];
  error: string | null;
  isStale: boolean;
  query: string;
}) {
  // Delay showing the spinner to avoid flicker on fast responses.
  const [showSpinner, setShowSpinner] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status === "loading") {
      timerRef.current = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShowSpinner(false);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [status]);

  return (
    <>
      {/* Loading indicator — only shown after 150ms to avoid flicker */}
      {showSpinner && (
        <div
          style={{
            maxWidth: "var(--max-width)",
            margin: "0 auto",
            fontSize: "0.75rem",
            color: "var(--fg-faint)",
            padding: "0.2rem 0",
          }}
        >
          {isStale ? `Updating results...` : `Searching...`}
        </div>
      )}

      {/* Error hint — non-blocking, keeps previous results */}
      {error && (
        <div
          style={{
            maxWidth: "var(--max-width)",
            margin: "0 auto",
            fontSize: "0.75rem",
            color: "var(--fg-faint)",
            padding: "0.2rem 0",
          }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {results && results.results.length > 0 ? (
        <SearchResults data={results} />
      ) : status === "success" && query.length >= 2 ? (
        <Empty message="No results found">
          {results?.meta.suggested_results && results.meta.suggested_results.length > 0 && (
            <IncrementalDidYouMean suggestions={results.meta.suggested_results} />
          )}
        </Empty>
      ) : null}
    </>
  );
}

function IncrementalDidYouMean({ suggestions }: { suggestions: SearchResult[] }) {
  return (
    <div style={{ marginTop: "1.25rem", textAlign: "left" }}>
      <p style={{ fontSize: "0.8rem", color: "var(--fg-faint)", marginBottom: "0.5rem" }}>
        Did you mean?
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {suggestions.map((s) => (
          <Link
            key={s.discogs_id}
            href={`/artist/${s.discogs_id}`}
            style={{ fontSize: "0.95rem", color: "var(--fg)", textDecoration: "underline", textUnderlineOffset: "3px" }}
          >
            {s.name || s.title || `Artist ${s.discogs_id}`}
          </Link>
        ))}
      </div>
    </div>
  );
}
