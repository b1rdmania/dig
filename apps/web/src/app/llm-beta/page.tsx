import type { Metadata } from "next";
import { LlmBetaClient } from "./LlmBetaClient";

export const metadata: Metadata = {
  title: "Dig. AI Chat.",
  description: "Chat music, get suggestions, playlists, Discogs links. Private beta.",
};

export default function LlmBetaPage() {
  return <LlmBetaClient />;
}
