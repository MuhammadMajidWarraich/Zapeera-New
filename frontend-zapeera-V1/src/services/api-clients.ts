import { ApiService } from './api';
import { config } from '@/lib/config';

// Separate storage keys to avoid token ambiguity between cloud and local APIs
const CLOUD_TOKEN_KEY = 'cloudAccessToken';
const LOCAL_TOKEN_KEY = 'localAccessToken';
// v1.0.19: desktop-scoped cloud refresh token (30-day session coherence).
// Only ever issued to desktop sign-ins; rotated by /auth/desktop/refresh.
const CLOUD_REFRESH_TOKEN_KEY = 'cloudRefreshToken';

let _cloudApi: ApiService | null = null;
let _localApi: ApiService | null = null;
let _backofficeApi: ApiService | null = null;

export function getCloudApi(): ApiService {
  if (!_cloudApi) {
    const baseUrl = config.cloud.baseUrl;
    if (!baseUrl) {
      throw new Error('Cloud API URL not configured. Set VITE_CLOUD_API_URL.');
    }
    _cloudApi = new ApiService(baseUrl);
    _cloudApi.suppressAuthRequired = true;
    // Restore persisted cloud access token
    try {
      const saved = localStorage.getItem(CLOUD_TOKEN_KEY);
      if (saved) _cloudApi.setAccessToken(saved);
    } catch { /* ignore */ }
  }
  return _cloudApi;
}

export function getLocalApi(): ApiService {
  if (!_localApi) {
    const baseUrl = config.local.baseUrl;
    if (!baseUrl) {
      throw new Error('Local API URL not configured. Desktop runtime required.');
    }
    _localApi = new ApiService(baseUrl);
    // Restore persisted local access token
    try {
      const saved = localStorage.getItem(LOCAL_TOKEN_KEY);
      if (saved) _localApi.setAccessToken(saved);
    } catch { /* ignore */ }
  }
  return _localApi;
}

export function getBackofficeApi(): ApiService {
  if (!_backofficeApi) {
    _backofficeApi = new ApiService(config.backoffice.baseUrl);
  }
  return _backofficeApi;
}

export function persistCloudToken(token: string): void {
  try { localStorage.setItem(CLOUD_TOKEN_KEY, token); } catch { /* ignore */ }
}

export function clearCloudToken(): void {
  try { localStorage.removeItem(CLOUD_TOKEN_KEY); } catch { /* ignore */ }
  // The refresh token dies with the access token on every explicit
  // sign-out / retry path — a logged-out device must not be able to
  // mint new cloud access tokens.
  clearCloudRefreshToken();
}

export function persistCloudRefreshToken(token: string): void {
  try { localStorage.setItem(CLOUD_REFRESH_TOKEN_KEY, token); } catch { /* ignore */ }
}

export function readCloudRefreshToken(): string | null {
  try { return localStorage.getItem(CLOUD_REFRESH_TOKEN_KEY); } catch { return null; }
}

export function clearCloudRefreshToken(): void {
  try { localStorage.removeItem(CLOUD_REFRESH_TOKEN_KEY); } catch { /* ignore */ }
}

export function persistLocalToken(token: string): void {
  try { localStorage.setItem(LOCAL_TOKEN_KEY, token); } catch { /* ignore */ }
}

export function clearLocalToken(): void {
  try { localStorage.removeItem(LOCAL_TOKEN_KEY); } catch { /* ignore */ }
}

export function resetApiClients(): void {
  _cloudApi = null;
  _localApi = null;
  _backofficeApi = null;
}

// Re-export for convenient single import
export type { ApiService };
