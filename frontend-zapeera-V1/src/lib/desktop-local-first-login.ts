/**
 * v1.0.19 Phase 2B — LOCAL-FIRST LOGIN (owner's design, approved
 * 2026-11-11).
 *
 * Sign-in order on desktop: LOCAL first (verify against the cached
 * cloud-verified credential on this device, inside the 30d + 72h
 * revalidation window), then CLOUD (full existing behaviour incl.
 * 2FA; success re-provisions and heals the cache), and only then the
 * internet-required error — with copy that distinguishes
 * never-on-this-device from password-mismatch-on-device.
 *
 * This module performs ONLY the local attempt and classifies the
 * outcome; DesktopLoginFlow owns the ordering and the error copy.
 * The password transits renderer → embedded backend on the app's
 * internal loopback channel only, and is never logged or stored here.
 */
import { getLocalApi } from '@/services/api-clients';

export type LocalFirstAttempt =
  | {
      kind: 'success';
      // ApiResponse-shaped result so LoginForm completes exactly like
      // a cloud login; `localSession` carries the tokens handlePostLogin
      // needs to finish WITHOUT any cloud provisioning.
      result: { success: true; data: any };
      localSession: { token: string | null; sessionToken: string | null };
    }
  | { kind: 'mismatch' | 'unknown' | 'window-expired' | 'unavailable' };

const isElectronRuntime =
  typeof window !== 'undefined' && typeof (window as any).electronAPI !== 'undefined';

export async function tryLocalFirstLogin(credentials: {
  usernameOrEmail: string;
  password: string;
}): Promise<LocalFirstAttempt> {
  if (!isElectronRuntime) return { kind: 'unavailable' };
  try {
    const local = getLocalApi();
    const res: any = await local.localFirstLogin(credentials.usernameOrEmail, credentials.password);
    if (res?.success && res.data?.user) {
      return {
        kind: 'success',
        result: { success: true, data: res.data },
        localSession: {
          token: res.data.token || null,
          sessionToken: res.data.sessionToken || null,
        },
      };
    }
    switch (res?.code) {
      case 'LOCAL_MISMATCH':
        return { kind: 'mismatch' };
      case 'LOCAL_WINDOW_EXPIRED':
        return { kind: 'window-expired' };
      case 'LOCAL_UNKNOWN':
        return { kind: 'unknown' };
      default:
        return { kind: 'unavailable' };
    }
  } catch {
    // Embedded backend unreachable — no local attempt is possible;
    // the cloud attempt proceeds exactly as before.
    return { kind: 'unavailable' };
  }
}

/**
 * Destroy the on-device cached credential for an account the cloud
 * has DEFINITIVELY rejected (disabled / gone). Never call this on a
 * network failure — ambiguous failures purge nothing.
 */
export async function purgeLocalCredential(payload: {
  cloudUserId?: string;
  identifier?: string;
}): Promise<void> {
  if (!isElectronRuntime) return;
  try {
    const local = getLocalApi();
    await local.purgeLocalCredentialCache(payload);
  } catch {
    // Best-effort — a failed purge never breaks the sign-in flow.
  }
}
