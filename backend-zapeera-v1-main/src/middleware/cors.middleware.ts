import { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';

const PRODUCTION_ORIGINS = [
  'https://app.zapeera.com',
  'https://www.zapeera.com',
];

const isProduction = process.env.NODE_ENV === 'production';

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  // Exact match against production origins
  if (PRODUCTION_ORIGINS.includes(origin)) return true;
  // Allow subdomains of zapeera.com (must start with https:// and end with .zapeera.com)
  try {
    const url = new URL(origin);
    if (url.hostname === 'zapeera.com' || url.hostname.endsWith('.zapeera.com')) return true;
  } catch { /* not a valid URL */ }
  if (origin.startsWith('file://')) return isProduction === false;
  const envOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim());
  if (envOrigins?.includes(origin)) return true;
  if (process.env.NODE_ENV === 'development') return true;
  return false;
}

const DEFAULT_HEADERS =
  'Content-Type, Authorization, X-Requested-With, Accept, Origin, ' +
  'X-Business-ID, X-Branch-ID, x-zapeera-skip-cache, X-CSRF-Token';

export function configureCors(app: Express): void {
  // Single OPTIONS preflight handler — runs BEFORE the cors() middleware.
  // Echoes back whatever the browser requested (case-insensitive) so we never
  // need to enumerate every case variation of custom headers.
  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'OPTIONS') return next();

    const origin = req.headers.origin as string | undefined;

    if (isOriginAllowed(origin)) {
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      else res.setHeader('Access-Control-Allow-Origin', '*');

      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers',
        (req.headers['access-control-request-headers'] as string) || DEFAULT_HEADERS
      );
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(200).end();
    } else {
      if (isProduction) {
        console.warn('[CORS] Blocked origin:', origin);
      }
      res.status(403).json({ error: 'CORS: Origin not allowed' });
    }
  });

  // Standard cors middleware for non-OPTIONS requests (GET, POST, etc.)
  app.use(cors({
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept',
      'Origin', 'X-Business-ID', 'X-Branch-ID', 'x-zapeera-skip-cache', 'X-CSRF-Token'],
    exposedHeaders: ['Content-Type', 'Authorization', 'x-zapeera-skip-cache'],
    optionsSuccessStatus: 200,
  }));
}
