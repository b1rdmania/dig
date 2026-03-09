"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./Nav.module.css";

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") || "");

  useEffect(() => {
    setQ(searchParams.get("q") || "");
  }, [searchParams]);

  const onSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const params = new URLSearchParams();
    const trimmed = q.trim();
    if (trimmed) params.set("q", trimmed);
    router.push(params.toString() ? `/?${params.toString()}` : "/");
  };

  const isSubpage = pathname !== "/";

  return (
    <nav className={styles.nav}>
      <div className={styles.left}>
        {isSubpage && (
          <button type="button" onClick={() => router.back()} className={styles.backBtn}>
            &larr;
          </button>
        )}
        <Link href="/" className={styles.logo}>
          DIG <span className={styles.beta}>[beta]</span>
        </Link>
        <Link href="/design-lab" className={styles.labLink}>
          Design Lab
        </Link>
      </div>
      {isSubpage ? (
        <form className={styles.searchForm} onSubmit={onSearchSubmit}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button className={styles.searchBtn} type="submit">
            Search
          </button>
        </form>
      ) : null}
    </nav>
  );
}
