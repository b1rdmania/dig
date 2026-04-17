export const dynamic = "force-dynamic";
import { buildSitemapIndexXml, xmlResponse } from "@/lib/sitemap-xml";

export const revalidate = 86400;

const BASE = "https://app.dig.baby";

export async function GET() {
  return xmlResponse(
    buildSitemapIndexXml([
      `${BASE}/sitemap.xml`,
      `${BASE}/sitemap-artists.xml`,
      `${BASE}/sitemap-masters.xml`,
      `${BASE}/sitemap-masters-2.xml`,
      `${BASE}/sitemap-labels.xml`,
    ]),
  );
}
