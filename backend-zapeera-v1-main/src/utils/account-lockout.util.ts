/**
 * In-memory per-account lockout tracker (QA A-14).
 *
 * The IP-based rate limiters in server.ts cannot stop distributed password
 * guessing, so failed logins are ALSO counted per account identifier
 * (normalized username/email — see auth.controller, which records under both
 * the submitted identifier and the resolved account's canonical email, so
 * alternating identifier forms cannot split the counter).
 *
 * Progressive policy:
 *   - MAX_FAILED_ATTEMPTS consecutive failures trigger a lock.
 *   - Lock duration escalates per lock event: 15 min → 30 min → 60 min (cap).
 *   - Locks always expire on their own (never permanent), so a legitimate
 *     owner behind a shared IP is delayed, not locked out forever.
 *   - A successful login clears the counter AND the escalation level.
 */

interface LockoutEntry {
  attempts: number;
  lockedUntil: number; // epoch ms, 0 = not locked
  lockCount: number; // how many times this identifier has been locked
  updatedAt: number; // epoch ms of last activity (for cleanup)
}

const MAX_FAILED_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOCKOUT_MS = 60 * 60 * 1000; // 60 minutes
const ESCALATION_MEMORY_MS = 24 * 60 * 60 * 1000; // keep lockCount for 24h

const store = new Map<string, LockoutEntry>();

function lockoutDurationMs(lockCount: number): number {
  return Math.min(BASE_LOCKOUT_MS * 2 ** Math.max(0, lockCount - 1), MAX_LOCKOUT_MS);
}

// Periodic cleanup: drop entries that are unlocked, have no pending
// attempts, and whose escalation memory has expired.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    const lockExpired = entry.lockedUntil > 0 && entry.lockedUntil < now;
    if (entry.lockedUntil === 0 || lockExpired) {
      if (entry.attempts === 0 && now - entry.updatedAt > ESCALATION_MEMORY_MS) {
        store.delete(key);
      }
    }
  }
}, 5 * 60 * 1000);

function normalise(key: string): string {
  return key.toLowerCase().trim();
}

/**
 * Returns true if the account is currently locked.
 */
export function isLocked(identifier: string): boolean {
  const entry = store.get(normalise(identifier));
  if (!entry) return false;
  if (entry.lockedUntil === 0) return false;
  if (Date.now() < entry.lockedUntil) return true;
  // Lock expired — clear the lock (attempts were already reset when the
  // lock engaged; lockCount is kept for escalation until cleanup).
  entry.lockedUntil = 0;
  entry.updatedAt = Date.now();
  return false;
}

/**
 * Record a failed attempt. When the threshold is reached the account locks
 * for an escalating duration and the attempt counter restarts, so after the
 * lock expires an attacker needs a fresh full set of failures to re-lock.
 */
export function recordFailedAttempt(identifier: string): void {
  const key = normalise(identifier);
  const entry = store.get(key) || { attempts: 0, lockedUntil: 0, lockCount: 0, updatedAt: 0 };
  entry.attempts += 1;
  entry.updatedAt = Date.now();
  if (entry.attempts >= MAX_FAILED_ATTEMPTS) {
    entry.lockCount += 1;
    entry.lockedUntil = Date.now() + lockoutDurationMs(entry.lockCount);
    entry.attempts = 0;
  }
  store.set(key, entry);
}

/**
 * Reset the counter and escalation level on successful login.
 */
export function clearFailedAttempts(identifier: string): void {
  store.delete(normalise(identifier));
}

/**
 * Returns remaining lockout seconds (0 if not locked).
 */
export function remainingLockoutSeconds(identifier: string): number {
  const entry = store.get(normalise(identifier));
  if (!entry || entry.lockedUntil === 0) return 0;
  const remaining = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}
