"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import styles from "./SaveButton.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL ?? "https://dig-api.fly.dev";

interface Props {
  entityType: "artist" | "release" | "version" | "label" | "track";
  discogsId: number;
  listType?: "favorite" | "want";
  initialSaved?: boolean;
  /** Label for upgrade CTA — if not provided, upgrade prompt is generic */
  upgradeContext?: string;
  className?: string;
}

export function SaveButton({
  entityType,
  discogsId,
  listType = "favorite",
  initialSaved = false,
  upgradeContext,
  className,
}: Props) {
  const { isSignedIn } = useUser();
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  async function toggle() {
    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }
    if (loading) return;
    setLoading(true);
    setShowUpgrade(false);

    try {
      if (saved) {
        const res = await fetch(`${API_URL}/v1/me/saved/${listType}/${entityType}/${discogsId}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (res.status === 204 || res.ok) setSaved(false);
      } else {
        const res = await fetch(`${API_URL}/v1/me/saved`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ entity_type: entityType, discogs_id: discogsId, list_type: listType }),
        });
        if (res.status === 403) {
          setShowUpgrade(true);
        } else if (res.ok) {
          setSaved(true);
        }
      }
    } catch {
      // no-op — silent failure on network error
    } finally {
      setLoading(false);
    }
  }

  const label = listType === "want" ? "want" : "favourite";
  const icon = listType === "want" ? "♡" : "♥";
  const iconSaved = listType === "want" ? "♥" : "♥";

  return (
    <span className={`${styles.wrap} ${className ?? ""}`}>
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        className={styles.btn}
        data-saved={String(saved)}
        data-list={listType}
        aria-label={saved ? `Remove from ${label}s` : `Add to ${label}s`}
        title={saved ? `Remove from ${label}s` : `Add to ${label}s`}
      >
        {saved ? iconSaved : icon}
      </button>
      {showUpgrade && (
        <span className={styles.upgradeTip}>
          {upgradeContext ?? `${listType === "want" ? "Want list" : "Favourites"} require Early Access.`}{" "}
          <a href="/account" className={styles.upgradeLink}>Upgrade →</a>
        </span>
      )}
    </span>
  );
}
