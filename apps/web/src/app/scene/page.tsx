import Link from "next/link";
import { digFetch, ApiRequestError } from "@/lib/api";
import type { ListScenesResponse } from "@/lib/types";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PageHeading } from "@/components/design";
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

// The list leads with the interesting shelves; the scenes everyone already
// knows sit further down.
const DEMOTE_TO = 6;
const OBVIOUS = new Set(["chicago-house"]);

function demoteObvious<T extends { slug: string }>(scenes: T[]): T[] {
  const kept = scenes.filter((s) => !OBVIOUS.has(s.slug));
  const demoted = scenes.filter((s) => OBVIOUS.has(s.slug));
  kept.splice(Math.min(DEMOTE_TO, kept.length), 0, ...demoted);
  return kept;
}

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
      <PageHeading title="Scenes." lede="The labels that defined an era." />

      <div className={styles.rows}>
        {demoteObvious(order.flatMap((axis) => grouped[axis] ?? [])).map((s) => {
          const era = formatEra(s.era_start, s.era_end);
          return (
            <Link key={s.slug} href={`/scene/${s.slug}`} className={styles.row}>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{s.name}</span>
                <span className={styles.rowMeta}>
                  {[s.city, era].filter(Boolean).join(" · ")}
                </span>
                {s.blurb && <span className={styles.rowBlurb}>{s.blurb}</span>}
              </span>
            </Link>
          );
        })}
      </div>

      <p className={`${styles.aside} ${styles.asideFoot}`}>
        We also built a drum-pattern generator from some of these scenes —{" "}
        <a href="https://ghost-pattern.pages.dev/" target="_blank" rel="noreferrer">try it</a>.
      </p>
    </div>
  );
}
