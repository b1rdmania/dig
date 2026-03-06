import type { MetadataRoute } from "next";

/**
 * Core static pages sitemap.
 * Entity sitemaps (artists, releases, labels) are published in cohorts —
 * see docs/programmatic-seo-v1.md §8 for Wave 1 rollout plan.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://app.dig.baby";
  return [
    { url: base, changeFrequency: "weekly", priority: 1.0 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/feedback`, changeFrequency: "monthly", priority: 0.3 },
  ];
}
