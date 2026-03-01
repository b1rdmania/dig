import styles from "./Skeleton.module.css";

export function SkeletonLine({ width }: { width?: "short" | "medium" }) {
  const cls = [
    styles.bone,
    styles.line,
    width === "short" ? styles.lineShort : width === "medium" ? styles.lineMedium : "",
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={cls} />;
}

export function SkeletonHeading() {
  return <div className={`${styles.bone} ${styles.heading}`} />;
}

export function SkeletonBlock() {
  return <div className={`${styles.bone} ${styles.block}`} />;
}
