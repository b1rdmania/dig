"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import styles from "./HomeLink.module.css";

/**
 * The site has no header — this is the one piece of wayfinding chrome at
 * the top of every page except home itself.
 *
 * Top-level pages get "← home". Dug-in entity pages (label, artist,
 * master, a scene) get "← back · home": back keeps the loop out of a dig
 * returning to wherever you came from — the list, search results, another
 * record — and home is the escape hatch when you've dug too deep to care.
 */
const DEEP_RE = /^\/(label|artist|master|release)\/.|^\/scene\/./;

export function HomeLink() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === "/") return null;
  // Record Bore is his own page with his own chrome (mock-spec masthead).
  if (pathname === "/recordbore") return null;

  if (DEEP_RE.test(pathname)) {
    return (
      <div className={styles.wrap}>
        <button
          type="button"
          className={styles.link}
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push("/");
          }}
        >
          ← back
        </button>
        <span className={styles.sep} aria-hidden>·</span>
        <Link href="/" className={styles.link}>home</Link>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <Link href="/" className={styles.link}>← home</Link>
    </div>
  );
}
