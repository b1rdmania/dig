"use client";

import styles from "./FavoriteButton.module.css";

interface Props {
  entityType: "artist" | "label" | "release" | "version";
  discogsId: number;
}

export function FavoriteButton(_props: Props) {
  return (
    <button
      type="button"
      disabled
      className={styles.btn}
      data-saved="false"
      aria-label="Favorites removed"
      title="Favorites removed"
    >
      ♡
    </button>
  );
}
