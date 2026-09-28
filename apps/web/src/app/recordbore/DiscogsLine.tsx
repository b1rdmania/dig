"use client";

// Discogs sign-in for Record Bore: one muted line under the composer.
//
// The API hands the dig session back once, in the URL fragment of its
// callback redirect (#dig_session=...). It lives in localStorage and goes out
// as "Authorization: Bearer" on each ask. dig-api is a different site from
// app.dig.baby, so a cookie would be third-party and Safari would drop it.
//
// /v1/me answers 404 when sign-in is switched off on the API: the line hides.
// While sign-in is private, the signed-out line shows only on
// /recordbore?signin=1; NEXT_PUBLIC_SIGNIN_OPEN=on shows it to everyone.

import { useEffect, useState } from "react";
import s from "./recordbore.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";
const KEY = "dig_session";
const OPEN = process.env.NEXT_PUBLIC_SIGNIN_OPEN === "on";

export function readSession(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeSession(token: string | null) {
  try {
    if (token) window.localStorage.setItem(KEY, token);
    else window.localStorage.removeItem(KEY);
  } catch { /* private window: signed in for this page only */ }
}

/** Headers for an ask: the session when there is one. */
export function sessionHeaders(): Record<string, string> {
  const token = readSession();
  return token ? { authorization: `Bearer ${token}` } : {};
}

interface Me {
  username: string;
  wants: number;
  collection: number;
  syncing: boolean;
  sync_failed: boolean;
}

type State =
  | { kind: "off" }
  | { kind: "out"; note?: string }
  | { kind: "in"; me: Me };

async function fetchMe(): Promise<State> {
  const token = readSession();
  try {
    const res = await fetch(`${API_URL}/v1/me`, {
      cache: "no-store",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 404) return { kind: "off" };
    if (res.status === 401) {
      if (token) writeSession(null);
      return { kind: "out" };
    }
    if (!res.ok) return { kind: "off" };
    return { kind: "in", me: await res.json() as Me };
  } catch {
    return { kind: "off" };
  }
}

/** Take the session (or the failure) out of the fragment, then clear it. */
function takeFragment(): string | undefined {
  const hash = window.location.hash.slice(1);
  if (!hash) return undefined;
  const params = new URLSearchParams(hash);
  const token = params.get("dig_session");
  const signin = params.get("dig_signin");
  if (!token && !signin) return undefined;
  if (token) writeSession(token);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (signin === "failed") return "Discogs wouldn't let you in. Try again.";
  if (signin === "closed") return "Not open to everyone yet.";
  return undefined;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

export function DiscogsLine() {
  const [state, setState] = useState<State>({ kind: "off" });

  useEffect(() => {
    const note = takeFragment();
    const invited = OPEN || new URLSearchParams(window.location.search).get("signin") === "1";
    // Nothing to show a stranger: skip the round trip (and its 401).
    if (!invited && !note && !readSession()) return;
    void fetchMe().then((st) => {
      if (st.kind === "out" && !invited && !note) return setState({ kind: "off" });
      setState(st.kind === "out" && note ? { kind: "out", note } : st);
    });
  }, []);

  // While the lists come through, check back every few seconds.
  const syncing = state.kind === "in" && state.me.syncing;
  useEffect(() => {
    if (!syncing) return;
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      void fetchMe().then(setState);
      if (tries >= 40) window.clearInterval(id);
    }, 4000);
    return () => window.clearInterval(id);
  }, [syncing]);

  const signOut = async (forget: boolean) => {
    const headers = sessionHeaders();
    writeSession(null);
    setState({ kind: "out", note: forget ? "Forgotten. Your lists are gone from here." : undefined });
    await fetch(`${API_URL}/v1/me${forget ? "" : "/logout"}`, { method: forget ? "DELETE" : "POST", headers }).catch(() => {});
  };

  const retry = async () => {
    await fetch(`${API_URL}/v1/me/sync`, { method: "POST", headers: sessionHeaders() }).catch(() => {});
    setState((st) => (st.kind === "in" ? { kind: "in", me: { ...st.me, syncing: true, sync_failed: false } } : st));
  };

  if (state.kind === "off") return null;

  if (state.kind === "out") {
    const back = OPEN ? "/recordbore" : "/recordbore?signin=1";
    const href = `${API_URL}/v1/me/discogs/login?return=${encodeURIComponent(back)}`;
    return (
      <p className={s.cap}>
        {state.note ? `${state.note} ` : ""}
        <a className={s.capLink} href={href}>Sign in with Discogs</a> and I&rsquo;ll look at your wantlist.
      </p>
    );
  }

  const { me } = state;
  return (
    <p className={s.cap}>
      {`Signed in as ${me.username}. `}
      {me.sync_failed ? (
        <>Couldn&rsquo;t read your lists. <button type="button" className={s.capLink} onClick={retry}>Try again</button>. </>
      ) : me.syncing ? (
        "Reading your wantlist… "
      ) : (
        `${plural(me.wants, "want", "wants")}, ${plural(me.collection, "record", "records")} in the collection. `
      )}
      <button type="button" className={s.capLink} onClick={() => signOut(false)}>Sign out</button>
      {" · "}
      <button type="button" className={s.capLink} onClick={() => signOut(true)}>Forget me</button>
    </p>
  );
}
