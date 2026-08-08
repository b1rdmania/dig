export async function register() {
  // No-op: placeholder for future OpenTelemetry or other SDK init.
  // Outbound concurrency is bounded in lib/api.ts, not here — configuring an
  // undici Agent from instrumentation means importing the `undici` package,
  // whose index pulls in the mock/snapshot agent and breaks `next build` with
  // "UnhandledSchemeError: Reading from node:fs/promises". serverExternalPackages
  // does not cover the instrumentation bundle.
}

/**
 * Captures SSR render errors server-side with full request context.
 * Logs structured JSON so Fly log drain / manual grep can correlate
 * error digests (e.g. 3214993863) with exact route + request details.
 *
 * Stable in Next.js 15. Does NOT require any experimental flag.
 */
export function onRequestError(
  error: { digest?: string } & Error,
  request: {
    path: string;
    method: string;
    headers: Record<string, string>;
  },
  context: {
    routerKind: string;
    routePath?: string;
    routeType?: string;
    renderSource?: string;
    renderType?: string;
  },
): void {
  // Skip AbortError — these are expected timeouts, tracked separately
  if (error.name === "AbortError") return;

  console.error(
    JSON.stringify({
      event: "ssr_render_error",
      digest: error.digest,
      message: error.message,
      path: request.path,
      method: request.method,
      route_path: context.routePath,
      route_type: context.routeType,
      router_kind: context.routerKind,
      render_source: context.renderSource,
      render_type: context.renderType,
      request_id:
        request.headers["x-request-id"] ??
        request.headers["fly-request-id"] ??
        null,
      user_agent: request.headers["user-agent"] ?? null,
      ts: new Date().toISOString(),
    }),
  );
}
