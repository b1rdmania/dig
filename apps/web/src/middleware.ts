import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_FILE = /\.[^/]+$/;
const ALLOWED_ROUTES = new Set(["/", "/search", "/progress"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    ALLOWED_ROUTES.has(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    PUBLIC_FILE.test(pathname)
  ) {
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
