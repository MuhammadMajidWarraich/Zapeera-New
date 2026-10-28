/**
 * License service tests — server-side issuance (feature/license-server).
 *
 * Pure unit tests: signing/verification use a throwaway in-memory Ed25519
 * keypair; issuance uses a fake prisma object (no database, no schema).
 * No secret material: the throwaway key is generated fresh per run and is
 * never written anywhere.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import * as crypto from 'crypto';
import {
  signLicenseToken,
  verifyLicenseToken,
  computeLicenseExpiry,
  resolveDeviceLimit,
  issueLicenseForBusiness,
  readDeviceBinding,
  resetLicenseKeyCacheForTests,
  GRACE_DAYS,
  LICENSE_MAX_TOKEN_LIFETIME_DAYS,
  LICENSE_DEVICE_LIMITS,
} from '../src/services/license.service';

const DAY = 24 * 60 * 60 * 1000;

let throwawayPrivatePem: string;
let throwawayPublicPem: string;

function makeKeypair(): void {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  throwawayPrivatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  throwawayPublicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

function enableIssuance(): void {
  process.env.LICENSE_PRIVATE_KEY_PEM = throwawayPrivatePem;
  resetLicenseKeyCacheForTests();
}

function disableIssuance(): void {
  delete process.env.LICENSE_PRIVATE_KEY_PEM;
  resetLicenseKeyCacheForTests();
}

function makeSubscription(overrides: Record<string, any> = {}): any {
  const now = Date.now();
  return {
    businessId: 'biz-1',
    planId: 'single-growth',
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodEnd: new Date(now + 30 * DAY),
    plan: { durationDays: 30, features: null },
    ...overrides,
  };
}

/** Minimal fake prisma: only the delegates the license service touches. */
function makePrisma(opts: {
  subscription?: any;
  devicesById?: Record<string, any>;
  myDevices?: Array<{ deviceId: string }>;
}): any {
  const created: any[] = [];
  const updated: any[] = [];
  return {
    __created: created,
    __updated: updated,
    businessSubscription: {
      findUnique: async () => opts.subscription ?? null,
    },
    deviceActivation: {
      findUnique: async ({ where }: any) => opts.devicesById?.[where.deviceId] ?? null,
      findMany: async () => opts.myDevices ?? [],
      create: async ({ data }: any) => {
        created.push(data);
        return { ...data, id: 'dev-row-1' };
      },
      update: async ({ where, data }: any) => {
        updated.push({ where, data });
        return { ...data, id: 'dev-row-1' };
      },
    },
    membership: { findFirst: async () => null },
  };
}

beforeEach(() => {
  makeKeypair();
});

describe('sign / verify (same wire format as the desktop verifier)', () => {
  it('round-trips a payload through sign + verify', () => {
    enableIssuance();
    const payload: any = {
      licenseId: 'lic_test',
      accountId: 'user-1',
      businessIds: ['biz-1'],
      planId: 'single-growth',
      status: 'ACTIVE',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 30 * DAY,
      serverTime: Date.now(),
      deviceId: 'dev-1',
      installId: 'inst-1',
    };
    const token = signLicenseToken(payload);
    expect(token.split('.')).toHaveLength(2);
    const verified = verifyLicenseToken(token, throwawayPublicPem);
    expect(verified).toEqual(payload);
  });

  it('rejects a tampered payload (plan upgraded / expiry extended)', () => {
    enableIssuance();
    const payload: any = {
      licenseId: 'lic_test',
      accountId: 'user-1',
      businessIds: ['biz-1'],
      planId: 'single-starter',
      status: 'ACTIVE',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 30 * DAY,
      serverTime: Date.now(),
      deviceId: 'dev-1',
      installId: 'inst-1',
    };
    const token = signLicenseToken(payload);
    const [payloadSeg, sigSeg] = token.split('.');
    const tamperedBytes = Buffer.from(payloadSeg.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const tamperedPayload = JSON.parse(tamperedBytes.toString('utf8'));
    tamperedPayload.planId = 'single-scale';
    tamperedPayload.expiresAt = Date.now() + 365 * DAY;
    const tamperedSeg = Buffer.from(JSON.stringify(tamperedPayload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifyLicenseToken(`${tamperedSeg}.${sigSeg}`, throwawayPublicPem)).toBeNull();
  });

  it('rejects a token verified against a different public key', () => {
    enableIssuance();
    const { publicKey: other } = crypto.generateKeyPairSync('ed25519');
    const otherPem = other.export({ type: 'spki', format: 'pem' }).toString();
    const token = signLicenseToken({
      licenseId: 'lic_test',
      accountId: 'user-1',
      businessIds: ['biz-1'],
      planId: 'single-growth',
      status: 'ACTIVE',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 30 * DAY,
      serverTime: Date.now(),
      deviceId: 'dev-1',
      installId: 'inst-1',
    } as any);
    expect(verifyLicenseToken(token, otherPem)).toBeNull();
  });

  it('throws LICENSE_NOT_CONFIGURED when no private key is set', () => {
    disableIssuance();
    expect(() =>
      signLicenseToken({
        licenseId: 'lic_test',
        accountId: 'user-1',
        businessIds: ['biz-1'],
        planId: 'single-growth',
        status: 'ACTIVE',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 30 * DAY,
        serverTime: Date.now(),
        deviceId: 'dev-1',
        installId: 'inst-1',
      } as any)
    ).toThrow('LICENSE_NOT_CONFIGURED');
  });
});

describe('expiry — grace has exactly ONE home (the server)', () => {
  it('graceDays is 3', () => {
    expect(GRACE_DAYS).toBe(3);
  });

  it('bakes exactly 3 days of grace into expiresAt when inside the cap', () => {
    const now = Date.now();
    const periodEnd = now + 30 * DAY;
    const expiresAt = computeLicenseExpiry({ nowMs: now, periodEndMs: periodEnd, fallbackDays: 30 });
    expect(expiresAt).toBe(periodEnd + 3 * DAY);
  });

  it('caps expiresAt at issuedAt + 40 days for far-future period ends', () => {
    const now = Date.now();
    const expiresAt = computeLicenseExpiry({ nowMs: now, periodEndMs: now + 365 * DAY, fallbackDays: 365 });
    expect(expiresAt).toBe(now + LICENSE_MAX_TOKEN_LIFETIME_DAYS * DAY);
    expect(LICENSE_MAX_TOKEN_LIFETIME_DAYS).toBe(40);
  });

  it('falls back to plan durationDays when no period end is on file', () => {
    const now = Date.now();
    const expiresAt = computeLicenseExpiry({ nowMs: now, periodEndMs: null, fallbackDays: 14 });
    expect(expiresAt).toBe(now + 14 * DAY + 3 * DAY);
  });
});

describe('device limits', () => {
  it('uses the per-plan map, defaulting to 1 for unknown plans', () => {
    expect(resolveDeviceLimit('single-growth', null)).toBe(2);
    expect(resolveDeviceLimit('single-scale', null)).toBe(3);
    expect(resolveDeviceLimit('single-trial', null)).toBe(1);
    expect(resolveDeviceLimit('no-such-plan', null)).toBe(1);
    expect(LICENSE_DEVICE_LIMITS['single-growth']).toBe(2);
  });

  it('lets plan.features.maxDevices override the map', () => {
    expect(resolveDeviceLimit('single-growth', { maxDevices: 5 })).toBe(5);
    expect(resolveDeviceLimit('single-growth', { maxDevices: 0 })).toBe(2); // invalid override ignored
    expect(resolveDeviceLimit('single-growth', { maxDevices: '3' })).toBe(2); // non-numeric ignored
  });
});

describe('readDeviceBinding', () => {
  it('reads body first, then headers, then nulls', () => {
    expect(readDeviceBinding({ body: { deviceId: 'd1', installId: 'i1' }, headers: {} })).toEqual({
      deviceId: 'd1',
      installId: 'i1',
    });
    expect(readDeviceBinding({ body: {}, headers: { 'x-device-id': 'dh', 'x-install-id': 'ih' } })).toEqual({
      deviceId: 'dh',
      installId: 'ih',
    });
    expect(readDeviceBinding({ body: {}, headers: {} })).toEqual({ deviceId: null, installId: null });
    expect(readDeviceBinding({} as any)).toEqual({ deviceId: null, installId: null });
  });
});

describe('issueLicenseForBusiness', () => {
  it('issues a bound token for an ACTIVE subscription (expiresAt = periodEnd + 3d)', async () => {
    enableIssuance();
    const subscription = makeSubscription();
    const prisma = makePrisma({ subscription, myDevices: [] });
    const result = await issueLicenseForBusiness(prisma, {
      userId: 'user-1',
      businessId: 'biz-1',
      deviceId: 'dev-1',
      installId: 'inst-1',
      fingerprint: 'fp-1',
    });
    expect(result.issued).toBe(true);
    if (!result.issued) return;
    expect(result.license.planId).toBe('single-growth');
    expect(result.license.status).toBe('ACTIVE');
    expect(result.license.deviceId).toBe('dev-1');
    expect(result.license.installId).toBe('inst-1');
    expect(result.license.deviceCount).toBe(1);
    expect(result.license.deviceLimit).toBe(2);
    expect(result.license.expiresAt).toBe(new Date(subscription.currentPeriodEnd as Date).getTime() + 3 * DAY);
    // The issued token verifies against the throwaway public key.
    const payload = verifyLicenseToken(result.license.token, throwawayPublicPem);
    expect(payload).not.toBeNull();
    expect(payload?.licenseId).toBe(result.license.licenseId);
    // New device row created PENDING (issuance is not activation).
    expect(prisma.__created).toHaveLength(1);
    expect(prisma.__created[0].status).toBe('PENDING');
    expect(prisma.__created[0].lastVerifiedStatus).toBe('LICENSE_ISSUED');
  });

  it('re-issues freely for an already-registered device', async () => {
    enableIssuance();
    const prisma = makePrisma({
      subscription: makeSubscription(),
      devicesById: { 'dev-1': { deviceId: 'dev-1', status: 'PENDING', fingerprint: 'fp-1' } },
      myDevices: [{ deviceId: 'dev-1' }],
    });
    const result = await issueLicenseForBusiness(prisma, {
      userId: 'user-1',
      businessId: 'biz-1',
      deviceId: 'dev-1',
      installId: 'inst-1',
    });
    expect(result.issued).toBe(true);
    if (!result.issued) return;
    expect(result.license.deviceCount).toBe(1);
    expect(prisma.__created).toHaveLength(0);
    expect(prisma.__updated).toHaveLength(1);
  });

  it('rejects a new device past the plan cap', async () => {
    enableIssuance();
    const prisma = makePrisma({
      subscription: makeSubscription(), // single-growth: cap 2
      myDevices: [{ deviceId: 'dev-a' }, { deviceId: 'dev-b' }],
    });
    const result = await issueLicenseForBusiness(prisma, {
      userId: 'user-1',
      businessId: 'biz-1',
      deviceId: 'dev-new',
      installId: 'inst-1',
    });
    expect(result.issued).toBe(false);
    if (result.issued) return;
    expect(result.code).toBe('LICENSE_DEVICE_LIMIT_REACHED');
    expect(prisma.__created).toHaveLength(0);
  });

  it('refuses an admin-deactivated (INACTIVE) device', async () => {
    enableIssuance();
    const prisma = makePrisma({
      subscription: makeSubscription(),
      devicesById: { 'dev-1': { deviceId: 'dev-1', status: 'INACTIVE' } },
      myDevices: [],
    });
    const result = await issueLicenseForBusiness(prisma, {
      userId: 'user-1',
      businessId: 'biz-1',
      deviceId: 'dev-1',
      installId: 'inst-1',
    });
    expect(result.issued).toBe(false);
    if (result.issued) return;
    expect(result.code).toBe('LICENSE_DEVICE_INACTIVE');
  });

  it('refuses issuance for a SUSPENDED subscription (revocation via non-issuance)', async () => {
    enableIssuance();
    const prisma = makePrisma({ subscription: makeSubscription({ status: 'SUSPENDED' }) });
    const result = await issueLicenseForBusiness(prisma, {
      userId: 'user-1',
      businessId: 'biz-1',
      deviceId: 'dev-1',
      installId: 'inst-1',
    });
    expect(result.issued).toBe(false);
    if (result.issued) return;
    expect(result.code).toBe('LICENSE_SUBSCRIPTION_NOT_ACTIVE');
  });

  it('refuses when the period already ended even though status says ACTIVE', async () => {
    enableIssuance();
    const prisma = makePrisma({
      subscription: makeSubscription({ currentPeriodEnd: new Date(Date.now() - DAY) }),
    });
    const result = await issueLicenseForBusiness(prisma, {
      userId: 'user-1',
      businessId: 'biz-1',
      deviceId: 'dev-1',
      installId: 'inst-1',
    });
    expect(result.issued).toBe(false);
    if (result.issued) return;
    expect(result.code).toBe('LICENSE_SUBSCRIPTION_EXPIRED');
  });

  it('refuses when the business has no subscription', async () => {
    enableIssuance();
    const prisma = makePrisma({ subscription: null });
    const result = await issueLicenseForBusiness(prisma, {
      userId: 'user-1',
      businessId: 'biz-1',
      deviceId: 'dev-1',
      installId: 'inst-1',
    });
    expect(result.issued).toBe(false);
    if (result.issued) return;
    expect(result.code).toBe('LICENSE_NO_SUBSCRIPTION');
  });

  it('issues an explicitly UNBOUND token in shadow mode when no binding is sent', async () => {
    enableIssuance();
    const prisma = makePrisma({ subscription: makeSubscription(), myDevices: [] });
    const result = await issueLicenseForBusiness(prisma, {
      userId: 'user-1',
      businessId: 'biz-1',
    });
    expect(result.issued).toBe(true);
    if (!result.issued) return;
    expect(result.license.deviceId).toBeNull();
    expect(result.license.installId).toBeNull();
  });

  it('refuses everything when no private key is configured', async () => {
    disableIssuance();
    const prisma = makePrisma({ subscription: makeSubscription() });
    const result = await issueLicenseForBusiness(prisma, {
      userId: 'user-1',
      businessId: 'biz-1',
      deviceId: 'dev-1',
      installId: 'inst-1',
    });
    expect(result.issued).toBe(false);
    if (result.issued) return;
    expect(result.code).toBe('LICENSE_NOT_CONFIGURED');
  });

  it('uses trialEndsAt as the period end for TRIAL subscriptions', async () => {
    enableIssuance();
    const trialEnd = new Date(Date.now() + 10 * DAY);
    const prisma = makePrisma({
      subscription: makeSubscription({
        status: 'TRIAL',
        trialEndsAt: trialEnd,
        currentPeriodEnd: new Date(Date.now() + 30 * DAY),
      }),
      myDevices: [],
    });
    const result = await issueLicenseForBusiness(prisma, {
      userId: 'user-1',
      businessId: 'biz-1',
      deviceId: 'dev-1',
      installId: 'inst-1',
    });
    expect(result.issued).toBe(true);
    if (!result.issued) return;
    expect(result.license.expiresAt).toBe(trialEnd.getTime() + 3 * DAY);
    expect(result.license.status).toBe('TRIAL');
  });
});
