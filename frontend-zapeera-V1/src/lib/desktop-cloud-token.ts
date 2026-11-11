/**
 * v1.0.19 — Desktop cloud-token coherence.
 *
 * The problem: the cloud access JWT lives 7 days, but the desktop's
 * local session now lives 30 days (+72h offline grace). At day 10 with
 * internet back, the sync layer's cloud token is expired while the
 * local session is still valid — the desktop must renew the CLOUD
 * token without touching the local session (the restore state
 * machine's contract: offline/expired-cloud can never wipe a valid
 * local session).
 *
 * The mechanism: desktop sign-ins (only) receive a desktop-scoped
 * refresh token whose absolute expiry is fixed at sign-in + 35 days
 * (rootExp never extends on rotation). maintainCloudToken() exchanges
 * it for a fresh access token when the current one is expired or has
 * <24h left, persists both tokens, and pushes the new access token
 * into the embedded backend (POST /auth/cloud-token) so the sync
 * engine uses it.
 *
 * Failure posture: network failure = silent no-op (retry on the next
 * trigger). A definitive 401 from the refresh endpoint clears ONLY
 * the refresh token — the local session is never touched here.
 */
import { getCloudApi, getLocalApi, persistCloudToken, persistCloudRefreshToken, readCloudRefreshToken, clearCloudRefreshToken } from '@/services/api-clients';

const isElectronRuntime =
  typeof window !== 'undefined' && typeof (window as any).electronAPI !== 'undefined';

function decodeJwtExp(token: string | null): number | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

let inFlight: Promise<void> | null = null;

export async function maintainCloudToken(): Promise<void> {
  if (!isElectronRuntime) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const refreshToken = readCloudRefreshToken();
      if (!refreshToken) return;

      let accessToken: string | null = null;
      try {
        accessToken = localStorage.getItem('cloudAccessToken');
      } catch { /* ignore */ }

      const exp = decodeJwtExp(accessToken);
      const nowSec = Math.floor(Date.now() / 1000);
      // Still comfortably valid — nothing to do.
      if (exp && exp - nowSec > 24 * 3600) return;

      const cloud = getCloudApi();
      let result: any;
      try {
        result = await cloud.refreshDesktopToken(refreshToken);
      } catch {
        return; // network-level failure: silent no-op
      }

      if (!result?.success || !result?.data?.accessToken) {
        const msg = String(result?.message || '');
        // Definitive rejection (invalid/expired refresh, disabled
        // account): clear ONLY the refresh token. The local session
        // and its data are not touched — renewal simply stops.
        if (/invalid|expired|not available|required/i.test(msg)) {
          clearCloudRefreshToken();
        }
        // Phase 2B (cloud wins on contact): 'Account not available'
        // means the cloud user is gone or disabled — its cached
        // credential on this device is purged too. (An merely expired
        // refresh token purges NOTHING: the local-login window has
        // simply ended.)
        if (/not available/i.test(msg)) {
          try {
            const stored = localStorage.getItem('zapeera_user');
            const uid = stored ? JSON.parse(stored)?.id : null;
            if (uid) {
              const { purgeLocalCredential } = await import('./desktop-local-first-login');
              await purgeLocalCredential({ cloudUserId: uid });
            }
          } catch { /* best-effort */ }
        }
        return;
      }

      const newAccess = result.data.accessToken as string;
      const newRefresh = result.data.desktopRefreshToken as string | undefined;

      cloud.setAccessToken(newAccess);
      persistCloudToken(newAccess);
      if (newRefresh) persistCloudRefreshToken(newRefresh);

      // Hand the fresh token to the embedded backend for the sync layer.
      try {
        const local = getLocalApi();
        await local.postCloudToken(newAccess);
      } catch {
        // Embedded not reachable right now; the persisted cloud token
        // is picked up at the next provision/restore.
      }
    } catch {
      // Maintenance must never break the app.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
