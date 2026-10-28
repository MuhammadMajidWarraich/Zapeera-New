# Zapeera Signed Licenses — server contract

Approved by Muhammad 2026-10-28 18:58 PKT. Implementation: `src/services/license.service.ts`
(issue), `src/controllers/license.controller.ts` + `src/routes/license.routes.ts`
(refresh/report), issuance wired into login (`auth.controller.ts`,
`issueLoginSession` — covers plain login AND the 2FA-completion path) and
provision (`sync-cloud-api.controller.ts`, `cloudProvisionBusiness`).

## Keypair

- Private key: **server env only** — `LICENSE_PRIVATE_KEY_PEM` in the VM's
  `~/zapeera/.env` (mode 0600, generated on the VM 2026-10-28). Never in any
  repo file, log, or response. The service never logs the key value.
- Public key: `~/workspace/license-pubkey.pem` (sandbox) — paste into the
  desktop's `LICENSE_PUBLIC_KEY_PEM` (`electron/services/license/license.service.js`).
- Fingerprint (SHA-256 of the DER public key):
  `acf0b281981086de01d07ac364825b22d8ebb43bad1d398226ab9d62ab8c2e3c`
- Rotation story: the desktop verifier accepts a `publicKeyPem` override for
  tests; a production rotation mechanism (second embedded key or
  server-delivered rotation) must be specified BEFORE enforcement ships —
  not after. Until then, losing the private key means issuing stops
  (LICENSE_NOT_CONFIGURED) and the desktop falls back to its legacy path.

## Token

- Wire format: `base64url(JSON payload) + "." + base64url(Ed25519 signature)`
  over the raw payload bytes (Node `crypto.sign(null, …)` / `crypto.verify(null, …)`).
- Payload: `{ licenseId, accountId, businessIds, planId, status, issuedAt,
  expiresAt, serverTime, deviceId, installId }` — one business per token
  (`businessIds: [businessId]`); `status` is `ACTIVE` | `TRIAL` | `GRACE`.
- `expiresAt` **includes the 3-day grace** (see below). `serverTime` is the
  server clock at issuance (the desktop's monotonic anti-rollback anchor).

## Policy constants (`license.service.ts`)

| Constant | Value | Notes |
|---|---|---|
| `HARD_EXPIRY_MODE` | `'READ_ONLY_EXPORT_ONLY'` | One-word switch to `'FULL_LOCK'`. The server declares it; the desktop enforces it at its write gates (new sales/invoices, purchases, refunds, stock edits blocked; view history + export/backup allowed). |
| `GRACE_DAYS` | `3` | **SERVER-ONLY home.** Baked into `expiresAt` at issuance: `expiresAt = min(periodEnd + 3d, issuedAt + 40d)`. The desktop MUST NOT add its own grace — `evaluate()` treats `expiresAt` as final. Never double-count. |
| `LICENSE_MAX_TOKEN_LIFETIME_DAYS` | `40` | `expiresAt ≤ issuedAt + 40d`, even for annual plans. Forces re-issuance (and re-checks) at least every 40 days; bounds the revocation window. |
| `LICENSE_SHADOW_MODE` | `true` | Shadow release: evaluate, do not enforce. Flip to `false` ONLY together with the desktop enforcement switch, once the desktop sends `deviceId`/`installId` at login/provision/refresh. |
| Device caps | trial 1 / starter 1 / growth 2 / scale 3 | `plan.features.maxDevices` (JSON) overrides; unknown plans default to 1. Per (user, business), counting `device_activations` rows with status ≠ `INACTIVE`. |

## Issuance points

| Call | Token returned |
|---|---|
| `POST /api/auth/login` (and `/login/2fa` completion) | `data.license` (object or `null`) + `data.licenseCode` |
| `POST /api/sync/business/provision` | `data.license` + `data.licenseCode` |
| `POST /api/license/refresh` (auth; `deviceId` required, `businessId` optional — body, else `x-company-id`, else first ACTIVE membership) | `{ license \| null, licenseCode }` |

Issuance is **best-effort at login/provision**: it can never break login or
provision — failures surface as `license: null` + `licenseCode`, never an
error response.

## Refusal codes (`license: null`)

| Code | Meaning |
|---|---|
| `LICENSE_NOT_CONFIGURED` | No/invalid private key in server env. |
| `LICENSE_NO_SUBSCRIPTION` | Business has no subscription row. |
| `LICENSE_SUBSCRIPTION_NOT_ACTIVE` | Status `SUSPENDED` / `EXPIRED` / `CANCELLED` / … — **revocation via non-issuance**: no fresh token; the old token dies at its own `expiresAt`. |
| `LICENSE_SUBSCRIPTION_EXPIRED` | Period end already passed, even if the status row still says `ACTIVE` (fail closed). |
| `LICENSE_NO_DEVICE_BINDING` | Enforcement only: no `deviceId` sent. (In shadow mode an unbound token is issued instead and the miss is logged — see below.) |
| `LICENSE_DEVICE_INACTIVE` | Device deactivated by an admin — the stolen-device kill switch. |
| `LICENSE_DEVICE_LIMIT_REACHED` | New device would exceed the plan cap (`count/limit` in the message). |
| `LICENSE_NO_BUSINESS` | Login only: the user has no business to license. |
| `LICENSE_DEVICE_REQUIRED` | Refresh only: HTTP 400, `deviceId` missing. |
| `LICENSE_ERROR` | Unexpected issuance error at login/provision (login/provision unaffected). |

## Device binding

- The desktop sends `deviceId` + `installId` in the request body (login,
  provision, refresh accept them as optional fields) or as `x-device-id` /
  `x-install-id` headers. The server always populates both claims when they
  are sent; the token binds exactly one device + install.
- **Shadow mode:** a client that sends no binding still receives a token
  with `deviceId: null, installId: null`, and the miss is logged
  (`issuing UNBOUND token …`). The desktop only logs in shadow mode.
- **Enforcement:** unbound issuance is refused (`LICENSE_NO_DEVICE_BINDING`)
  and the desktop must fail closed on missing claims (a claim missing once
  enforcing = `device-mismatch`, never silent unenforcement).
- Issuance upserts the `device_activations` row (new devices start `PENDING`,
  stamped `lastVerifiedStatus: 'LICENSE_ISSUED'`). Issuance NEVER flips a
  device to `ACTIVE` — activation remains the separate admin act. A device
  row that changes hands follows the signed-in account (mirrors check-in).

## Shadow-mode reporting

`POST /api/license/report` (auth) — the desktop posts
`{ licenseVerdict, legacyVerdict, reason, businessId?, deviceId? }`; the
server logs one structured `[license-shadow] … mismatch=<bool>` line per
report. Telemetry only: never changes state, never fails the caller.

## What this branch deliberately does NOT do

- No schema change (no new tables/columns — issuance reads
  `business_subscriptions` + `device_activations` only). Schema-sync gate
  stays green by construction.
- No desktop changes: the client groundwork (`electron/services/license/`)
  is NOT copied into this branch — the desktop agent owns pasting the public
  key, storing `zapeera_license_token`, sending `deviceId`/`installId`, and
  the shadow-mode evaluation/reporting.
- No enforcement gates on the desktop (subscription fallback, write paths,
  read-only UI) — those ship with the enforcement switch, not this branch.
- No code signing (decision 5, deferred). No auto-update channel. No
  Electron upgrade. No change to the 10-year auto-activate blocks or the
  dead activation service — those are removed by the desktop-side rollout
  in the same change that switches the gates (leaving them in place during
  shadow mode is intentional: shadow must not change behaviour).
- The refresh endpoint re-checks subscription status on every issuance, so
  a downgraded plan is picked up at the next refresh (at most 40 days on a
  stale token, usually at the next sync).

## Deploy notes (for the deploy phase — DO NOT deploy from this branch)

- The private key already lives in the VM's `~/zapeera/.env`
  (`LICENSE_PRIVATE_KEY_PEM`, mode 0600, backup `.env.bak-license-20261028`
  predates the key). The deploy only needs the new backend build; no env
  change, no DDL, no migration. `SKIP_SCHEMA_HEAL` is NOT needed (no schema
  change). Verify after deploy: `POST /api/license/refresh` with a test
  device returns a token whose signature verifies against
  `~/workspace/license-pubkey.pem`, and login/provision responses carry
  `license`/`licenseCode`.
- Prisma client: do NOT reuse the pre-generated client at
  `~/workspace/shift-fix-verify/candidate-client/` — its generated types
  are stale relative to the release-tip schema (it lacks `creditLimit`,
  `syncOrigin`, `twoFactorSecret`, … in its `.d.ts` even though its bundled
  `schema.prisma` has them; `tsc` fails 48 errors against it). Regenerate
  from the release schema with the repo's own script
  (`npm run setup:web` / `node scripts/generate-client.js postgresql`).
  Note: on this sandbox the generate step tried to download engine binaries
  for all 7 `binaryTargets` from binaries.prisma.sh (blocked by the egress
  proxy); the workaround that worked was generating from a throwaway copy of
  the schema with `binaryTargets = ["debian-openssl-3.0.x"]` only — the
  generated types are target-independent. If the deploy host can reach
  binaries.prisma.sh, plain `setup:web` works as-is.
