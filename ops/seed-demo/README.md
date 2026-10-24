# Live-demo tenant: seed + nightly reset

The marketing homepage hero embeds the **real** Zapeera app running one
dedicated public tenant — "Demo Pharmacy", owned by the demo account
(`DEMO_USER_EMAIL`). Visitors sign in through `POST /api/auth/demo-login`
(no credentials; the account is designated server-side and fenced by
`backend-zapeera-v1-main/src/utils/demo-guard.ts`).

## Files

- `reset-demo.mjs` — ensure-user → wipe → reseed → verify. Creates the
  demo account through the real register + email-verify flow on first
  run, deletes every row owned by the demo user's businesses (children
  first, direct Prisma — the only DB-direct phase), then rebuilds the
  golden dataset (pharmacy, ~40 products with batches/expiry, 6
  customers, 14 sales, 2 expenses, Growth plan via the real backoffice
  assign endpoint) entirely through the HTTP API, so all demo numbers
  are computed by the real app.
- `run-reset.sh` — host wrapper: `docker cp` the script into
  `zapeera-backend-1` and `docker exec` it (fresh copy each run, so
  container recreates by deploys don't lose it).

## Install (VM)

```bash
mkdir -p ~/zapeera/ops/seed-demo
cp reset-demo.mjs run-reset.sh ~/zapeera/ops/seed-demo/
chmod +x ~/zapeera/ops/seed-demo/run-reset.sh
# Nightly at 04:00 PKT (VM cron with explicit timezone):
( crontab -l 2>/dev/null; echo 'CRON_TZ=Asia/Karachi'; \
  echo '0 4 * * * /home/ubuntu/zapeera/ops/seed-demo/run-reset.sh >> /home/ubuntu/zapeera/ops/seed-demo/reset.log 2>&1' ) | crontab -
```

## Required env (VM `~/zapeera/.env`, backend service)

- `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD` — the demo account.
- `DEMO_SEED_ADMIN_EMAIL`, `DEMO_SEED_ADMIN_PASSWORD` — backoffice admin
  used by the seed to assign the Growth plan via the real endpoint.

Never commit these values. The demo account's password is also the
seed's login — rotating it means updating the env and re-running once.
