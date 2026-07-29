/**
 * Auth Service
 * Authentication utilities - extracted from embedded-server.js
 */

const crypto = require('crypto');

function hashPassword(password) {
  const normalizedPassword = String(password).trim();
  const hash = crypto.createHash('sha256').update(normalizedPassword).digest('hex');
  console.log('[Auth] Hashing password, result:', hash.substring(0, 10) + '...');
  return hash;
}

function generateToken(payload) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const b = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64');
  const s = crypto.createHmac('sha256', 'zapeera-secret').update(`${h}.${b}`).digest('base64');
  return `${h}.${b}.${s}`;
}

function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
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
          const sessionService = require('../services/session.service');
          const session = sessionService.validateOfflineSession(sessionToken);
          if (session) {
            const userRecord = query('SELECT id, email, name, role, branchId, companyId, createdBy FROM users WHERE id = ?', [session.userId]);
            if (userRecord && userRecord.length > 0) {
              req.user = userRecord[0];
              req.session = session;
              // Extract header-based branch/company selection
              const headerBranchId = req.headers['x-branch-id'];
              const headerCompanyId = req.headers['x-company-id'];
              if (headerBranchId !== undefined) req.user.selectedBranchId = headerBranchId || null;
              if (headerCompanyId !== undefined) req.user.selectedCompanyId = headerCompanyId || null;
              return next();
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
          const sessionService = require('../services/session.service');
          const session = sessionService.validateOfflineSession(sessionToken);
          if (session) {
            const userRecord = query('SELECT id, email, name, role, branchId, companyId, createdBy FROM users WHERE id = ?', [session.userId]);
            if (userRecord && userRecord.length > 0) {
              req.user = userRecord[0];
              req.session = session;
              const headerBranchId = req.headers['x-branch-id'];
              const headerCompanyId = req.headers['x-company-id'];
              if (headerBranchId !== undefined) req.user.selectedBranchId = headerBranchId || null;
              if (headerCompanyId !== undefined) req.user.selectedCompanyId = headerCompanyId || null;
              return next();
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

    // Fetch fresh user data from DB to get current branchId/companyId
    const freshUser = query('SELECT id, email, name, role, branchId, companyId, createdBy FROM users WHERE id = ?', [payload.id])[0];
    if (freshUser) {
      req.user = { ...payload, ...freshUser };
    } else {
      req.user = payload;
    }

    // Extract selectedBranchId and selectedCompanyId from headers
    const headerBranchId = req.headers['x-branch-id'];
    const headerCompanyId = req.headers['x-company-id'];
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

    next();
  };
}

/**
 * Generate a short-lived provisioning token for Desktop local session creation.
 * Signed with the embedded server's JWT_SECRET so only the Electron main process
 * (which knows JWT_SECRET) can create valid provisioning tokens.
 */
function generateProvisioningToken(userId, jwtSecret) {
  const secret = jwtSecret || process.env.JWT_SECRET || 'zapeera-secret';
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
    const secret = jwtSecret || process.env.JWT_SECRET || 'zapeera-secret';
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
  hashPassword,
  generateToken,
  verifyToken,
  generateProvisioningToken,
  verifyProvisioningToken,
  createAuthMiddleware,
  parseCookies
};
