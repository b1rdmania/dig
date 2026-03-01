import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.logo}>Dig</div>
      <div className={styles.note}>
        Early stage. Building in public. dig.baby{" · "}
        <a href="https://dig.baby/whitepaper">Technical white paper</a>
      </div>
    </footer>
  );
}
