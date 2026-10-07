/**
 * Wine Bore has its own domain. dig-web serves winebore.app as a second host:
 * the root renders /winebore, assets and /api pass through, and every catalog
 * path goes back to app.dig.baby. On app.dig.baby, /winebore moves to the new
 * domain so the page has one home.
 */
export const WINE_BORE_HOST = "winebore.app";
export const DIG_ORIGIN = "https://app.dig.baby";

const PUBLIC_FILE = /\.[^/]+$/;

export type HostRoute =
  | { kind: "next" }
  | { kind: "rewrite"; pathname: string }
  | { kind: "redirect"; url: string };

export function routeHost(host: string | null, pathname: string, search = ""): HostRoute {
  const name = (host ?? "").split(":")[0].toLowerCase();

  if (name === `www.${WINE_BORE_HOST}`) {
    return { kind: "redirect", url: `https://${WINE_BORE_HOST}${pathname}${search}` };
  }

  if (name === WINE_BORE_HOST) {
    if (pathname === "/v2" || pathname === "/winebore/v2") return { kind: "redirect", url: `https://${WINE_BORE_HOST}/${search}` };
    if (pathname === "/") return { kind: "rewrite", pathname: "/winebore" };
    if (pathname === "/winebore") return { kind: "redirect", url: `https://${WINE_BORE_HOST}/${search}` };
    if (pathname.startsWith("/_next") || pathname.startsWith("/api") || PUBLIC_FILE.test(pathname)) {
      return { kind: "next" };
    }
    return { kind: "redirect", url: `${DIG_ORIGIN}${pathname}${search}` };
  }

  if (name === new URL(DIG_ORIGIN).hostname && (pathname === "/winebore" || pathname === "/winebore/v2")) {
    return { kind: "redirect", url: `https://${WINE_BORE_HOST}/${search}` };
  }

  return { kind: "next" };
}
