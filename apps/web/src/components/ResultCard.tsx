import Link from "next/link";
import type { SearchResult } from "@/lib/types";
import { displayName, typeLabel } from "@/lib/format";
import styles from "./ResultCard.module.css";

interface Props {
  result: SearchResult;
}

function resultHref(result: SearchResult): string | null {
  if (result.type === "release") return `/release/${result.discogs_id}`;
  if (result.type === "master") return `/master/${result.discogs_id}`;
  if (result.type === "artist") return `/artist/${result.discogs_id}`;
  return null;
}

export function ResultCard({ result }: Props) {
  const href = resultHref(result);
  const subtitleParts: string[] = [];
  if (result.type === "release" || result.type === "master") {
    if (result.year) subtitleParts.push(String(result.year));
    if (result.country) subtitleParts.push(result.country);
  }

  const content = (
    <>
      <span className={styles.badge}>{typeLabel(result.type)}</span>
      <div className={styles.main}>
        <span className={styles.name}>{displayName(result)}</span>
        {subtitleParts.length > 0 && (
          <span className={styles.subtitle}>{subtitleParts.join(" • ")}</span>
        )}
      </div>
      {result.year && (result.type === "artist" || result.type === "label") && (
        <span className={styles.year}>{result.year}</span>
      )}
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
