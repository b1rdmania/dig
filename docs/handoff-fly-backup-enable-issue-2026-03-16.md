# Handoff: Fly Postgres Backup Enable Inconsistency (`dig-db`)

Date: 2026-03-16  
Owner: handoff from Codex session  
Scope: `fly pg/postgres backup` commands for `dig-db`

## Problem Summary

Backup state is inconsistent in Fly CLI for `dig-db`:

- `fly pg backup enable -a dig-db` returns: **`Error: backups are already enabled`**
- `fly pg backup list -a dig-db` returns: **`backups are not enabled`**
- `fly postgres backup create -a dig-db` returns: **`backups are not enabled`**

This prevents confirming/using backups even after Tigris project creation.

## What Was Observed (Concrete)

### 1) Initial state

- User hit: `fly pg backup enable -a dig-db` -> `Error: no active leader found`

### 2) DB health checks around the issue

`fly checks list -a dig-db` frequently oscillated:

- `role`: passing/primary at times
- `pg`: often critical (timeouts / connection refused to repmgr/flypgadmin)
- `vm`: critical due CPU/IO checks

This explains intermittent `no active leader found`, but not the persistent enabled/disabled contradiction after recovery.

### 3) Terms/Tigris flow

At one point `enable` reached Tigris setup and showed terms prompt behavior.  
User later reported Tigris project details and secrets were set for `dig-db`:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_ENDPOINT_URL_S3`
- `AWS_REGION`
- `BUCKET_NAME`

### 4) Lease lock interference (resolved)

There were stale local fly processes holding VM lease (from prior interactive sessions), causing:

`failed to exec on VM ... lease currently held ...`

Killed local stuck processes; lease errors cleared.

### 5) Current contradiction (still unresolved)

After lease cleanup and DB restart attempts:

- `fly pg backup enable -a dig-db` -> `Error: backups are already enabled`
- `fly pg backup list -a dig-db` -> `backups are not enabled`
- `fly postgres backup list -a dig-db` -> `backups are not enabled`
- `fly postgres backup create -a dig-db` -> `backups are not enabled`

## Environment Notes

- Fly CLI version: `v0.4.21` (2026-03-11 build)
- App: `dig-db` (single machine: `d8d1009a0702d8`, region `iad`)
- DB machine has recurring critical VM CPU/IO checks.

## Suspected Root Causes

1. Fly control-plane state drift:
   - backup feature flag appears "enabled" on one path (`enable` command),
   - but backup config/list path sees "not enabled".

2. CLI bug/regression in current `flyctl`:
   - previously demanded `--yes` for non-interactive terms acceptance,
   - but `--yes` is not supported by `fly postgres backup enable` flags in this version.

3. DB health instability contributes intermittent leader errors but is likely not the sole cause of the contradictory enabled/disabled status.

## Recommended Next Debug Path (for next agent)

1. Re-check health first:
   - `fly checks list -a dig-db`
   - Ensure `role` and `pg` are both passing before backup ops.

2. Inspect backup config directly when healthy:
   - `fly postgres backup config show -a dig-db`
   - If available, record output in this doc.

3. Attempt config mutation (if accepted by backend):
   - `fly postgres backup config update -a dig-db --full-backup-frequency ... --recovery-window ... --minimum-redundancy ...`
   - Then retry `backup list` + `backup create`.

4. Test from a different `flyctl` version (newer or previous known-good):
   - compare behavior of `enable/list/create`.

5. If contradiction persists, open Fly support ticket with exact repro:
   - app: `dig-db`
   - timestamp window
   - command outputs above
   - mention control-plane drift (`enable says enabled`, `list/create says not enabled`).

## Resolution (2026-03-16)

Root cause: Tigris secrets were staged but never deployed to the machine. Running
`fly secrets deploy -a dig-db` pushed the credentials and restarted the machine.

Verified via SSH + pg_stat_archiver:
- `archived_count = 153` — WAL files streaming to Tigris ✓
- `last_archived_time > last_failed_time` — transient failures during restart, recovered ✓
- `barman-cloud-backup-list` returns successfully (empty = no full backup yet, expected) ✓

**First full backup will run automatically within 24h** (`full_backup_frequency = 24h`).
After 3 full backups accumulate (`minimum_redundancy = 3`) PITR coverage is complete.

## Remaining Open Items

- `fly pg backup list` still returns "backups are not enabled" — this is because the
  flyctl exec API is dead on this machine (vm health check returning 500s). Cosmetic only;
  actual backups are running. Worth a Fly support ticket.
- vm health check 500s — Fly agent inside the VM not responding. Separate from PG health.

