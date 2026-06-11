import { buildUrlsetXml, xmlResponse } from "@/lib/sitemap-xml";
import { MAINTENANCE_MODE } from "@/lib/maintenance";
import { API_URL, apiKeyHeaders } from "@/lib/server-env";

export const revalidate = 86400;

const BASE = "https://app.dig.baby";

export async function GET() {
  if (MAINTENANCE_MODE) return xmlResponse(buildUrlsetXml([]));

  try {
    const res = await fetch(`${API_URL}/v1/seo/cohort?type=artists&limit=5000`, {
      headers: apiKeyHeaders(),
      signal: AbortSignal.timeout(60_000),
    });
    const data = res.ok ? (await res.json()) as { ids: number[] } : { ids: [] };

    const entries = data.ids.map((id) => ({
      loc: `${BASE}/artist/${id}`,
      changefreq: "monthly",
      priority: 0.7,
    }));

    return xmlResponse(buildUrlsetXml(entries));
  } catch {
    return xmlResponse(buildUrlsetXml([]));
  }
}
