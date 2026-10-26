import { apiService } from './api';
import { getCloudApi, getLocalApi } from './api-clients';
import type { CloudState, SyncState } from '@/lib/runtime';

export interface SyncStatus {
  connectionState: CloudState;
  syncState: SyncState;
  lastSyncAt: string | null;
  pendingChanges: number;
  failedChanges: number;
  inProgress: boolean;
  // Multi-counter review (R3/R6, 2026-10-26): open sales in the review
  // list (oversold / offline / replay-pending). Polled by the
  // SyncProvider from /sync/review/summary — NOT part of the engine
  // status, so it survives engine restarts and works in web mode too.
  reviewOpen: number;
  // Desktop only, from the main-process sync status: how many businesses
  // the local DB holds memberships for, and the last account-sync outcome
  // (null until an account sync has run or failed). These are what let
  // the UI tell "online and syncing" from "online but nothing will ever
  // download" (2026-10-24 trap).
  localBusinessCount: number;
  accountSyncError: string | null;
  // Desktop only (v1.0.8, RC-1a): last pull's apply failures — rows the
  // cloud sent that the local DB could not store (null when the last
  // pull applied cleanly). Shown in Settings → Device Status.
  // v1.0.8 fixup (RC-1c): `skipped` lists records quarantined off a
  // poison batch after 3 consecutive failed pulls — the cursor was
  // advanced past them, so they are named here rather than dropped
  // silently. `failures` lists the per-record failures of the last pull
  // with the underlying DB error text (capped at 10), so the surface
  // names the failing column instead of only the console lines doing so.
  applyFailures: { at: string; total: number; byEntity: Record<string, number>; failures?: Array<{ entityType: string; entityId: string; error: string; businessId: string }>; skipped?: Array<{ entityType: string; entityId: string; error: string; skippedAt: string; businessId: string }> } | null;
}

export type SyncStateListener = (status: SyncStatus) => void;

/**
 * Map the desktop sync engine's states (electron/services/sync.service.js:
 * OFFLINE / PENDING / ERROR / AUTH_REQUIRED / CLOUD_REACHABLE /
 * SYNC_READY / SYNCING / SYNCED) onto the renderer's CloudState. The IPC
 * branch of getDesktopStatus previously stored the engine value RAW, so
 * e.g. "SYNCED" never equalled 'online' and the header badge showed
 * "Offline" on a connected machine; PENDING/ERROR/CLOUD_REACHABLE fell
 * to the same wrong display. CLOUD_REACHABLE means the cloud answered
 * /health — the machine IS online, sync just hasn't been authorized or
 * hasn't run yet — so it maps to 'online' for connectivity purposes,
 * with syncState carrying the not-yet-synced nuance.
 */
export function mapEngineConnectionState(engineState?: string | null): { connectionState: CloudState; syncState: SyncState } {
  switch ((engineState || '').toUpperCase()) {
    case 'SYNC_READY':
    case 'SYNCED':
      return { connectionState: 'online', syncState: 'synced' };
    case 'SYNCING':
      return { connectionState: 'online', syncState: 'syncing' };
    case 'CLOUD_REACHABLE':
      return { connectionState: 'online', syncState: 'idle' };
    case 'PENDING':
      return { connectionState: 'online', syncState: 'pending' };
    case 'AUTH_REQUIRED':
      return { connectionState: 'auth-required', syncState: 'offline' };
    case 'ERROR':
      return { connectionState: 'offline', syncState: 'failed' };
    case 'OFFLINE':
      return { connectionState: 'offline', syncState: 'offline' };
    default:
      return { connectionState: 'checking', syncState: 'offline' };
  }
}

class SyncService {
  private status: SyncStatus = this.getDefaultStatus();
  private listeners: Set<SyncStateListener> = new Set();
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private runtimeUpdater: ((status: SyncStatus) => void) | null = null;
  private localApiAttempted: boolean = false;

  private getDefaultStatus(): SyncStatus {
    return {
      connectionState: 'checking',
      syncState: 'offline',
      lastSyncAt: null,
      pendingChanges: 0,
      failedChanges: 0,
      inProgress: false,
      reviewOpen: 0,
      localBusinessCount: 0,
      accountSyncError: null,
      applyFailures: null,
    };
  }

  setRuntimeUpdater(updater: (status: SyncStatus) => void): void {
    this.runtimeUpdater = updater;
  }

  private updateAndNotify(partial: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...partial };
    this.listeners.forEach(fn => fn(this.status));
    this.runtimeUpdater?.(this.status);
  }

  async checkCloudConnectivity(): Promise<CloudState> {
    this.updateAndNotify({ connectionState: 'checking' });
    try {
      const cloud = getCloudApi();
      const res = await cloud.request<{ success?: boolean }>('/health', { method: 'GET' });
      const connected = res?.success !== false;
      const state: CloudState = connected ? 'online' : 'offline';
      this.updateAndNotify({ connectionState: state });
      return state;
    } catch {
      this.updateAndNotify({ connectionState: 'offline' });
      return 'offline';
    }
  }

  async checkLocalConnectivity(): Promise<boolean> {
    try {
      const local = getLocalApi();
      const res = await local.request<{ status?: string }>('/health', { method: 'GET' });
      return res?.status === 'ok';
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<SyncStatus> {
    const isDesktop = typeof window !== 'undefined' && typeof (window as any).electronAPI !== 'undefined';

    if (isDesktop) {
      return this.getDesktopStatus();
    }

    // Don't call the endpoint if there's no auth token — avoids 401 noise
    const hasToken = typeof window !== 'undefined' && localStorage.getItem('token');
    if (!hasToken) {
      if (this.status.connectionState === 'checking') {
        this.updateAndNotify({ connectionState: 'offline', syncState: 'offline' });
      }
      return this.status;
    }

    try {
      const res = await apiService.request<{ data?: { connectionState?: string; syncState?: string; lastSync?: string; pendingItems?: number } }>('/sync/status', { method: 'GET' });
      if (res?.data) {
        const d = res.data;
        this.updateAndNotify({
          connectionState: (d.connectionState as CloudState) || 'online',
          syncState: (d.syncState as SyncState) || (d.pendingItems && d.pendingItems > 0 ? 'pending' : 'idle'),
          lastSyncAt: d.lastSync || null,
          pendingChanges: d.pendingItems || 0,
        });
      }
    } catch {
      if (this.status.connectionState === 'checking') {
        this.updateAndNotify({ connectionState: 'offline', syncState: 'offline' });
      }
    }
    return this.status;
  }

  private async getDesktopStatus(): Promise<SyncStatus> {
    // Skip API call if no local token — prevents 401→logout before local session is established
    const localToken = typeof window !== 'undefined' ? (localStorage.getItem('localAccessToken') || localStorage.getItem('token')) : null;
    if (!localToken) {
      return this.status;
    }

    try {
      const electronApi = (window as any).electronAPI;
      if (electronApi?.getSyncStatus) {
        const result = await electronApi.getSyncStatus();
        if (result?.connectionState) {
          const mapped = mapEngineConnectionState(result.connectionState);
          // Setup-pending (2026-10-24 trap): the cloud answers, but the
          // local DB holds zero memberships, so provision/pull iterate
          // zero rows and nothing will ever download. Do NOT report this
          // as plain 'online'/'synced': the badge must say the download
          // hasn't happened. Unknown count (-1: field absent) never
          // triggers this — only a confirmed zero does. A sync actually
          // in flight keeps 'syncing' (no flicker during recovery).
          const localBusinessCount = typeof result.localBusinessCount === 'number' ? result.localBusinessCount : -1;
          const setupPending =
            mapped.connectionState === 'online' &&
            mapped.syncState !== 'syncing' &&
            localBusinessCount === 0;
          const accountSyncError =
            result.accountSync && result.accountSync.success === false
              ? (result.accountSync.message || 'Account sync failed')
              : null;
          this.updateAndNotify({
            connectionState: mapped.connectionState,
            syncState: setupPending
              ? 'setup-pending'
              : mapped.syncState === 'synced' && (result.pendingChanges || 0) > 0
                ? 'pending'
                : mapped.syncState,
            lastSyncAt: result.lastSyncAt || null,
            pendingChanges: result.pendingChanges || 0,
            failedChanges: result.failedChanges || 0,
            inProgress: result.inProgress || false,
            localBusinessCount: localBusinessCount < 0 ? 0 : localBusinessCount,
            accountSyncError,
            applyFailures: result.applyFailures || null,
          });
          return this.status;
        }
      }
    } catch { /* fall through */ }

    try {
      const local = getLocalApi();
      const res = await local.request<{ data?: { connectionState?: string; status?: string; pendingChanges?: number } }>('/sync/status', { method: 'GET' });
      if (res?.data) {
        const d = res.data;
        const mapped = mapEngineConnectionState(d.connectionState);
        const syncSt: SyncState = d.status === 'syncing' ? 'syncing' : mapped.syncState === 'synced' && (d.pendingChanges || 0) > 0 ? 'pending' : mapped.syncState;
        this.updateAndNotify({ connectionState: mapped.connectionState, syncState: syncSt, pendingChanges: d.pendingChanges || 0, lastSyncAt: (d as any).lastSync || null });
      }
    } catch {
      if (this.status.connectionState === 'checking') {
        this.updateAndNotify({ connectionState: 'offline', syncState: 'offline' });
      }
    }
    return this.status;
  }

  async triggerSync(): Promise<{ success: boolean; message?: string }> {
    const isDesktop = typeof window !== 'undefined' && typeof (window as any).electronAPI !== 'undefined';
    this.updateAndNotify({ syncState: 'syncing', inProgress: true });

    try {
      if (isDesktop) {
        try {
          const local = getLocalApi();
          const res = await local.request<{ success?: boolean; message?: string }>('/sync/push', { method: 'POST' });
          this.updateAndNotify({ syncState: res?.success !== false ? 'synced' : 'failed', inProgress: false });
          return { success: res?.success !== false, message: res?.message };
        } catch (e: any) {
          this.updateAndNotify({ syncState: 'failed', inProgress: false });
          return { success: false, message: e.message };
        }
      }

      const res = await apiService.request<{ success?: boolean; message?: string }>('/sync/push', { method: 'POST' });
      this.updateAndNotify({ syncState: res?.success !== false ? 'synced' : 'failed', inProgress: false });
      return { success: res?.success !== false, message: res?.message };
    } catch (e: any) {
      this.updateAndNotify({ syncState: 'failed', inProgress: false });
      return { success: false, message: e.message };
    }
  }

  startPolling(intervalMs: number = 10000): void {
    if (this.pollingTimer) return;
    this.getStatus();
    this.pollingTimer = setInterval(() => { this.getStatus(); }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => { this.listeners.delete(listener); };
  }

  getCurrentStatus(): SyncStatus {
    return this.status;
  }
}

export const syncService = new SyncService();
