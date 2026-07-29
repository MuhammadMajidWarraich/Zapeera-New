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
}

export type SyncStateListener = (status: SyncStatus) => void;

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
          this.updateAndNotify({
            connectionState: result.connectionState || 'checking',
            syncState: result.syncState || 'idle',
            lastSyncAt: result.lastSyncAt || null,
            pendingChanges: result.pendingChanges || 0,
            failedChanges: result.failedChanges || 0,
            inProgress: result.inProgress || false,
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
        const cloudState: CloudState = d.connectionState === 'SYNC_READY' || d.connectionState === 'SYNCED' ? 'online' : d.connectionState === 'AUTH_REQUIRED' ? 'auth-required' : 'offline';
        const syncSt: SyncState = d.connectionState === 'SYNCING' ? 'syncing' : d.connectionState === 'SYNCED' ? 'synced' : d.status === 'syncing' ? 'syncing' : (d.pendingChanges || 0) > 0 ? 'pending' : 'idle';
        this.updateAndNotify({ connectionState: cloudState, syncState: syncSt, pendingChanges: d.pendingChanges || 0 });
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
