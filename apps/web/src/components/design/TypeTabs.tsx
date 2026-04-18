"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type { SearchTypeCounts } from "@/lib/types";
import styles from "./TypeTabs.module.css";

interface Props {
  /** Active type from the URL (`?type=label` etc.). null = ALL. */
  active: "all" | "artist" | "label" | "master";
  /** Per-type result counts from the API response. */
  counts?: SearchTypeCounts;
}

const TABS: Array<{ id: "all" | "artist" | "label" | "master"; label: string }> = [
  { id: "all",    label: "All" },
  { id: "label",  label: "Labels" },
  { id: "artist", label: "Artists" },
  { id: "master", label: "Releases" },
];

/**
 * Type-filter tabs for the search page. Renders a segmented row of mono
 * pills with per-type counts. Tabs are real Link elements so they keep
 * the URL canonical (the server-rendered SearchContent re-fetches with
 * `?type=…`).
 *
 * The "Releases" label is intentional — the slim catalog uses `master`
 * as the canonical entity for albums/releases. We don't expose the
 * internal `master` term to users.
 */
export function TypeTabs({ active, counts }: Props) {
  const searchParams = useSearchParams();

  // Build hrefs per tab — preserve q + filters, swap (or remove) `type`.
  const hrefForTab = useMemo(() => {
    return (tabId: "all" | "artist" | "label" | "master") => {
      const params = new URLSearchParams();
      for (const [key, val] of searchParams.entries()) {
        if (key === "type" || key === "cursor") continue;
        params.set(key, val);
      }
      if (tabId !== "all") params.set("type", tabId);
      const qs = params.toString();
      return qs ? `/?${qs}` : "/";
    };
  }, [searchParams]);

  return (
    <nav className={styles.tabs} aria-label="Filter results by type">
      {TABS.map((tab) => {
        const count = countFor(tab.id, counts);
        const isCurrent = tab.id === active;
        const isCapped = tab.id !== "all" && counts?.[`${tab.id}_capped` as const];
        const isDisabled = tab.id !== "all" && count === 0;
        return (
          <Link
            key={tab.id}
            href={hrefForTab(tab.id)}
            className={`${styles.tab} ${isDisabled ? styles.disabled : ""}`}
            aria-current={isCurrent ? "page" : undefined}
            prefetch={false}
            tabIndex={isDisabled ? -1 : 0}
          >
            <span>{tab.label}</span>
            {counts && (
              <span className={styles.count}>
                {count}
                {isCapped ? "+" : ""}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function countFor(
  id: "all" | "artist" | "label" | "master",
  counts?: SearchTypeCounts,
): number {
  if (!counts) return 0;
  if (id === "all") {
    return (counts.artist ?? 0) + (counts.label ?? 0) + (counts.master ?? 0);
  }
  return counts[id] ?? 0;
}
