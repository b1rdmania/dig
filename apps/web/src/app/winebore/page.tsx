import type { Metadata, Viewport } from "next";
import { WineBoreClient } from "./WineBoreClient";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";

export const metadata: Metadata = {
  title: "Wine Bore.",
  description: "Ask.",
  openGraph: {
    title: "Wine Bore.",
    description: "Ask.",
    type: "website",
    images: [{ url: "/api/og?kind=winebore", width: 1200, height: 630, alt: "Wine Bore. Ask." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Wine Bore.",
    description: "Ask.",
    images: ["/api/og?kind=winebore"],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

// Dark launch: the page is rebuilt on request so the opener is a fresh
// bottle each time. No ISR - there is no link to this page anywhere yet.
export const dynamic = "force-dynamic";

const FALLBACK_OPENER =
  "If you’ve come in to say “smooth”, the door’s behind you. Otherwise - go on.";

async function getOpener(): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/v1/wine/opener`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return FALLBACK_OPENER;
    const data = await res.json() as { text?: string };
    return data.text || FALLBACK_OPENER;
  } catch {
    return FALLBACK_OPENER;
  }
}

export default async function WineBorePage() {
  const opener = await getOpener();
  return <WineBoreClient opener={opener} />;
}
