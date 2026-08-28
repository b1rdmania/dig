/**
 * dig uptime watchdog — Cloudflare Worker, cron-triggered.
 *
 * Why this exists
 * ---------------
 * On 2026-08-07 dig-web wedged: the process stayed alive and the port stayed
 * open, but the shallow /api/health check timed out at 5s. Fly's health check
 * spotted it immediately and went critical — and then nothing happened, for
 * four hours, because Fly health checks only steer the load balancer. Machine
 * restarts fire on process EXIT CODES (the [[restart]] policy), never on a
 * failing check. There is no fly.toml setting that expresses "restart when
 * unhealthy".
 *
 * So something outside has to do it. Not inside the container: a watchdog on
 * the wedged machine shares the failure domain of the thing it's watching
 * (blocked event loop, GC thrash at the memory ceiling) and can be just as
 * stuck. This runs off Fly entirely, polls the public URL a real visitor hits,
 * and restarts through the Machines API.
 *
 * What it does, every cron tick
 * -----------------------------
 *   1. GET each target's health URL through the Fly proxy, 10s timeout.
 *   2. Track consecutive failures in KV. Under the threshold, do nothing —
 *      one slow response is not an outage.
 *   3. At the threshold, ask the Machines API which machines are actually
 *      unhealthy and restart only those. A machine whose checks pass is left
 *      alone even when the public URL is failing, because then the fault is
 *      upstream and restarting won't fix it.
 *   4. Refuse to restart if we restarted recently, or too often this hour.
 *
 * The caps are the point. An unbounded restarter turns a bad deploy into a
 * crash loop that hides the actual problem. If two restarts in an hour didn't
 * fix it, a third won't either — it stops and reports instead.
 */

export interface Env {
  STATE: KVNamespace;
  /** Org-scoped Fly token. Per-app FLY_TOKEN_<APP> overrides it when set. */
  FLY_API_TOKEN: string;
  FLY_TOKEN_DIG_WEB?: string;
  FLY_TOKEN_DIG_API?: string;
  /** Optional. POSTed a JSON summary whenever the watchdog acts or gives up. */
  NOTIFY_WEBHOOK?: string;
}

interface Target {
  /** Fly app name, used against the Machines API. */
  app: string;
  /** Public health URL — deliberately the path a visitor takes, via the proxy. */
  healthUrl: string;
  /** Substring the body must contain for the response to count as healthy. */
  expect: string;
}

const TARGETS: Target[] = [
  { app: "dig-web", healthUrl: "https://app.dig.baby/api/health", expect: '"status":"ok"' },
  { app: "dig-api", healthUrl: "https://dig-api.fly.dev/v1/health", expect: '"status":"ok"' },
];

/** Consecutive failed polls before we act. At a 2-min cron: ~6 min of outage. */
const FAILURES_BEFORE_RESTART = 3;
/** Per-request timeout. Generous — slow is not the same as down. */
const HEALTH_TIMEOUT_MS = 10_000;
/** Minimum gap between restarts of the same app. */
const RESTART_COOLDOWN_MS = 30 * 60 * 1000;
/** Give up after this many restarts of the same app within the hour. */
const MAX_RESTARTS_PER_HOUR = 2;

const FLY_API = "https://api.machines.dev/v1";

interface AppState {
  consecutiveFailures: number;
  /** Epoch ms of restarts we've issued, trimmed to the last hour. */
  restarts: number[];
  /** True while we're in the given-up state, so we only report it once. */
  escalated: boolean;
}

const EMPTY_STATE: AppState = { consecutiveFailures: 0, restarts: [], escalated: false };

async function readState(env: Env, app: string): Promise<AppState> {
  const raw = await env.STATE.get(`state:${app}`);
  if (!raw) return { ...EMPTY_STATE };
  try {
    return { ...EMPTY_STATE, ...(JSON.parse(raw) as Partial<AppState>) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function writeState(env: Env, app: string, state: AppState): Promise<void> {
  await env.STATE.put(`state:${app}`, JSON.stringify(state), {
    // Long enough to outlive the restart cooldown, short enough to self-clean.
    expirationTtl: 24 * 60 * 60,
  });
}

function tokenFor(env: Env, app: string): string {
  const perApp = app === "dig-web" ? env.FLY_TOKEN_DIG_WEB : env.FLY_TOKEN_DIG_API;
  return perApp || env.FLY_API_TOKEN;
}

async function isHealthy(target: Target): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(target.healthUrl, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cf: { cacheTtl: 0, cacheEverything: false },
      headers: { "user-agent": "dig-uptime-watchdog" },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = await res.text();
    if (!body.includes(target.expect)) {
      return { ok: false, detail: `body missing ${target.expect}: ${body.slice(0, 120)}` };
    }
    return { ok: true, detail: `HTTP ${res.status}` };
  } catch (err) {
    // Timeout, DNS, TLS, connection reset — all "down" from a visitor's view.
    return { ok: false, detail: String(err) };
  }
}

interface FlyMachine {
  id: string;
  name: string;
  state: string;
  checks?: { name: string; status: string }[];
}

async function listMachines(env: Env, app: string): Promise<FlyMachine[]> {
  const res = await fetch(`${FLY_API}/apps/${app}/machines`, {
    headers: { Authorization: `Bearer ${tokenFor(env, app)}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`machines list for ${app}: HTTP ${res.status}`);
  return (await res.json()) as FlyMachine[];
}

/**
 * A machine worth restarting is one that is started but whose checks aren't
 * passing — the exact shape of the 2026-08-07 wedge. Stopped machines are
 * fine (auto_stop parks them); a started machine with passing checks is fine
 * too, and if EVERY machine looks fine while the public URL fails, the fault
 * is upstream of the machines and restarting them is just noise.
 */
function unhealthyMachines(machines: FlyMachine[]): FlyMachine[] {
  return machines.filter(
    (m) =>
      m.state === "started" &&
      (m.checks ?? []).some((c) => c.status !== "passing"),
  );
}

async function restartMachine(env: Env, app: string, machine: FlyMachine): Promise<void> {
  const res = await fetch(`${FLY_API}/apps/${app}/machines/${machine.id}/restart`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(env, app)}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`restart ${app}/${machine.id}: HTTP ${res.status} ${await res.text()}`);
  }
}

async function notify(env: Env, payload: Record<string, unknown>): Promise<void> {
  console.log(JSON.stringify(payload));
  if (!env.NOTIFY_WEBHOOK) return;
  try {
    await fetch(env.NOTIFY_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Never let a broken webhook stop the watchdog doing its job.
    console.error("notify failed", String(err));
  }
}

async function checkTarget(env: Env, target: Target, now: number): Promise<void> {
  const { app } = target;
  const state = await readState(env, app);
  const health = await isHealthy(target);

  if (health.ok) {
    // Steady-state health is the overwhelmingly common case, so it must not write.
    // An unconditional put here cost 2 writes every 2 minutes = 1,440/day against a
    // 1,000/day free-tier cap: the watchdog exhausted its own quota by lunchtime and
    // then couldn't record failures for the rest of the day. Only persist a change.
    const wasDown = state.consecutiveFailures > 0 || state.escalated;
    const staleRestarts = state.restarts.some((t) => now - t >= 60 * 60 * 1000);
    if (wasDown) {
      await notify(env, {
        event: "recovered",
        app,
        afterFailures: state.consecutiveFailures,
        detail: health.detail,
      });
    }
    if (wasDown || staleRestarts) {
      await writeState(env, app, {
        ...state,
        consecutiveFailures: 0,
        escalated: false,
        restarts: state.restarts.filter((t) => now - t < 60 * 60 * 1000),
      });
    }
    return;
  }

  state.consecutiveFailures += 1;

  if (state.consecutiveFailures < FAILURES_BEFORE_RESTART) {
    console.log(
      `${app} unhealthy (${state.consecutiveFailures}/${FAILURES_BEFORE_RESTART}): ${health.detail}`,
    );
    await writeState(env, app, state);
    return;
  }

  // Trim the restart log to the trailing hour before applying the caps.
  state.restarts = state.restarts.filter((t) => now - t < 60 * 60 * 1000);

  const lastRestart = state.restarts[state.restarts.length - 1] ?? 0;
  if (now - lastRestart < RESTART_COOLDOWN_MS) {
    console.log(`${app} unhealthy but within restart cooldown, holding`);
    await writeState(env, app, state);
    return;
  }

  if (state.restarts.length >= MAX_RESTARTS_PER_HOUR) {
    // Two restarts didn't fix it. A third won't. Stop and say so.
    if (!state.escalated) {
      await notify(env, {
        event: "giving_up",
        app,
        restartsThisHour: state.restarts.length,
        consecutiveFailures: state.consecutiveFailures,
        detail: health.detail,
        message: "restart cap reached — needs a human",
      });
      state.escalated = true;
    }
    await writeState(env, app, state);
    return;
  }

  let machines: FlyMachine[];
  try {
    machines = await listMachines(env, app);
  } catch (err) {
    await notify(env, { event: "error", app, stage: "list_machines", detail: String(err) });
    await writeState(env, app, state);
    return;
  }

  const targets = unhealthyMachines(machines);
  if (targets.length === 0) {
    await notify(env, {
      event: "no_action",
      app,
      detail: health.detail,
      message:
        "public health failing but every started machine reports passing checks — fault is upstream of the machines, not restarting",
      machines: machines.map((m) => ({ id: m.id, state: m.state, checks: m.checks })),
    });
    await writeState(env, app, state);
    return;
  }

  const restarted: string[] = [];
  for (const machine of targets) {
    try {
      await restartMachine(env, app, machine);
      restarted.push(machine.id);
    } catch (err) {
      await notify(env, {
        event: "error",
        app,
        stage: "restart",
        machine: machine.id,
        detail: String(err),
      });
    }
  }

  if (restarted.length > 0) {
    state.restarts.push(now);
    state.consecutiveFailures = 0;
    await notify(env, {
      event: "restarted",
      app,
      machines: restarted,
      reason: health.detail,
      restartsThisHour: state.restarts.length,
    });
  }

  await writeState(env, app, state);
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const now = Date.now();
        // Targets are independent — one app being down must not delay the other.
        await Promise.all(
          TARGETS.map((t) =>
            checkTarget(env, t, now).catch((err) =>
              notify(env, { event: "error", app: t.app, stage: "check", detail: String(err) }),
            ),
          ),
        );
      })(),
    );
  },

  /**
   * Manual endpoint, for verifying the worker without waiting for cron.
   *   GET /        — current KV state per app, plus a live health probe
   *   GET /run     — force a full check cycle now
   */
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/run") {
      const now = Date.now();
      await Promise.all(TARGETS.map((t) => checkTarget(env, t, now)));
      return Response.json({ ran: true, at: new Date(now).toISOString() });
    }

    const report = await Promise.all(
      TARGETS.map(async (t) => ({
        app: t.app,
        healthUrl: t.healthUrl,
        live: await isHealthy(t),
        state: await readState(env, t.app),
      })),
    );
    return Response.json({
      thresholds: {
        failuresBeforeRestart: FAILURES_BEFORE_RESTART,
        healthTimeoutMs: HEALTH_TIMEOUT_MS,
        restartCooldownMs: RESTART_COOLDOWN_MS,
        maxRestartsPerHour: MAX_RESTARTS_PER_HOUR,
      },
      targets: report,
    });
  },
};
