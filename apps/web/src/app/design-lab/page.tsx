import Link from "next/link";

export const metadata = {
  title: "Design Lab — dig",
  description: "Isolated design variants for rapid visual testing.",
};

const links = [
  { href: "/design-lab/live", label: "Live data pages (search/artist/release)" },
  { href: "/design-lab/variant-2", label: "Variant 2" },
  { href: "/design-lab/variant-3", label: "Variant 3" },
  { href: "/design-lab/variant-4", label: "Variant 4" },
  { href: "/design-lab/variant-5", label: "Variant 5" },
];

export default function DesignLabIndex() {
  return (
    <main style={{ padding: "2rem 1.5rem", maxWidth: "720px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Design Lab</h1>
      <p style={{ opacity: 0.8, marginBottom: "1.25rem" }}>
        Isolated template variants. No impact on production flows.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.75rem" }}>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} style={{ textDecoration: "underline" }}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
