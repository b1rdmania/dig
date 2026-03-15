import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/design-lab", "/design-lab/"],
    },
    sitemap: "https://app.dig.baby/sitemap-index.xml",
  };
}
