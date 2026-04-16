"use client";

import styles from "./AddToMixtapeButton.module.css";

interface Props {
  sourceEntityType: "master" | "release";
  sourceDiscogsId: number;
  masterDiscogsId?: number | null;
  name?: string | null;
  artist?: string | null;
}

export function AddToMixtapeButton(_props: Props) {
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        disabled
        aria-label="Add to mixtape"
        aria-expanded="false"
      >
        + Mixtape
      </button>
    </div>
  );
}
