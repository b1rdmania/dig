import { Suspense } from "react";
import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";
import { SearchContent } from "@/components/SearchContent";
import { SearchPreview } from "@/components/maintenance/SearchPreview";
import { MAINTENANCE_MODE } from "@/lib/maintenance";
import styles from "./page.module.css";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export const metadata = MAINTENANCE_MODE
  ? {
      title: "Search Preview — dig",
      description: "Preview the Dig search surface during the maintenance window.",
    }
  : {
      title: "Search — dig",
      description:
        "Search labels, artists, and records across the dig catalog (house & techno, 1988–2008).",
    };

export default async function SearchPage({ searchParams }: Props) {
  const resolved = await searchParams;
  const q = typeof resolved.q === "string" ? resolved.q.trim() : "";

  if (MAINTENANCE_MODE) {
    return <SearchPreview q={q} />;
  }

  return (
    <div className={styles.page}>
      {!q && (
        <header className={styles.pageHeader}>
          <h1 className={styles.heading}>Search the catalog.</h1>
          <p className={styles.lede}>
            Look up a label, an artist, or a record. Or skip the box and{" "}
            <Link href="/scene" className={styles.inlineLink}>
              browse by scene
            </Link>
            .
          </p>
        </header>
      )}
      <Suspense>
        <SearchBar />
        <div className={styles.resultsSlot}>
          <SearchContent searchParams={resolved} />
        </div>
      </Suspense>
    </div>
  );
}
