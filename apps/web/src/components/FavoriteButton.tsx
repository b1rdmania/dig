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
}

export function FavoriteButton({ entityType, discogsId }: Props) {
  const { isSignedIn } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname ?? "/")}`);
      return;
    }
    if (loading) return;

    setLoading(true);
    const previousSaved = saved;
    setSaved(!saved);

    try {
      const token = await getToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token ?? ""}`,
      };

      if (previousSaved) {
        const res = await fetch(
          `${API_URL}/v1/me/saved/favorite/${entityType}/${discogsId}`,
          { method: "DELETE", headers },
        );
        if (!res.ok && res.status !== 204) {
          setSaved(previousSaved);
          return;
        }
        try { trackFavoriteToggled(entityType, discogsId, false); } catch { /* no-op */ }
      } else {
        const res = await fetch(`${API_URL}/v1/me/saved`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ entity_type: entityType, discogs_id: discogsId, list_type: "favorite" }),
        });
        if (!res.ok) {
          setSaved(previousSaved);
          return;
        }
        try { trackFavoriteToggled(entityType, discogsId, true); } catch { /* no-op */ }
      }
    } catch {
      setSaved(previousSaved);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, loading, saved, getToken, router, pathname, entityType, discogsId]);

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      className={styles.btn}
      data-saved={String(saved)}
      aria-label={saved ? "Remove from favorites" : "Add to favorites"}
      title={saved ? "Remove from favorites" : "Add to favorites"}
    >
      {saved ? "♥" : "♡"}
    </button>
  );
}
