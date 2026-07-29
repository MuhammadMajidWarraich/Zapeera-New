import { createContext, useContext } from 'react';

export type AppRuntime = 'web' | 'desktop' | 'backoffice';

export type CloudState =
  | 'checking'
  | 'online'
  | 'offline'
  | 'auth-required';

export type SyncState =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'pending'
  | 'offline'
  | 'failed'
  | 'conflict';

export interface DesktopBusinessState {
  businessId: string;
  provisioned: boolean;
  availableOffline: boolean;
  lastSyncedAt?: string;
  pendingChanges: number;
}

export interface RuntimeInfo {
  runtime: AppRuntime;
  isWeb: boolean;
  isDesktop: boolean;
  isBackoffice: boolean;
  cloudApiUrl: string;
  localApiUrl: string;
  cloudState: CloudState;
  syncState: SyncState;
  desktopBusinessStates: DesktopBusinessState[];
  lastSyncAt: string | null;
  pendingChanges: number;
}

function detectRuntime(): AppRuntime {
  if (typeof window === 'undefined') return 'web';
  const url = window.location.pathname;
  if (url.startsWith('/backoffice')) return 'backoffice';
  if (typeof (window as any).electronAPI !== 'undefined') return 'desktop';
  return 'web';
}

function getCloudApiUrl(runtime: AppRuntime): string {
  if (runtime === 'desktop') {
    const fromEnv = String(import.meta.env.VITE_CLOUD_API_URL || '').trim();
    if (fromEnv) return fromEnv;
    // Note: electronAPI.getCloudApiUrl() is async (IPC invoke) and cannot be called synchronously.
    return '';
  }
  const envUrl = String(import.meta.env.VITE_CLOUD_API_URL || '').trim();
  return envUrl || '/api';
}

function getLocalApiUrl(runtime: AppRuntime): string {
  if (runtime !== 'desktop') return '';
  // Note: electronAPI.getLocalApiUrl() is async (IPC invoke) and cannot be called synchronously.
  return `http://127.0.0.1:${import.meta.env.VITE_EMBEDDED_PORT || '4201'}/api`;
}

export function createRuntimeInfo(): RuntimeInfo {
  const runtime = detectRuntime();
  return {
    runtime,
    isWeb: runtime === 'web',
    isDesktop: runtime === 'desktop',
    isBackoffice: runtime === 'backoffice',
    cloudApiUrl: getCloudApiUrl(runtime),
    localApiUrl: getLocalApiUrl(runtime),
    cloudState: 'checking',
    syncState: 'offline',
    desktopBusinessStates: [],
    lastSyncAt: null,
    pendingChanges: 0,
  };
}

export interface RuntimeContextValue extends RuntimeInfo {
  setCloudState: (state: CloudState) => void;
  setSyncState: (state: SyncState) => void;
  setDesktopBusinessStates: (states: DesktopBusinessState[]) => void;
  setPendingChanges: (count: number) => void;
  setLastSyncAt: (timestamp: string | null) => void;
}

export const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function useRuntime(): RuntimeContextValue {
  const ctx = useContext(RuntimeContext);
  if (!ctx) {
    throw new Error('useRuntime must be used within a RuntimeProvider');
  }
  return ctx;
}
