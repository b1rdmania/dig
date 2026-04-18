"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clearTrail, readTrail, subscribeTrail, trailHrefFor, type TrailItem } from "@/lib/trail";
import styles from "./TrailBar.module.css";

const KIND_GLYPH: Record<TrailItem["kind"], string> = {
  label: "label",
  artist: "artist",
  master: "release",
  scene: "scene",
};

const VISIBLE = 6;

export function TrailBar() {
  const pathname = usePathname();
  const [items, setItems] = useState<TrailItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setItems(readTrail());
    return subscribeTrail(() => setItems(readTrail()));
  }, []);

  // Re-read trail on route changes — TrailRecorder pushes happen during the
  // mount of the new page, so by the time pathname has settled we want fresh
  // data.
  useEffect(() => {
    if (!mounted) return;
    // Defer one tick so any in-mount pushTrail call lands first.
    const t = setTimeout(() => setItems(readTrail()), 0);
    return () => clearTimeout(t);
  }, [pathname, mounted]);

  if (!mounted || items.length === 0) return null;

  const visible = items.slice(-VISIBLE);

  return (
    <nav aria-label="Trail" className={styles.trail}>
      <span className={styles.label}>trail</span>
      <ol className={styles.items}>
        {visible.map((it, i) => {
          const isLast = i === visible.length - 1;
          return (
            <li key={`${it.kind}-${it.id}`} className={styles.item}>
              <Link
                href={trailHrefFor(it)}
                className={`${styles.link} ${isLast ? styles.linkCurrent : ""}`}
                title={`${KIND_GLYPH[it.kind]}: ${it.name}${it.subtitle ? ` — ${it.subtitle}` : ""}`}
              >
                <span className={styles.kind}>{KIND_GLYPH[it.kind]}</span>
                <span className={styles.name}>{it.name}</span>
              </Link>
              {!isLast && <span className={styles.sep} aria-hidden>›</span>}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className={styles.clear}
        onClick={() => clearTrail()}
        aria-label="Clear trail"
        title="Clear trail"
      >
        ×
      </button>
    </nav>
  );
}
