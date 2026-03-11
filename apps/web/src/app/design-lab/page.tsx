import Link from "next/link";

export const metadata = {
  title: "Design Lab — dig",
  description: "Isolated design variants for rapid visual testing.",
};

const links = [
  {
    href: "/design-lab/live-v2",
    label: "Live v2 (wired) — NEW",
    status: "Live API",
    detail: "New Variant-Dig shell with real data across search/artist/release/version/label.",
  },
  {
    href: "/design-lab/variant-dig-desktop",
    label: "Variant Dig Desktop (imported)",
    status: "New import",
    detail: "Design-only import source (not directly wired).",
  },
  {
    href: "/design-lab/variant-dig-mobile",
    label: "Variant Dig Mobile (imported)",
    status: "New import",
    detail: "Design-only import source (not directly wired).",
  },
  {
    href: "/design-lab/live",
    label: "Live v1 (legacy shell)",
    status: "Legacy live",
    detail: "Older Variant3 live shell kept as fallback for side-by-side comparison.",
  },
  {
    href: "/design-lab/variant-2",
    label: "Variant 2",
    status: "Legacy static",
    detail: "Static concept page.",
  },
  {
    href: "/design-lab/variant-3",
    label: "Variant 3",
    status: "Legacy static",
    detail: "Static concept page.",
  },
  {
    href: "/design-lab/variant-4",
    label: "Variant 4",
    status: "Legacy static",
    detail: "Static concept page.",
  },
  {
    href: "/design-lab/variant-5",
    label: "Variant 5",
    status: "Legacy static",
    detail: "Static concept page.",
  },
];

export default function DesignLabIndex() {
  const live = links.filter((link) => link.status === "Live API");
  const imports = links.filter((link) => link.status === "New import");
  const legacy = links.filter((link) => link.status === "Legacy static" || link.status === "Legacy live");

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
    <main style={{ padding: "2rem 1.5rem", maxWidth: "760px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Design Lab</h1>
      <p style={{ opacity: 0.8, marginBottom: "0.5rem" }}>
        Isolated template variants. No impact on production flows.
      </p>
      <p style={{ opacity: 0.7, marginBottom: "1.25rem", fontSize: "0.9rem" }}>
        Progress: `Live v2 (wired)` is the current fully plugged test surface. Legacy routes are moved below.
      </p>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>Live Data Surfaces</h2>
        {renderLinks(live)}
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>New Imports (Design Only)</h2>
        {renderLinks(imports)}
      </section>

      <section>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>Legacy Static Variants</h2>
        {renderLinks(legacy)}
      </section>
    </main>
  );
}
