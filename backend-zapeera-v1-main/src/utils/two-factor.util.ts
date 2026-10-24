/**
 * Two-factor authentication (TOTP) utilities.
 *
 * Real 2FA for Zapeera (built 2026-10-24, replacing the old flag-only
 * toggle that persisted `twoFactorEnabled` without any enforcement):
 *
 *  - TOTP secrets are generated/verified with otplib (RFC 6238, ±1 step
 *    window so a code typed near a step boundary still works).
 *  - Recovery codes are single-use. Only their SHA-256 hashes are stored
 *    (JSON array on zapeeraUser.twoFactorRecoveryCodes); the plaintext
 *    codes are returned to the user exactly once at issue time.
 *  - Login challenges are short-lived JWTs (purpose: '2fa-challenge',
 *    5 minutes) plus a server-side attempt ledger kept here: a challenge
 *    dies after MAX_CHALLENGE_ATTEMPTS failed verifications or on first
 *    success. The ledger is in-memory, matching the existing
 *    account-lockout util — the backend runs as a single instance.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';

export const TWO_FACTOR_ISSUER = 'Zapeera';
export const CHALLENGE_PURPOSE = '2fa-challenge';
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 5;
export const RECOVERY_CODE_COUNT = 10;

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

/** Generate a fresh TOTP secret (base32). 32 chars ≈ 160 bits of entropy. */
export const generateTotpSecret = (): string => authenticator.generateSecret(32);

/** otpauth:// URI for QR codes + manual entry in authenticator apps. */
export const buildOtpauthUri = (accountLabel: string, secret: string): string =>
  authenticator.keyuri(accountLabel, TWO_FACTOR_ISSUER, secret);

/** Verify a 6-digit TOTP code against a secret, allowing ±1 time step. */
export const verifyTotpCode = (secret: string, code: string): boolean => {
  const token = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(token)) return false;
  try {
    // NOTE: otplib 12.0.1's authenticator.verify({ window }) does NOT
    // actually evaluate neighbouring steps (verified empirically: a code
    // from the previous step is rejected even with window: 1). So the
    // +-1 step window is applied explicitly: generate the expected code
    // for the previous, current and next 30-second step (the epoch
    // option is expressed in milliseconds) and compare in constant time.
    const nowMs = Date.now();
    for (const offsetMs of [-30_000, 0, 30_000]) {
      const instance = authenticator.clone();
      instance.options = { epoch: nowMs + offsetMs } as any;
      const expected = instance.generate(secret);
      const a = Buffer.from(expected);
      const b = Buffer.from(token);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    }
    return false;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

// Unambiguous alphabet (no 0/O, 1/I/L) so codes survive being read aloud
// or typed from a screenshot/printout.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const randomRecoveryCode = (): string => {
  const chars: string[] = [];
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    chars.push(RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length]);
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
};

/** Normalize a user-supplied recovery code for hashing/comparison. */
export const normalizeRecoveryCode = (code: string): string =>
  String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** SHA-256 hex hash of the normalized code. Plaintext is never stored. */
export const hashRecoveryCode = (code: string): string =>
  crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');

/** Issue a fresh set of recovery codes: plaintext (show once) + hashes (store). */
export const generateRecoveryCodeSet = (
  count: number = RECOVERY_CODE_COUNT
): { plainCodes: string[]; hashes: string[] } => {
  const plainCodes: string[] = [];
  const seen = new Set<string>();
  while (plainCodes.length < count) {
    const code = randomRecoveryCode();
    if (seen.has(code)) continue;
    seen.add(code);
    plainCodes.push(code);
  }
  return { plainCodes, hashes: plainCodes.map(hashRecoveryCode) };
};

/** Parse the stored JSON hash array; tolerates null/corrupt values. */
export const parseRecoveryHashes = (stored: string | null | undefined): string[] => {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((h) => typeof h === 'string') : [];
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Login challenge attempt ledger (in-memory)
// ---------------------------------------------------------------------------

interface ChallengeEntry {
  userId: string;
  attempts: number;
  expiresAt: number;
}

const challenges = new Map<string, ChallengeEntry>();

const sweepExpired = (now: number) => {
  for (const [jti, entry] of challenges) {
    if (entry.expiresAt <= now) challenges.delete(jti);
  }
};

/** Register a freshly issued challenge token id. */
export const registerChallenge = (jti: string, userId: string): void => {
  const now = Date.now();
  sweepExpired(now);
  challenges.set(jti, { userId, attempts: 0, expiresAt: now + CHALLENGE_TTL_MS });
};

/**
 * Look up a challenge without consuming it. Returns null when the
 * challenge is unknown, expired, or already exhausted — callers must
 * answer with one generic error so nothing about the state leaks.
 */
export const peekChallenge = (jti: string): ChallengeEntry | null => {
  const entry = challenges.get(jti);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    challenges.delete(jti);
    return null;
  }
  return entry;
};

/**
 * Record a failed verification attempt. Returns true when the challenge
 * is still alive afterwards, false when this failure killed it.
 */
export const recordChallengeFailure = (jti: string): boolean => {
  const entry = challenges.get(jti);
  if (!entry) return false;
  entry.attempts += 1;
  if (entry.attempts >= MAX_CHALLENGE_ATTEMPTS || entry.expiresAt <= Date.now()) {
    challenges.delete(jti);
    return false;
  }
  return true;
};

/** Consume a challenge (on success, or when it must die immediately). */
export const consumeChallenge = (jti: string): void => {
  challenges.delete(jti);
};

// ---------------------------------------------------------------------------
// Challenge tokens (JWT)
// ---------------------------------------------------------------------------

/**
 * Mint a 2FA challenge token for a user who passed the password check.
 * The token is signed with the app JWT secret but is SCOPED: it carries
 * `purpose: '2fa-challenge'` and no session claims. The auth middleware
 * rejects any purpose-scoped token presented as an access token, and
 * POST /auth/login/2fa rejects anything without this exact purpose.
 */
export const createChallengeToken = (userId: string): string => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined. Please set JWT_SECRET in your .env file or environment variables.');
  }
  const jti = crypto.randomUUID();
  registerChallenge(jti, userId);
  return (jwt.sign as any)(
    { userId, purpose: CHALLENGE_PURPOSE, jti },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
};

/**
 * Verify a challenge token's signature, expiry and purpose. Returns the
 * claims on success, null on ANY failure (callers answer one generic
 * error — never which check failed).
 */
export const verifyChallengeToken = (token: string): { userId: string; jti: string } | null => {
  if (!process.env.JWT_SECRET || !token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
    if (decoded.purpose !== CHALLENGE_PURPOSE || !decoded.userId || !decoded.jti) return null;
    if (peekChallenge(String(decoded.jti)) === null) return null;
    return { userId: String(decoded.userId), jti: String(decoded.jti) };
  } catch {
    return null;
  }
};
