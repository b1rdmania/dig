"use client";

import { useEffect } from "react";
import { ErrorMessage } from "@/components/ErrorMessage";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        event: "error_boundary",
        digest: error.digest,
        message: error.message,
        path: typeof window !== "undefined" ? window.location.pathname : null,
        ts: new Date().toISOString(),
      }),
    );
  }, [error]);

  return (
    <div style={{ maxWidth: "var(--max-width)", margin: "0 auto 0 0", padding: "2rem 1rem" }}>
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
