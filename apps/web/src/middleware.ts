import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAllowedPath, MAINTENANCE_MODE } from "@/lib/maintenance";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
