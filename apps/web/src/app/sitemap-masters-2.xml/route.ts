import { buildUrlsetXml, xmlResponse } from "@/lib/sitemap-xml";
import { MAINTENANCE_MODE } from "@/lib/maintenance";
import { API_URL, apiKeyHeaders } from "@/lib/server-env";

export const revalidate = 86400;

const BASE = "https://app.dig.baby";
const SHARD_LIMIT = 50000;
const SHARD_OFFSET = 50000;

export async function GET() {
  if (MAINTENANCE_MODE) return xmlResponse(buildUrlsetXml([]));

  try {
    const res = await fetch(
      `${API_URL}/v1/seo/cohort?type=releases&limit=${SHARD_LIMIT}&offset=${SHARD_OFFSET}`,
      {
        headers: apiKeyHeaders(),
        signal: AbortSignal.timeout(120_000),
      },
    );
    const data = res.ok ? ((await res.json()) as { ids: number[] }) : { ids: [] };

    const entries = data.ids.map((id) => ({
      loc: `${BASE}/master/${id}`,
      changefreq: "monthly",
      priority: 0.8,
    }));

    return xmlResponse(buildUrlsetXml(entries));
  } catch {
    return xmlResponse(buildUrlsetXml([]));
  }
}
