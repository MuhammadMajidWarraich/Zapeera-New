/**
 * Signed-license issuance — server side of the Zapeera signed-license system.
 *
 * Approved by Muhammad 2026-10-28 18:58 PKT (audit decisions 2–4):
 *   - Ed25519 license tokens, issued at login / provision / refresh.
 *   - Hard expiry = READ-ONLY / EXPORT-ONLY (policy constant below; FULL_LOCK
 *     stays a one-word switch — never the default).
 *   - Grace = 3 DAYS, with exactly ONE home: THE SERVER (see GRACE_DAYS).
 *   - Per-account device limits enforced server-side at issuance.
 *   - Revocation via NON-ISSUANCE: a lapsed account gets no fresh token;
 *     the old token dies at its own expiresAt. No revocation list, no
 *     server-side token store — the token's signature + expiry are the truth.
 *   - Code signing is NOT part of this system (decision 5, deferred).
 *
 * Token wire format (must match the desktop verifier in
 * frontend-zapeera-V1/electron/services/license/license.service.js):
 *
 *     token = base64url(JSON payload) + "." + base64url(Ed25519 signature)
 *
 * signed with Node crypto.sign(null, payloadBytes, privateKey) — i.e. the
 * signature covers the raw payload bytes, exactly as the desktop verifies
 * with crypto.verify(null, payloadBytes, publicKeyPem, signature).
 *
 * Private key: env LICENSE_PRIVATE_KEY_PEM ONLY (generated on the server,
 * 2026-10-28, into the VM's ~/zapeera/.env, mode 0600). It must NEVER
 * appear in any repo file, log, or response. The public key is published
 * separately (~/workspace/license-pubkey.pem) for the desktop to embed.
 *
 * GRACE — SINGLE HOME (read this before touching expiry):
 *   GRACE_DAYS = 3 lives ONLY here, on the server, baked into expiresAt at
 *   issuance: expiresAt = min(periodEnd + 3 days, issuedAt + 40 days).
 *   The desktop MUST NOT add its own grace on top of expiresAt — its
 *   evaluate() treats expiresAt as the final bound ("the offline grace IS
 *   this expiry"). If the desktop ever adds grace too, customers get 6
 *   days; if the server ever stops baking it in, they get 0. One home.
 *
 * SHADOW MODE (rollout step 1):
 *   LICENSE_SHADOW_MODE = true while the desktop evaluates but does not
 *   enforce. In shadow mode the server still issues real tokens, enforces
 *   device caps and subscription status, and logs every issuance decision —
 *   but a client that sends NO device binding yet still receives an UNBOUND
 *   token (deviceId/installId null) so the legacy desktop can exercise the
 *   full sign → store → evaluate → report path. When enforcement ships,
 *   flip LICENSE_SHADOW_MODE to false (same release as the desktop
 *   enforcement switch): unbound issuance is then refused with
 *   LICENSE_NO_DEVICE_BINDING, and the desktop fails closed on missing
 *   claims. The flip is one constant; do not flip it alone — the desktop
 *   must be sending deviceId/installId at login/provision/refresh first.
 *
 * DEVICE LIMITS (no schema change — derived from the plan):
 *   Per (user, business): devices are the device_activations rows for that
 *   pair with status != INACTIVE. The cap comes from plan.features.maxDevices
 *   (JSON, backoffice-settable) when present, else LICENSE_DEVICE_LIMITS
 *   keyed by plan id, else LICENSE_DEFAULT_MAX_DEVICES. An already-registered
 *   device re-issues freely; a NEW device past the cap is rejected at
 *   issuance (LICENSE_DEVICE_LIMIT_REACHED). An admin-deactivated (INACTIVE)
 *   device never receives a token (LICENSE_DEVICE_INACTIVE) — that is the
 *   stolen-device kill switch. Issuance NEVER flips a PENDING device to
 *   ACTIVE: activation remains the separate admin act (see device.controller).
 *   A device row that changes hands (shared shop PC switching accounts)
 *   follows the signed-in account, mirroring the check-in reassignment.
 */

import * as crypto from 'crypto';

// ── Policy constants (Muhammad's approved decisions, 2026-10-28) ──────────

/** Hard-expiry behaviour. One-word switch to full lock: 'FULL_LOCK'. */
export const HARD_EXPIRY_MODE = 'READ_ONLY_EXPORT_ONLY' as const;
export type HardExpiryMode = 'READ_ONLY_EXPORT_ONLY' | 'FULL_LOCK';

/**
 * Grace period, in days. SERVER-ONLY home — baked into expiresAt at
 * issuance. The desktop must NOT add grace of its own (see header).
 */
export const GRACE_DAYS = 3;

/** Issuance lifetime cap: expiresAt is never more than this past issuedAt. */
export const LICENSE_MAX_TOKEN_LIFETIME_DAYS = 40;

/** Rollout flag: true = shadow mode (evaluate, do not enforce). */
export const LICENSE_SHADOW_MODE = true;

/** Device cap per plan id (fallback when the plan has no features.maxDevices). */
export const LICENSE_DEVICE_LIMITS: Record<string, number> = {
  'single-trial': 1,
  'single-starter': 1,
  'single-growth': 2,
  'single-scale': 3,
};

/** Device cap for a plan id with no entry above and no features override. */
export const LICENSE_DEFAULT_MAX_DEVICES = 1;

/** Subscription statuses that may receive a license token. */
export const LICENSE_ENTITLED_STATUSES = ['ACTIVE', 'TRIAL', 'GRACE'] as const;

// ── Token payload ─────────────────────────────────────────────────────────

export interface LicensePayload {
  licenseId: string;
  accountId: string;
  businessIds: string[];
  planId: string;
  status: string; // ACTIVE | TRIAL | GRACE
  issuedAt: number; // ms epoch (server time)
  expiresAt: number; // ms epoch (server time) — INCLUDES the 3-day grace
  serverTime: number; // ms epoch at issuance (anti-rollback anchor)
  deviceId: string | null;
  installId: string | null;
}

export interface IssuedLicense {
  token: string;
  licenseId: string;
  planId: string;
  status: string;
  issuedAt: number;
  expiresAt: number;
  businessIds: string[];
  deviceId: string | null;
  installId: string | null;
  deviceCount: number;
  deviceLimit: number;
}

export type LicenseIssueResult =
  | { issued: true; license: IssuedLicense }
  | { issued: false; code: string; message: string };

// ── Key handling ──────────────────────────────────────────────────────────

let cachedPrivateKey: crypto.KeyObject | null = null;
let keyLoadAttempted = false;

/**
 * Load the Ed25519 private key from LICENSE_PRIVATE_KEY_PEM. Accepts the
 * value with literal "\n" escapes (single-line .env form) or real newlines
 * (dotenv converts "\n" inside double quotes; either form loads).
 * Returns null when unconfigured or invalid — issuance is then disabled
 * and callers get LICENSE_NOT_CONFIGURED (login/provision still succeed).
 * The key value is NEVER logged.
 */
export function loadLicensePrivateKey(): crypto.KeyObject | null {
  if (keyLoadAttempted) return cachedPrivateKey;
  keyLoadAttempted = true;
  const raw = process.env.LICENSE_PRIVATE_KEY_PEM;
  if (!raw || !raw.trim()) {
    console.warn('[license] LICENSE_PRIVATE_KEY_PEM is not set — license issuance disabled (no tokens issued)');
    return null;
  }
  const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  try {
    cachedPrivateKey = crypto.createPrivateKey(pem.trim());
    return cachedPrivateKey;
  } catch {
    console.error('[license] LICENSE_PRIVATE_KEY_PEM is set but is not a valid private key — issuance disabled');
    return null;
  }
}

export function isLicenseConfigured(): boolean {
  return loadLicensePrivateKey() !== null;
}

/** Test-only: drop the cached key so a fresh env value is read. */
export function resetLicenseKeyCacheForTests(): void {
  cachedPrivateKey = null;
  keyLoadAttempted = false;
}

// ── Signing / verification ────────────────────────────────────────────────

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(segment: string): Buffer {
  return Buffer.from(String(segment).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Sign a payload with the server private key (or an explicit key, for tests). */
export function signLicenseToken(payload: LicensePayload, privateKey?: crypto.KeyObject): string {
  const key = privateKey ?? loadLicensePrivateKey();
  if (!key) throw new Error('LICENSE_NOT_CONFIGURED');
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = crypto.sign(null, payloadBytes, key);
  return `${base64urlEncode(payloadBytes)}.${base64urlEncode(signature)}`;
}

/**
 * Verify a token against a public key PEM. Mirrors the desktop verifier
 * (same byte-level format). Used by tests and by the shadow-mode self-check;
 * the production path never needs it — the desktop verifies.
 */
export function verifyLicenseToken(token: string, publicKeyPem: string): LicensePayload | null {
  try {
    if (!publicKeyPem || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payloadBytes = base64urlDecode(parts[0]);
    const signature = base64urlDecode(parts[1]);
    if (!crypto.verify(null, payloadBytes, publicKeyPem, signature)) return null;
    const payload = JSON.parse(payloadBytes.toString('utf8')) as LicensePayload;
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Expiry ────────────────────────────────────────────────────────────────

/**
 * Compute expiresAt for a new token. Grace is baked in HERE and nowhere
 * else: expiresAt = min(periodEnd + GRACE_DAYS, issuedAt + 40 days).
 * periodEndMs may be null (no period end on file) — the fallback is
 * issuedAt + fallbackDays (the plan's durationDays, else 30).
 */
export function computeLicenseExpiry(args: {
  nowMs: number;
  periodEndMs: number | null;
  fallbackDays: number;
}): number {
  const graceMs = GRACE_DAYS * 24 * 60 * 60 * 1000;
  const capMs = args.nowMs + LICENSE_MAX_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
  const baseEnd = args.periodEndMs ?? args.nowMs + args.fallbackDays * 24 * 60 * 60 * 1000;
  return Math.min(baseEnd + graceMs, capMs);
}

// ── Device limits ─────────────────────────────────────────────────────────

/** Resolve the device cap for a plan (features.maxDevices wins, else the map, else default). */
export function resolveDeviceLimit(planId: string, planFeatures: unknown): number {
  if (planFeatures && typeof planFeatures === 'object') {
    const override = (planFeatures as Record<string, unknown>).maxDevices;
    if (typeof override === 'number' && Number.isFinite(override) && override >= 1) {
      return Math.floor(override);
    }
  }
  return LICENSE_DEVICE_LIMITS[planId] ?? LICENSE_DEFAULT_MAX_DEVICES;
}

// ── Issuance ──────────────────────────────────────────────────────────────

/**
 * Issue (or refuse) a license token for one business.
 *
 * The prisma argument is the app's PrismaClient; only businessSubscription
 * and deviceActivation delegates are touched, so no schema change is needed.
 * The caller owns the "which business" decision (login: the current
 * membership's business; provision/refresh: the requested business).
 *
 * Refusal codes (license: null, request itself still succeeds):
 *   LICENSE_NOT_CONFIGURED        no/invalid private key in server env
 *   LICENSE_NO_SUBSCRIPTION       business has no subscription row
 *   LICENSE_SUBSCRIPTION_NOT_ACTIVE status is SUSPENDED/EXPIRED/CANCELLED/…
 *   LICENSE_SUBSCRIPTION_EXPIRED  period end already passed (fail closed
 *                                 even if the status row still says ACTIVE)
 *   LICENSE_NO_DEVICE_BINDING     (enforcement only) no deviceId was sent
 *   LICENSE_DEVICE_INACTIVE       device was deactivated by an admin
 *   LICENSE_DEVICE_LIMIT_REACHED  new device would exceed the plan cap
 */
export async function issueLicenseForBusiness(
  prisma: any,
  opts: {
    userId: string;
    businessId: string;
    deviceId?: string | null;
    installId?: string | null;
    fingerprint?: string | null;
    platform?: string | null;
    hostname?: string | null;
  }
): Promise<LicenseIssueResult> {
  const now = new Date();
  const nowMs = now.getTime();
  const logPrefix = `[license] user=${opts.userId} business=${opts.businessId}`;

  if (!isLicenseConfigured()) {
    return { issued: false, code: 'LICENSE_NOT_CONFIGURED', message: 'License issuance is not configured on this server.' };
  }

  // ── 1. Subscription truth (server-side only) ───────────────────────────
  const subscription = await prisma.businessSubscription.findUnique({
    where: { businessId: opts.businessId },
    include: { plan: true },
  });
  if (!subscription) {
    console.log(`${logPrefix} refused LICENSE_NO_SUBSCRIPTION`);
    return { issued: false, code: 'LICENSE_NO_SUBSCRIPTION', message: 'This business has no subscription.' };
  }
  const status = String(subscription.status || '').toUpperCase();
  if (!(LICENSE_ENTITLED_STATUSES as readonly string[]).includes(status)) {
    // Revocation via non-issuance: a SUSPENDED / EXPIRED / CANCELLED
    // subscription simply gets no fresh token; the old one dies at its
    // own expiresAt (at most 40 days out).
    console.log(`${logPrefix} refused LICENSE_SUBSCRIPTION_NOT_ACTIVE status=${status}`);
    return {
      issued: false,
      code: 'LICENSE_SUBSCRIPTION_NOT_ACTIVE',
      message: `Subscription status is ${status}; no license is issued.`,
    };
  }

  // Period end: TRIAL prefers trialEndsAt; otherwise currentPeriodEnd.
  // A period that already ended refuses even if the status row still
  // says ACTIVE (fail closed — the row is not the truth, the date is).
  const periodEnd: Date | null =
    (status === 'TRIAL' ? subscription.trialEndsAt : subscription.currentPeriodEnd) ??
    subscription.currentPeriodEnd ??
    subscription.trialEndsAt ??
    null;
  const fallbackDays =
    typeof subscription.plan?.durationDays === 'number' && subscription.plan.durationDays > 0
      ? subscription.plan.durationDays
      : 30;
  const baseEndMs = periodEnd ? new Date(periodEnd).getTime() : nowMs + fallbackDays * 24 * 60 * 60 * 1000;
  if (baseEndMs <= nowMs) {
    console.log(`${logPrefix} refused LICENSE_SUBSCRIPTION_EXPIRED status=${status} periodEnd=${new Date(baseEndMs).toISOString()}`);
    return {
      issued: false,
      code: 'LICENSE_SUBSCRIPTION_EXPIRED',
      message: 'The subscription period has ended; no license is issued.',
    };
  }
  const expiresAt = computeLicenseExpiry({ nowMs, periodEndMs: periodEnd ? new Date(periodEnd).getTime() : null, fallbackDays });

  // ── 2. Device binding + per-account cap ────────────────────────────────
  const deviceId = opts.deviceId ? String(opts.deviceId).trim() : null;
  const installId = opts.installId ? String(opts.installId).trim() : null;
  const deviceLimit = resolveDeviceLimit(String(subscription.planId), subscription.plan?.features);

  if (!deviceId) {
    // Shadow-mode bridge: legacy clients send no binding yet. Log it and
    // issue an explicitly UNBOUND token so the desktop can exercise the
    // full sign → store → evaluate → report path. Once enforcement ships
    // (LICENSE_SHADOW_MODE = false) this becomes a refusal — and the
    // desktop fails closed on missing claims.
    console.warn(`${logPrefix} issuing UNBOUND token (no deviceId sent; shadow-mode client)`);
    if (!LICENSE_SHADOW_MODE) {
      return {
        issued: false,
        code: 'LICENSE_NO_DEVICE_BINDING',
        message: 'A deviceId is required for license issuance.',
      };
    }
    return issueToken(prisma, {
      userId: opts.userId,
      businessId: opts.businessId,
      subscription,
      status,
      nowMs,
      expiresAt,
      deviceId: null,
      installId: null,
      deviceCount: 0,
      deviceLimit,
      logPrefix,
    });
  }

  const existingDevice = await prisma.deviceActivation.findUnique({ where: { deviceId } });
  if (existingDevice && String(existingDevice.status || '').toUpperCase() === 'INACTIVE') {
    console.log(`${logPrefix} refused LICENSE_DEVICE_INACTIVE device=${deviceId}`);
    return { issued: false, code: 'LICENSE_DEVICE_INACTIVE', message: 'This device has been deactivated. Contact your administrator.' };
  }

  // Devices for THIS (user, business) pair, excluding deactivated ones.
  // (deviceId is globally unique; a row that changed hands follows the
  // signed-in account, mirroring the check-in reassignment.)
  const myDevices = await prisma.deviceActivation.findMany({
    where: { userId: opts.userId, companyId: opts.businessId, status: { not: 'INACTIVE' } },
    select: { deviceId: true },
  });
  const alreadyRegistered = myDevices.some((d: any) => d.deviceId === deviceId);
  const deviceCount = alreadyRegistered ? myDevices.length : myDevices.length + 1;
  if (!alreadyRegistered && myDevices.length >= deviceLimit) {
    console.log(`${logPrefix} refused LICENSE_DEVICE_LIMIT_REACHED device=${deviceId} count=${myDevices.length} limit=${deviceLimit} plan=${subscription.planId}`);
    return {
      issued: false,
      code: 'LICENSE_DEVICE_LIMIT_REACHED',
      message: `Device limit reached for this plan (${myDevices.length}/${deviceLimit} devices). Remove a device or upgrade your plan.`,
    };
  }

  // Record the device (presence row, NOT activation): new devices start
  // PENDING — activation remains the separate admin act. An existing row
  // keeps its status and follows the current account.
  if (existingDevice) {
    await prisma.deviceActivation.update({
      where: { deviceId },
      data: {
        userId: opts.userId,
        companyId: opts.businessId,
        fingerprint: opts.fingerprint || existingDevice.fingerprint,
        platform: opts.platform || existingDevice.platform,
        hostname: opts.hostname || existingDevice.hostname,
        lastVerifiedAt: now,
        lastVerifiedStatus: 'LICENSE_ISSUED',
        updatedAt: now,
      },
    });
  } else {
    await prisma.deviceActivation.create({
      data: {
        deviceId,
        fingerprint: opts.fingerprint || '',
        status: 'PENDING',
        userId: opts.userId,
        companyId: opts.businessId,
        platform: opts.platform || 'desktop',
        hostname: opts.hostname || null,
        lastVerifiedAt: now,
        lastVerifiedStatus: 'LICENSE_ISSUED',
      },
    });
  }

  return issueToken(prisma, {
    userId: opts.userId,
    businessId: opts.businessId,
    subscription,
    status,
    nowMs,
    expiresAt,
    deviceId,
    installId,
    deviceCount,
    deviceLimit,
    logPrefix,
  });
}

async function issueToken(
  _prisma: any,
  args: {
    userId: string;
    businessId: string;
    subscription: any;
    status: string;
    nowMs: number;
    expiresAt: number;
    deviceId: string | null;
    installId: string | null;
    deviceCount: number;
    deviceLimit: number;
    logPrefix: string;
  }
): Promise<LicenseIssueResult> {
  const payload: LicensePayload = {
    licenseId: `lic_${crypto.randomBytes(12).toString('hex')}`,
    accountId: args.userId,
    businessIds: [args.businessId],
    planId: String(args.subscription.planId),
    status: args.status,
    issuedAt: args.nowMs,
    expiresAt: args.expiresAt,
    serverTime: args.nowMs,
    deviceId: args.deviceId,
    installId: args.installId,
  };
  const token = signLicenseToken(payload);
  console.log(
    `${args.logPrefix} issued license=${payload.licenseId} plan=${payload.planId} status=${args.status} ` +
      `expiresAt=${new Date(args.expiresAt).toISOString()} device=${args.deviceId ?? 'unbound'} ` +
      `devices=${args.deviceCount}/${args.deviceLimit} shadow=${LICENSE_SHADOW_MODE}`
  );
  return {
    issued: true,
    license: {
      token,
      licenseId: payload.licenseId,
      planId: payload.planId,
      status: payload.status,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      businessIds: payload.businessIds,
      deviceId: payload.deviceId,
      installId: payload.installId,
      deviceCount: args.deviceCount,
      deviceLimit: args.deviceLimit,
    },
  };
}

/**
 * Read the device binding the desktop sends, from the request body first
 * (login/provision/refresh accept deviceId + installId as optional fields)
 * then the x-device-id / x-install-id headers. Returns nulls when the
 * client sent nothing — the shadow-mode path, never an error by itself.
 */
export function readDeviceBinding(req: any): { deviceId: string | null; installId: string | null } {
  const body = (req && req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const headers = (req && req.headers ? req.headers : {}) as Record<string, unknown>;
  const pick = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    deviceId: pick(body.deviceId) ?? pick(headers['x-device-id']),
    installId: pick(body.installId) ?? pick(headers['x-install-id']),
  };
}
