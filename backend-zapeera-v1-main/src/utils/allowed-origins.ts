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
 * Behaviour when the env vars are UNSET is intentionally identical to the
 * pre-migration code: the historical production origins (app.zapeera.com,
 * www.zapeera.com, the "six" Vercel deployment), the *.zapeera.com suffix
 * rule, the localhost dev origins, Electron file:// / "null" origins, and
 * allow-all in NODE_ENV=development all still apply. Env-provided origins
 * are ADDED on top of those defaults.
 */

const DEFAULT_PRODUCTION_ORIGINS = [
  'https://app.zapeera.com',
  'https://www.zapeera.com',
  'https://zapeera-new-six.vercel.app',
];

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

/** Full static allowlist: env origins + historical production + dev origins. */
export function getAllowedOrigins(): string[] {
  return [...new Set([...getEnvOrigins(), ...DEFAULT_PRODUCTION_ORIGINS, ...DEV_ORIGINS])];
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
  // Legacy fallback, kept so old production keeps working with no env set:
  // allow zapeera.com and any of its subdomains.
  try {
    const url = new URL(origin);
    if (url.hostname === 'zapeera.com' || url.hostname.endsWith('.zapeera.com')) return true;
  } catch { /* not a valid URL */ }
  if (process.env.NODE_ENV === 'development') return true;
  return false;
}
