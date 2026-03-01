import Link from "next/link";
import styles from "./Nav.module.css";

export function Nav() {
  return (
    <nav className={styles.nav}>
      <Link href="/" className={styles.logo}>
        DIG
      </Link>
      <span className={styles.tagline}>Music data layer</span>
    </nav>
  );
}
