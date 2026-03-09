import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AccountClient } from "./AccountClient";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL ?? "https://dig-api.fly.dev";

interface Entitlements {
  plan: string;
  llm_beta_access: boolean;
  monthly_request_limit: number;
  rpm_limit: number;
  features: Record<string, boolean>;
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

  const entitlements = token ? await getEntitlements(token) : null;
  const checkoutStatus = params.checkout ?? null;

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
    />
  );
}
