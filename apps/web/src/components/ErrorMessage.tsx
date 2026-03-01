export function ErrorMessage({
  code,
  message,
}: {
  code?: string;
  message: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "2rem 1rem",
        maxWidth: "var(--max-width)",
        margin: "0 auto",
      }}
    >
      {code && (
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.65rem",
            color: "var(--danger)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: "0.5rem",
          }}
        >
          {code}
        </p>
      )}
      <p style={{ color: "var(--cream)", fontSize: "0.95rem" }}>{message}</p>
    </div>
  );
}
