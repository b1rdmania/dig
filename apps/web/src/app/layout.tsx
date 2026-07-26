import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { IBM_Plex_Sans, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-sans-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-body",
  display: "swap",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400"],
  style: ["italic", "normal"],
  variable: "--font-serif-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "dig — house and techno, 1988–2008",
  description:
    "A curated catalog of house and techno from 1988 to 2008 — the labels, the records, the scenes that built the form.",
  metadataBase: new URL("https://app.dig.baby"),
  openGraph: {
    title: "dig — house and techno, 1988–2008",
    description:
      "A curated catalog of house and techno from 1988 to 2008 — the labels, the records, the scenes that built the form.",
    siteName: "dig",
    locale: "en_US",
    images: [
      {
        url: "/api/og?kind=home",
        width: 1200,
        height: 630,
        alt: "dig — house and techno, 1988–2008",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "dig — house and techno, 1988–2008",
    description:
      "A curated catalog of house and techno from 1988 to 2008 — the labels, the records, the scenes that built the form.",
    images: ["/api/og?kind=home"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f1e8",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${serif.variable}`}
      style={{
        // Bind next/font CSS variables to the design-system aliases so any
        // `var(--font-sans)` reference picks up the loaded webfont.
        // Stacks fall back to the system fonts already declared in
        // globals.css if the webfont is still loading.
        ["--font-sans" as string]:
          `var(--font-sans-body), -apple-system, BlinkMacSystemFont, "Söhne", Inter, system-ui, sans-serif`,
        ["--font-mono" as string]:
          `var(--font-mono-body), ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace`,
        ["--font-serif" as string]:
          `var(--font-serif-body), "Iowan Old Style", Charter, Georgia, "Times New Roman", serif`,
      }}
    >
      <body>
        <Suspense fallback={null}>
          <Nav />
        </Suspense>
        <main>
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
