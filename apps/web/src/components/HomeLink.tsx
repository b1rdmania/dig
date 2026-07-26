"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./HomeLink.module.css";

/**
 * The site has no header — this is the one piece of wayfinding chrome:
 * a small "← home" at the top of every page except home itself and the
 * chrome-free pilot page.
 */
export function HomeLink() {
  const pathname = usePathname();
  if (pathname === "/" || pathname === "/pilot") return null;
  return (
    <div className={styles.wrap}>
      <Link href="/" className={styles.link}>← home</Link>
    </div>
  );
}
