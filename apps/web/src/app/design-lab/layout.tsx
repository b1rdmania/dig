import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function DesignLabDisabledLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  void children;
  notFound();
}
