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

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  };

  const onSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const params = new URLSearchParams();
    const trimmed = q.trim();
    if (trimmed) params.set("q", trimmed);
    router.push(params.toString() ? `/?${params.toString()}` : "/");
  };

  return (
    <nav className={styles.nav}>
      <div className={styles.left}>
        <button type="button" onClick={goBack} className={styles.backBtn}>
          Back
        </button>
        <Link href="/" className={styles.logo}>
          DIG
        </Link>
      </div>
      {pathname !== "/" ? (
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
      <ul className={styles.links}>
        <li>
          <Link
            href="/"
            className={`${styles.link} ${pathname === "/" ? styles.linkActive : ""}`}
          >
            Search
          </Link>
        </li>
        <li>
          <a href="https://dig.baby/" className={styles.link}>
            Home
          </a>
        </li>
        <li>
          <a href="https://dig.baby/whitepaper" className={styles.link}>
            Tech Paper
          </a>
        </li>
        <li>
          <a href="https://dig.baby/progress" className={styles.link}>
            Progress
          </a>
        </li>
      </ul>
    </nav>
  );
}
