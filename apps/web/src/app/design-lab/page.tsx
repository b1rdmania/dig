import Link from "next/link";

export const metadata = {
  title: "Design Lab — dig",
  description: "Isolated design variants for rapid visual testing.",
};

const links = [
  {
    href: "/design-lab/variant-dig-desktop",
    label: "Variant Dig Desktop (imported)",
    status: "New import",
    detail: "Design-only import. Not wired to live API data yet.",
  },
  {
    href: "/design-lab/variant-dig-mobile",
    label: "Variant Dig Mobile (imported)",
    status: "New import",
    detail: "Design-only import. Not wired to live API data yet.",
  },
  {
    href: "/design-lab/live",
    label: "Live data pages (legacy shell)",
    status: "Live API",
    detail: "Uses older Variant3 live shell with real Dig data.",
  },
  {
    href: "/design-lab/variant-2",
    label: "Variant 2",
    status: "Legacy",
    detail: "Static concept page.",
  },
  {
    href: "/design-lab/variant-3",
    label: "Variant 3",
    status: "Legacy",
    detail: "Static concept page.",
  },
  {
    href: "/design-lab/variant-4",
    label: "Variant 4",
    status: "Legacy",
    detail: "Static concept page.",
  },
  {
    href: "/design-lab/variant-5",
    label: "Variant 5",
    status: "Legacy",
    detail: "Static concept page.",
  },
];

export default function DesignLabIndex() {
  const newImports = links.filter((link) => link.status === "New import");
  const live = links.filter((link) => link.status === "Live API");
  const legacy = links.filter((link) => link.status === "Legacy");

  function renderLinks(items: typeof links) {
    return (
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.85rem" }}>
        {items.map((link) => (
          <li key={link.href}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                <Link href={link.href} style={{ textDecoration: "underline" }}>
                  {link.label}
                </Link>
                <span
                  style={{
                    fontSize: "0.7rem",
                    opacity: 0.8,
                    border: "1px solid var(--line)",
                    borderRadius: "999px",
                    padding: "0.1rem 0.45rem",
                  }}
                >
                  {link.status}
                </span>
              </div>
              <span style={{ fontSize: "0.82rem", opacity: 0.65 }}>{link.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main style={{ padding: "2rem 1.5rem", maxWidth: "720px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Design Lab</h1>
      <p style={{ opacity: 0.8, marginBottom: "1.25rem" }}>
        Isolated template variants. No impact on production flows.
      </p>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>New Imports</h2>
        {renderLinks(newImports)}
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>Live Data (Current)</h2>
        {renderLinks(live)}
      </section>

      <section>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>Legacy Variants</h2>
        {renderLinks(legacy)}
      </section>
    </main>
  );
}
