import type { ReactNode } from "react";
import { Newsreader, Archivo_Narrow, IBM_Plex_Mono } from "next/font/google";

// The Bore's own typography (whitepaper §7 P4): Newsreader for voice and
// display, Archivo Narrow for the NTS-style strip, Plex Mono for data. Loaded
// route-scoped so the rest of dig stays on its single-family system.
const serif = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--rb-serif",
});
const cond = Archivo_Narrow({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--rb-cond",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--rb-mono",
});

export default function RecordBoreLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${serif.variable} ${cond.variable} ${mono.variable}`}>
      {children}
    </div>
  );
}
