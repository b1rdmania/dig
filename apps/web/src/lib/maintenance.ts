/**
 * Maintenance-mode gate. While true, middleware redirects everything except
 * ALLOWED_ROUTES (+ /api, /_next, static files) to "/", and sitemaps only
 * advertise the allowed routes. Flip to false at relaunch.
 */
export const MAINTENANCE_MODE = false;

const PUBLIC_FILE = /\.[^/]+$/;

export const ALLOWED_ROUTES = new Set(["/", "/search", "/progress"]);

export function isAllowedPath(pathname: string): boolean {
  return (
    ALLOWED_ROUTES.has(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    PUBLIC_FILE.test(pathname)
  );
}
