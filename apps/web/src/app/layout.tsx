import type { Metadata, Viewport } from "next";
import { Playfair_Display, DM_Mono, DM_Sans } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

const dmMono = DM_Mono({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const dmSans = DM_Sans({
  weight: "300",
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dig — Music Data Layer",
  description: "Search 24M+ records from the Discogs CC0 dataset",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0a07",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${dmMono.variable} ${dmSans.variable}`}
    >
      <body>
        <Nav />
        <main style={{ padding: "1rem" }}>{children}</main>
      </body>
    </html>
  );
}
