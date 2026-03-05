import Link from "next/link";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.left}>
        <span className={styles.logo}>Dig</span>
        <span className={styles.note}>Early stage. Building in public.</span>
      </div>
      <div className={styles.links}>
        <a href="#" className={styles.link}>About</a>
        <Link href="/progress" className={styles.link}>How we built</Link>
      </div>
    </footer>
  );
}
