/**
 * Shared, versioned authorization cache (Issue 10).
 *
 * ONE cache serves BOTH the V2 module resolver and the universal API
 * middleware. Every cache key embeds a policy fingerprint: a hash of the
 * versions of every auth-relevant entity for (businessId, userId):
 *
 *   - Business.policyVersion / updatedAt
 *   - BusinessType.updatedAt (+ its module/page enablement rows)
 *   - Plan.permissionState / policyVersion / updatedAt
 *   - BusinessSubscription.updatedAt (status / plan / billing status)
 *   - Role.permissionState / policyVersion / updatedAt
 *   - Membership.updatedAt / status
 *   - BusinessModuleOverride rows (max updatedAt)
 *   - ModuleDefinition / ModulePage rows (max updatedAt)
 *
 * Any policy mutation bumps one of those versions, so the fingerprint changes
 * and the next lookup misses. A stale entry can therefore NEVER grant revoked
 * access for longer than the hard TTL ceiling (60s, documented below).
 */

const TTL_MS = 60 * 1000; // hard ceiling — documented in this file and in the final report
const MAX_SIZE = 20000;

interface CacheEntry<T = unknown> {
  data: T;
  expiresAt: number;
}

class AuthPolicyCache {
  private cache = new Map<string, CacheEntry>();

  key(businessId: string, userId: string, fingerprint: string): string {
    return `${businessId}|${userId}|${fingerprint}`;
  }

  get<T>(businessId: string, userId: string, fingerprint: string): T | null {
    const key = this.key(businessId, userId, fingerprint);
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set<T>(businessId: string, userId: string, fingerprint: string, data: T): void {
    const key = this.key(businessId, userId, fingerprint);

    if (this.cache.size >= MAX_SIZE) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      const evictCount = Math.max(1, Math.floor(MAX_SIZE * 0.1));
      for (let i = 0; i < evictCount && i < entries.length; i++) {
        this.cache.delete(entries[i][0]);
      }
    }

    this.cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
  }

  /** Explicit invalidation (belt-and-suspenders; versioned keys are primary). */
  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; maxSize: number; ttlMs: number } {
    return { size: this.cache.size, maxSize: MAX_SIZE, ttlMs: TTL_MS };
  }
}

export const authPolicyCache = new AuthPolicyCache();

export const AUTH_CACHE_TTL_MS = TTL_MS;
