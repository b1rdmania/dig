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
            fontSize: "0.75rem",
            color: "red",
            marginBottom: "0.5rem",
          }}
        >
          {code}
        </p>
      )}
      <p style={{ color: "var(--fg)", fontSize: "0.95rem" }}>{message}</p>
    </div>
  );
}
