import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { RuntimeContext, createRuntimeInfo, type CloudState, type SyncState, type DesktopBusinessState } from '@/lib/runtime';

interface RuntimeProviderProps {
  children: ReactNode;
}

type ElectronStateResult =
  | { states?: Array<Partial<DesktopBusinessState> & { status?: string }>; lastSyncAt?: string | null }
  | undefined
  | null;

function normalizeDesktopStates(result: ElectronStateResult): DesktopBusinessState[] {
  if (!result || !Array.isArray(result.states)) return [];
  return result.states
    .map((s) => ({
      businessId: String(s.businessId || ''),
      name: s.name || null,
      slug: s.slug || null,
      provisioned: Boolean(s.provisioned ?? s.availableOffline ?? s.status === 'DOWNLOADED'),
      availableOffline: Boolean(s.availableOffline ?? s.status === 'DOWNLOADED'),
      status: s.status || (s.availableOffline ? 'DOWNLOADED' : 'ACTIVE'),
      lastSyncedAt: s.lastSyncedAt || null,
      pendingChanges: s.pendingChanges || 0,
    }))
    .filter((s) => s.businessId);
}

export function RuntimeProvider({ children }: RuntimeProviderProps) {
  const [info, setInfo] = useState(() => createRuntimeInfo());

  const setCloudState = useCallback((cloudState: CloudState) => {
    setInfo(prev => prev.cloudState === cloudState ? prev : { ...prev, cloudState });
  }, []);

  const setSyncState = useCallback((syncState: SyncState) => {
    setInfo(prev => prev.syncState === syncState ? prev : { ...prev, syncState });
  }, []);

  const setDesktopBusinessStates = useCallback((desktopBusinessStates: DesktopBusinessState[]) => {
    setInfo(prev => prev.desktopBusinessStates === desktopBusinessStates ? prev : { ...prev, desktopBusinessStates });
  }, []);

  const setPendingChanges = useCallback((pendingChanges: number) => {
    setInfo(prev => prev.pendingChanges === pendingChanges ? prev : { ...prev, pendingChanges });
  }, []);

  const setLastSyncAt = useCallback((lastSyncAt: string | null) => {
    setInfo(prev => prev.lastSyncAt === lastSyncAt ? prev : { ...prev, lastSyncAt });
  }, []);

  // On mount, check electron for local API URL override
  useEffect(() => {
    if (info.isDesktop) {
      const electronApi = (window as any).electronAPI;
      if (electronApi?.getLocalApiUrl) {
        const url = electronApi.getLocalApiUrl();
        if (url) {
          setInfo(prev => ({ ...prev, localApiUrl: url }));
        }
      }
    }
  }, [info.isDesktop]);

  // Populate per-business desktop states (provisioned/downloaded vs cloud-only).
  useEffect(() => {
    if (!info.isDesktop) return;
    const electronApi = (window as any).electronAPI;
    if (!electronApi?.getLocalBusinessStates) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await electronApi.getLocalBusinessStates();
        if (cancelled) return;
        const states = normalizeDesktopStates(result);
        if (result?.lastSyncAt) {
          setInfo(prev => (prev.lastSyncAt === result.lastSyncAt ? prev : { ...prev, lastSyncAt: result.lastSyncAt }));
        }
        setDesktopBusinessStates(states);
      } catch {
        /* ignore transient failures */
      }
    };

    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [info.isDesktop, setDesktopBusinessStates]);

  const value = useMemo(() => ({
    ...info,
    setCloudState,
    setSyncState,
    setDesktopBusinessStates,
    setPendingChanges,
    setLastSyncAt,
  }), [info, setCloudState, setSyncState, setDesktopBusinessStates, setPendingChanges, setLastSyncAt]);

  return (
    <RuntimeContext.Provider value={value}>
      {children}
    </RuntimeContext.Provider>
  );
}
