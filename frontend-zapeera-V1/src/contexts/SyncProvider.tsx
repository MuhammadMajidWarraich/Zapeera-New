import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { syncService, type SyncStatus } from '@/services/syncService';
import { useRuntime } from '@/lib/runtime';

interface SyncContextValue {
  status: SyncStatus;
  triggerSync: () => Promise<{ success: boolean; message?: string }>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>(syncService.getCurrentStatus());
  const { setCloudState, setSyncState, setPendingChanges, setLastSyncAt } = useRuntime();

  useEffect(() => {
    syncService.setRuntimeUpdater(setStatus);
    const unsub = syncService.subscribe(setStatus);
    syncService.startPolling();
    return () => {
      unsub();
      syncService.stopPolling();
    };
  }, []);

  // Sync runtime context with sync service state
  useEffect(() => {
    setCloudState(status.connectionState);
    setSyncState(status.syncState);
    setPendingChanges(status.pendingChanges);
    setLastSyncAt(status.lastSyncAt);
  }, [status, setCloudState, setSyncState, setPendingChanges, setLastSyncAt]);

  const triggerSync = async () => syncService.triggerSync();

  return (
    <SyncContext.Provider value={{ status, triggerSync }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within a SyncProvider');
  return ctx;
}
