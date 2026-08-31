import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAllowedPath, MAINTENANCE_MODE } from "@/lib/maintenance";
import { hit, isThrottledPath } from "@/lib/throttle";

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("fly-client-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isThrottledPath(pathname)) {
    const ip = clientIp(request);
    // Sampled request log (1 in 20) so a crawl can be attributed by UA/IP.
    // Both prior bot incidents (2026-08-07, 2026-08-31) stalled at "probably
    // a crawler" because nothing on the request path recorded a user-agent.
    if (Math.random() < 0.05) {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          code: "ENTITY_REQ",
          ip,
          ua: request.headers.get("user-agent") ?? "",
          path: pathname,
        }),
      );
    }
    const result = hit(ip);
    if (!result.allowed) {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          code: "ENTITY_THROTTLE",
          ip,
          ua: request.headers.get("user-agent") ?? "",
          path: pathname,
          retry_after: result.retryAfterSec,
        }),
      );
      return new NextResponse("Too many requests — slow down.", {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfterSec),
          "Cache-Control": "no-store",
        },
      });
    }
  }

  if (!MAINTENANCE_MODE || isAllowedPath(pathname)) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/";
  redirectUrl.search = "";

  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
