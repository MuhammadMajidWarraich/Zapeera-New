import { useState, useCallback, useRef } from 'react';
import { getCloudApi, persistCloudToken, persistLocalToken, clearCloudToken, clearLocalToken } from '@/services/api-clients';
import { tryLocalFirstLogin, purgeLocalCredential } from '@/lib/desktop-local-first-login';
import { config } from '@/lib/config';
import LoginForm from '@/components/auth/LoginForm';
import { WifiOff, CheckCircle2, Loader2, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';

type DesktopLoginPhase =
  | 'sign-in'
  | 'authenticating'
  | 'authenticated-remote'
  | 'provisioning-account'
  | 'creating-local-session'
  | 'provisioning-businesses'
  | 'ready'
  | 'failed'
  | 'offline-blocked';

interface DesktopLoginFlowProps {
  onLogin: (user: any) => void;
}

const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null;

export function DesktopLoginFlow({ onLogin }: DesktopLoginFlowProps) {
  const [phase, setPhase] = useState<DesktopLoginPhase>('sign-in');
  const [progressLabel, setProgressLabel] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const provisionStartedRef = useRef(false);
  // v1.0.19 Phase 2B (local-first login): the password from the current
  // cloud attempt, held in memory ONLY so a successful cloud sign-in
  // can cache it (bcrypt, embedded-side) during provisioning. Never
  // persisted, never logged; cleared as soon as provisioning is built.
  const verifiedPasswordRef = useRef<string | null>(null);
  // Set when the local-first attempt succeeds: handlePostLogin finishes
  // from this WITHOUT any cloud provisioning (works fully offline).
  const localFirstSessionRef = useRef<{ token: string | null; sessionToken: string | null } | null>(null);
  // Classification of the last local-first failure, for error copy when
  // the cloud is also unreachable.
  const localClassificationRef = useRef<'mismatch' | 'unknown' | 'window-expired' | null>(null);

  // v1.0.19 Phase 2B — sign-in order (owner's approved design):
  // (1) LOCAL first: a cached cloud-verified credential on this device
  //     signs in fully offline, even after a deliberate logout.
  // (2) CLOUD next: the full existing behaviour incl. 2FA; success
  //     provisions and heals the cache.
  // (3) Internet-required error LAST, with copy that distinguishes
  //     never-on-this-device from password-mismatch-on-device.
  const handleCloudLogin = useCallback(async (credentials: { usernameOrEmail: string; password: string }) => {
    setPhase('authenticating');
    setProgressLabel('Authenticating...');
    setErrorMessage('');
    try {
      const localAttempt = await tryLocalFirstLogin(credentials);
      if (localAttempt.kind === 'success') {
        localFirstSessionRef.current = localAttempt.localSession;
        return localAttempt.result;
      }
      localClassificationRef.current = localAttempt.kind === 'unavailable' ? null : localAttempt.kind;
      verifiedPasswordRef.current = credentials.password;
      const cloud = getCloudApi();
      const result = await cloud.login(credentials);
      // Cloud wins on contact: an account the cloud definitively
      // reports as disabled loses its cached credential on this device.
      if (!result?.success && (result as any)?.accountDisabled) {
        void purgeLocalCredential({ identifier: credentials.usernameOrEmail });
      }
      if (!result?.success) throw new Error(result?.message || 'Authentication failed');
      // Two-factor challenge: the password passed but no session exists
      // yet. Return to the (still-mounted) sign-in form, which renders the
      // code step from this response — there is no access token to store.
      if ((result.data as any)?.twoFactorRequired) {
        setPhase('sign-in');
        return result;
      }
      // Store cloud access token on the cloud API instance and persist it
      const accessToken = (result.data as any)?.accessToken;
      if (accessToken) {
        cloud.setAccessToken(accessToken);
        persistCloudToken(accessToken);
      }
      return result;
    } catch (e: any) {
      const networkFailure = e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError') || e.message?.includes('connect');
      if (networkFailure && localClassificationRef.current) {
        // Local failed AND the cloud is unreachable — the copy must say
        // WHICH case this is, in plain language.
        const copy =
          localClassificationRef.current === 'mismatch'
            ? "That password doesn't match the one saved on this computer, and there's no internet connection to check it online. If the password was changed online, connect to the internet and sign in once with the new password — this computer will remember it again."
            : localClassificationRef.current === 'window-expired'
              ? "It's been over 30 days since this computer last verified your account online, so offline sign-in has paused. Connect to the internet and sign in once to renew it."
              : "This account hasn't signed in on this computer before, and there's no internet connection. The first sign-in on a computer needs the internet — connect and try again.";
        setErrorMessage(copy);
        setPhase('sign-in');
        throw new Error(copy);
      }
      if (networkFailure) {
        setPhase('offline-blocked');
      } else {
        // Any other failure (bad credentials, server error, missing
        // configuration) must return to the sign-in form with the error
        // visible. v1.0.1 left the phase on 'authenticating' here, which
        // unmounted the form and stranded users on an endless spinner.
        setErrorMessage(e.message || 'Login failed. Please try again.');
        setPhase('sign-in');
      }
      throw e;
    }
  }, []);

  // Completes a 2FA-challenged cloud login. On success the response is the
  // standard login payload; persist its cloud access token exactly like
  // handleCloudLogin does, then LoginForm finishes via handlePostLogin.
  const handleCloudLogin2fa = useCallback(async (payload: { challengeToken: string; code?: string; recoveryCode?: string }) => {
    const cloud = getCloudApi();
    const result = await cloud.login2fa(payload);
    const accessToken = (result?.data as any)?.accessToken;
    if (result?.success && accessToken) {
      cloud.setAccessToken(accessToken);
      persistCloudToken(accessToken);
    }
    return result;
  }, []);

  const handlePostLogin = useCallback(async (user: any) => {
    if (provisionStartedRef.current) return;
    provisionStartedRef.current = true;

    // v1.0.19 Phase 2B: local-first success — the embedded backend has
    // already minted the local session. Persist its tokens and finish:
    // NO cloud provisioning (this path works with the internet fully
    // off, including right after a deliberate logout).
    if (localFirstSessionRef.current) {
      const localSession = localFirstSessionRef.current;
      localFirstSessionRef.current = null;
      verifiedPasswordRef.current = null;
      if (localSession.token) {
        persistLocalToken(localSession.token);
      }
      try { localStorage.setItem('sessionToken', localSession.sessionToken || ''); } catch { }
      setPhase('ready');
      setProgressLabel('');
      await new Promise(r => setTimeout(r, 400));
      onLogin(user);
      return;
    }

    setPhase('authenticated-remote');
    setProgressLabel('Fetching account data...');

    let memberships: any[] = [];
    let businesses: any[] = [];
    let cloudUser = user;

    try {
      const cloud = getCloudApi();
      const syncResult = await cloud.syncAccount();
      if (!syncResult?.success || !syncResult?.data) {
        throw new Error(syncResult?.message || 'Account bootstrap failed');
      }
      memberships = syncResult.data.memberships || [];
      businesses = syncResult.data.businesses || [];
      if (syncResult.data.user) {
        cloudUser = { ...user, ...syncResult.data.user };
      }

      // Fetch the full business list (owned + shared) so every accessible
      // business is provisioned locally — even businesses whose membership
      // status is not ACTIVE (otherwise they would be missing on desktop).
      try {
        const companiesRes = await cloud.getMyCompanies();
        if (companiesRes?.success && companiesRes?.data) {
          const myBusinesses = [
            ...((companiesRes.data as any).owned || []),
            ...((companiesRes.data as any).shared || []),
          ].filter(Boolean);
          if (myBusinesses.length > 0) {
            const seen = new Set(businesses.map((b: any) => b?.id));
            for (const cb of myBusinesses) {
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
        }
      } catch (e: any) {
        console.warn('[DesktopLogin] Full business list fetch failed:', e?.message);
      }
    } catch (e: any) {
      setPhase('failed');
      setErrorMessage(e.message || 'Could not fetch your account data from the cloud. Make sure you are connected to the internet and try again.');
      provisionStartedRef.current = false;
      return;
    }

    setPhase('provisioning-account');
    setProgressLabel('Setting up local account...');

    if (!electronAPI) {
      setPhase('failed');
      setErrorMessage('Desktop runtime not available. Cannot provision local session.');
      provisionStartedRef.current = false;
      return;
    }

    setPhase('creating-local-session');
    setProgressLabel('Creating local session...');

    try {
      const cloud = getCloudApi();
      const provisionResult = await electronAPI.provisionLocalSession({
        user: {
          id: cloudUser.id,
          email: cloudUser.email || cloudUser.username,
          username: cloudUser.username || cloudUser.email,
          name: cloudUser.name,
          role: cloudUser.role,
          displayName: cloudUser.name,
          companyId: cloudUser.companyId,
          branchId: cloudUser.branchId,
          isActive: true,
        },
        memberships,
        businesses,
        cloudAccessToken: cloud.accessToken,
        cloudApiUrl: String(config.cloud.baseUrl || '').replace(/\/api$/, ''),
        // Phase 2B: the just-cloud-verified password, for the embedded
        // credential cache (hashed locally, never stored in plaintext).
        verifiedPassword: verifiedPasswordRef.current || undefined,
      });
      verifiedPasswordRef.current = null;

      if (!provisionResult?.success || !provisionResult?.data) {
        throw new Error(provisionResult?.message || 'Session provisioning failed');
      }

      const { token: localAccessToken, sessionToken } = provisionResult.data;

      if (localAccessToken) {
        persistLocalToken(localAccessToken);
        try { localStorage.setItem('sessionToken', sessionToken || ''); } catch { }
      }
    } catch (e: any) {
      setPhase('failed');
      setErrorMessage(e.message || 'Failed to create local session. Please try again.');
      provisionStartedRef.current = false;
      return;
    }

    setPhase('provisioning-businesses');
    setProgressLabel('Preparing your businesses...');
    await new Promise(r => setTimeout(r, 400));

    setPhase('ready');
    setProgressLabel('');
    await new Promise(r => setTimeout(r, 600));
    onLogin(cloudUser);
  }, [onLogin]);

  const handleRetry = useCallback(() => {
    provisionStartedRef.current = false;
    clearCloudToken();
    clearLocalToken();
    setPhase('sign-in');
    setErrorMessage('');
  }, []);

  const handleSignOut = useCallback(() => {
    provisionStartedRef.current = false;
    clearCloudToken();
    clearLocalToken();
    setPhase('sign-in');
    setErrorMessage('');
  }, []);

  if (phase === 'offline-blocked') {
    return (
      <div className="flex items-center justify-center min-h-screen p-8">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="bg-amber-50 dark:bg-amber-950 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
            <WifiOff className="h-10 w-10 text-amber-500" />
          </div>
          <h2 className="text-xl font-semibold">Internet connection required</h2>
          <p className="text-sm text-muted-foreground">
            Connect to the internet the first time you sign in to Zapeera Desktop. After setup, supported businesses can be used offline.
          </p>
          <button onClick={handleRetry} className="px-6 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className="flex items-center justify-center min-h-screen p-8">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="bg-red-50 dark:bg-red-950 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-10 w-10 text-red-500" />
          </div>
          <h2 className="text-xl font-semibold">Zapeera Desktop could not finish setting up your account.</h2>
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={handleRetry} className="inline-flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90">
              <RefreshCw className="h-4 w-4" />
              Retry Setup
            </button>
            <button onClick={handleSignOut} className="inline-flex items-center gap-2 px-6 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80">
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'ready') {
    return (
      <div className="flex items-center justify-center min-h-screen p-8">
        <div className="text-center space-y-4">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
          <h2 className="text-xl font-semibold">Ready to go!</h2>
          <p className="text-sm text-muted-foreground">Opening Zapeera Desktop...</p>
        </div>
      </div>
    );
  }

  // 'authenticating' deliberately keeps the sign-in form mounted (below):
  // unmounting it mid-request would destroy the form's state — including a
  // pending 2FA challenge — before its async handler can act on it. The
  // provisioning progress screen takes over from 'authenticated-remote' on.
  if (phase !== 'sign-in' && phase !== 'authenticating') {
    const phases = [
      { key: 'authenticating', label: 'Authenticating...' },
      { key: 'authenticated-remote', label: 'Fetching account data...' },
      { key: 'provisioning-account', label: 'Setting up local account...' },
      { key: 'creating-local-session', label: 'Creating local session...' },
      { key: 'provisioning-businesses', label: 'Preparing your businesses...' },
    ];
    const currentIdx = phases.findIndex(p => p.key === phase);
    const visiblePhases = phases.slice(0, currentIdx + 2);

    return (
      <div className="flex items-center justify-center min-h-screen p-8">
        <div className="w-full max-w-md space-y-4">
          <h2 className="text-xl font-semibold text-center">{progressLabel}</h2>
          <div className="space-y-3">
            {visiblePhases.map((p, i) => {
              const isActive = i === currentIdx;
              const isDone = i < currentIdx;
              return (
                <div key={p.key} className="flex items-center gap-3 p-3 rounded-lg border">
                  {isDone && <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />}
                  {isActive && <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />}
                  {!isActive && !isDone && <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />}
                  <span className={`text-sm ${isDone ? 'text-green-600 dark:text-green-400' : isActive ? 'font-medium' : 'text-muted-foreground'}`}>
                    {p.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {errorMessage && (
        <div className="absolute inset-x-0 top-4 z-10 mx-auto w-full max-w-md px-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 shadow-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        </div>
      )}
      <LoginForm
        onLogin={handlePostLogin}
        loginHandler={handleCloudLogin}
        login2faHandler={handleCloudLogin2fa}
        signupLabel="Create account"
        onNavigateToSignup={() => {
          // v1.0.19 (model b): no signup form inside the app — the
          // "Create account" action opens the web signup funnel in the
          // system browser.
          const signupUrl = 'https://app.zapeera.seikho.online/signup';
          if (electronAPI?.openExternal) {
            electronAPI.openExternal(signupUrl);
          } else {
            window.open(signupUrl, '_blank', 'noopener,noreferrer');
          }
        }}
      />
    </div>
  );
}
