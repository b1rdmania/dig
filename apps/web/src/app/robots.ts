import type { MetadataRoute } from "next";

/**
 * Crawl policy.
 *
 * The catalog is ~80k master pages plus artist and label pages, all
 * server-rendered against dig-api. An unthrottled crawler walking entity IDs
 * is the single cheapest way to take the site down — on 2026-08-07 dig-web
 * wedged under exactly that traffic shape (lax/iad/gru hitting /artist/<id>,
 * /label/<id>, /master/<id>) while running one 1GB machine.
 *
 * Policy:
 *   - Googlebot and Bingbot: unrestricted. This is the traffic we want, and
 *     the sitemaps give them the canonical list so they don't guess IDs.
 *     Google ignores crawl-delay regardless; Bing honours it, so it gets an
 *     explicit rule rather than falling through to the throttled default.
 *   - Assistant crawlers (GPTBot, ClaudeBot, PerplexityBot): allowed. They
 *     refer real people, and agent reachability is deliberate here.
 *   - Bulk extractors (Bytespider, CCBot, Amazonbot, Omgili, Diffbot):
 *     blocked. They take the whole catalog and send nothing back.
 *   - Everything else: allowed at crawl-delay 10.
 *
 * crawl-delay is not part of MetadataRoute.Robots, hence the cast — Next
 * serialises unknown keys through to robots.txt as-is.
 */

const BULK_EXTRACTORS = [
  "Bytespider",
  "CCBot",
  "Amazonbot",
  "Omgili",
  "Omgilibot",
  "Diffbot",
];

type Rule = MetadataRoute.Robots["rules"];

export default function robots(): MetadataRoute.Robots {
  const rules = [
    { userAgent: ["Googlebot", "Googlebot-Image"], allow: "/" },
    { userAgent: "Bingbot", allow: "/", crawlDelay: 5 },
    {
      userAgent: ["GPTBot", "ClaudeBot", "Claude-User", "PerplexityBot"],
      allow: "/",
      crawlDelay: 5,
    },
    ...BULK_EXTRACTORS.map((userAgent) => ({ userAgent, disallow: "/" })),
    { userAgent: "*", allow: "/", crawlDelay: 10 },
  ] as unknown as Rule;

  return {
    rules,
    sitemap: "https://app.dig.baby/sitemap-index.xml",
    host: "https://app.dig.baby",
  };
}
