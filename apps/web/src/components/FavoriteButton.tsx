"use client";

import { useState, useCallback } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { useRouter, usePathname } from "next/navigation";
import { trackFavoriteToggled } from "@/lib/analytics";
import styles from "./FavoriteButton.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL ?? "https://dig-api.fly.dev";

interface Props {
  entityType: "artist" | "label" | "release" | "version";
  discogsId: number;
  compact?: boolean;
}

export function FavoriteButton({ entityType, discogsId, compact = false }: Props) {
  const { isSignedIn } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname ?? "/")}`);
      return;
    }
    if (loading) return;

    setLoading(true);
    setError(null);

    const previousSaved = saved;
    // Optimistic update
    setSaved(!saved);

    try {
      const token = await getToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token ?? ""}`,
      };

      if (previousSaved) {
        // Remove favorite
        const res = await fetch(
          `${API_URL}/v1/me/saved/favorite/${entityType}/${discogsId}`,
          { method: "DELETE", headers },
        );
        if (!res.ok && res.status !== 204) {
          setSaved(previousSaved);
          setError("Couldn't update favorite. Try again.");
          return;
        }
        try { trackFavoriteToggled(entityType, discogsId, false); } catch { /* no-op */ }
      } else {
        // Add favorite
        const res = await fetch(`${API_URL}/v1/me/saved`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ entity_type: entityType, discogs_id: discogsId, list_type: "favorite" }),
        });
        if (!res.ok) {
          setSaved(previousSaved);
          setError("Couldn't save right now. Try again.");
          return;
        }
        try { trackFavoriteToggled(entityType, discogsId, true); } catch { /* no-op */ }
      }
    } catch {
      // Network error — rollback
      setSaved(previousSaved);
      setError("Couldn't save right now. Try again.");
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, loading, saved, getToken, router, pathname, entityType, discogsId]);

  const label = saved ? "♥ Favorited" : "♡ Favorite";
  const ariaLabel = saved ? "Remove from favorites" : "Add to favorites";

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        className={`${styles.btn}${compact ? ` ${styles.compact}` : ""}`}
        data-saved={String(saved)}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {compact ? (saved ? "♥" : "♡") : label}
      </button>
      {error && <span className={styles.errorTip} role="alert">{error}</span>}
    </span>
  );
}
