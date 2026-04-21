import Link from "next/link";
import { digFetch, ApiRequestError } from "@/lib/api";
import type { ListScenesResponse } from "@/lib/types";
import { ErrorMessage } from "@/components/ErrorMessage";
import styles from "./page.module.css";

export const metadata = {
  title: "Scenes — dig",
  description:
    "Curated scenes that map house and techno from 1988 to 2008 — Detroit Core, Berlin Techno, Chicago House, Dub Techno and more.",
  openGraph: {
    title: "Scenes — dig",
    description:
      "Curated scenes that map house and techno from 1988 to 2008 — Detroit Core, Berlin Techno, Chicago House, Dub Techno and more.",
    images: [{ url: "/api/og?kind=wall", width: 1200, height: 630, alt: "Dig — scenes" }],
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Scenes — dig",
    description:
      "Curated scenes that map house and techno from 1988 to 2008.",
    images: ["/api/og?kind=wall"],
  },
};

export const revalidate = 600;

const AXIS_LABEL: Record<string, string> = {
  geography: "scene",
  cluster: "cluster",
  sound: "sound",
  era: "era",
  bridge: "bridge",
  micro: "micro",
};

function formatEra(start: number | null, end: number | null): string | null {
  if (start == null && end == null) return null;
  if (start != null && end != null) return `${start}–${end}`;
  if (start != null) return `${start}–`;
  if (end != null) return `?–${end}`;
  return null;
}

export default async function ScenesIndexPage() {
  let data: ListScenesResponse;
  try {
    data = await digFetch<ListScenesResponse>("/v1/scenes", { revalidate: 600 });
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return <ErrorMessage code={err.code} message={err.message} />;
    }
    return <ErrorMessage message="Failed to load scenes" />;
  }

  const grouped: Record<string, typeof data.scenes> = {};
  for (const s of data.scenes) {
    grouped[s.axis] = grouped[s.axis] ?? [];
    grouped[s.axis].push(s);
  }
  const order: Array<keyof typeof grouped> = ["geography", "cluster", "sound", "era", "bridge", "micro"];

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.eyebrow}>[ scenes ] · v0.1</div>
        <h1 className={styles.heading}>Scenes.</h1>
        <p className={styles.lede}>
          Curated entry points to the catalog. Each scene gathers the labels
          that defined a city, a sound, or a moment. Click in to see the wall;
          click a label to drop into its full discography.
        </p>
        <div className={styles.toolbar}>
          <Link href="/wall" className={styles.toolbarLink}>
            ← View the whole wall
          </Link>
        </div>
      </header>

      {order.map((axis) => {
        const scenes = grouped[axis];
        if (!scenes || scenes.length === 0) return null;
        return (
          <section key={axis} className={styles.axisSection}>
            <h2 className={styles.axisHeading}>{AXIS_LABEL[axis] ?? axis}</h2>
            <div className={styles.cards}>
              {scenes.map((s) => {
                const era = formatEra(s.era_start, s.era_end);
                const accent = s.palette?.accent ?? "#1a1a1a";
                return (
                  <Link
                    key={s.slug}
                    href={`/scene/${s.slug}`}
                    className={styles.card}
                    style={{ "--card-accent": accent } as React.CSSProperties}
                  >
                    <div className={styles.cardAccent} aria-hidden />
                    <div className={styles.cardBody}>
                      <h3 className={styles.cardTitle}>{s.name}</h3>
                      <div className={styles.cardMeta}>
                        {s.city && <span>{s.city}</span>}
                        {s.city && era && <span className={styles.cardSep}>·</span>}
                        {era && <span className={styles.cardEra}>{era}</span>}
                      </div>
                      {s.blurb && <p className={styles.cardBlurb}>{s.blurb}</p>}
                      <div className={styles.cardFooter}>
                        <span>{s.label_count} {s.label_count === 1 ? "label" : "labels"}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
