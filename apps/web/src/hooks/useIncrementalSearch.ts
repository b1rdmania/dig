"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResponse } from "@/lib/types";
import { isSearchResponse } from "@/lib/types";
import { trackIncrementalSearch } from "@/lib/analytics";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const INCREMENTAL_LIMIT = 15;
const CLIENT_TIMEOUT_MS = 3000;

type Status = "idle" | "loading" | "success" | "error";

interface ResultsState {
  status: Status;
  /** The query these results correspond to. */
  query: string;
  data: SearchResponse | null;
  error: string | null;
}

interface UseIncrementalSearchOptions {
  initialQuery: string;
  enabled: boolean;
}

export function useIncrementalSearch({
  initialQuery,
  enabled,
}: UseIncrementalSearchOptions) {
  // ── State ──
  const [inputValue, setInputValue] = useState(initialQuery);
  const [resultsState, setResultsState] = useState<ResultsState>({
    status: initialQuery ? "success" : "idle",
    query: initialQuery,
    data: null,
    error: null,
  });

  // ── Refs (never cause re-renders) ──
  const latestRequestId = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocused = useRef(false);

  // Sync input from URL when navigating back/forward (but NOT while typing).
  useEffect(() => {
    if (!isFocused.current) {
      setInputValue(initialQuery);
    }
  }, [initialQuery]);

  // ── Debounced fetch ──
  const fetchResults = useCallback(
    async (query: string, requestId: number, signal: AbortSignal) => {
      const startMs = Date.now();
      trackIncrementalSearch("started", { query_length: query.length });

      try {
        const params = new URLSearchParams({
          q: query,
          limit: String(INCREMENTAL_LIMIT),
        });

        const res = await fetch(`/api/search?${params.toString()}`, {
          signal,
        });

        // Guard: if a newer request started, discard this one.
        if (requestId !== latestRequestId.current) {
          trackIncrementalSearch("aborted", {
            query_length: query.length,
            elapsed_ms: Date.now() - startMs,
          });
          return;
        }

        if (!res.ok) {
          trackIncrementalSearch("error", {
            query_length: query.length,
            elapsed_ms: Date.now() - startMs,
          });
          setResultsState((prev) => ({
            ...prev,
            status: "error",
            error: "Search unavailable",
          }));
          return;
        }

        const data = await res.json();
        if (requestId !== latestRequestId.current) {
          trackIncrementalSearch("aborted", {
            query_length: query.length,
            elapsed_ms: Date.now() - startMs,
          });
          return;
        }

        if (isSearchResponse(data)) {
          trackIncrementalSearch("completed", {
            query_length: query.length,
            elapsed_ms: Date.now() - startMs,
            result_count: data.results.length,
          });
          setResultsState({
            status: "success",
            query,
            data,
            error: null,
          });
        }
      } catch (err: unknown) {
        if (requestId !== latestRequestId.current) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          trackIncrementalSearch("aborted", {
            query_length: query.length,
            elapsed_ms: Date.now() - startMs,
          });
          return;
        }
        trackIncrementalSearch("error", {
          query_length: query.length,
          elapsed_ms: Date.now() - startMs,
          timeout: true,
        });
        setResultsState((prev) => ({
          ...prev,
          status: "error",
          error: "Search timed out — try refining your query",
        }));
      }
    },
    [],
  );

  // ── Trigger incremental search on inputValue change ──
  useEffect(() => {
    if (!enabled) return;

    // Clear previous debounce.
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }

    const trimmed = inputValue.trim();

    // Below threshold — go idle, don't blank results if we have some.
    if (trimmed.length < MIN_QUERY_LENGTH) {
      // Only clear results if we genuinely have no query.
      if (trimmed.length === 0) {
        setResultsState({ status: "idle", query: "", data: null, error: null });
      }
      return;
    }

    // Same query as current results — skip.
    if (trimmed === resultsState.query && resultsState.status === "success") {
      return;
    }

    debounceTimer.current = setTimeout(() => {
      // Abort previous in-flight request.
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Client-side timeout.
      const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
      controller.signal.addEventListener("abort", () =>
        clearTimeout(timeoutId),
      );

      const requestId = ++latestRequestId.current;

      // Show loading state but keep previous data visible.
      setResultsState((prev) => ({ ...prev, status: "loading", error: null }));

      fetchResults(trimmed, requestId, controller.signal);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, enabled, fetchResults]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  /** Whether displayed results are stale (query changed since last success). */
  const isStale =
    resultsState.status === "loading" &&
    resultsState.data !== null &&
    inputValue.trim() !== resultsState.query;

  return {
    inputValue,
    setInputValue,
    results: resultsState.data,
    status: resultsState.status,
    error: resultsState.error,
    isStale,
    /** Call from onFocus to prevent URL→input sync while typing. */
    onFocus: () => {
      isFocused.current = true;
    },
    /** Call from onBlur to re-enable URL→input sync. */
    onBlur: () => {
      isFocused.current = false;
    },
  };
}
