"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { useRouter, usePathname } from "next/navigation";
import {
  trackMixtapeAddClicked,
  trackMixtapeAddSucceeded,
  trackMixtapeAddFailed,
  trackMixtapeUpgradePrompted,
} from "@/lib/analytics";
import styles from "./AddToMixtapeButton.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL ?? "https://dig-api.fly.dev";

interface Mixtape {
  id: string;
  title: string;
  track_count?: number;
}

interface Props {
  sourceEntityType: "master" | "release";
  sourceDiscogsId: number;
  masterDiscogsId?: number | null;
  name?: string | null;
  artist?: string | null;
}

type Status = "idle" | "open" | "loading" | "added" | "duplicate" | "upgrade" | "error";

export function AddToMixtapeButton({
  sourceEntityType,
  sourceDiscogsId,
  masterDiscogsId,
  name,
  artist,
}: Props) {
  const { isSignedIn } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [status, setStatus] = useState<Status>("idle");
  const [mixtapes, setMixtapes] = useState<Mixtape[] | null>(null);
  const [addedTo, setAddedTo] = useState<string | null>(null);
  const [fetchingList, setFetchingList] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (status !== "open") return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setStatus("idle");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [status]);

  const handleOpen = useCallback(async () => {
    try { trackMixtapeAddClicked(sourceEntityType, sourceDiscogsId); } catch { /* no-op */ }

    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname ?? "/")}`);
      return;
    }

    // Already have list cached
    if (mixtapes !== null) {
      setStatus("open");
      return;
    }

    setFetchingList(true);
    setStatus("open");

    try {
      const token = await getToken();
      if (!token) {
        router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname ?? "/")}`);
        return;
      }
      const res = await fetch(`${API_URL}/v1/me/mixtapes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        try { trackMixtapeUpgradePrompted(sourceEntityType, sourceDiscogsId); } catch { /* no-op */ }
        setStatus("upgrade");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json() as { mixtapes: Mixtape[] };
      setMixtapes(data.mixtapes ?? []);
      setStatus("open");
    } catch {
      setStatus("error");
    } finally {
      setFetchingList(false);
    }
  }, [isSignedIn, mixtapes, getToken, router, pathname, sourceEntityType, sourceDiscogsId]);

  const handleAdd = useCallback(async (mixtapeId: string, mixtapeTitle: string) => {
    setStatus("loading");
    try {
      const token = await getToken();
      if (!token) {
        router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname ?? "/")}`);
        return;
      }
      const res = await fetch(`${API_URL}/v1/me/mixtapes/${mixtapeId}/tracks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          source_entity_type: sourceEntityType,
          source_discogs_id: sourceDiscogsId,
          master_discogs_id: masterDiscogsId ?? null,
          name: name ?? null,
          artist: artist ?? null,
          client_request_id: crypto.randomUUID(),
        }),
      });

      if (res.status === 201) {
        try { trackMixtapeAddSucceeded(sourceEntityType, sourceDiscogsId, mixtapeId); } catch { /* no-op */ }
        setAddedTo(mixtapeTitle);
        setStatus("added");
        setTimeout(() => setStatus("idle"), 2500);
      } else if (res.status === 403) {
        try { trackMixtapeUpgradePrompted(sourceEntityType, sourceDiscogsId); } catch { /* no-op */ }
        setStatus("upgrade");
      } else {
        try { trackMixtapeAddFailed(sourceEntityType, sourceDiscogsId, String(res.status)); } catch { /* no-op */ }
        setStatus("error");
        setTimeout(() => setStatus("idle"), 2000);
      }
    } catch {
      try { trackMixtapeAddFailed(sourceEntityType, sourceDiscogsId, "network"); } catch { /* no-op */ }
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }, [getToken, router, pathname, sourceEntityType, sourceDiscogsId, masterDiscogsId, name, artist]);

  // Feedback label for non-open states
  if (status === "added") {
    return <span className={styles.feedback}>Added to {addedTo}</span>;
  }
  if (status === "upgrade") {
    return (
      <span className={styles.feedback}>
        <a href="/account" className={styles.upgradeLink}>Early Access required</a>
      </span>
    );
  }
  if (status === "error") {
    return <span className={styles.feedback}>Couldn&apos;t add — try again</span>;
  }

  return (
    <div className={styles.wrap} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={handleOpen}
        aria-label="Add to mixtape"
        aria-expanded={status === "open"}
      >
        + Mixtape
      </button>

      {status === "open" && (
        <div className={styles.popover} role="menu">
          {fetchingList && <p className={styles.popoverNote}>Loading...</p>}
          {!fetchingList && mixtapes !== null && mixtapes.length === 0 && (
            <p className={styles.popoverNote}>
              No mixtapes yet.{" "}
              <a href="/account" className={styles.popoverLink}>Create one</a>
            </p>
          )}
          {!fetchingList && mixtapes && mixtapes.length > 0 && (
            <ul className={styles.list}>
              {mixtapes.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={styles.mixtapeItem}
                    onClick={() => handleAdd(m.id, m.title)}
                    role="menuitem"
                  >
                    <span className={styles.mixtapeTitle}>{m.title}</span>
                    {m.track_count !== undefined && (
                      <span className={styles.mixtapeMeta}>{m.track_count}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {status === "loading" && (
        <div className={styles.popover}>
          <p className={styles.popoverNote}>Adding...</p>
        </div>
      )}
    </div>
  );
}
