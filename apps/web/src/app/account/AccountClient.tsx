"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { SignOutButton } from "@clerk/nextjs";
import { MixtapesTab } from "@/components/MixtapesTab";
import {
  trackFavoritesListViewed,
  trackFavoriteReopened,
  trackFavoriteRemoved,
  trackFavoritesBulkRemove,
} from "@/lib/analytics";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL ?? "https://dig-api.fly.dev";

interface FavoriteItem {
  id: string;
  entity_type: "artist" | "release" | "version" | "label" | "track";
  discogs_id: number;
  list_type: "favorite" | "want";
  created_at: string;
  name: string | null;
  artist: string | null;
  coverUrl: string | null;
}

interface Props {
  displayName: string;
  imageUrl: string | null;
  email: string;
  plan: string;
  llmBetaAccess: boolean;
  features: Record<string, boolean>;
  monthlyRequestLimit: number;
  checkoutStatus: string | null;
  favorites: FavoriteItem[];
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  early_access: "Early Access",
  team: "Team",
};

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "artist", label: "Artists" },
  { value: "release", label: "Releases" },
  { value: "version", label: "Versions" },
  { value: "label", label: "Labels" },
] as const;

type FilterType = (typeof FILTER_OPTIONS)[number]["value"];
type SortOrder = "newest" | "oldest" | "type";

function hrefForFavorite(entityType: string, discogsId: number): string | null {
  if (entityType === "artist") return `/artist/${discogsId}`;
  if (entityType === "label") return `/label/${discogsId}`;
  if (entityType === "release") return `/release/${discogsId}`;
  if (entityType === "version") return `/version/${discogsId}`;
  return null;
}

function applyFilterSort(
  items: FavoriteItem[],
  filter: FilterType,
  sort: SortOrder,
): FavoriteItem[] {
  let filtered = filter === "all" ? items : items.filter((i) => i.entity_type === filter);
  if (sort === "newest") {
    filtered = [...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at));
  } else if (sort === "oldest") {
    filtered = [...filtered].sort((a, b) => a.created_at.localeCompare(b.created_at));
  } else if (sort === "type") {
    filtered = [...filtered].sort((a, b) =>
      a.entity_type !== b.entity_type
        ? a.entity_type.localeCompare(b.entity_type)
        : (a.name ?? "").localeCompare(b.name ?? ""),
    );
  }
  return filtered;
}

export function AccountClient({
  displayName,
  imageUrl,
  email,
  plan,
  llmBetaAccess,
  features,
  monthlyRequestLimit,
  checkoutStatus,
  favorites: initialFavorites,
}: Props) {
  const { getToken } = useAuth();
  const [tab, setTab] = useState<"crates" | "mixtapes">("crates");
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  // Favorites state
  const [favorites, setFavorites] = useState<FavoriteItem[]>(initialFavorites);
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const listViewedRef = useRef(false);

  // Emit list-viewed event once when crates tab is active
  useEffect(() => {
    if (tab === "crates" && !listViewedRef.current) {
      listViewedRef.current = true;
      try { trackFavoritesListViewed(favorites.length); } catch { /* no-op */ }
    }
  }, [tab, favorites.length]);

  async function startUpgrade() {
    setUpgrading(true);
    setUpgradeError(null);
    try {
      const res = await fetch(`${API_URL}/v1/billing/checkout-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
      });
      const data = await res.json() as { url?: string; error?: { message: string } };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setUpgradeError(data.error?.message ?? "Checkout failed. Try again.");
        setUpgrading(false);
      }
    } catch {
      setUpgradeError("Network error. Try again.");
      setUpgrading(false);
    }
  }

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleRemoveSingle = useCallback(async (item: FavoriteItem) => {
    // Optimistic remove
    setFavorites((prev) => prev.filter((f) => f.id !== item.id));
    setSelected((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    try {
      const token = await getToken();
      if (!token) { setFavorites((prev) => [...prev, item]); return; }
      const res = await fetch(
        `${API_URL}/v1/me/saved/favorite/${item.entity_type}/${item.discogs_id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok && res.status !== 204) {
        setFavorites((prev) => [item, ...prev]);
      } else {
        try { trackFavoriteRemoved(item.entity_type, item.discogs_id, "account_list"); } catch { /* no-op */ }
      }
    } catch {
      setFavorites((prev) => [item, ...prev]);
    }
  }, [getToken]);

  const handleBulkRemove = useCallback(async () => {
    if (selected.size === 0 || removing) return;
    setRemoving(true);

    const toRemove = favorites.filter((f) => selected.has(f.id));
    // Optimistic
    setFavorites((prev) => prev.filter((f) => !selected.has(f.id)));
    setSelected(new Set());

    try {
      const token = await getToken();
      if (!token) { setFavorites((prev) => [...toRemove, ...prev]); return; }
      const results = await Promise.allSettled(
        toRemove.map((item) =>
          fetch(`${API_URL}/v1/me/saved/favorite/${item.entity_type}/${item.discogs_id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          }),
        ),
      );
      // Rollback any that failed
      const failed = toRemove.filter((_, i) => {
        const r = results[i];
        return r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok && r.value.status !== 204);
      });
      if (failed.length > 0) {
        setFavorites((prev) => [...failed, ...prev]);
      }
      const succeeded = toRemove.length - failed.length;
      if (succeeded > 0) {
        try { trackFavoritesBulkRemove(succeeded); } catch { /* no-op */ }
      }
    } catch {
      setFavorites((prev) => [...toRemove, ...prev]);
    } finally {
      setRemoving(false);
    }
  }, [selected, removing, favorites, getToken]);

  const isEarlyAccess = plan === "early_access" || plan === "team";
  const visible = applyFilterSort(favorites, filter, sort);

  return (
    <div className={styles.page}>
      {checkoutStatus === "success" && (
        <div className={styles.banner}>Welcome to Early Access. Your plan is now active.</div>
      )}
      {checkoutStatus === "cancel" && (
        <div className={styles.bannerMuted}>Checkout cancelled — your plan is unchanged.</div>
      )}

      {/* Tabs */}
      <div className={styles.tabs}>
        <button type="button" className={styles.tab} data-active={String(tab === "crates")} onClick={() => setTab("crates")}>
          Your Crates
        </button>
        <button type="button" className={styles.tab} data-active={String(tab === "mixtapes")} onClick={() => setTab("mixtapes")}>
          Mixtapes
        </button>
      </div>

      {tab === "crates" && (
        <section className={styles.section}>
          {/* Filter chips */}
          <div className={styles.filterChips}>
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={filter === opt.value ? styles.filterChipActive : styles.filterChip}
                onClick={() => { setFilter(opt.value); setSelected(new Set()); }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Sort + bulk actions row */}
          {favorites.length > 0 && (
            <div className={styles.sortRow}>
              <select
                className={styles.sortSelect}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOrder)}
              >
                <option value="newest">Newest saved</option>
                <option value="oldest">Oldest saved</option>
                <option value="type">By type</option>
              </select>
              {selected.size > 0 && (
                <button
                  type="button"
                  className={styles.bulkRemoveBtn}
                  onClick={handleBulkRemove}
                  disabled={removing}
                >
                  {removing ? "Removing..." : `Remove ${selected.size} selected`}
                </button>
              )}
            </div>
          )}

          {favorites.length === 0 ? (
            <p className={styles.emptyText}>No favorites yet. Save artists, releases, versions, or labels.</p>
          ) : visible.length === 0 ? (
            <p className={styles.emptyText}>No {filter}s saved yet.</p>
          ) : (
            <ul className={styles.savedList}>
              {visible.map((item) => {
                const href = hrefForFavorite(item.entity_type, item.discogs_id);
                const title = item.name ?? `${item.entity_type} #${item.discogs_id}`;
                const isSelected = selected.has(item.id);
                return (
                  <li key={item.id} className={styles.savedItem} data-selected={String(isSelected)}>
                    <input
                      type="checkbox"
                      className={styles.savedItemCheck}
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                      aria-label={`Select ${title}`}
                    />
                    <div className={styles.savedThumb}>
                      {item.coverUrl ? (
                        <img src={item.coverUrl} alt="" className={styles.savedThumbImg} />
                      ) : (
                        <div className={styles.savedThumbPlaceholder} />
                      )}
                    </div>
                    <div className={styles.savedInfo}>
                      {href ? (
                        <a
                          href={href}
                          className={styles.savedLink}
                          onClick={() => {
                            try { trackFavoriteReopened(item.entity_type, item.discogs_id, "account_list"); } catch { /* no-op */ }
                          }}
                        >
                          {title}
                        </a>
                      ) : (
                        <span className={styles.savedText}>{title}</span>
                      )}
                      {item.artist && <span className={styles.savedArtist}>{item.artist}</span>}
                      <span className={styles.savedType}>{item.entity_type}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.savedRemoveBtn}
                      onClick={() => handleRemoveSingle(item)}
                      aria-label={`Remove ${title}`}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "mixtapes" && (
        <section className={styles.section}>
          <MixtapesTab plan={plan} />
        </section>
      )}

      <section className={styles.section}>
        <p className={styles.eyebrow}>Account</p>
        <div className={styles.identity}>
          {imageUrl && <img src={imageUrl} alt="" className={styles.avatar} />}
          <div>
            <p className={styles.name}>{displayName}</p>
            <p className={styles.email}>{email}</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <p className={styles.label}>Plan</p>
        <div className={styles.planRow}>
          <span className={styles.planBadge} data-plan={plan}>
            {PLAN_LABELS[plan] ?? plan}
          </span>
          {isEarlyAccess && (
            <span className={styles.rpmNote}>{monthlyRequestLimit.toLocaleString()} req/month</span>
          )}
        </div>
        {!isEarlyAccess && (
          <div className={styles.upgrade}>
            <p className={styles.upgradeText}>
              Early Access — £5/month. Includes the Dig AI assistant, favourites, mixtapes, and higher limits.
            </p>
            {upgradeError && <p className={styles.errorText}>{upgradeError}</p>}
            <button className={styles.upgradeBtn} onClick={startUpgrade} disabled={upgrading} type="button">
              {upgrading ? "Redirecting..." : "Upgrade to Early Access →"}
            </button>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <SignOutButton redirectUrl="/">
          <button className={styles.signOut} type="button">Sign out</button>
        </SignOutButton>
      </section>
    </div>
  );
}
