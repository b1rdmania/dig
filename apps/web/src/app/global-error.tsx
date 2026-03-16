"use client";

import { useEffect } from "react";

/**
 * Root-level error boundary — catches errors in the root layout.
 * Rendered outside the normal layout, so must include <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console so Fly log drain captures digest + message client-side too
    console.error(
      JSON.stringify({
        event: "global_error_boundary",
        digest: error.digest,
        message: error.message,
        path: typeof window !== "undefined" ? window.location.pathname : null,
        ts: new Date().toISOString(),
      }),
    );
  }, [error]);

  return (
    <html>
      <body
        style={{
          fontFamily: "monospace",
          background: "#0a0a0a",
          color: "#e5e5e5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ color: "#ff4444", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            RENDER_ERROR
            {error.digest ? ` · ${error.digest}` : ""}
          </p>
          <p style={{ fontSize: "0.875rem", marginBottom: "1.5rem" }}>
            Something went wrong loading this page.
          </p>
          <button
            onClick={reset}
            style={{
              fontSize: "0.8rem",
              color: "#e5e5e5",
              background: "transparent",
              border: "1px solid #333",
              borderRadius: "4px",
              padding: "0.5rem 1rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
