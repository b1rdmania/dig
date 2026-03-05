export function Empty({ message }: { message?: string }) {
  if (!message) return null;

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
          fontSize: "1.2rem",
          color: "var(--fg-muted)",
        }}
      >
        {message}
      </p>
    </div>
  );
}
