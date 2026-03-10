import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AccountClient } from "./AccountClient";

// Use internal Fly network URL server-side for lower latency
const API_URL = process.env.DIG_API_URL ?? process.env.NEXT_PUBLIC_DIG_API_URL ?? "https://dig-api.fly.dev";

interface Entitlements {
  plan: string;
  llm_beta_access: boolean;
  monthly_request_limit: number;
  rpm_limit: number;
  features: Record<string, boolean>;
}

type SavedEntityType = "artist" | "release" | "version" | "label" | "track";

interface SavedItem {
  id: string;
  entity_type: SavedEntityType;
  discogs_id: number;
  list_type: "favorite" | "want";
  created_at: string;
}

interface SavedItemsResponse {
  items: SavedItem[];
  count: number;
}

async function getEntitlements(token: string): Promise<Entitlements | null> {
  try {
    const res = await fetch(`${API_URL}/v1/billing/status`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<Entitlements>;
  } catch {
    return null;
  }
}

async function getFavorites(token: string): Promise<SavedItem[]> {
  try {
    const res = await fetch(`${API_URL}/v1/me/saved?list_type=favorite`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as SavedItemsResponse;
    return data.items ?? [];
  } catch {
    return [];
  }
}

async function resolveEntityName(entityType: SavedEntityType, discogsId: number): Promise<string | null> {
  try {
    const pathMap: Record<SavedEntityType, string> = {
      artist: `/v1/artists/${discogsId}`,
      label: `/v1/labels/${discogsId}`,
      release: `/v1/masters/${discogsId}`,
      version: `/v1/releases/${discogsId}`,
      track: `/v1/releases/${discogsId}`,
    };
    const res = await fetch(`${API_URL}${pathMap[entityType]}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, any>;
    return data.artist?.name ?? data.label?.name ?? data.master?.title ?? data.release?.title ?? null;
  } catch {
    return null;
  }
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  const [user, token, params] = await Promise.all([
    currentUser(),
    getToken(),
    searchParams,
  ]);

  const [entitlements, rawFavorites] = token
    ? await Promise.all([getEntitlements(token), getFavorites(token)])
    : [null, []];
  const checkoutStatus = params.checkout ?? null;

  // Resolve entity names in parallel (cap at 20 to avoid waterfall on large lists)
  const favorites = await Promise.all(
    rawFavorites.slice(0, 20).map(async (item) => ({
      ...item,
      name: await resolveEntityName(item.entity_type, item.discogs_id),
    }))
  );

  return (
    <AccountClient
      displayName={user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress ?? ""}
      imageUrl={user?.imageUrl ?? null}
      email={user?.emailAddresses?.[0]?.emailAddress ?? ""}
      plan={entitlements?.plan ?? "free"}
      llmBetaAccess={entitlements?.llm_beta_access ?? false}
      features={entitlements?.features ?? {}}
      monthlyRequestLimit={entitlements?.monthly_request_limit ?? 500}
      checkoutStatus={checkoutStatus}
      favorites={favorites}
    />
  );
}
