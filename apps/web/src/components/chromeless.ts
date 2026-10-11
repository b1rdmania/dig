/**
 * Routes that own their whole page: no Dig footer, no home link.
 * Decided by the route segment, not the URL: on winebore.app the URL is "/"
 * (host rewrite to /winebore), so a pathname check disagrees between server
 * and client and breaks hydration. The segment is the same on both.
 */
export const CHROMELESS_SEGMENTS: ReadonlySet<string> = new Set(["recordbore", "winebore"]);
