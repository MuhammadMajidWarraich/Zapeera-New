import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { RuntimeContext, createRuntimeInfo, type CloudState, type SyncState, type DesktopBusinessState } from '@/lib/runtime';

interface RuntimeProviderProps {
  children: ReactNode;
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
