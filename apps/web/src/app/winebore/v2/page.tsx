import type { Metadata, Viewport } from "next";
import { WineBoreV2 } from "./WineBoreV2";

export const metadata: Metadata = {
  title: "Wine Bore.",
  description: "Ask.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f8f6f1",
};
export default function Page() { return <WineBoreV2 />; }
