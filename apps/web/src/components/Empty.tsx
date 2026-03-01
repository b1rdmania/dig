export function Empty({ message }: { message?: string }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "4rem 1rem",
        maxWidth: "var(--max-width)",
        margin: "0 auto",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: "1.2rem",
          color: "var(--warm-mid)",
          marginBottom: "0.5rem",
        }}
      >
        {message || "Search the catalog"}
      </p>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.7rem",
          color: "var(--warm-mid)",
          opacity: 0.6,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        24M+ records from the Discogs CC0 dataset
      </p>
    </div>
  );
}
