export type LinkProvider = "bandcamp" | "instagram";

export interface LinkoutCandidate {
  provider: LinkProvider;
  url: string;
  handle: string | null;
  confidence: number;
  matchMethod: string;
}

function normalize(input: string): URL | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    if (u.pathname !== "/") {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u;
  } catch {
    return null;
  }
}

function firstPathSegment(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  return parts[0] || null;
}

function normalizeHandle(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return null;
  if (!/^[a-z0-9._-]+$/.test(cleaned)) return null;
  return cleaned;
}

export function extractLabelLinkout(url: string): LinkoutCandidate | null {
  const parsed = normalize(url);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  if (host.endsWith("bandcamp.com")) {
    // Accept label/store roots or subdomains.
    const subdomain = host.replace(/\.bandcamp\.com$/, "");
    const pathHandle = normalizeHandle(firstPathSegment(parsed.pathname));
    const handle = subdomain && subdomain !== "bandcamp" ? normalizeHandle(subdomain) : pathHandle;
    if (!handle) return null;
    const canonical = `https://${handle}.bandcamp.com`;
    return {
      provider: "bandcamp",
      url: canonical,
      handle,
      confidence: 1.0,
      matchMethod: "discogs_label_url_exact_domain",
    };
  }

  if (host === "instagram.com") {
    const segment = firstPathSegment(parsed.pathname);
    const reserved = new Set([
      "p",
      "reel",
      "explore",
      "accounts",
      "about",
      "developer",
      "privacy",
      "legal",
      "direct",
    ]);
    if (!segment || reserved.has(segment.toLowerCase())) return null;
    const handle = normalizeHandle(segment);
    if (!handle) return null;
    return {
      provider: "instagram",
      url: `https://instagram.com/${handle}`,
      handle,
      confidence: 0.98,
      matchMethod: "discogs_label_url_exact_domain",
    };
  }

  return null;
}
