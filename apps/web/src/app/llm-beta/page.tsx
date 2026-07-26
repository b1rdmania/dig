import type { Metadata } from "next";
import { LlmBetaClient } from "./LlmBetaClient";

export const metadata: Metadata = {
  title: "Dig. Beta.",
  description: "Ask the catalog for records. Private beta.",
};

export default function LlmBetaPage() {
  return <LlmBetaClient />;
}
