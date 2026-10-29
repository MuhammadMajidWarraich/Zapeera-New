/**
 * desktop-session-restore.ts
 *
 * Boot-time restore of the desktop (Electron) session.
 *
 * Why this exists: AuthContext used to validate the saved local session
 * with a single sessionLogin() call and, on ANY failure, wiped the stored
 * session and fell through to the login screen. On the first boot after an
 * over-the-top update that single call could fail transiently — the
 * embedded backend used to accept connections before its database was
 * initialized, and its query layer fails soft to "no rows", so a healthy
 * session was reported as expired. One transient failure permanently
 * destroyed a good session (the wipe removed the very token a later boot
 * could have recovered with).
 *
 * This module is the resilient replacement. Contract:
 *  - 'restored'      — a user was validated (locally, or by silently
 *                      re-provisioning the local session from the saved
 *                      cloud session). The caller may trust the session.
 *  - 'invalid'       — the session is DEFINITIVELY dead: the local backend
 *                      (database confirmed ready) rejects it AND there is
 *                      no usable cloud fallback (no cloud token, or the
 *                      cloud token is expired / rejected). Only now may
 *                      the caller clear the stored session — this preserves
 *                      the original protection against a stale session
 *                      causing a 401 storm on every boot.
 *  - 'indeterminate' — nothing could be proven either way (e.g. offline,
 *                      cloud unreachable, local provisioning glitch). The
 *                      caller shows the login screen for this boot but
 *                      must NOT clear the stored session, so the next boot
 *                      can retry the restore.
 *
 * The core (`restoreDesktopSession`) is dependency-injected and free of
 * app imports so it can be unit-tested outside the renderer.
 */

export interface SessionLoginResultLike {
  success?: boolean;
  data?: { user?: Record<string, unknown> | null } | null;
}

export interface CloudAccountData {
  user: Record<string, unknown>;
  memberships: unknown[];
  businesses: unknown[];
  cloudAccessToken: string;
}

export type CloudAccountResult =
  | { status: 'ok'; account: CloudAccountData }
  | { status: 'invalid' }
  | { status: 'unavailable' }
  | { status: 'none' };

export interface ProvisionResultLike {
  success?: boolean;
  token?: string | null;
  sessionToken?: string | null;
}

export interface DesktopSessionRestoreDeps {
  sessionLogin: () => Promise<SessionLoginResultLike | null | undefined>;
  waitForDatabaseReady: () => Promise<boolean>;
  fetchCloudAccount: () => Promise<CloudAccountResult>;
  provisionLocalSession: (account: CloudAccountData) => Promise<ProvisionResultLike>;
  persistLocalSession: (token: string | null, sessionToken: string | null) => void;
  sleep: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export type DesktopSessionRestoreOutcome =
  | { kind: 'restored'; user: Record<string, unknown>; via: 'local' | 'cloud' }
  | { kind: 'invalid' }
  | { kind: 'indeterminate' };

/** Backoff between local retries once the database reports ready. */
export const SESSION_RESTORE_RETRY_DELAYS_MS: readonly number[] = [600, 1200, 2400];

export async function restoreDesktopSession(
  deps: DesktopSessionRestoreDeps
): Promise<DesktopSessionRestoreOutcome> {
  const log = deps.log ?? (() => undefined);

  const attemptLocal = async (): Promise<Record<string, unknown> | null> => {
    try {
      const res = await deps.sessionLogin();
      const user = res?.data?.user;
      if (res?.success && user && (user as { id?: unknown }).id) {
        return user;
      }
    } catch {
      /* a thrown error is just another transient failure here */
    }
    return null;
  };

  // Fast path — the normal warm boot: one call, no added latency.
  const first = await attemptLocal();
  if (first) return { kind: 'restored', user: first, via: 'local' };

  // The embedded backend may still be initializing (first boot after an
  // update is the slowest). Wait for a definitive readiness signal, then
  // retry with backoff before concluding anything about the session.
  log('Local session check failed; waiting for embedded database readiness before retrying');
  await Promise.resolve()
    .then(() => deps.waitForDatabaseReady())
    .catch(() => false);
  for (const delay of SESSION_RESTORE_RETRY_DELAYS_MS) {
    await deps.sleep(delay);
    const user = await attemptLocal();
    if (user) {
      log('Local session restored after database became ready');
      return { kind: 'restored', user, via: 'local' };
    }
  }

  // The local rejection is now definitive (database ready, retries done):
  // the local session is missing, expired, or revoked. Fall back to the
  // saved cloud session — if the cloud still honours it, silently
  // re-provision a fresh local session from it.
  log('Local session definitively rejected; trying the saved cloud session');
  const cloud = await Promise.resolve()
    .then(() => deps.fetchCloudAccount())
    .catch((): CloudAccountResult => ({ status: 'unavailable' }));

  if (cloud.status === 'ok') {
    try {
      const provisioned = await deps.provisionLocalSession(cloud.account);
      if (provisioned?.success && provisioned.sessionToken) {
        deps.persistLocalSession(provisioned.token ?? null, provisioned.sessionToken);
        const user = await attemptLocal();
        if (user) {
          log('Session restored by re-provisioning from the cloud session');
          return { kind: 'restored', user, via: 'cloud' };
        }
      }
    } catch {
      /* fall through to indeterminate */
    }
    // The cloud vouches for the user but the local side could not be
    // rebuilt. Destroying the stored session would not fix that — keep it
    // and let a later boot retry.
    return { kind: 'indeterminate' };
  }

  if (cloud.status === 'invalid') return { kind: 'invalid' };
  if (cloud.status === 'none') {
    // No cloud fallback exists and the local rejection was definitive.
    return { kind: 'invalid' };
  }
  // 'unavailable' — offline or the cloud could not be reached. Nothing was
  // proven about the session; never destroy it on a guess.
  return { kind: 'indeterminate' };
}

/**
 * Default wiring against the real app services. Uses dynamic imports so
 * this module carries no static app dependencies (keeps the pure core
 * above loadable in isolation, e.g. in tests).
 */
export function createDesktopSessionRestoreDeps(): DesktopSessionRestoreDeps {
  return {
    sessionLogin: async () => {
      const { apiService } = await import('../services/api');
      return apiService.sessionLogin() as unknown as SessionLoginResultLike;
    },

    waitForDatabaseReady: async () => {
      const { config } = await import('./config');
      const origin = String(config.local.baseUrl || '').replace(/\/api\/?$/, '');
      if (!origin) return false;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2000);
          const res = await fetch(`${origin}/health`, { signal: controller.signal, cache: 'no-store' });
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json().catch(() => null)) as { databaseInitialized?: unknown } | null;
            if (data && data.databaseInitialized === true) return true;
            // Very old embedded builds expose no readiness field; a
            // responding /health is the best signal available there.
            if (data && !('databaseInitialized' in data)) return true;
          }
        } catch {
          /* backend not answering yet */
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      return false;
    },

    fetchCloudAccount: async () => {
      let token: string | null = null;
      try {
        token = localStorage.getItem('cloudAccessToken');
      } catch {
        /* storage unavailable */
      }
      if (!token) return { status: 'none' };

      // A locally decodable, already-expired JWT is definitively invalid —
      // the cloud will reject it; classifying it here avoids mistaking an
      // expired token for a network problem (which would keep the dead
      // session alive forever).
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(atob(b64)) as { exp?: unknown };
          if (typeof payload?.exp === 'number' && payload.exp * 1000 < Date.now()) {
            return { status: 'invalid' };
          }
        }
      } catch {
        /* undecodable — let the cloud decide */
      }

      try {
        const { getCloudApi } = await import('../services/api-clients');
        const cloud = getCloudApi();
        if (typeof (cloud as unknown as { setAccessToken?: unknown }).setAccessToken === 'function') {
          (cloud as unknown as { setAccessToken: (t: string) => void }).setAccessToken(token);
        }
        const syncResult = (await cloud.syncAccount()) as {
          success?: boolean;
          data?: { user?: Record<string, unknown>; memberships?: unknown[]; businesses?: unknown[] };
        } | null;
        // NOTE: ApiService.request() does not surface the HTTP status, so a
        // failed syncAccount cannot be split into "cloud rejected the
        // token" vs "transient failure" from here. Expiry (the common
        // definitive case) is already handled above via the exp claim;
        // anything else is reported 'unavailable' so a healthy session is
        // never destroyed on an ambiguous failure. A server-side revoked
        // token still lands the user on the login screen for this boot —
        // it just isn't wiped until a definitive verdict exists.
        if (!syncResult?.success || !syncResult?.data?.user) {
          return { status: 'unavailable' };
        }
        const data = syncResult.data;
        const businesses: unknown[] = [...(data.businesses || [])];
        // Mirror DesktopLoginFlow: merge the full owned+shared business
        // list so provisioning covers businesses whose membership is not
        // ACTIVE. Failure here is tolerated — syncAccount data suffices.
        try {
          const companiesRes = (await cloud.getMyCompanies()) as {
            success?: boolean;
            data?: { owned?: unknown[]; shared?: unknown[] };
          } | null;
          if (companiesRes?.success && companiesRes?.data) {
            const merged = [...(companiesRes.data.owned || []), ...(companiesRes.data.shared || [])].filter(Boolean) as Record<string, unknown>[];
            const seen = new Set(
              (businesses as Record<string, unknown>[]).map((b) => b?.id).filter(Boolean)
            );
            for (const cb of merged) {
              if (!cb?.id || seen.has(cb.id)) continue;
              seen.add(cb.id);
              businesses.push({
                id: cb.id,
                name: cb.name || '',
                slug: cb.slug || null,
                description: cb.description || null,
                address: cb.address || null,
                phone: cb.phone || null,
                email: cb.email || null,
                businessType: cb.businessType || '',
              });
            }
          }
        } catch {
          /* syncAccount data is enough */
        }
        return {
          status: 'ok',
          account: {
            user: data.user,
            memberships: data.memberships || [],
            businesses,
            cloudAccessToken: token,
          },
        };
      } catch {
        return { status: 'unavailable' };
      }
    },

    provisionLocalSession: async (account) => {
      const electronAPI = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: any }).electronAPI : null;
      if (!electronAPI?.provisionLocalSession) return { success: false };
      const { config } = await import('./config');
      const user = account.user as Record<string, any>;
      const res = (await electronAPI.provisionLocalSession({
        user: {
          id: user.id,
          email: user.email || user.username,
          username: user.username || user.email,
          name: user.name,
          role: user.role,
          displayName: user.name,
          companyId: user.companyId,
          branchId: user.branchId,
          isActive: true,
        },
        memberships: account.memberships,
        businesses: account.businesses,
        cloudAccessToken: account.cloudAccessToken,
        cloudApiUrl: String(config.cloud.baseUrl || '').replace(/\/api$/, ''),
      })) as { success?: boolean; data?: { token?: string; sessionToken?: string } } | null;
      if (!res?.success || !res?.data) return { success: false };
      return { success: true, token: res.data.token ?? null, sessionToken: res.data.sessionToken ?? null };
    },

    persistLocalSession: (token, sessionToken) => {
      // Same storage keys services/api-clients persists under
      // (persistLocalToken + the sessionToken write in DesktopLoginFlow);
      // sessionLogin() also re-stores both from its own response on the
      // follow-up validation call.
      try {
        if (token) localStorage.setItem('localAccessToken', token);
      } catch {
        /* ignore */
      }
      try {
        if (sessionToken) localStorage.setItem('sessionToken', sessionToken);
      } catch {
        /* ignore */
      }
    },

    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (message) => {
      try {
        console.log(`[Auth] ${message}`);
      } catch {
        /* ignore */
      }
    },
  };
}
