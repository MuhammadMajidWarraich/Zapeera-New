/**
 * Auth Service
 * Authentication utilities - extracted from embedded-server.js
 *
 * SECURITY (QA fix 2026-10-19, Track C C-01/C-02/C-03):
 * - verifyToken() now performs REAL HS256 signature verification
 *   (HMAC-SHA256 + crypto.timingSafeEqual) and expiry checks. Previously it
 *   base64-decoded the payload and trusted it without any signature check,
 *   which let anyone mint a valid "session" for any user/role.
 * - All signing/verification uses ONE per-install secret, resolved by
 *   getJwtSecret(): the value the Electron main process generates on first
 *   run and persists in the app data dir (jwt-secret.txt), shared via
 *   global.__ZAPEERA_JWT_SECRET__ / process.env.JWT_SECRET. The old
 *   hardcoded fallback literal is GONE. If no secret exists yet, a random
 *   one is generated and persisted (mode 0600) — never a constant.
 * - `jsonwebtoken` is not a dependency of this package, so verification is
 *   implemented with Node's crypto, following the exact pattern already
 *   used by verifyProvisioningToken() below.
 * - The auth middleware no longer trusts a token payload whose user id is
 *   not a live DB user (that fallback was a complete auth bypass).
 * - Users flagged mustChangePassword (e.g. seeded default admins) are
 *   gated by the middleware: everything except POST /api/auth/change-password
 *   returns 403 PASSWORD_CHANGE_REQUIRED.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Per-install JWT secret (C-02)
// ---------------------------------------------------------------------------
let cachedJwtSecret = null;

function jwtSecretFilePath() {
  // Same location the Electron main process uses (main.js: APP_DATA_DIR).
  return path.join(os.homedir(), '.zapeera', 'jwt-secret.txt');
}

function getJwtSecret() {
  if (cachedJwtSecret) return cachedJwtSecret;

  let secret = null;

  // 1. Value handed over by the Electron main process (it generates and
  //    persists the per-install secret before starting this server).
  try {
    if (global.__ZAPEERA_JWT_SECRET__) {
      secret = String(global.__ZAPEERA_JWT_SECRET__).trim();
    }
  } catch (e) { /* global may be unavailable outside Electron */ }

  // 2. Environment (main process also exports it for the in-process server).
  if (!secret && process.env.JWT_SECRET) {
    secret = String(process.env.JWT_SECRET).trim();
  }

  // 3. The persisted per-install file written by the main process.
  if (!secret) {
    try {
      const filePath = jwtSecretFilePath();
      if (fs.existsSync(filePath)) {
        secret = fs.readFileSync(filePath, 'utf8').trim();
      }
    } catch (e) { /* fall through to generation */ }
  }

  // 4. Fail closed: generate a fresh random per-install secret and persist
  //    it — never fall back to a hardcoded constant.
  if (!secret) {
    secret = crypto.randomBytes(64).toString('hex');
    try {
      const filePath = jwtSecretFilePath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, secret, { encoding: 'utf8', mode: 0o600 });
      console.log('[Auth] Generated new per-install JWT secret');
    } catch (e) {
      // Persistence failed (read-only FS?): keep the random secret in memory
      // for this process lifetime. Sessions will not survive a restart, but
      // the secret is still unique per install — never a shared constant.
      console.warn('[Auth] Could not persist JWT secret:', e.message);
    }
  }

  cachedJwtSecret = secret;
  return cachedJwtSecret;
}

// ---------------------------------------------------------------------------
// Password hashing / verification
// ---------------------------------------------------------------------------

/**
 * LEGACY unsalted SHA-256 password hash.
 * Kept ONLY so verifyPassword() can recognise and migrate legacy hashes at
 * login, and for non-password token derivation elsewhere. Never use this to
 * store a new password — use hashPasswordBcrypt().
 */
function hashPassword(password) {
  const normalizedPassword = String(password).trim();
  return crypto.createHash('sha256').update(normalizedPassword).digest('hex');
}

function isBcryptHash(stored) {
  return typeof stored === 'string' && /^\$2[aby]\$\d{2}\$/.test(stored);
}

function isLegacySha256Hash(stored) {
  return typeof stored === 'string' && /^[a-f0-9]{64}$/i.test(stored);
}

function loadBcrypt() {
  // bcryptjs is provided by the app bundle (backend node_modules via
  // NODE_PATH / route deps). Lazy-require so this module stays loadable in
  // isolation (tests, tooling).
  return require('bcryptjs');
}

/** Hash a password for storage. bcrypt only — never SHA-256. */
function hashPasswordBcrypt(password) {
  const bcryptjs = loadBcrypt();
  return bcryptjs.hashSync(String(password), 10);
}

/**
 * Verify a password against a stored hash.
 * Returns { valid, legacySha256 }:
 *  - bcrypt hashes are verified with bcrypt (the only accepted format going
 *    forward).
 *  - A legacy unsalted SHA-256 hash that matches is accepted EXACTLY ONCE:
 *    legacySha256=true tells the caller to immediately re-hash with bcrypt
 *    and overwrite the stored value, after which SHA-256 is never accepted
 *    for that account again (the stored value is no longer SHA-256).
 *  - Anything else is invalid.
 */
async function verifyPassword(password, storedHash) {
  if (!password || !storedHash || typeof storedHash !== 'string') {
    return { valid: false, legacySha256: false };
  }
  if (isBcryptHash(storedHash)) {
    try {
      const bcryptjs = loadBcrypt();
      const valid = await bcryptjs.compare(String(password), storedHash);
      return { valid, legacySha256: false };
    } catch (e) {
      console.error('[Auth] bcrypt verification error:', e.message);
      return { valid: false, legacySha256: false };
    }
  }
  if (isLegacySha256Hash(storedHash)) {
    const candidate = hashPassword(password);
    const a = Buffer.from(candidate);
    const b = Buffer.from(storedHash.toLowerCase());
    const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { valid, legacySha256: valid };
  }
  return { valid: false, legacySha256: false };
}

// ---------------------------------------------------------------------------
// Session tokens (hand-rolled HS256 JWT, signed with the per-install secret)
// ---------------------------------------------------------------------------

function generateToken(payload, jwtSecret) {
  const secret = jwtSecret || getJwtSecret();
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const b = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64');
  const s = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64');
  return `${h}.${b}.${s}`;
}

function verifyToken(token, jwtSecret) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // REAL signature verification: recompute HMAC-SHA256 over header.payload
    // and compare in constant time. Any tampering (payload, header, secret)
    // rejects the token.
    const secret = jwtSecret || getJwtSecret();
    const expectedSig = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64');
    const sigBuf = Buffer.from(parts[2]);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

    const exp = payload.exp;
    if (typeof exp === 'number') {
      // exp may be in seconds (JWT standard) or milliseconds (legacy local tokens)
      const nowMs = Date.now();
      const expMs = exp > 1e12 ? exp : exp * 1000;
      if (expMs < nowMs) return null;
    }
    return payload;
  } catch (e) {
    return null;
  }
}

// Parse cookies from Cookie header
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.split('=');
    if (name) cookies[name.trim()] = decodeURIComponent(rest.join('=').trim());
  });
  return cookies;
}

// Create auth middleware (requires query function)
function createAuthMiddleware(query) {
  // Authoritative mustChangePassword lookup. Guarded so a pre-migration DB
  // (column not yet added) fails open to "not flagged" instead of breaking
  // every request; both DB initializers add the column at startup.
  function lookupMustChangePassword(userId) {
    try {
      const rows = query('SELECT mustChangePassword FROM users WHERE id = ?', [userId]);
      if (rows && rows.length > 0) {
        const v = rows[0].mustChangePassword;
        return v === 1 || v === true || v === '1';
      }
    } catch (e) { /* column missing on an unmigrated DB */ }
    return false;
  }

  // C-03 gate: a flagged user (or a restricted password-change token) may
  // ONLY call POST /api/auth/change-password. Everything else is 403.
  function enforcePasswordChangeGate(req, res, next) {
    const flagged = !!(req.user && (req.user.mustChangePassword || req.user.restricted));
    if (!flagged) return next();
    const isChangePassword =
      req.method === 'POST' &&
      (req.path === '/api/auth/change-password' || req.path === '/auth/change-password');
    if (isChangePassword) return next();
    return res.status(403).json({
      success: false,
      code: 'PASSWORD_CHANGE_REQUIRED',
      mustChangePassword: true,
      message: 'Password change required. Please set a new password to continue.'
    });
  }

  return function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies['zapeera_token'];
    const sessionToken = cookies['zapeera_session'];

    // Extract token from Authorization header OR cookie
    let token = null;
    if (auth && auth.startsWith('Bearer ')) {
      token = auth.substring(7);
    } else if (cookieToken) {
      token = cookieToken;
    }

    // Debug logging for 401 errors
    console.log('🔍 [Auth Middleware] Request:', {
      method: req.method,
      path: req.path,
      hasAuthHeader: !!auth,
      hasCookieToken: !!cookieToken,
      hasSessionToken: !!sessionToken,
      tokenSource: auth && auth.startsWith('Bearer ') ? 'Authorization header' : (cookieToken ? 'cookie' : 'none'),
      allHeaders: Object.keys(req.headers)
    });

    if (!token) {
      // No JWT token - try session-based auth (offline grace period)
      if (sessionToken) {
        try {
          const sessionService = require('../session.service');
          const session = sessionService.validateOfflineSession(sessionToken);
          if (session) {
            const userRecord = query('SELECT id, email, name, role, branchId, companyId, createdBy FROM users WHERE id = ?', [session.userId]);
            if (userRecord && userRecord.length > 0) {
              req.user = { ...userRecord[0], mustChangePassword: lookupMustChangePassword(session.userId) };
              req.session = session;
              // Extract header-based branch/company selection
              const headerBranchId = req.headers['x-branch-id'];
              const headerCompanyId = req.headers['x-company-id'] || req.headers['x-business-id']; // frontend sends X-Business-ID
              if (headerBranchId !== undefined) req.user.selectedBranchId = headerBranchId || null;
              if (headerCompanyId !== undefined) req.user.selectedCompanyId = headerCompanyId || null;
              return enforcePasswordChangeGate(req, res, next);
            }
          }
        } catch (e) {
          console.error('❌ [Auth Middleware] Session fallback error:', e.message);
        }
      }

      console.error('❌ [Auth Middleware] Missing token:', {
        path: req.path,
        hasAuth: !!auth,
        hasCookie: !!cookieToken
      });
      return res.status(401).json({ success: false, message: 'Unauthorized - No token provided' });
    }

    const payload = verifyToken(token);

    if (!payload) {
      // JWT expired or invalid - try session-based fallback
      console.log('🔄 [Auth Middleware] JWT invalid/expired, trying session fallback...');
      if (sessionToken) {
        try {
          const sessionService = require('../session.service');
          const session = sessionService.validateOfflineSession(sessionToken);
          if (session) {
            const userRecord = query('SELECT id, email, name, role, branchId, companyId, createdBy FROM users WHERE id = ?', [session.userId]);
            if (userRecord && userRecord.length > 0) {
              req.user = { ...userRecord[0], mustChangePassword: lookupMustChangePassword(session.userId) };
              req.session = session;
              const headerBranchId = req.headers['x-branch-id'];
              const headerCompanyId = req.headers['x-company-id'] || req.headers['x-business-id']; // frontend sends X-Business-ID
              if (headerBranchId !== undefined) req.user.selectedBranchId = headerBranchId || null;
              if (headerCompanyId !== undefined) req.user.selectedCompanyId = headerCompanyId || null;
              return enforcePasswordChangeGate(req, res, next);
            }
          }
        } catch (e) {
          console.error('❌ [Auth Middleware] Session fallback error:', e.message);
        }
      }

      console.error('❌ [Auth Middleware] Invalid token:', {
        path: req.path,
        tokenLength: token.length,
        tokenPreview: token.substring(0, 20) + '...',
        tokenParts: token.split('.').length
      });
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    // Fetch fresh user data from DB to get current branchId/companyId.
    // SECURITY (C-01): a cryptographically valid token whose user no longer
    // exists in the local DB is rejected. The previous code trusted the raw
    // token payload as req.user in that case — a complete auth bypass now
    // that payloads can only be minted by the server, and still wrong for
    // deleted/deactivated local accounts.
    const freshUser = query('SELECT id, email, name, role, branchId, companyId, createdBy FROM users WHERE id = ?', [payload.id])[0];
    if (!freshUser) {
      console.error('❌ [Auth Middleware] Token user not found in DB:', { path: req.path, userId: payload.id });
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    req.user = {
      ...payload,
      ...freshUser,
      // DB flag is authoritative; the token's restricted claim is additive.
      mustChangePassword: lookupMustChangePassword(payload.id),
      restricted: payload.restricted === true
    };

    // Extract selectedBranchId and selectedCompanyId from headers
    const headerBranchId = req.headers['x-branch-id'];
    const headerCompanyId = req.headers['x-company-id'] || req.headers['x-business-id']; // frontend sends X-Business-ID
    const selectedBranchId = headerBranchId || req.user?.selectedBranchId;
    const selectedCompanyId = headerCompanyId || req.user?.selectedCompanyId;

    // Set selectedBranchId and selectedCompanyId on req.user
    if (headerBranchId !== undefined) req.user.selectedBranchId = headerBranchId || null;
    if (headerCompanyId !== undefined) req.user.selectedCompanyId = headerCompanyId || null;

    console.log('🔍 Embedded Server - Auth Middleware:', {
      userId: req.user?.id,
      role: req.user?.role,
      headerBranchId,
      headerCompanyId,
      selectedBranchId,
      selectedCompanyId,
      userBranchId: req.user?.branchId,
      userCompanyId: req.user?.companyId
    });

    return enforcePasswordChangeGate(req, res, next);
  };
}

/**
 * Generate a short-lived provisioning token for Desktop local session creation.
 * Signed with the embedded server's per-install secret so only the Electron
 * main process (which knows the secret) can create valid provisioning tokens.
 */
function generateProvisioningToken(userId, jwtSecret) {
  const secret = jwtSecret || getJwtSecret();
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({
    purpose: 'provision',
    userId,
    iat: Date.now(),
    exp: Date.now() + 60000 // 60 seconds
  })).toString('base64');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64');
  return `${header}.${payload}.${signature}`;
}

/**
 * Verify a provisioning token.
 * Validates HMAC signature, purpose claim, and expiry.
 */
function verifyProvisioningToken(token, jwtSecret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const secret = jwtSecret || getJwtSecret();
    const expectedSig = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64');
    const sigBuf = Buffer.from(parts[2]);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (payload.purpose !== 'provision') return null;
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = {
  getJwtSecret,
  hashPassword,
  hashPasswordBcrypt,
  isBcryptHash,
  isLegacySha256Hash,
  verifyPassword,
  generateToken,
  verifyToken,
  generateProvisioningToken,
  verifyProvisioningToken,
  createAuthMiddleware,
  parseCookies
};
