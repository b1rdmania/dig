import Link from "next/link";
import type { SearchResult } from "@/lib/types";
import { displayName, typeLabel } from "@/lib/format";
import styles from "./ResultCard.module.css";

interface Props {
  result: SearchResult;
}

function resultHref(result: SearchResult): string | null {
  // Only releases have detail pages in this scaffold
  if (result.type === "release") return `/release/${result.discogs_id}`;
  return null;
}

export function ResultCard({ result }: Props) {
  const href = resultHref(result);
  const content = (
    <>
      <span className={styles.badge}>{typeLabel(result.type)}</span>
      <span className={styles.name}>{displayName(result)}</span>
      {result.year && <span className={styles.year}>{result.year}</span>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={styles.card}>
        {content}
      </Link>
    );
  }

  return <div className={styles.card}>{content}</div>;
}
