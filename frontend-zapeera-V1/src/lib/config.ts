/**
 * Application configuration from environment variables
 */

// Detect if running in Electron
const isElectron = typeof window !== 'undefined' &&
  typeof (window as any).electronAPI !== 'undefined';

// In Electron, always use localhost backend (auto-started)
// In web/production, use environment variable (must be set)
export const config = {
  // API Configuration
  api: {
    // Electron apps use localhost backend that auto-starts.
    // Web/Production prefers an explicit VITE_API_BASE_URL.
    baseUrl: (() => {
      const envBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '').trim();

      if (isElectron) {
        return `http://127.0.0.1:${import.meta.env.VITE_EMBEDDED_PORT || '4201'}/api`;
      }

      if (envBaseUrl) {
        return envBaseUrl;
      }

      // Use relative /api in all modes — in dev, Vite's proxy forwards
      // to the backend; in production, same-origin or reverse-proxy handles it.
      // This is required for httpOnly cookie auth (SameSite) to work,
      // since cookies need same-origin requests.
      return '/api';
    })(),
    timeout: parseInt(import.meta.env.VITE_API_TIMEOUT || '30000'),
  },

  // App Configuration
  app: {
    name: import.meta.env.VITE_APP_NAME || 'Zapeera',
    version: import.meta.env.VITE_APP_VERSION || '1.0.0',
  },

  // Development Configuration
  debug: {
    enabled: import.meta.env.VITE_DEBUG_MODE === 'true',
    logLevel: import.meta.env.VITE_LOG_LEVEL || 'info',
  },

  // Feature Flags
  features: {
    analytics: import.meta.env.VITE_ENABLE_ANALYTICS === 'true',
    debugLogs: import.meta.env.VITE_ENABLE_DEBUG_LOGS === 'true',
  },

  // UI Configuration
  ui: {
    defaultTheme: import.meta.env.VITE_DEFAULT_THEME || 'light',
    itemsPerPage: parseInt(import.meta.env.VITE_ITEMS_PER_PAGE || '10'),
  },

  // Support Contact Configuration
  support: {
    phoneNumber: import.meta.env.VITE_SUPPORT_PHONE || '+923075445509',
    email: import.meta.env.VITE_SUPPORT_EMAIL || 'support@zapeera.com',
    whatsappUrl: import.meta.env.VITE_WHATSAPP_URL || 'https://wa.me/923075445509',
    contactUrl: import.meta.env.VITE_CONTACT_URL || 'https://zapeera.com/contact',
  },

  // Cloud API Configuration (used by Desktop for online operations: auth, sync, etc.)
  // Must be an absolute URL. In web mode, defaults to same-origin.
  // In Electron/desktop mode, must be set explicitly via VITE_CLOUD_API_URL.
  cloud: {
    baseUrl: (() => {
      const envUrl = String(import.meta.env.VITE_CLOUD_API_URL || '').trim();
      if (envUrl) return envUrl;
      if (isElectron) return ''; // Electron requires explicit VITE_CLOUD_API_URL
      return '/api';
    })(),
    timeout: parseInt(import.meta.env.VITE_CLOUD_API_TIMEOUT || '15000'),
  },

  // Realtime / SSE Configuration
  // EventSource streams cannot pass through the Vercel /api rewrite (it buffers and
  // returns 502), so the SSE endpoint must be reached DIRECTLY on the backend.
  realtime: {
    sseBaseUrl: (() => {
      const envUrl = String(import.meta.env.VITE_SSE_BASE_URL || '').trim();
      if (envUrl) return envUrl;
      const base = config.api.baseUrl;
      // Absolute API base (e.g. VITE_API_BASE_URL set) → stream from the same origin
      if (base.startsWith('http')) return base;
      // Dev: Vite's proxy forwards /api and can stream SSE
      if (import.meta.env.DEV) return '/api';
      // Production web (relative /api through the Vercel rewrite): hit Railway directly
      return 'https://zapeera-api-production.up.railway.app/api';
    })(),
  },

  // Local API Configuration (Electron embedded server, SQLite-backed)
  // Note: electronAPI.getLocalApiUrl() is async (IPC invoke) and cannot be used here synchronously.
  local: {
    baseUrl: isElectron
      ? `http://127.0.0.1:${import.meta.env.VITE_EMBEDDED_PORT || '4201'}/api`
      : '',
    timeout: parseInt(import.meta.env.VITE_LOCAL_API_TIMEOUT || '5000'),
  },

  // Backoffice API Configuration (web-only admin panel)
  backoffice: {
    baseUrl: import.meta.env.VITE_BACKOFFICE_API_URL || '/api/backoffice',
  },
} as const;

// Runtime check: warn if api.baseUrl unexpectedly points to production
if (config.api.baseUrl.includes('api.zapeera.com') && config.local.baseUrl) {
  console.warn(
    '[config] api.baseUrl resolves to production (api.zapeera.com) while local.baseUrl is available.',
    'This likely means VITE_API_BASE_URL from .env.production leaked into a desktop build.',
    `Set VITE_API_BASE_URL=http://127.0.0.1:4201/api in .env.desktop and build with --mode desktop.`
  );
}

// Type definitions for better TypeScript support
export type Config = typeof config;
export type ApiConfig = typeof config.api;
export type AppConfig = typeof config.app;
export type DebugConfig = typeof config.debug;
export type FeatureConfig = typeof config.features;
export type UIConfig = typeof config.ui;
export type SupportConfig = typeof config.support;
export type CloudConfig = typeof config.cloud;
export type LocalConfig = typeof config.local;
export type BackofficeConfig = typeof config.backoffice;
