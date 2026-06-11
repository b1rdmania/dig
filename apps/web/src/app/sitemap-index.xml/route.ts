import { buildSitemapIndexXml, xmlResponse } from "@/lib/sitemap-xml";
import { MAINTENANCE_MODE } from "@/lib/maintenance";

export const revalidate = 86400;

const BASE = "https://app.dig.baby";

export async function GET() {
  // While the maintenance gate is on, entity pages redirect to "/" — only
  // advertise the static sitemap so crawlers never see blocked URLs.
  if (MAINTENANCE_MODE) {
    return xmlResponse(buildSitemapIndexXml([`${BASE}/sitemap.xml`]));
  }

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
