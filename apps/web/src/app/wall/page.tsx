import { Suspense } from "react";
import Link from "next/link";
import { ApiRequestError } from "@/lib/api";
import { fetchAllSceneWalls } from "@/lib/wall";
import { CatalogWall } from "@/components/wall";
import { ErrorMessage } from "@/components/ErrorMessage";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Catalog Wall — dig",
  description:
    "The Dig catalog rendered as a wall: every curated scene, every label, every record. House and techno, 1988–2008.",
  openGraph: {
    title: "The catalog, as a wall — dig",
    description:
      "Every scene, every label, every release in scope. House and techno, 1988–2008.",
    images: [{ url: "/api/og?kind=wall", width: 1200, height: 630, alt: "Dig — catalog wall" }],
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "The catalog, as a wall — dig",
    description:
      "Every scene, every label, every release in scope. House and techno, 1988–2008.",
    images: ["/api/og?kind=wall"],
  },
};

interface Props {
  searchParams: Promise<{ density?: string; per_label?: string }>;
}

async function WallContent({ density, perLabel }: { density: "compact" | "medium" | "full"; perLabel: number | null }) {
  try {
    const scenes = await fetchAllSceneWalls(density, perLabel);
    if (scenes.length === 0) {
      return <ErrorMessage message="No scenes loaded" />;
    }
    return <CatalogWall scenes={scenes} density={density} />;
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return <ErrorMessage code={err.code} message={err.message} />;
    }
    return <ErrorMessage message="Failed to load the wall" />;
  }
}

export default async function WallPage({ searchParams }: Props) {
  const sp = await searchParams;
  const density = sp.density === "medium" || sp.density === "full" ? sp.density : "compact";
  const perLabel = sp.per_label ? Math.max(1, Math.min(200, parseInt(sp.per_label, 10) || 0)) || null : null;

  return (
    <div className={styles.pageWrap}>
      <header className={styles.pageHeader}>
        <div className={styles.eyebrow}>[ wall ] · catalog · v0.1</div>
        <h1 className={styles.heading}>The catalog, as a wall.</h1>
        <p className={styles.lede}>
          Every scene, every label, every release in scope. Strips read top-down,
          earliest first. Click a label to drop into its full catalog. Click a
          scene title to read it as an essay.
        </p>
        <div className={styles.toolbar}>
          <DensityChip current={density} value="compact" />
          <DensityChip current={density} value="medium" />
          <DensityChip current={density} value="full" />
          <span className={styles.toolbarSep}>·</span>
          <Link href="/scene" className={styles.toolbarLink}>
            Browse scenes →
          </Link>
        </div>
      </header>

      <Suspense fallback={<div className={styles.loading}>Loading wall…</div>}>
        <WallContent density={density} perLabel={perLabel} />
      </Suspense>
    </div>
  );
}

function DensityChip({ current, value }: { current: string; value: "compact" | "medium" | "full" }) {
  const active = current === value;
  return (
    <Link
      href={value === "compact" ? "/wall" : `/wall?density=${value}`}
      className={`${styles.chip} ${active ? styles.chipActive : ""}`}
    >
      {value}
    </Link>
  );
}
