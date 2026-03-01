"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Nav.module.css";

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      <Link href="/" className={styles.logo}>
        DIG
      </Link>
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
