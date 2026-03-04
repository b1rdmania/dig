import Link from "next/link";
import styles from "./Empty.module.css";

const SUGGESTIONS = [
  { q: "Aphex Twin", label: "Aphex Twin" },
  { q: "Blue Note", label: "Blue Note" },
  { q: "Radiohead OK Computer", label: "OK Computer" },
  { q: "Warp Records", label: "Warp Records" },
  { q: "Miles Davis", label: "Miles Davis" },
  { q: "Burial Untrue", label: "Burial — Untrue" },
];

export function Empty({ message }: { message?: string }) {
  if (message) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.message}>{message}</p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.suggestions}>
        <span className={styles.tryLabel}>Try</span>
        {SUGGESTIONS.map((s) => (
          <Link key={s.q} href={`/?q=${encodeURIComponent(s.q)}`} className={styles.chip}>
            {s.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
