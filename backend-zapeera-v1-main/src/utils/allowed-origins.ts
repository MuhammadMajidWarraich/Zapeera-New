/**
 * Shared allowed-origins resolution for CORS (middleware/cors.middleware.ts)
 * and the SSE routes (routes/sse.routes.ts).
 *
 * Single-host migration (2026-10-15): the domains this app is served from
 * are DEPLOYMENT CONFIG, not code. Set them in the environment:
 *
 *   FRONTEND_URL=https://zapeera.seikho.online
 *   CORS_ORIGINS=https://zapeera.seikho.online,https://api.zapeera.seikho.online
 *
 * QA A-13/Wave-2 (2026-10-19): the historical production origins for the
 * old zapeera domain and its wildcard subdomain-suffix rule were REMOVED.
 * That domain is not one the owner controls, so no origin is trusted by
 * virtue of being baked into the source. In production the ONLY browser
 * origins allowed are the ones supplied via CORS_ORIGINS / FRONTEND_URL.
 * Localhost dev origins (and allow-all) apply only outside production.
 */

const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4200',
  'http://localhost:4100',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4200',
  'http://127.0.0.1:4100',
  'http://127.0.0.1:3000',
];

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function normalize(origin: string | undefined): string {
  return String(origin || '').trim().replace(/\/$/, '');
}

/** Origins contributed by the environment: CORS_ORIGINS (comma list) + FRONTEND_URL. */
export function getEnvOrigins(): string[] {
  const origins: string[] = [];
  const push = (value?: string): void => {
    const origin = normalize(value);
    if (origin) origins.push(origin);
  };
  (process.env.CORS_ORIGINS || '').split(',').forEach((o) => push(o));
  push(process.env.FRONTEND_URL);
  return [...new Set(origins)];
}

/**
 * Full static allowlist: env origins always; localhost dev origins only
 * outside production (no baked-in production domains remain).
 */
export function getAllowedOrigins(): string[] {
  const origins = [...getEnvOrigins()];
  if (!isProduction()) origins.push(...DEV_ORIGINS);
  return [...new Set(origins)];
}

/**
 * The single origin check used by both the CORS middleware and SSE routes.
 * Mirrors the checks that used to be duplicated (and divergent) in both files.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  // Desktop/Electron clients: the packaged app loads from file:// (opaque
  // origin -> "null" header) and talks to the cloud API cross-origin. Auth is
  // via Bearer token + CSRF token, so reflecting these origins does not leak
  // cookies.
  if (origin === 'null' || origin.startsWith('file://')) return true;
  if (getAllowedOrigins().includes(origin)) return true;
  if (process.env.NODE_ENV === 'development') return true;
  return false;
}
