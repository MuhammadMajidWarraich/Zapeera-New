import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Generate a cryptographically random CSRF token.
 */
export const generateCSRFToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Parse cookies from the raw Cookie header (no cookie-parser dependency).
 */
function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    if (key) out[key] = val;
  }
  return out;
}

/**
 * Generate CSRF token and set it as a non-httpOnly cookie so the client
 * can read it and echo it back in the X-CSRF-Token header.
 */
export const generateCSRF = (_req: Request, res: Response, next: NextFunction) => {
  try {
    const token = generateCSRFToken();
    res.cookie('csrf-token', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000, // 1 hour
      path: '/'
    });
    next();
  } catch (error) {
    console.error('CSRF token generation error:', error);
    next();
  }
};

/**
 * Paths that are exempt from CSRF validation (no cookie exists yet).
 */
const CSRF_EXEMPT_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password-with-token',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/verify-reset-token',
  '/api/auth/logout',
  '/api/auth/check-status',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password-with-token',
  '/api/v1/auth/verify-email',
  '/api/v1/auth/resend-verification',
  '/api/v1/auth/verify-reset-token',
  '/api/v1/auth/logout',
  '/api/v1/auth/check-status',
  '/api/backoffice/auth/login',
  '/api/backoffice/auth/setup',
  '/api/backoffice/auth/profile',
  '/api/backoffice/auth/logout',
  '/api/v1/backoffice/auth/login',
  '/api/v1/backoffice/auth/setup',
  '/api/v1/backoffice/auth/profile',
  '/api/v1/backoffice/auth/logout',
  '/api/sse',
  '/api/v1/sse',
  // Barcode lookup is read-only (no state mutation)
  '/api/barcodes/lookup',
  '/api/v1/barcodes/lookup',
  '/api/barcodes/validate',
  '/api/v1/barcodes/validate',
  '/api/barcodes/stats',
  '/api/v1/barcodes/stats',
  '/api/barcodes/product/',
  '/api/v1/barcodes/product/',
];

/**
 * Validate CSRF token using the **double-submit cookie** pattern.
 *
 * Flow:
 *   1. Server sets `csrf-token` cookie (httpOnly:false) on login.
 *   2. Client reads the cookie and sends the value as `X-CSRF-Token` header.
 *   3. Server compares the cookie value with the header value using
 *      timing-safe comparison.  No server-side state is required.
 *
 * Safe methods (GET/HEAD/OPTIONS), CSRF_BYPASS=true, and exempt paths
 * (auth endpoints with no cookie yet) skip validation.
 */
export const validateCSRF = (req: Request, res: Response, next: NextFunction) => {
  try {
    const method = req.method.toUpperCase();

    // Safe methods never mutate state
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next();
    }

    // Dev bypass
    if (process.env.CSRF_BYPASS === 'true') {
      return next();
    }

    // Skip CSRF for Bearer-authenticated requests (Desktop/native clients).
    // Bearer token auth is not ambient cookie auth, so CSRF is not applicable.
    if (req.headers.authorization?.startsWith('Bearer ')) {
      return next();
    }

    // Skip paths that don't have a CSRF cookie yet (login, register, etc.)
    const pathname = req.originalUrl.split('?')[0];
    if (CSRF_EXEMPT_PATHS.some(p => pathname.startsWith(p))) {
      return next();
    }

    // Token from header (client echo)
    const headerToken =
      (req.headers['x-csrf-token'] as string) ||
      (req.headers['x-xsrf-token'] as string);

    // Token from cookie (server-set, readable by JS because httpOnly=false)
    const cookies = parseCookies(req);
    const cookieToken = cookies['csrf-token'] || cookies['XSRF-TOKEN'];

    if (!headerToken || !cookieToken) {
      return res.status(403).json({
        success: false,
        message: 'CSRF token missing',
        error: 'CSRF_TOKEN_REQUIRED'
      });
    }

    // Timing-safe comparison of the two hex strings
    const headerBuf = Buffer.from(headerToken, 'hex');
    const cookieBuf = Buffer.from(cookieToken, 'hex');

    if (
      headerBuf.length !== cookieBuf.length ||
      !crypto.timingSafeEqual(headerBuf, cookieBuf)
    ) {
      return res.status(403).json({
        success: false,
        message: 'CSRF token invalid',
        error: 'CSRF_TOKEN_INVALID'
      });
    }

    next();
  } catch {
    return res.status(403).json({
      success: false,
      message: 'CSRF validation failed',
      error: 'CSRF_VALIDATION_ERROR'
    });
  }
};

/**
 * Clear the CSRF cookie (called on logout).
 */
export const invalidateCSRF = (_req: Request, res: Response, next: NextFunction) => {
  res.clearCookie('csrf-token', { path: '/' });
  next();
};
