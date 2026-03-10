import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";

// Use unprefixed env var so key is read at runtime, not baked in at build time.
// Set CLERK_PUBLISHABLE_KEY as a Fly secret — no rebuild needed for rotation.
const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? "";

// Routes that require authentication
const isProtectedRoute = createRouteMatcher(["/account(.*)"]);

const clerk = clerkMiddleware(
  async (auth, req) => {
    if (isProtectedRoute(req)) {
      await auth.protect();
    }
  },
  { publishableKey: publishableKey || undefined },
);

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (!publishableKey) return NextResponse.next();
  return clerk(req, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
