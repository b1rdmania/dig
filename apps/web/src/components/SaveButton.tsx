"use client";

import styles from "./SaveButton.module.css";

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
  listType = "favorite",
  className,
}: Props) {
  const label = listType === "want" ? "want" : "favourite";
  const icon = listType === "want" ? "♡" : "♥";

  return (
    <span className={`${styles.wrap} ${className ?? ""}`}>
      <button
        type="button"
        disabled
        className={styles.btn}
        data-saved="false"
        data-list={listType}
        aria-label={`${label}s removed`}
        title={`${label}s removed`}
      >
        {icon}
      </button>
    </span>
  );
}
