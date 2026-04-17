import Link from "next/link";
import styles from "./RosterColumn.module.css";

export interface RosterRow {
  artist_discogs_id: number;
  name: string;
  master_count: number;
  first_year: number | null;
  last_year: number | null;
}

interface Props {
  rows: RosterRow[];
  title?: string;
  /** When > maxVisible, the rest get tucked behind a "+ N more" affordance. */
  maxVisible?: number;
}

/**
 * The label-page roster column. Top artists by # of in-scope masters on
 * the label, with first–last year span. The component itself does not
 * collapse — it just renders the supplied rows; the page is responsible
 * for slicing.
 */
export function RosterColumn({ rows, title = "Roster", maxVisible = 12 }: Props) {
  if (rows.length === 0) return null;
  const visible = rows.slice(0, maxVisible);
  const overflow = rows.length - visible.length;

  return (
    <aside className={styles.roster} aria-label={title}>
      <h3 className={styles.heading}>{title}</h3>
      <ul className={styles.list}>
        {visible.map((row) => {
          const span = formatYearSpan(row.first_year, row.last_year);
          return (
            <li key={row.artist_discogs_id} className={styles.row}>
              <Link href={`/artist/${row.artist_discogs_id}`} className={styles.name}>
                {row.name}
              </Link>
              <span className={styles.meta}>
                <span className={styles.count}>{row.master_count}</span>
                <span className={styles.metaSep}> · </span>
                <span className={styles.span}>{span}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {overflow > 0 && (
        <div className={styles.overflow}>+ {overflow} more on the roster</div>
      )}
    </aside>
  );
}

function formatYearSpan(first: number | null, last: number | null): string {
  if (first == null && last == null) return "—";
  if (first == null) return `–${last}`;
  if (last == null) return `${first}–`;
  if (first === last) return String(first);
  return `${first}–${String(last).slice(-2)}`;
}
