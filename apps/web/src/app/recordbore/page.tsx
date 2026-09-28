import type { Metadata, Viewport } from "next";
import { RecordBoreClient } from "./RecordBoreClient";

export const metadata: Metadata = {
  title: "Record Bore.",
  description:
    "Ask about records. I’ll probably disagree. House and techno, 1988-2008.",
  openGraph: {
    title: "Record Bore.",
    description: "Ask before touching anything.",
    type: "website",
    images: [
      {
        url: "/api/og?kind=recordbore",
        width: 1200,
        height: 630,
        alt: "Record Bore - Go on then. House and techno only.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Record Bore.",
    description: "Ask before touching anything.",
    images: ["/api/og?kind=recordbore"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RecordBorePage() {
  return <RecordBoreClient />;
}
