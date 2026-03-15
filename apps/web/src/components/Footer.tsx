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
        <Link href="/about" prefetch={false} className={styles.link}>About</Link>
        <Link href="/mcp" prefetch={false} className={styles.link}>MCP setup</Link>
        <Link href="/llm-beta" prefetch={false} className={styles.link}>LLM beta</Link>
        <Link href="/progress" prefetch={false} className={styles.link}>How we built</Link>
        <Link href="/usage" prefetch={false} className={styles.link}>Usage</Link>
        <Link href="/feedback" prefetch={false} className={styles.link}>Report a bug</Link>
        <a href="https://github.com/b1rdmania/dig" target="_blank" rel="noreferrer" className={styles.link}>GitHub</a>
      </div>
    </footer>
  );
}
