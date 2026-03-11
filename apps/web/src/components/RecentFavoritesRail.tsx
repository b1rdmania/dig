"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { trackRecentFavoriteClicked } from "@/lib/analytics";
import styles from "./RecentFavoritesRail.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL ?? "https://dig-api.fly.dev";

interface FavoriteItem {
  id: string;
  entity_type: "artist" | "release" | "version" | "label" | "track";
  discogs_id: number;
  name: string | null;
  artist: string | null;
  coverUrl: string | null;
}

function hrefForFavorite(entityType: string, discogsId: number): string | null {
  if (entityType === "artist") return `/artist/${discogsId}`;
  if (entityType === "label") return `/label/${discogsId}`;
  if (entityType === "release") return `/release/${discogsId}`;
  if (entityType === "version") return `/version/${discogsId}`;
  return null;
}

export function RecentFavoritesRail() {
  const { getToken, isSignedIn } = useAuth();
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isSignedIn) { setLoaded(true); return; }

    (async () => {
      try {
        const token = await getToken();
        if (!token) { setLoaded(true); return; }
        const res = await fetch(`${API_URL}/v1/me/saved?list_type=favorite&limit=8`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { setLoaded(true); return; }
        const data = await res.json() as { items?: FavoriteItem[] };
        setItems((data.items ?? []).slice(0, 8));
      } catch {
        // silent — rail is non-critical
      } finally {
        setLoaded(true);
      }
    })();
  }, [isSignedIn, getToken]);

  if (!loaded || !isSignedIn || items.length === 0) return null;

  return (
    <div className={styles.rail}>
      <p className={styles.label}>Recently saved</p>
      <div className={styles.pills}>
        {items.map((item, i) => {
          const href = hrefForFavorite(item.entity_type, item.discogs_id);
          const title = item.name ?? `${item.entity_type} #${item.discogs_id}`;
          if (!href) return null;
          return (
            <Link
              key={item.id}
              href={href}
              className={styles.pill}
              onClick={() => {
                try { trackRecentFavoriteClicked(item.entity_type, item.discogs_id, i); } catch { /* no-op */ }
              }}
            >
              {item.coverUrl && (
                <img src={item.coverUrl} alt="" className={styles.thumb} />
              )}
              <span className={styles.pillText}>{title}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
