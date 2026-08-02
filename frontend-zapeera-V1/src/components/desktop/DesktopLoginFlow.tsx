import { useState, useCallback, useRef } from 'react';
import { getCloudApi, persistCloudToken, persistLocalToken, clearCloudToken, clearLocalToken } from '@/services/api-clients';
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

  const handleCloudLogin = useCallback(async (credentials: { usernameOrEmail: string; password: string }) => {
    setPhase('authenticating');
    setProgressLabel('Authenticating...');
    try {
      const cloud = getCloudApi();
      const result = await cloud.login(credentials);
      if (!result?.success) throw new Error(result?.message || 'Authentication failed');
      // Store cloud access token on the cloud API instance and persist it
      const accessToken = (result.data as any)?.accessToken;
      if (accessToken) {
        cloud.setAccessToken(accessToken);
        persistCloudToken(accessToken);
      }
      return result;
    } catch (e: any) {
      if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError') || e.message?.includes('connect')) {
        setPhase('offline-blocked');
      }
      throw e;
    }
  }, []);

  const handlePostLogin = useCallback(async (user: any) => {
    if (provisionStartedRef.current) return;
    provisionStartedRef.current = true;

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
      });

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

  if (phase !== 'sign-in') {
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

  return <LoginForm onLogin={handlePostLogin} loginHandler={handleCloudLogin} />;
}
