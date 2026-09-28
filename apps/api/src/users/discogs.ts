// ---------------------------------------------------------------------------
// Discogs OAuth 1.0a and the two lists Record Bore reads (wantlist,
// collection). Discogs accepts the PLAINTEXT signature over HTTPS, so a
// signature is just "consumer_secret&token_secret" - no base string, no HMAC.
// https://www.discogs.com/developers/#page:authentication,header:authentication-oauth-flow
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";

const API = "https://api.discogs.com";
export const AUTHORIZE_URL = "https://www.discogs.com/oauth/authorize";
const UA = "DigRecordBore/1.0 +https://app.dig.baby";
const TIMEOUT_MS = 10_000;

export interface Consumer {
  key: string;
  secret: string;
}

export function consumerFromEnv(): Consumer | null {
  const key = String(process.env.DISCOGS_CONSUMER_KEY ?? "").trim();
  const secret = String(process.env.DISCOGS_CONSUMER_SECRET ?? "").trim();
  return key && secret ? { key, secret } : null;
}

export function oauthHeader(consumer: Consumer, extra: Record<string, string>, tokenSecret = ""): string {
  const params: Record<string, string> = {
    oauth_consumer_key: consumer.key,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "PLAINTEXT",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...extra,
    oauth_signature: `${consumer.secret}&${tokenSecret}`,
  };
  return "OAuth " + Object.entries(params)
    .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
    .join(", ");
}

async function discogs(path: string, init: RequestInit & { auth: string }): Promise<Response> {
  const { auth, ...rest } = init;
  return fetch(`${API}${path}`, {
    ...rest,
    headers: {
      "User-Agent": UA,
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function formOrThrow(res: Response, step: string): Promise<URLSearchParams> {
  const text = await res.text();
  if (!res.ok) throw new Error(`discogs ${step} ${res.status}: ${text.slice(0, 200)}`);
  return new URLSearchParams(text);
}

export async function getRequestToken(consumer: Consumer, callbackUrl: string): Promise<{ token: string; secret: string }> {
  const res = await discogs("/oauth/request_token", {
    method: "GET",
    auth: oauthHeader(consumer, { oauth_callback: callbackUrl }),
  });
  const form = await formOrThrow(res, "request_token");
  const token = form.get("oauth_token");
  const secret = form.get("oauth_token_secret");
  if (!token || !secret) throw new Error("discogs request_token: missing token");
  return { token, secret };
}

export async function getAccessToken(
  consumer: Consumer,
  requestToken: string,
  requestSecret: string,
  verifier: string,
): Promise<{ token: string; secret: string }> {
  const res = await discogs("/oauth/access_token", {
    method: "POST",
    auth: oauthHeader(consumer, { oauth_token: requestToken, oauth_verifier: verifier }, requestSecret),
  });
  const form = await formOrThrow(res, "access_token");
  const token = form.get("oauth_token");
  const secret = form.get("oauth_token_secret");
  if (!token || !secret) throw new Error("discogs access_token: missing token");
  return { token, secret };
}

async function getJson(consumer: Consumer, token: string, secret: string, path: string): Promise<{ body: any; remaining: number }> {
  const res = await discogs(path, { method: "GET", auth: oauthHeader(consumer, { oauth_token: token }, secret) });
  if (!res.ok) throw new Error(`discogs GET ${path.split("?")[0]} ${res.status}`);
  const remaining = Number(res.headers.get("x-discogs-ratelimit-remaining") ?? 60);
  return { body: await res.json(), remaining };
}

export async function getIdentity(consumer: Consumer, token: string, secret: string): Promise<{ id: number; username: string }> {
  const { body } = await getJson(consumer, token, secret, "/oauth/identity");
  if (!body?.id || !body?.username) throw new Error("discogs identity: missing id/username");
  return { id: Number(body.id), username: String(body.username) };
}

export interface CrateRow {
  release_discogs_id: number;
  master_discogs_id: number | null;
  title: string;
  artist: string | null;
  label: string | null;
  year: number | null;
  styles: string[];
  added_at: Date | null;
}

// Discogs disambiguates duplicate names with a " (2)" suffix; the shop doesn't.
const cleanName = (s: unknown) => String(s ?? "").replace(/\s\(\d+\)$/, "").trim();

export function toCrateRow(item: any): CrateRow | null {
  const b = item?.basic_information;
  const id = Number(b?.id ?? item?.id);
  if (!b || !Number.isFinite(id) || id <= 0) return null;
  const master = Number(b.master_id);
  const year = Number(b.year);
  return {
    release_discogs_id: id,
    master_discogs_id: Number.isFinite(master) && master > 0 ? master : null,
    title: String(b.title ?? "").slice(0, 300),
    artist: Array.isArray(b.artists) && b.artists.length ? b.artists.map((a: any) => cleanName(a?.name)).filter(Boolean).join(", ").slice(0, 300) : null,
    label: Array.isArray(b.labels) && b.labels.length ? cleanName(b.labels[0]?.name).slice(0, 200) || null : null,
    year: Number.isFinite(year) && year > 0 ? year : null,
    styles: Array.isArray(b.styles) ? b.styles.map(String).slice(0, 12) : [],
    added_at: item?.date_added ? new Date(item.date_added) : null,
  };
}

// 100 per page, 20 pages: 2,000 records a list. Discogs allows 60 signed
// requests a minute, so one full sync (both lists) fits inside it.
export const PAGE_SIZE = 100;
export const MAX_PAGES = 20;

export async function fetchList(
  consumer: Consumer,
  token: string,
  secret: string,
  username: string,
  list: "want" | "collection",
): Promise<CrateRow[]> {
  const base = list === "want"
    ? `/users/${encodeURIComponent(username)}/wants`
    : `/users/${encodeURIComponent(username)}/collection/folders/0/releases`;
  const rows: CrateRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { body, remaining } = await getJson(consumer, token, secret, `${base}?per_page=${PAGE_SIZE}&page=${page}&sort=added&sort_order=desc`);
    const items: unknown[] = (list === "want" ? body?.wants : body?.releases) ?? [];
    for (const it of items) {
      const row = toCrateRow(it);
      if (row) rows.push(row);
    }
    const pages = Number(body?.pagination?.pages ?? 1);
    if (page >= pages || items.length === 0) break;
    // Nearly out of the minute's allowance: wait it out rather than 429.
    if (remaining <= 3) await new Promise((r) => setTimeout(r, 60_000));
  }
  return rows;
}
