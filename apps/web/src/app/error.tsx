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
            fontSize: "0.8rem",
            color: "var(--link)",
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
