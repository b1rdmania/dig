import { NextResponse } from "next/server";

/**
 * Liveness probe for the Fly health check on dig-web.
 *
 * Deliberately shallow: it proves this Next.js process is up and still able
 * to serve a route, nothing more. It does NOT call dig-api or the database.
 * A deep check would couple the frontend's health to the API's, so an API
 * outage would make Fly kill and restart otherwise-healthy web machines —
 * turning a partial outage into a total one. The API has its own check on
 * /v1/health.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: "dig-web" },
    { headers: { "cache-control": "no-store" } },
  );
}
