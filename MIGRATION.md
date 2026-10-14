# Zapeera — Single-Host Migration Guide

**Branch:** `migration/oracle-single-host` · **Prepared:** 2026-10-15
**Target:** one Oracle Cloud Always Free VM (Ampere A1 ARM64, 2 OCPU / 12 GB RAM, Ubuntu 24.04), Docker Compose.
**Replaces:** Neon (database) + Railway (backend) + Vercel (frontend).
**Research & plan:** `~/workspace/github/ZAPEERA_MIGRATION_RESEARCH_2026-10-15.md` (§10) — this file is the hands-on runbook for Phase 2–3.
**Audit:** `~/workspace/github/ZAPEERA_ANALYSIS_REPORT_2026-10-15.md`.

---

## 1. Architecture

```
                        ┌──────────────── one VM ────────────────┐
  browser ──HTTPS──────▶│ Caddy (80/443, automatic Let's Encrypt)│
                        │   zapeera.seikho.online ──▶ frontend   │
                        │   api.zapeera.seikho.online ─▶ backend │
                        │                                        │
                        │ frontend (nginx) ──/api,/health───────▶│
                        │ backend (Node :4200) ──▶ postgres :5432│
                        │ backend ──OCR_SERVICE_URL──▶ ocr :8000 │
                        └────────────────────────────────────────┘
```

| Service | Image / build | Public? | Notes |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | **Yes — 80/443 only** | TLS + routing; site names come from `.env` |
| `frontend` | `frontend-zapeera-V1/Dockerfile` | via Caddy | SPA; nginx proxies `/api/`, `/health`, `/uploads/` to backend, SSE streaming on |
| `backend` | `backend-zapeera-v1-main/Dockerfile` (new) | via Caddy (`api.` host) | Node 22, port 4200; uploads on named volume |
| `postgres` | `postgres:16-alpine` | No | Named volume `zapeera_pgdata`, healthcheck |
| `ocr` | `ocr-service/Dockerfile` (new) | No | FastAPI + RapidOCR (ONNX); Tesseract fallback binary included |

**Schema handling — read this before "fixing" it:** this project has **no
`prisma/migrations/` directory**, by design. The repo's supported flow is
`prisma db push`, applied automatically at backend boot by
`src/config/schema-heal.ts` (additive, fail-fast). The compose stack
deliberately runs **no** migrate step; the backend container keeps the full
`node_modules` (Prisma CLI included) because schema-heal shells out to
`npx prisma` at startup.

**Domain portability contract:** every public hostname lives in `.env`
(`FRONTEND_DOMAIN`, `API_DOMAIN`, `FRONTEND_URL`, `CORS_ORIGINS`,
`VITE_CLOUD_API_URL`). The frontend is built with **relative** `VITE_API_BASE_URL=/api`
and `VITE_SSE_BASE_URL=/api`, so the same build works on any domain.

---

## 2. Before you start (Phase 0 — data safety)

1. **Export the Neon database NOW, while access exists** (old production is
   not under the project's control — treat access as perishable):
   ```bash
   pg_dump "$NEON_DATABASE_URL" -Fc -f ~/zapeera-neon-$(date +%F).dump
   pg_dump "$NEON_DATABASE_URL" -f  ~/zapeera-neon-$(date +%F).sql
   ```
   Store both **outside the repo** (e.g. `~/workspace/github/`).
2. Record verification baselines from Neon: row counts for `ZapeeraUser`,
   `Business`, `Product`, `Sale` (adjust to actual table names).
3. Inventory the production secrets you will re-issue into the VM's `.env`
   (`JWT_SECRET`, Resend API key, …) — from the old dashboards, never from git.

Muhammad's own steps (account signup with card, home region **Mumbai**, VM
creation with the provided SSH key) are in the migration research §11 and the
signup guide — everything below assumes the VM exists and you can SSH in.

---

## 3. Deploy on a fresh Ubuntu 24.04 (ARM64) VM

### 3.1 Open the network paths
- **OCI console:** VCN security list — allow ingress `22, 80, 443` (TCP) and `443` (UDP, HTTP/3 optional).
- **On the VM:** Oracle Ubuntu images ship restrictive iptables. Allow the same ports there too:
  ```bash
  sudo iptables -I INPUT -p tcp --dport 80  -j ACCEPT
  sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  sudo netfilter-persistent save   # if the package is present
  ```
  (SSH/22 is open by default on OCI images.)

### 3.2 Install Docker
```bash
sudo apt-get update && sudo apt-get -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out/in once so this takes effect
docker --version && docker compose version
```

### 3.3 Get the code
```bash
git clone -b migration/oracle-single-host https://github.com/MuhammadMajidWarraich/Zapeera-New.git
cd Zapeera-New
```
(After this branch is merged, clone normally and use `main`.)

### 3.4 Configure
```bash
cp .env.example .env
nano .env
```
Fill in at minimum:
- `POSTGRES_PASSWORD` — long random (`openssl rand -hex 24`)
- `JWT_SECRET` — `openssl rand -hex 48`
- `ADMIN_SETUP_TOKEN` — random token
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — email via the Resend HTTPS API
  (OCI blocks outbound SMTP ports 25/465/587; do not plan on SMTP from the VM)
- Keep the test hostnames (`zapeera.seikho.online`, `api.zapeera.seikho.online`)
  and the relative `VITE_*` URLs exactly as templated.

### 3.5 DNS (Cloudflare, seikho.online zone)
Add two **A records, DNS-only (grey cloud)** pointing at the VM's public IP:
```
zapeera       A   <VM public IP>
api.zapeera   A   <VM public IP>
```
Grey cloud matters: it keeps Let's Encrypt issuance simple and keeps SSE
streams away from proxy buffering/timeouts.

### 3.6 Build & start
```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend   # expect: [Schema Heal] ✅ … server listening on 4200
docker compose logs -f caddy     # expect: certificates obtained for both hosts
```
First build takes a while (frontend bundle + OCR wheels). Subsequent starts
are fast.

### 3.7 Restore the production data (staging)
Restore **before** inviting real use; the VM's database starts empty and
the boot-time schema-heal creates the schema.
```bash
# stop the backend so nothing writes during restore
docker compose stop backend
# custom-format dump (preferred):
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < ~/zapeera-neon-YYYY-MM-DD.dump
#   …or the plain-SQL copy:
# gunzip -c zapeera-neon-YYYY-MM-DD.sql.gz | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose start backend
```
Then compare restored row counts against the §2 baseline.
*(For a throwaway staging DB instead: skip the restore and use the repo's
seed scripts inside the backend container — but seeded default accounts
such as `admin@zapeera.com / admin123` MUST be changed immediately; see the
audit's P0 finding on default credentials.)*

### 3.8 Verify — end-to-end checklist
```bash
curl -s https://api.zapeera.seikho.online/health        # {"status":"ok", … postgresql online}
curl -s https://zapeera.seikho.online/health            # same, via the same-origin proxy
curl -sI https://zapeera.seikho.online/                 # 200, valid TLS
```
In a browser at **https://zapeera.seikho.online**:
- [ ] Login / logout works; session survives refresh
- [ ] Password-reset email arrives (Resend) and the link lands on the
      **seikho.online** reset page (proves `FRONTEND_URL` is right)
- [ ] POS sale → invoice → stock deduction → refund
- [ ] Reports page renders
- [ ] Realtime: a second session's change appears live (SSE) — connection
      stays open in devtools (no 502/buffering)
- [ ] OCR: scan a sample pharmacy label; batch no. / expiry extracted
      (first scan is slow — model loads lazily; check `docker compose logs ocr`)
- [ ] Backoffice login works
- [ ] Payment-proof upload succeeds and the file still loads after
      `docker compose restart backend` (uploads volume)

---

## 4. Backups

```bash
./scripts/backup-db.sh        # timestamped gzip dump into ./backups/
```
Nightly cron on the VM:
```cron
15 2 * * *  cd ~/Zapeera-New && BACKUP_DIR=$HOME/zapeera-backups OCI_BUCKET=zapeera-backups ./scripts/backup-db.sh >> $HOME/zapeera-backup.log 2>&1
```
- Local retention: 14 days by default (`BACKUP_RETENTION_DAYS`).
- Off-VM copy: the script already supports upload to an **OCI Object
  Storage** bucket (Always Free 20 GB) when `OCI_BUCKET` is set — the only
  missing piece is installing/configuring the OCI CLI on the VM
  (**TODO hook**, marked in the script).
- **Restore drill:** do one full restore into a scratch database during
  staging (§3.7 procedure) so the first real restore is not improvised.

---

## 5. Routine operations

| Task | Command |
|---|---|
| Update the app | `git pull && docker compose up -d --build` |
| Logs | `docker compose logs -f backend|caddy|ocr|postgres` |
| Restart one service | `docker compose restart backend` |
| Stop everything | `docker compose down` (volumes/data are kept) |
| OS maintenance | monthly `sudo apt-get update && sudo apt-get -y upgrade` + Docker engine updates via apt |

---

## 6. Rollback

Nothing in Phases 2–3 touches the old stack, so rollback is boring by design:

1. **Before DNS existed / staging only:** stop using the seikho.online test
   URLs. The old production (Neon + old backend + Vercel) is untouched —
   keep it that way for **at least 7 days** after go-live (research §10).
2. **Bad deploy on the VM:** `git checkout <previous-good-commit> && docker compose up -d --build`.
   Data written only to the VM copy during testing is disposable — the
   go-live data always comes from a **fresh Neon dump** (research Phase 4).
3. **DNS rollback:** delete or repoint the two Cloudflare A records; the
   test deployment disappears from the public internet, the VM keeps its data.

---

## 7. Moving to Zapeera's own domain (later)

1. Point the new domain's `A` records (app + `api.`) at the VM IP.
2. In `.env`: set `FRONTEND_DOMAIN`, `API_DOMAIN`, `FRONTEND_URL`,
   `CORS_ORIGINS`, `VITE_CLOUD_API_URL` to the new domain.
3. `docker compose up -d --build` — Caddy issues new certificates
   automatically. (The frontend rebuild in this step is only needed because
   `VITE_CLOUD_API_URL` is baked at build time; all API/SSE traffic itself
   uses relative `/api` and would work unchanged.)
4. Also update, when relevant: `frontend-zapeera-V1/capacitor.config.ts`
   `allowNavigation` (mobile) and the Electron cloud API default (below).

---

## 8. What this branch changed (summary)

| Area | Change |
|---|---|
| Backend CORS/SSE | One env-driven origin policy (`src/utils/allowed-origins.ts`, `CORS_ORIGINS` + `FRONTEND_URL`); duplicated hardcoded lists removed; behaviour unchanged when env unset |
| Backend auth | Password-reset fallback is no longer `app.zapeera.com`; `FRONTEND_URL` is authoritative |
| Frontend config | Production SSE fallback: dead Railway host → relative `/api`; production-leak warning keyed on env |
| Frontend presets | `setup-env.js` staging/production use `/api` + `api.zapeera.seikho.online`; Capacitor `allowNavigation` → `*.seikho.online` |
| `vercel.json` | **Legacy** — kept (Vercel settings may reference it during the rollback window) but its `/api` rewrite now points at `api.zapeera.seikho.online` instead of the dead Railway host |
| OCR | PaddleOCR → **RapidOCR** (same API/schema), + Dockerfile + Tesseract fallback (none existed before) |
| Deploy | Root `docker-compose.yml` + `Caddyfile` + `.env.example`, backend Dockerfile, frontend Dockerfile build args, SSE-safe nginx proxy |

## 9. Deferred / known leftovers (deliberate)

- **Electron default cloud API URL** (`frontend-zapeera-V1/electron/routes/auth.routes.js`)
  still defaults to `https://api.zapeera.com`. It already honours an
  `API_URL` env override; **desktop is out of scope for this migration** —
  set `API_URL=https://api.zapeera.seikho.online` for desktop builds that
  should talk to the new host, and change the shipped default when the
  desktop release is next built.
- **Cosmetic `zapeera.com` references** left in place (support email/contact
  defaults — both env-overridable — `openapi.yaml` server URL,
  `render.yaml`, seed-account emails). Branding pass, not migration work.
  `render.yaml` can be deleted once the Render option is formally dropped.
- **OCR accuracy:** RapidOCR uses the same PP-OCR models, but field-level
  results can differ slightly from PaddleOCR on photographed labels —
  validate with real samples in staging (§3.8) before relying on it.
- **Backoffice/admin default credentials** (audit P0): seeded `admin123`
  accounts must be rotated/forced-changed before any customer-facing use.
- **Prisma engines in restricted networks:** engine binaries download at
  image build time; builds must run with normal internet access (they do
  on the VM). This sandbox could not verify the backend build for exactly
  that reason (audit §6.1) — the staging build is the first full check.
