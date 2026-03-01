"use client";

import { ErrorMessage } from "@/components/ErrorMessage";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ maxWidth: "var(--max-width)", margin: "0 auto", padding: "2rem 1rem" }}>
      <ErrorMessage message={error.message || "Something went wrong"} />
      <div style={{ textAlign: "center", marginTop: "1rem" }}>
        <button
          onClick={reset}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.7rem",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--accent-light)",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            padding: "0.5rem 1rem",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
