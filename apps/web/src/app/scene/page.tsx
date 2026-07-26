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
        <h1 className={styles.heading}>Scenes.</h1>
        <p className={styles.lede}>
          Each scene gathers the labels that defined a city, a sound, or a moment.
        </p>
        <p className={styles.aside}>
          We also built a drum-pattern generator from some of these scenes —{" "}
          <a href="https://ghost-pattern.pages.dev/" target="_blank" rel="noreferrer">try it</a>.
        </p>
      </header>

      {order.map((axis) => {
        const scenes = grouped[axis];
        if (!scenes || scenes.length === 0) return null;
        return (
          <section key={axis} className={styles.axisSection}>
            <h2 className={styles.axisHeading}>{AXIS_LABEL[axis] ?? axis}</h2>
            <div className={styles.rows}>
              {scenes.map((s) => {
                const era = formatEra(s.era_start, s.era_end);
                const accent = s.palette?.accent ?? "#1a1a1a";
                return (
                  <Link
                    key={s.slug}
                    href={`/scene/${s.slug}`}
                    className={styles.row}
                    style={{ "--card-accent": accent } as React.CSSProperties}
                  >
                    <span className={styles.rowAccent} aria-hidden />
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>{s.name}</span>
                      <span className={styles.rowMeta}>
                        {[s.city, era].filter(Boolean).join(" · ")}
                      </span>
                      {s.blurb && <span className={styles.rowBlurb}>{s.blurb}</span>}
                    </span>
                    <span className={styles.rowCount}>
                      {s.label_count} {s.label_count === 1 ? "label" : "labels"}
                    </span>
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
