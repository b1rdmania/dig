import type { Metadata } from "next";
import { LlmBetaClient } from "./LlmBetaClient";

export const metadata: Metadata = {
  title: "LLM Beta — dig",
  description: "Private LLM beta tester for Dig. Key-gated ask endpoint demo.",
};

export default function LlmBetaPage() {
  return <LlmBetaClient />;
}
