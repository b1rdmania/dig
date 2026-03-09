import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "dig (beta)",
  description: "music search, fixed.",
  metadataBase: new URL("https://app.dig.baby"),
  openGraph: {
    title: "dig (beta)",
    siteName: "dig",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <Suspense fallback={null}>
            <Nav />
          </Suspense>
          <main>
            {children}
          </main>
          <Footer />
        </ClerkProvider>
      </body>
    </html>
  );
}
