import type { ReleaseCredit } from "@/lib/types";
import styles from "./Credits.module.css";

interface Props {
  credits: ReleaseCredit[];
}

export function Credits({ credits }: Props) {
  if (credits.length === 0) return null;

  // Group by role
  const grouped = new Map<string, string[]>();
  for (const c of credits) {
    const role = c.role || "Other";
    const names = grouped.get(role) || [];
    names.push(c.artist_name);
    grouped.set(role, names);
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Credits</h2>
      {Array.from(grouped.entries()).map(([role, names]) => (
        <div key={role} className={styles.group}>
          <div className={styles.role}>{role}</div>
          <div className={styles.names}>{names.join(", ")}</div>
        </div>
      ))}
    </section>
  );
}
