import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.DIG_API_URL || "https://dig-api.fly.dev";
const API_KEY = process.env.DIG_API_KEY || "";

/**
 * Proxy route for future client-side search.
 * Keeps API key server-side while allowing client fetch.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const url = `${API_URL}/v1/search?${searchParams.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
      },
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: { code: "PROXY_ERROR", message: "Failed to reach API", details: null } },
      { status: 502 },
    );
  }
}
