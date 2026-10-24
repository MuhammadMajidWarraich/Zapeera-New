#!/usr/bin/env bash
# ============================================================================
# deploy-backend-warm.sh — zero-502 backend deploy for the Zapeera
# single-host stack (Oracle Micro VM, ~/zapeera, docker compose).
#
# WHY: a plain `docker compose up -d --force-recreate backend` leaves the
# API dead for the backend's full cold-boot time (~2 min on this 1 GB box:
# schema heal + Prisma + schedulers). During that window BOTH public chains
# return 502 (api.zapeera.seikho.online via Caddy, and
# app.zapeera.seikho.online via Caddy -> frontend nginx). A user hit this
# at login on 2026-10-24 10:19 PKT. This script removes the window:
#
#   1. Assemble the candidate image (established assembly-container route).
#   2. Boot it as a SIDECAR container (backend-next) on the compose network
#      with the live backend's exact environment — except subscription
#      reminders disabled, so two instances can never double-send mail.
#   3. Gate on REAL readiness: GET /api/health inside the sidecar == 200
#      (the handler runs a live DB SELECT 1; it is not a liveness stub).
#   4. Switch both proxies to the sidecar (Caddyfile edit + `caddy reload`;
#      frontend nginx conf edit in the RUNNING container + `nginx -s
#      reload` — no frontend recreate). Reloads are graceful: in-flight
#      requests finish on the old upstream.
#   5. Only then rebuild the compose `backend` service from the candidate
#      image (traffic is on the sidecar, so its ~2 min cold boot is
#      invisible), and gate on its health too.
#   6. Switch both proxies back to the canonical `backend:4200`, verify,
#      and remove the sidecar. The stack ends in the standard compose
#      layout: service `backend` runs the new image under its normal name,
#      proxy configs byte-identical to their canonical form.
#
# At every instant, traffic points at a container that has already passed
# the health gate. There is no step where a proxy targets a cold backend.
#
# USAGE (on the VM):
#   ops/deploy-backend-warm.sh --dist /path/to/backend-dist.tar.gz
#   ops/deploy-backend-warm.sh --image zapeera-backend:sometag
#
# The dist tarball must contain the compiled backend at its root
# (server.js at the top level — i.e. the contents of backend dist/).
#
# ENV KNOBS:
#   STACK_DIR       stack directory (default: ~/zapeera)
#   HEALTH_TIMEOUT  seconds to wait for each health gate (default: 600)
#
# FAILURE BEHAVIOUR:
#   - Failure BEFORE the proxy switch: sidecar is removed, traffic was
#     never touched, exit 1. Just fix the problem and re-run.
#   - Failure AFTER the proxy switch: the script exits 2 and LEAVES THE
#     SIDECAR SERVING TRAFFIC on purpose (it is healthy; the old backend
#     may not be). Recovery steps are printed and are also in
#     ops/WARM-SWAP-DEPLOY.md.
#
# ROLLBACK ARTIFACTS (kept on the VM):
#   - image tag  zapeera-backend:pre-warmswap-<TS>   (previous live image)
#   - ~/zapeera/Caddyfile.bak-warmswap-<TS>
#   - ~/zapeera/nginx-default.conf.bak-warmswap-<TS>
# ============================================================================
set -euo pipefail

STACK_DIR="${STACK_DIR:-$HOME/zapeera}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-600}"
TS="$(date +%Y%m%d%H%M%S)"
SIDECAR="backend-next"
ASM="zapeera-backend-asm"
CANDIDATE="zapeera-backend:candidate-$TS"
ROLLBACK_TAG="zapeera-backend:pre-warmswap-$TS"
WORK="$(mktemp -d /tmp/warmswap-$TS.XXXXXX)"
PHASE="preflight"

DIST_TARBALL=""
IMAGE_REF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dist)  DIST_TARBALL="$2"; shift 2 ;;
    --image) IMAGE_REF="$2";    shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done
if [ -z "$DIST_TARBALL" ] && [ -z "$IMAGE_REF" ]; then
  echo "usage: $0 --dist <dist.tar.gz> | --image <image-ref>" >&2
  exit 64
fi

log() { printf '[%s] [warm-swap] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

on_exit() {
  local rc=$?
  if [ $rc -ne 0 ]; then
    if [ "$PHASE" = "switched" ] || [ "$PHASE" = "reconciling" ]; then
      cat >&2 <<EOF

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
WARM-SWAP ABORTED AFTER TRAFFIC WAS SWITCHED TO THE SIDECAR.
The sidecar ($SIDECAR) has been LEFT RUNNING and is serving traffic —
do NOT stop it. The compose backend may be down or unhealthy.
Recovery (see ops/WARM-SWAP-DEPLOY.md):
  1. Check the sidecar is healthy:
       docker exec $SIDECAR curl -sf http://localhost:4200/api/health
  2. Finish the reconcile by hand once the compose backend is fixed:
       docker tag <candidate-image> zapeera-backend:latest
       docker compose up -d --no-deps --no-build --force-recreate backend
       # wait for health, restore proxy configs from the backups:
       #   ~/zapeera/Caddyfile.bak-warmswap-$TS
       #   ~/zapeera/nginx-default.conf.bak-warmswap-$TS
       # caddy reload + nginx -s reload, verify, then:
       docker rm -f $SIDECAR
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
EOF
      exit 2
    fi
    # Pre-switch failure: traffic untouched; just drop the sidecar/asm.
    docker rm -f "$SIDECAR" "$ASM" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap on_exit EXIT

# ---------------------------------------------------------------- preflight
cd "$STACK_DIR"
[ -f docker-compose.yml ] && [ -f Caddyfile ] || die "docker-compose.yml / Caddyfile not found in $STACK_DIR"

for c in zapeera-backend-1 zapeera-frontend-1 zapeera-caddy-1 zapeera-postgres-1; do
  docker inspect "$c" >/dev/null 2>&1 || die "container $c not found — stack not in its standard layout"
done
if docker inspect "$SIDECAR" >/dev/null 2>&1; then
  die "container $SIDECAR already exists (leftover from an aborted run?) — inspect it manually; if it is serving traffic, finish that swap first (see runbook)"
fi

# Memory guard: two backends + one cold boot must fit in RAM+swap, or the
# OOM killer picks a victim (possibly the live backend or Postgres).
MEM_AVAIL_MB=$(free -m | awk '/^Mem:/{print $7}')
SWAP_FREE_MB=$(free -m | awk '/^Swap:/{print $4}')
HEADROOM_MB=$(( MEM_AVAIL_MB + SWAP_FREE_MB ))
log "memory headroom: ${HEADROOM_MB} MB (avail ${MEM_AVAIL_MB} + free swap ${SWAP_FREE_MB})"
[ "$HEADROOM_MB" -ge 700 ] || die "not enough memory headroom (${HEADROOM_MB} MB < 700 MB) — refusing to boot a second backend"

DISK_FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
log "disk free: ${DISK_FREE_GB} GB"
[ "${DISK_FREE_GB:-0}" -ge 3 ] || die "less than 3 GB disk free — image commit may fail"

LIVE_IMAGE_ID=$(docker inspect zapeera-backend-1 --format '{{.Image}}')
LIVE_IMAGE_REF=$(docker inspect zapeera-backend-1 --format '{{.Config.Image}}')
log "live backend image: $LIVE_IMAGE_REF ($LIVE_IMAGE_ID)"
docker tag "$LIVE_IMAGE_ID" "$ROLLBACK_TAG"
log "rollback tag: $ROLLBACK_TAG"

NETWORK=$(docker inspect zapeera-backend-1 --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')
UPLOADS_VOL=$(docker inspect zapeera-backend-1 --format '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Name}}{{end}}{{end}}')
[ -n "$NETWORK" ] && [ -n "$UPLOADS_VOL" ] || die "could not derive network / uploads volume from the live backend"
log "network: $NETWORK, uploads volume: $UPLOADS_VOL"

# Pristine proxy configs (restored byte-for-byte at switch-back).
cp Caddyfile "Caddyfile.bak-warmswap-$TS"
docker cp zapeera-frontend-1:/etc/nginx/conf.d/default.conf "nginx-default.conf.bak-warmswap-$TS"
log "proxy config backups: Caddyfile.bak-warmswap-$TS, nginx-default.conf.bak-warmswap-$TS"

wait_healthy() { # $1 = container name, $2 = timeout seconds
  local c="$1" deadline=$(( $(date +%s) + $2 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if docker exec "$c" curl -sf -m 5 http://localhost:4200/api/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# ---------------------------------------------------------------- assemble
PHASE="assemble"
if [ -n "$DIST_TARBALL" ]; then
  [ -f "$DIST_TARBALL" ] || die "dist tarball not found: $DIST_TARBALL"
  mkdir -p "$WORK/dist"
  tar -xzf "$DIST_TARBALL" -C "$WORK/dist"
  [ -f "$WORK/dist/server.js" ] || die "dist tarball does not contain server.js at its root"
  log "assembling candidate image from dist tarball (assembly-container route)"
  docker rm -f "$ASM" >/dev/null 2>&1 || true
  # Sleep-typed assembly container; commit restores the real entrypoint/cmd
  # via --change (a commit otherwise captures the override — known trap).
  docker run -d --name "$ASM" --entrypoint sh "$LIVE_IMAGE_ID" \
    -c 'rm -rf /app/dist && mkdir -p /app/dist && sleep 900' >/dev/null
  docker cp "$WORK/dist/." "$ASM:/app/dist/"
  docker commit \
    --change 'ENTRYPOINT ["docker-entrypoint.sh"]' \
    --change 'CMD ["node","dist/server.js"]' \
    "$ASM" "$CANDIDATE" >/dev/null
  docker rm -f "$ASM" >/dev/null
else
  log "using existing image as candidate: $IMAGE_REF"
  docker image inspect "$IMAGE_REF" >/dev/null 2>&1 || die "image not found: $IMAGE_REF"
  docker tag "$IMAGE_REF" "$CANDIDATE"
fi
CANDIDATE_ID=$(docker image inspect "$CANDIDATE" --format '{{.Id}}')
log "candidate image: $CANDIDATE ($CANDIDATE_ID)"

# ---------------------------------------------------------------- sidecar
PHASE="sidecar-boot"
# Exact environment of the live backend (same JWT secret, same DB URL),
# plus the one override that makes co-existence safe: the subscription
# reminder scheduler stays OFF in the sidecar (server.ts honours
# ENABLE_SUBSCRIPTION_REMINDERS=false), so reminder mail can never be
# sent twice. The SyncScheduler has no env switch, but its jobs are
# idempotent DB sync passes (30 s user sync / 5 min backup / 10 min
# safety net) — a duplicated pass is a no-op, not a user-visible event.
docker inspect zapeera-backend-1 --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -v '^HOSTNAME=' > "$WORK/env.next"
echo 'ENABLE_SUBSCRIPTION_REMINDERS=false' >> "$WORK/env.next"

log "starting sidecar $SIDECAR from $CANDIDATE"
docker run -d --name "$SIDECAR" --network "$NETWORK" \
  --env-file "$WORK/env.next" \
  -v "$UPLOADS_VOL":/app/uploads \
  --restart no \
  "$CANDIDATE" >/dev/null

BOOT_T0=$(date +%s)
if wait_healthy "$SIDECAR" "$HEALTH_TIMEOUT"; then
  log "sidecar healthy after $(( $(date +%s) - BOOT_T0 ))s"
else
  docker logs --tail 40 "$SIDECAR" >&2 || true
  die "sidecar did not become healthy within ${HEALTH_TIMEOUT}s (traffic untouched)"
fi

# ---------------------------------------------------------------- switch ->
switch_caddy() { # $1 = backend | backend-next
  if [ "$1" = "backend-next" ]; then
    sed -i 's/reverse_proxy backend:4200/reverse_proxy backend-next:4200/g' Caddyfile
  else
    sed -i 's/reverse_proxy backend-next:4200/reverse_proxy backend:4200/g' Caddyfile
  fi
  grep -q "reverse_proxy $1:4200" Caddyfile || die "Caddyfile edit failed (upstream $1 not found)"
  docker exec zapeera-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    || { cp "Caddyfile.bak-warmswap-$TS" Caddyfile; die "Caddyfile failed validation — restored pristine copy"; }
  docker exec zapeera-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    || die "caddy reload failed"
}

switch_nginx() { # $1 = backend | backend-next
  if [ "$1" = "backend-next" ]; then
    sed 's|http://backend:4200|http://backend-next:4200|g' "nginx-default.conf.bak-warmswap-$TS" > "$WORK/default.conf"
  else
    cp "nginx-default.conf.bak-warmswap-$TS" "$WORK/default.conf"
  fi
  grep -q "http://$1:4200" "$WORK/default.conf" || die "nginx conf edit failed (upstream $1 not found)"
  docker cp "$WORK/default.conf" zapeera-frontend-1:/etc/nginx/conf.d/default.conf
  if ! docker exec zapeera-frontend-1 nginx -t >/dev/null 2>&1; then
    docker cp "nginx-default.conf.bak-warmswap-$TS" zapeera-frontend-1:/etc/nginx/conf.d/default.conf
    docker exec zapeera-frontend-1 nginx -s reload >/dev/null 2>&1 || true
    die "nginx config test failed — restored pristine conf"
  fi
  docker exec zapeera-frontend-1 nginx -s reload >/dev/null 2>&1 || die "nginx reload failed"
}

verify_chain() { # hard gates via the proxies' own containers; soft public check
  docker exec zapeera-caddy-1 wget -q -O /dev/null "http://$1:4200/api/health" \
    || die "post-switch check failed: Caddy cannot reach upstream $1"
  docker exec zapeera-frontend-1 wget -q -O /dev/null "http://127.0.0.1/health" \
    || die "post-switch check failed: frontend nginx chain does not answer /health"
  if ! curl -sf -m 10 https://api.zapeera.seikho.online/api/health >/dev/null 2>&1; then
    log "WARNING: public api health check from the VM did not pass (hairpin?) — internal chain checks passed; verify from outside"
  fi
}

PHASE="switched"
switch_caddy backend-next
switch_nginx backend-next
verify_chain backend-next
log "traffic switched to sidecar $SIDECAR"

# ---------------------------------------------------------------- reconcile
PHASE="reconciling"
docker tag "$CANDIDATE" zapeera-backend:latest
log "recreating compose backend from candidate (traffic stays on sidecar)"
docker compose up -d --no-deps --no-build --force-recreate backend
BOOT_T0=$(date +%s)
if wait_healthy zapeera-backend-1 "$HEALTH_TIMEOUT"; then
  log "compose backend healthy after $(( $(date +%s) - BOOT_T0 ))s"
else
  docker logs --tail 40 zapeera-backend-1 >&2 || true
  die "recreated compose backend did not become healthy (traffic is safe on the sidecar)"
fi
NEW_BACKEND_IMAGE=$(docker inspect zapeera-backend-1 --format '{{.Image}}')
[ "$NEW_BACKEND_IMAGE" = "$CANDIDATE_ID" ] \
  || die "compose backend is running $NEW_BACKEND_IMAGE, expected candidate $CANDIDATE_ID (traffic is safe on the sidecar)"

# ---------------------------------------------------------------- switch <-
switch_caddy backend
switch_nginx backend
verify_chain backend
log "traffic switched back to compose backend"

# ---------------------------------------------------------------- retire
docker rm -f "$SIDECAR" >/dev/null
PHASE="done"
grep -q 'reverse_proxy backend:4200' Caddyfile && ! grep -q 'backend-next' Caddyfile \
  || die "final Caddyfile check failed"
log "final stack:"
docker ps --format '  {{.Names}} | {{.Image}} | {{.Status}}'
log "SUCCESS — backend deployed with warm swap. live image now: $(docker inspect zapeera-backend-1 --format '{{.Config.Image}}') ($(docker inspect zapeera-backend-1 --format '{{.Image}}'))"
log "rollback if ever needed: docker tag $ROLLBACK_TAG zapeera-backend:latest && docker compose up -d --no-deps --no-build --force-recreate backend"
