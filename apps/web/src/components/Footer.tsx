"use client";

import Link from "next/link";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import { CHROMELESS_SEGMENTS } from "./chromeless";
import styles from "./Footer.module.css";

export function Footer() {
  const pathname = usePathname();
  const segment = useSelectedLayoutSegment();
  // The pilot page is instructions only — no chrome at all.
  if (pathname === "/pilot") return null;
  // The Bores own their whole page. Decided by route segment so a host rewrite
  // (winebore.app serves /winebore at "/") cannot split server and client.
  if (segment && CHROMELESS_SEGMENTS.has(segment)) return null;
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <nav className={styles.links} aria-label="Footer">
          <Link href="/" prefetch={false} className={styles.link}>Home</Link>
          <Link href="/faq" prefetch={false} className={styles.link}>FAQ</Link>
          <Link href="/progress" prefetch={false} className={styles.link}>How we built it</Link>
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
