import type { ReactNode } from "react";
import styles from "./Empty.module.css";

export function Empty({ message, children }: { message?: string; children?: ReactNode }) {
  if (!message) return null;

  return (
    <div className={styles.wrapper}>
      <p className={styles.message}>{message}</p>
      {children}
    </div>
  );
}
