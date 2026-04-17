import Link from "next/link";
import { NotFoundTracker } from "@/components/NotFoundTracker";

export default function NotFound() {
  return (
    <div style={{ textAlign: "center", padding: "4rem 1rem", maxWidth: "480px", margin: "0 auto" }}>
      <NotFoundTracker />
      <p style={{ fontSize: "0.75rem", color: "var(--fg-faint)", marginBottom: "1rem", letterSpacing: "0.05em" }}>
        404
      </p>
      <h1 style={{ fontSize: "1.1rem", fontWeight: 500, color: "var(--fg)", marginBottom: "0.5rem" }}>
        Page not found
      </h1>
      <p style={{ fontSize: "0.875rem", color: "var(--fg-muted)", marginBottom: "2rem" }}>
        This link may be outdated or the entry doesn't exist in the catalog.
      </p>
      <Link
        href="/"
        style={{
          display: "inline-block",
          padding: "0.45rem 1rem",
          background: "var(--fg)",
          color: "var(--bg)",
          borderRadius: "var(--radius)",
          fontSize: "0.875rem",
          textDecoration: "none",
          marginBottom: "2rem",
        }}
      >
        Search dig
      </Link>
      <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
        <Link href="/artist/3840" style={{ fontSize: "0.8rem", color: "var(--fg-muted)", textDecoration: "underline", textUnderlineOffset: "2px" }}>
          Radiohead
        </Link>
        <Link href="/master/21004" style={{ fontSize: "0.8rem", color: "var(--fg-muted)", textDecoration: "underline", textUnderlineOffset: "2px" }}>
          OK Computer
        </Link>
        <Link href="/label/281" style={{ fontSize: "0.8rem", color: "var(--fg-muted)", textDecoration: "underline", textUnderlineOffset: "2px" }}>
          Blue Note
        </Link>
      </div>
    </div>
  );
}
