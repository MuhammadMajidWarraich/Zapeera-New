import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { syncService, type SyncStatus } from '@/services/syncService';
import { apiService } from '@/services/api';
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

  // Multi-counter review (R3/R6, 2026-10-26): poll the open-review count
  // every 60s while online so the header badge can show it. Silent on
  // failure (offline / 503 from the desktop proxy) — the count simply
  // stays at its last value instead of breaking the header.
  useEffect(() => {
    if (status.connectionState !== 'online') return;
    let cancelled = false;
    const fetchReview = async () => {
      try {
        const res = await apiService.getSyncReviewSummary();
        if (!cancelled && res?.data && typeof res.data.open === 'number') {
          setStatus((prev) => (prev.reviewOpen === res.data.open ? prev : { ...prev, reviewOpen: res.data.open }));
        }
      } catch { /* offline or proxy unavailable — keep the last count */ }
    };
    fetchReview();
    const timer = setInterval(fetchReview, 60000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [status.connectionState]);

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
