/**
 * License controller — refresh + shadow-mode reporting.
 *
 * POST /api/license/refresh  (authenticated)
 *   Re-checks the subscription server-side on EVERY issuance and returns a
 *   fresh token (or a structured refusal). This is the desktop's revalidation
 *   cadence: whenever the app is online it refreshes; a lapsed subscription
 *   gets no fresh token (revocation via non-issuance) and the old token
 *   dies at its own expiresAt.
 *
 * POST /api/license/report   (authenticated)
 *   Shadow-mode mismatch log hook: the desktop reports its license verdict
 *   vs the legacy-path verdict so mismatch rates are visible server-side
 *   before enforcement ships. Telemetry only — it never changes state and
 *   never fails the caller (a bad body is logged and acknowledged).
 */

import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { issueLicenseForBusiness, readDeviceBinding, LICENSE_SHADOW_MODE, GRACE_DAYS, HARD_EXPIRY_MODE } from '../services/license.service';

interface LicenseAuthRequest extends Request {
  user?: { id: string };
}

/** Resolve the business a refresh is for: body > x-company-id header > first ACTIVE membership. */
async function resolveRefreshBusiness(prisma: any, req: LicenseAuthRequest): Promise<string | null> {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const fromBody = typeof body.businessId === 'string' && body.businessId.trim() ? body.businessId.trim() : null;
  if (fromBody) return fromBody;
  const headerBusiness = typeof req.headers['x-company-id'] === 'string' ? (req.headers['x-company-id'] as string).trim() : null;
  if (headerBusiness) return headerBusiness;
  const membership = await prisma.membership.findFirst({
    where: { userId: req.user!.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { businessId: true },
  });
  return membership ? String(membership.businessId) : null;
}

export const refreshLicense = async (req: LicenseAuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    const { deviceId, installId } = readDeviceBinding(req);
    if (!deviceId) {
      // Refresh is a license-only endpoint with no legacy callers: a
      // missing binding is a client bug, not a shadow-mode case.
      res.status(400).json({
        success: false,
        code: 'LICENSE_DEVICE_REQUIRED',
        message: 'deviceId is required to refresh a license.',
      });
      return;
    }
    const prisma = await getPrisma();
    const businessId = await resolveRefreshBusiness(prisma, req);
    if (!businessId) {
      res.status(400).json({
        success: false,
        code: 'LICENSE_NO_BUSINESS',
        message: 'No business could be resolved for this account.',
      });
      return;
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const result = await issueLicenseForBusiness(prisma, {
      userId,
      businessId,
      deviceId,
      installId,
      fingerprint: typeof body.fingerprint === 'string' ? body.fingerprint : null,
      platform: typeof body.platform === 'string' ? body.platform : null,
      hostname: typeof body.hostname === 'string' ? body.hostname : null,
    });
    if (!result.issued) {
      res.json({ success: true, license: null, licenseCode: result.code, message: result.message });
      return;
    }
    res.json({ success: true, license: result.license, licenseCode: 'LICENSE_ISSUED' });
  } catch (error: any) {
    console.error('[license] Refresh error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Failed to refresh license' });
  }
};

export const reportLicenseMismatch = async (req: LicenseAuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const licenseVerdict = typeof body.licenseVerdict === 'string' ? body.licenseVerdict : 'unknown';
    const legacyVerdict = typeof body.legacyVerdict === 'string' ? body.legacyVerdict : 'unknown';
    const reason = typeof body.reason === 'string' ? body.reason : 'unknown';
    const mismatch = licenseVerdict !== legacyVerdict;
    console.log(
      `[license-shadow] user=${userId ?? 'unknown'} business=${typeof body.businessId === 'string' ? body.businessId : '-'} ` +
        `device=${typeof body.deviceId === 'string' ? body.deviceId : '-'} ` +
        `licenseVerdict=${licenseVerdict} legacyVerdict=${legacyVerdict} reason=${reason} ` +
        `mismatch=${mismatch} shadow=${LICENSE_SHADOW_MODE} graceDays=${GRACE_DAYS} hardExpiryMode=${HARD_EXPIRY_MODE}`
    );
    res.json({ success: true, received: true, mismatch });
  } catch (error: any) {
    // Telemetry must never fail the caller.
    console.error('[license-shadow] Report error (acknowledged anyway):', error?.message || error);
    res.json({ success: true, received: true, mismatch: false });
  }
};
