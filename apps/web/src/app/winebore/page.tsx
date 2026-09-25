import type { Metadata, Viewport } from "next";
import { WineBoreClient } from "./WineBoreClient";


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

export default function WineBorePage() {
  return <WineBoreClient />;
}
