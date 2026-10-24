/**
 * Account status — ONE derivation for every "is my account set up /
 * protected" surface (dashboard CompletionStrip, widgets AccountCompletion
 * + SecurityCard, Profile & Security "Security Status" card).
 *
 * Why this exists (2026-10-24): those surfaces used to compute the same
 * checks from different sources and contradicted each other on the same
 * account at the same minute — the strip read the login-time localStorage
 * snapshot (whose payload carries no phone / twoFactorEnabled at all, so
 * "Add phone number" and "Enable 2FA" could never complete), while the
 * security card read a fresh GET /auth/profile. One item ("Email
 * verified") was derived from the mere presence of an email address, and
 * "Secure login" / "Encrypted connection" were hardcoded `true`.
 *
 * Rules:
 * - Input is the FRESH profile (GET /auth/profile response), never the
 *   login snapshot.
 * - A check is only true when the payload proves it. Fields the backend
 *   does not (yet) expose read as NOT satisfied — conservative, never
 *   invented. (emailVerified + hasPassword are exposed by getProfile as
 *   of the status-truth backend change; against an older backend they
 *   are absent and the checks honestly read incomplete until it lands.)
 */
import { useEffect, useState } from "react";
import { apiService } from "@/services/api";
import { config } from "@/lib/config";

/** Structural subset of the GET /auth/profile payload this module reads. */
export interface AccountStatusProfile {
  email?: string | null;
  emailVerified?: boolean | null;
  hasPassword?: boolean | null;
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  dateOfBirth?: string | null;
  bio?: string | null;
  profileImage?: string | null;
  twoFactorEnabled?: boolean | null;
  /** Arrives with the real-TOTP-2FA backend: a secret has been generated. */
  twoFactorConfigured?: boolean | null;
  /** Canonical derived flag if a backend ever exposes it directly. */
  twoFactorActive?: boolean | null;
  [key: string]: unknown;
}

/**
 * "Complete profile" = every field the Profile & Security form collects
 * is filled: the avatar plus its editable personal fields (Full Name,
 * Phone, Date of Birth, City, Country, Address, About). Email/username
 * are identity fields the form cannot edit, so they are not counted.
 */
export const PROFILE_COMPLETION_FIELDS = [
  "name",
  "phone",
  "dateOfBirth",
  "city",
  "country",
  "address",
  "bio",
  "profileImage",
] as const;

export type ProfileCompletionField = (typeof PROFILE_COMPLETION_FIELDS)[number];

export interface AccountStatus {
  /** An email address exists on the account. */
  emailOnFile: boolean;
  /** The address has actually been verified (backend `emailVerified`). */
  emailVerified: boolean;
  /** A phone number is saved on the profile. */
  phoneOnFile: boolean;
  /** Every PROFILE_COMPLETION_FIELDS entry is filled. */
  profileComplete: boolean;
  /** The completion fields still empty, in form order. */
  profileMissingFields: ProfileCompletionField[];
  /**
   * 2FA is genuinely in force: the enabled flag AND a completed setup.
   * Reads `twoFactorActive` when the backend exposes it, else composes
   * flag + `twoFactorConfigured`, else — pre-TOTP backends, where the
   * flag is all that exists — the flag itself.
   */
  twoFactorOn: boolean;
  /** The account has a password credential (backend `hasPassword`). */
  secureLogin: boolean;
  /** This page's traffic is encrypted (https, or desktop→cloud https). */
  encryptedConnection: boolean;
  /** Desktops checked in within the presence window; null = unknown. */
  desktopConnectedCount: number | null;
  /** At least one desktop is currently connected to this account. */
  desktopConnected: boolean;
}

function filled(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

function currentConnectionEncrypted(): boolean {
  if (typeof window === "undefined") return false;
  const proto = window.location.protocol;
  if (proto === "https:") return true;
  if (proto === "file:") {
    // Desktop shell: the page itself loads from file://, but account
    // traffic goes to the cloud API — encrypted iff that base is https.
    const cloudBase = String((config as unknown as { cloud?: { baseUrl?: string } })?.cloud?.baseUrl || "");
    return cloudBase.startsWith("https://");
  }
  return false;
}

export function deriveAccountStatus(
  profile: Partial<AccountStatusProfile> | null | undefined,
  opts?: { desktopConnectedCount?: number | null }
): AccountStatus {
  const p = (profile || {}) as AccountStatusProfile;

  const profileMissingFields = PROFILE_COMPLETION_FIELDS.filter((f) => !filled(p[f]));

  const twoFactorOn =
    typeof p.twoFactorActive === "boolean"
      ? p.twoFactorActive
      : typeof p.twoFactorConfigured === "boolean"
        ? p.twoFactorEnabled === true && p.twoFactorConfigured
        : p.twoFactorEnabled === true;

  const desktopConnectedCount = opts?.desktopConnectedCount ?? null;

  return {
    emailOnFile: filled(p.email),
    emailVerified: p.emailVerified === true,
    phoneOnFile: filled(p.phone),
    profileComplete: profileMissingFields.length === 0,
    profileMissingFields,
    twoFactorOn,
    secureLogin: p.hasPassword === true,
    encryptedConnection: currentConnectionEncrypted(),
    desktopConnectedCount,
    desktopConnected: (desktopConnectedCount ?? 0) > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Data hook — fresh profile + device presence, deduped across mounts  */
/* ------------------------------------------------------------------ */

interface AccountStatusData {
  profile: AccountStatusProfile | null;
  desktopConnectedCount: number | null;
}

const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: AccountStatusData } | null = null;
let inflight: Promise<AccountStatusData> | null = null;

async function fetchAccountStatusData(): Promise<AccountStatusData> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    let profile: AccountStatusProfile | null = null;
    try {
      const res = await apiService.getProfile();
      if (res.success && res.data) profile = res.data as AccountStatusProfile;
    } catch {
      profile = null;
    }
    let desktopConnectedCount: number | null = null;
    try {
      const res = await apiService.getMyDevices();
      if (res.success && res.data) {
        desktopConnectedCount =
          typeof res.data.desktopConnected === "number" ? res.data.desktopConnected : null;
      }
    } catch {
      // Endpoint not deployed yet (or offline): presence stays unknown
      // (null) and `desktopConnected` derives false — never a guess.
      desktopConnectedCount = null;
    }
    const value: AccountStatusData = { profile, desktopConnectedCount };
    cache = { at: Date.now(), value };
    inflight = null;
    return value;
  })();
  return inflight;
}

/** Drop the cached profile/devices so the next mount refetches. */
export function invalidateAccountStatus() {
  cache = null;
}

export function useAccountStatus(): {
  profile: AccountStatusProfile | null;
  status: AccountStatus | null;
  loading: boolean;
} {
  const [data, setData] = useState<AccountStatusData | null>(() =>
    cache && Date.now() - cache.at < CACHE_TTL_MS ? cache.value : null
  );
  const [loading, setLoading] = useState<boolean>(!data);

  useEffect(() => {
    let cancelled = false;
    fetchAccountStatusData()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const status = data
    ? deriveAccountStatus(data.profile, { desktopConnectedCount: data.desktopConnectedCount })
    : null;

  return { profile: data?.profile ?? null, status, loading };
}
