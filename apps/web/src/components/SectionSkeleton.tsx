import styles from "./SectionSkeleton.module.css";

export function SectionSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className={styles.section}>
      <div className={styles.heading} />
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={styles.line}
          style={{ width: i === lines - 1 ? "60%" : undefined }}
        />
      ))}
    </div>
  );
}
