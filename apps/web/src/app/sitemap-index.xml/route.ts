import { buildSitemapIndexXml, xmlResponse } from "@/lib/sitemap-xml";

export const revalidate = 86400;

const BASE = "https://app.dig.baby";

export async function GET() {
  return xmlResponse(
    buildSitemapIndexXml([
      `${BASE}/sitemap.xml`,
      `${BASE}/sitemap-artists.xml`,
      `${BASE}/sitemap-releases.xml`,
      `${BASE}/sitemap-releases-2.xml`,
      `${BASE}/sitemap-releases-3.xml`,
      `${BASE}/sitemap-releases-4.xml`,
      `${BASE}/sitemap-labels.xml`,
    ]),
  );
}
