"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  early_access: "Early Access",
  team: "Team",
};

export function AccountClient({
  displayName,
  imageUrl,
  email,
  plan,
  llmBetaAccess,
  features,
  monthlyRequestLimit,
  checkoutStatus,
}: Props) {
  const router = useRouter();
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
        <div className={styles.banner}>
          Welcome to Early Access. Your plan is now active.
        </div>
      )}
      {checkoutStatus === "cancel" && (
        <div className={styles.bannerMuted}>Checkout cancelled — your plan is unchanged.</div>
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
          {!isEarlyAccess && (
            <span className={styles.rpmNote}>500 req/month · 20 req/min</span>
          )}
          {isEarlyAccess && (
            <span className={styles.rpmNote}>{monthlyRequestLimit.toLocaleString()} req/month</span>
          )}
        </div>

        {!isEarlyAccess && (
          <div className={styles.upgrade}>
            <p className={styles.upgradeText}>
              Early Access — £5/month. Includes AI music assistant, favourites, want list, and higher limits.
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

        {isEarlyAccess && (
          <ul className={styles.featureList}>
            <li className={styles.featureItem} data-on={String(llmBetaAccess)}>
              {llmBetaAccess ? "✓" : "–"} Ask Dig (AI assistant)
            </li>
            <li className={styles.featureItem} data-on={String(features.favorites ?? false)}>
              {features.favorites ? "✓" : "–"} Favourites
            </li>
            <li className={styles.featureItem} data-on={String(features.wantlist ?? false)}>
              {features.wantlist ? "✓" : "–"} Want list
            </li>
          </ul>
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
