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
  themeColor: "#f2eee5",
};

const OPENER_QUOTES = [
  "Anyway. What do you want? And don’t say Daft Punk - the answer’s Roulé and we both know it.",
  "Mind the boxes. Browsing is fine, buying is better, asking is best.",
  "Don’t lean on that rack. Ask me something worth dropping the needle for.",
  "You’ve got the look of someone about to say ‘deep house’. Be more specific.",
  "Kettle’s just gone on. Make it quick or make it interesting.",
  "The good stuff isn’t in the window. It never is. Go on then.",
  "I was in the middle of refiling the 12-inches, so this had better be good.",
  "If you heard it on an advert, the door’s behind you. Otherwise - speak.",
];

export default function RecordBorePage() {
  const opener = OPENER_QUOTES[Math.floor(Math.random() * OPENER_QUOTES.length)];
  return <RecordBoreClient opener={opener} />;
}
