/**
 * In-memory account lockout tracker.
 * After MAX_FAILED_ATTEMPTS consecutive failures the account is locked for
 * LOCKOUT_DURATION_MS. Successful authentication resets the counter.
 */

interface LockoutEntry {
  attempts: number;
  lockedUntil: number; // epoch ms, 0 = not locked
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const store = new Map<string, LockoutEntry>();

// Periodic cleanup every 5 minutes (entries expire naturally via lockedUntil)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.attempts === 0 && entry.lockedUntil === 0) {
      store.delete(key);
    } else if (entry.lockedUntil > 0 && entry.lockedUntil < now) {
      store.delete(key);
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
  // Lock expired — clear
  store.delete(normalise(identifier));
  return false;
}

/**
 * Record a failed attempt. If the threshold is reached the account is locked.
 */
export function recordFailedAttempt(identifier: string): void {
  const key = normalise(identifier);
  const entry = store.get(key) || { attempts: 0, lockedUntil: 0 };
  entry.attempts += 1;
  if (entry.attempts >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  store.set(key, entry);
}

/**
 * Reset the counter on successful login.
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
