import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Keep the ISR cache in memory only (Next's LRU, capped at
   * cacheMaxMemorySize = 50MB by default). The default also writes every
   * rendered catalog page and fetch result to .next/cache on the machine's
   * root disk, which is never pruned. On 2026-10-23 a crawl of ~100k catalog
   * pages filled the disk (ENOSPC on every cache write). Cloudflare already
   * caches entity pages for 1h at the edge, so the disk copy bought little.
   */
  experimental: {
    isrFlushToDisk: false,
  },
  /**
   * Framework-level redirects for the master-first cutover.
   *
   * The legacy /release/:id route is permanently gone — every release ID now
   * resolves to its master via /master/:id (the master page itself does the
   * release_shadow lookup if the id turns out to be a pressing).
   *
   * /version/:id used to be the per-pressing detail page. The master page can
   * resolve its master via /v1/release_shadow/:id, but for crawler-friendly
   * speed we keep this as a 308 to /master/:id and let the master page
   * fall through to the shadow lookup as needed.
   *
   * These need to be at the framework level (not page-level
   * permanentRedirect) so Next emits a real 308 HTTP response instead of a
   * meta-refresh fallback when the layout has already started streaming.
   */
  async redirects() {
    return [
      {
        source: "/release/:id(\\d+)",
        destination: "/master/:id",
        permanent: true,
      },
      {
        source: "/version/:id(\\d+)",
        destination: "/master/:id",
        permanent: true,
      },
      // Pilot page moved off /russ — the old URL had a stale share-card
      // scrape cached by messengers; a fresh path gets a fresh scrape.
      {
        source: "/russ",
        destination: "/pilot",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
