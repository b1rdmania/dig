"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Footer.module.css";

export function Footer() {
  const pathname = usePathname();
  // The pilot page is instructions only — no chrome at all.
  if (pathname === "/russ") return null;
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <nav className={styles.links} aria-label="Footer">
          <Link href="/" prefetch={false} className={styles.link}>Home</Link>
          <Link href="/faq" prefetch={false} className={styles.link}>FAQ</Link>
          <a
            href="https://github.com/b1rdmania/dig"
            target="_blank"
            rel="noreferrer"
            className={styles.link}
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
