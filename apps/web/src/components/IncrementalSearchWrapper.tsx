"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, type ReactNode } from "react";
import { useIncrementalSearch } from "@/hooks/useIncrementalSearch";
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
  return (
    <>
      {/* Loading indicator — subtle, doesn't blank the list */}
      {status === "loading" && (
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
        <Empty message="No results found" />
      ) : null}
    </>
  );
}
