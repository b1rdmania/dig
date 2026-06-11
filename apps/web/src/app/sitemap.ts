import type { MetadataRoute } from "next";
import { MAINTENANCE_MODE } from "@/lib/maintenance";

/**
 * Core static pages sitemap.
 * Entity sitemaps (artists, releases, labels) are published in cohorts —
 * see docs/programmatic-seo-v1.md §8 for Wave 1 rollout plan.
 * While the maintenance gate is on, only the allowed routes are listed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://app.dig.baby";

  if (MAINTENANCE_MODE) {
    return [
      { url: base, changeFrequency: "weekly", priority: 1.0 },
      { url: `${base}/search`, changeFrequency: "weekly", priority: 0.8 },
      { url: `${base}/progress`, changeFrequency: "monthly", priority: 0.5 },
    ];
  }

  return [
    { url: base, changeFrequency: "weekly", priority: 1.0 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/feedback`, changeFrequency: "monthly", priority: 0.3 },
  ];
}
