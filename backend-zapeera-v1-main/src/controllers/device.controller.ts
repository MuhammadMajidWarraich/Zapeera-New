/**
 * Device Presence Controller
 *
 * Powers the account dashboard's "Desktop Connected" card. Presence is a
 * CLOUD fact, recorded per USER (not per business):
 *
 *   - The desktop app checks in (POST /api/devices/check-in) when it signs
 *     in to the cloud and then again on its existing sync cadence. The
 *     check-in upserts a row in device_activations keyed by the device's
 *     stable device id and stamps lastVerifiedAt.
 *   - GET /api/devices/my counts the caller's devices whose last check-in
 *     is inside the connected window and whose status is not INACTIVE.
 *
 * Only the desktop client may create presence: the check-in requires the
 * explicit `client: 'desktop'` marker, so web logins never count and the
 * Android app (which never calls this endpoint) cannot be miscounted.
 *
 * The licensing semantics of device_activations are untouched: a first
 * check-in creates the row as PENDING (activation remains the separate
 * admin act in activation.controller), and an INACTIVE (admin-deactivated)
 * device is never resurrected or counted by a check-in.
 */

import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';

/**
 * A desktop counts as "connected" when it checked in within this window.
 * The desktop checks in at login and then at least every ~5 minutes while
 * the app is open and online (piggybacked on its sync engine), so 30
 * minutes is several missed beats of slack — it means "this desktop is
 * signed in and running now", not day-old presence.
 */
export const DESKTOP_CONNECTED_WINDOW_MS = 30 * 60 * 1000;

function isDeviceConnected(device: { status: string; lastVerifiedAt: Date | null }): boolean {
  if (device.status === 'INACTIVE') return false;
  if (!device.lastVerifiedAt) return false;
  return Date.now() - new Date(device.lastVerifiedAt).getTime() <= DESKTOP_CONNECTED_WINDOW_MS;
}

/**
 * POST /api/devices/check-in  (authenticated; desktop client only)
 * Upsert the caller's desktop device and refresh its presence stamp.
 */
export const checkInDevice = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { deviceId, fingerprint, platform, hostname, client } = req.body || {};

    // Only the desktop app may register desktop presence. Web sessions and
    // any other client are rejected rather than silently miscounted.
    if (client !== 'desktop') {
      return res.status(400).json({
        success: false,
        code: 'DEVICE_CLIENT_NOT_DESKTOP',
        message: 'Device check-in is only accepted from the desktop app.'
      });
    }

    if (!deviceId || !fingerprint) {
      return res.status(400).json({
        success: false,
        message: 'Device ID and fingerprint are required'
      });
    }

    const prisma = await getPrisma();
    const now = new Date();

    const existing = await prisma.deviceActivation.findUnique({
      where: { deviceId }
    });

    // An admin-deactivated device stays deactivated: a check-in must not
    // resurrect it or refresh its presence.
    if (existing && existing.status === 'INACTIVE') {
      return res.json({
        success: true,
        data: {
          deviceId: existing.deviceId,
          status: existing.status,
          connected: false,
          lastVerifiedAt: existing.lastVerifiedAt
        }
      });
    }

    const device = existing
      ? await prisma.deviceActivation.update({
          where: { deviceId },
          data: {
            // The record follows the account currently signed in on the
            // device (e.g. a shared shop PC switching accounts).
            userId,
            fingerprint,
            platform: platform || existing.platform,
            hostname: hostname || existing.hostname,
            lastVerifiedAt: now,
            lastVerifiedStatus: 'CHECK_IN',
            updatedAt: now
          }
        })
      : await prisma.deviceActivation.create({
          data: {
            deviceId,
            fingerprint,
            // Presence is not licensing: new devices start PENDING exactly
            // like the legacy register flow; activation stays an admin act.
            status: 'PENDING',
            userId,
            platform: platform || 'desktop',
            hostname: hostname || null,
            lastVerifiedAt: now,
            lastVerifiedStatus: 'CHECK_IN'
          }
        });

    return res.json({
      success: true,
      data: {
        deviceId: device.deviceId,
        status: device.status,
        connected: isDeviceConnected(device),
        lastVerifiedAt: device.lastVerifiedAt
      }
    });
  } catch (error: any) {
    console.error('[Devices] Check-in error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/devices/my  (authenticated)
 * The caller's desktop devices + the truthful connected count used by the
 * account dashboard's "Desktop Connected" card.
 */
export const getMyDevices = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const prisma = await getPrisma();

    const rows = await prisma.deviceActivation.findMany({
      where: { userId },
      orderBy: { lastVerifiedAt: 'desc' }
    });

    const devices = rows.map((d) => ({
      deviceId: d.deviceId,
      platform: d.platform,
      hostname: d.hostname,
      status: d.status,
      lastSeenAt: d.lastVerifiedAt,
      connected: isDeviceConnected(d)
    }));

    return res.json({
      success: true,
      data: {
        devices,
        desktopConnected: devices.filter((d) => d.connected).length
      }
    });
  } catch (error: any) {
    console.error('[Devices] List my devices error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
