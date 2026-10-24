# Warm-swap backend deploys (no more 502s)

## The problem

The backend takes ~2 minutes to become healthy on the 1 GB Oracle Micro VM
(schema heal + Prisma + schedulers). The old deploy ended with
`docker compose up -d --force-recreate backend`, so for that whole window
every API call failed:

- `api.zapeera.seikho.online` → Caddy → dead upstream → **502**
- `app.zapeera.seikho.online` → Caddy → frontend nginx → dead upstream → **502**

A user hit exactly this at login on 2026-10-24 10:19 PKT, during the
connection-leak fix deploy. There is no way to make a cold Node boot on
this box fast enough to hide inside a recreate — the fix is to never let
traffic point at a backend that is still booting.

## The procedure — `ops/deploy-backend-warm.sh`

Run it **on the VM**, from anywhere (it cds to `~/zapeera`):

```sh
# after building the backend dist in the sandbox and copying it over:
~/zapeera/ops/deploy-backend-warm.sh --dist /path/to/backend-dist.tar.gz

# or deploy an already-built image:
~/zapeera/ops/deploy-backend-warm.sh --image zapeera-backend:sometag
```

(The dist tarball's root must be the compiled `dist/` contents —
`server.js` at the top level.)

### What it does

1. **Preflight.** Verifies the stack is in its standard compose layout,
   records the live image, tags it `zapeera-backend:pre-warmswap-<TS>`
   (rollback), and backs up the Caddyfile and the frontend's nginx
   `default.conf`. Refuses to run if RAM+swap headroom < 700 MB (two
   backends + one cold boot must fit, or the OOM killer chooses a victim)
   or if a `backend-next` container already exists.
2. **Assemble** the candidate image `zapeera-backend:candidate-<TS>` via
   the established assembly-container route (sleep container on the live
   image, `docker cp` the dist in, `docker commit` with
   `--change ENTRYPOINT/CMD` restored — a raw commit would capture the
   sleep override).
3. **Boot a sidecar** `backend-next` on the compose network with the live
   backend's *exact* captured environment (same JWT secret, same DB URL,
   same uploads volume), plus one override:
   `ENABLE_SUBSCRIPTION_REMINDERS=false`.
4. **Health gate.** Polls `GET /api/health` *inside* the sidecar until
   200. That handler performs a live `SELECT 1` against Postgres, so
   "healthy" means actually ready to serve, not just "process started".
5. **Switch traffic to the sidecar.** Caddyfile upstream
   `backend` → `backend-next` + `caddy validate` + `caddy reload`;
   frontend nginx conf upstream likewise + `nginx -t` + `nginx -s
   reload`. Both reloads are graceful — no frontend or Caddy recreate,
   in-flight requests complete on the old upstream.
6. **Reconcile compose.** Tags the candidate as `zapeera-backend:latest`
   and runs `docker compose up -d --no-deps --no-build --force-recreate
   backend`. The compose backend's cold boot now happens *off the
   traffic path*. Gates on its health the same way, and asserts the
   running container's image ID is the candidate's.
7. **Switch traffic back** to `backend:4200` (proxy configs restored to
   their canonical form), verify, **remove the sidecar**. End state is
   the standard compose layout — the next deploy starts from exactly
   the same place as today.

At no point does any proxy point at a backend that has not passed the
health gate. That is the whole design.

### Scheduler overlap — why it is safe

While the swap runs, two backend processes exist. What they can duplicate:

- **Subscription reminder emails** — the only genuinely user-visible
  duplicate risk. `server.ts` starts that scheduler only when
  `ENABLE_SUBSCRIPTION_REMINDERS !== 'false'`; the sidecar sets it to
  `false`, so during the whole overlap exactly one reminder-enabled
  instance exists (the serving compose backend before step 6, the new
  one after — never two).
- **SyncScheduler** (30 s user sync, 5 min backup sync, 10 min safety
  net) — no env switch exists. Its passes are idempotent DB syncs; a
  rare doubled pass is a no-op. No mail, no user-visible effect.
- **Schema heal** at boot (`prisma db push`) — idempotent against an
  unchanged schema; the two boots never run simultaneously.

SSE streams: connections pinned to the old compose backend drop when it
is recreated in step 6, but by then traffic (and therefore all
reconnects, which EventSource performs automatically) lands on the
healthy sidecar. A reconnect is not a 502 and produces no error UI.

### Failure behaviour

- **Before the switch** (steps 1–4): the script removes the sidecar and
  exits 1. Traffic was never touched. Fix and re-run.
- **After the switch** (steps 5–7): the script exits 2 and deliberately
  **leaves the sidecar serving traffic** — it is the healthy instance.
  It prints recovery steps; in short: fix the compose backend, then
  restore the proxy configs from `Caddyfile.bak-warmswap-<TS>` /
  `nginx-default.conf.bak-warmswap-<TS>`, reload both proxies, verify
  `/api/health`, and only then `docker rm -f backend-next`.

### Rollback of a completed deploy

```sh
docker tag zapeera-backend:pre-warmswap-<TS> zapeera-backend:latest
docker compose up -d --no-deps --no-build --force-recreate backend
```

(That rollback itself recreates the backend the old way — expect the
~2 min window. To roll back *without* a window, run the warm-swap script
with `--image zapeera-backend:pre-warmswap-<TS>`.)

### Proof

First proof run: 2026-10-24, redeploying the then-live image
(`zapeera-backend:connfix`, 532a025b6956) through the full procedure
while a sandbox probe hit `GET /api/health` (api host) and a real
`POST /api/auth/login` (app host, seikhoonline) every ~2 s.
Probe log + summary: `~/workspace/warmswap-verify/` on the sandbox.
