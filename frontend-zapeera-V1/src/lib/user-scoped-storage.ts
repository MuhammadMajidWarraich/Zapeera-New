/**
 * User-scoped browser storage for per-account convenience data
 * (recently accessed businesses, favorite businesses).
 *
 * These lists hold business ids/names/slugs, so they must NEVER be
 * visible to a different account signed in on the same browser. Values
 * are stored as an envelope tagged with the owning user's id:
 *
 *   { v: 2, ownerId: string, items: ScopedBusinessRef[] }
 *
 * Rules:
 * - Reads return items ONLY when the envelope owner matches the
 *   current user. A legacy untagged value (the pre-fix format was a
 *   bare array shared by every account on the browser — the cause of
 *   the cross-user "Recently Accessed" leak) or another account's
 *   envelope is purged on first touch and reads as empty.
 * - Writes are tagged with the writer's user id and are a no-op when
 *   there is no authenticated user.
 * - AuthContext purges both keys when a login changes identity, so a
 *   previous account's lists are destroyed before the new account's
 *   home can render. Because the data is owner-tagged, logout keeps
 *   the owner's own lists intact — the same user's recents survive
 *   their own logout/login cycle, while no other account can ever
 *   read them.
 */

export interface ScopedBusinessRef {
  id: string;
  name: string;
  slug?: string | null;
}

export const RECENT_BUSINESSES_KEY = "zapeera_recent_businesses";
export const FAVORITE_BUSINESSES_KEY = "zapeera_favorite_businesses";

const ENVELOPE_VERSION = 2;

export function readUserScopedBusinesses(
  key: string,
  userId: string | null | undefined,
): ScopedBusinessRef[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.v !== ENVELOPE_VERSION ||
      typeof parsed.ownerId !== "string" ||
      !Array.isArray(parsed.items)
    ) {
      // Legacy untagged value — it cannot be trusted to belong to
      // this user, so destroy it instead of showing it.
      localStorage.removeItem(key);
      return [];
    }
    if (parsed.ownerId !== String(userId)) {
      // Another account's data on this browser — destroy, never show.
      localStorage.removeItem(key);
      return [];
    }
    return parsed.items.filter(
      (x: any) => x && typeof x.id === "string" && typeof x.name === "string",
    );
  } catch {
    return [];
  }
}

export function writeUserScopedBusinesses(
  key: string,
  userId: string | null | undefined,
  items: ScopedBusinessRef[],
): void {
  if (!userId) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ v: ENVELOPE_VERSION, ownerId: String(userId), items }),
    );
  } catch {
    /* ignore */
  }
}

/** Destroy every user-scoped convenience list on this browser. */
export function purgeUserScopedBusinesses(): void {
  try {
    localStorage.removeItem(RECENT_BUSINESSES_KEY);
    localStorage.removeItem(FAVORITE_BUSINESSES_KEY);
  } catch {
    /* ignore */
  }
}
