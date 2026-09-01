import type { ReactNode } from "react";
import { Newsreader, IBM_Plex_Mono } from "next/font/google";

// The Bore's own typography (design pass 2): one characterful serif for the
// Bore and his answers, one mono for metadata and UI. Loaded route-scoped so
// the rest of dig stays on its single-family system.
const serif = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--rb-serif",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--rb-mono",
});

export default function RecordBoreLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${serif.variable} ${mono.variable}`}>
      {children}
    </div>
  );
}
