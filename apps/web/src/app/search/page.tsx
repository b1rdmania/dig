import { Suspense } from "react";
import Link from "next/link";
import { SearchContent } from "@/components/SearchContent";
import { IncrementalSearchWrapper } from "@/components/IncrementalSearchWrapper";
import styles from "./page.module.css";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export const metadata = {
  title: "Search — dig",
  description:
    "Search labels, artists, and releases across the dig catalog (house & techno, 1988–2008).",
};

export default async function SearchPage({ searchParams }: Props) {
  const resolved = await searchParams;
  const q = typeof resolved.q === "string" ? resolved.q : "";

  return (
    <div className={styles.page}>
      {!q && (
        <header className={styles.pageHeader}>
          <div className={styles.eyebrow}>[ search ] · catalog · v0.2</div>
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
        <IncrementalSearchWrapper>
          <SearchContent searchParams={resolved} />
        </IncrementalSearchWrapper>
      </Suspense>
    </div>
  );
}
