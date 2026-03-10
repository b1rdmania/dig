"use client";

import { useState } from "react";
import { SignOutButton } from "@clerk/nextjs";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL ?? "https://dig-api.fly.dev";

interface Props {
  displayName: string;
  imageUrl: string | null;
  email: string;
  plan: string;
  llmBetaAccess: boolean;
  features: Record<string, boolean>;
  monthlyRequestLimit: number;
  checkoutStatus: string | null;
  favorites: Array<{
    id: string;
    entity_type: "artist" | "release" | "version" | "label" | "track";
    discogs_id: number;
    list_type: "favorite" | "want";
    created_at: string;
    name: string | null;
    artist: string | null;
    coverUrl: string | null;
  }>;
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  early_access: "Early Access",
  team: "Team",
};

function hrefForFavorite(entityType: string, discogsId: number): string | null {
  if (entityType === "artist") return `/artist/${discogsId}`;
  if (entityType === "label") return `/label/${discogsId}`;
  if (entityType === "release") return `/release/${discogsId}`;
  if (entityType === "version") return `/version/${discogsId}`;
  return null;
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
  favorites,
}: Props) {
  const [tab, setTab] = useState<"crates" | "mixtapes">("crates");
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

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

  const isEarlyAccess = plan === "early_access" || plan === "team";

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
        <button
          type="button"
          className={styles.tab}
          data-active={String(tab === "crates")}
          onClick={() => setTab("crates")}
        >
          Your Crates
        </button>
        <button
          type="button"
          className={styles.tab}
          data-active={String(tab === "mixtapes")}
          onClick={() => setTab("mixtapes")}
        >
          Mixtapes
        </button>
      </div>

      {tab === "crates" && (
        <section className={styles.section}>
          {favorites.length === 0 ? (
            <p className={styles.emptyText}>Nothing saved yet. Tap ♡ on any artist, release, or label.</p>
          ) : (
            <ul className={styles.savedList}>
              {favorites.map((item) => {
                const href = hrefForFavorite(item.entity_type, item.discogs_id);
                const title = item.name ?? `${item.entity_type} #${item.discogs_id}`;
                return (
                  <li key={item.id} className={styles.savedItem}>
                    <div className={styles.savedThumb}>
                      {item.coverUrl ? (
                        <img src={item.coverUrl} alt="" className={styles.savedThumbImg} />
                      ) : (
                        <div className={styles.savedThumbPlaceholder} />
                      )}
                    </div>
                    <div className={styles.savedInfo}>
                      {href ? (
                        <a href={href} className={styles.savedLink}>{title}</a>
                      ) : (
                        <span className={styles.savedText}>{title}</span>
                      )}
                      {item.artist && (
                        <span className={styles.savedArtist}>{item.artist}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "mixtapes" && (
        <section className={styles.section}>
          <p className={styles.comingSoon}>Mixtapes coming soon.</p>
          <p className={styles.emptyText}>
            Create a mixtape, add tracks, and export to Spotify or Apple Music.
          </p>
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
              Early Access — £5/month. Includes the Dig AI assistant, want list, crates, and higher limits.
            </p>
            {upgradeError && <p className={styles.errorText}>{upgradeError}</p>}
            <button
              className={styles.upgradeBtn}
              onClick={startUpgrade}
              disabled={upgrading}
              type="button"
            >
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
