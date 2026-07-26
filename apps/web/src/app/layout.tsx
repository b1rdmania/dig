import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { Footer } from "@/components/Footer";
import { HomeLink } from "@/components/HomeLink";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-sans-body",
  display: "swap",
});


export const metadata: Metadata = {
  title: "Dig. Beta.",
  description: "House and techno, 1988–2008. Browse the catalog or ask it for records.",
  metadataBase: new URL("https://app.dig.baby"),
  openGraph: {
    title: "Dig. Beta.",
    description: "House and techno, 1988–2008. Browse the catalog or ask it for records.",
    siteName: "dig",
    locale: "en_US",
    images: [
      {
        url: "/api/og?kind=home",
        width: 1200,
        height: 630,
        alt: "Dig. Beta. — house and techno, 1988–2008",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dig. Beta.",
    description: "House and techno, 1988–2008. Browse the catalog or ask it for records.",
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
      className={sans.variable}
      style={{
        // One family. Every design-system alias resolves to the sans stack;
        // --font-mono-data (system monospace) survives solely for the Ask
        // Dig workings log. No serif, no mono webfonts.
        ["--font-sans" as string]:
          `var(--font-sans-body), -apple-system, BlinkMacSystemFont, "Söhne", Inter, system-ui, sans-serif`,
        ["--font-mono" as string]:
          `var(--font-sans-body), -apple-system, BlinkMacSystemFont, "Söhne", Inter, system-ui, sans-serif`,
        ["--font-mono-data" as string]:
          `ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace`,
        ["--font-serif" as string]:
          `var(--font-sans-body), -apple-system, BlinkMacSystemFont, "Söhne", Inter, system-ui, sans-serif`,
      }}
    >
      <body>
        <main>
          <HomeLink />
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
