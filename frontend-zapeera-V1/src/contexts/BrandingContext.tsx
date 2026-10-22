import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiService } from '../services/api';
import { useAuth } from './AuthContext';

// ─── White-label branding (Feature 3) ─────────────────────────────────
// One BrandingProvider, mounted inside AuthProvider, owns the product's
// public identity: name, logo, tagline, support email and the primary
// accent color. It resolves from GET /api/branding:
//   · a partner slug in the URL (?partner=<slug> or /join/<slug>) — the
//     slug is persisted to localStorage so it survives the email-
//     verification round-trip and is later sent with business creation
//     (attribution happens server-side, once, at createCompany).
//   · otherwise, when signed in, the partner behind the current
//     business; when anonymous, the default Zapeera branding.
// With no partner anywhere in play the provider yields EXACTLY the
// stock branding and touches nothing — the pre-white-label render.
//
// What the primary color drives: the `--primary` and `--ring` CSS
// variables in index.css are stored as HSL components; the provider
// converts the partner's hex color and overrides those two variables
// on <html>, which re-themes every bg-primary / text-primary /
// ring-primary surface, plus a `--brand-primary` hex variable used by
// the sidebar brand marks. A full re-theme of hard-coded gradient
// surfaces is intentionally out of scope (see the wave report).

export interface Branding {
  productName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  tagline: string | null;
  supportEmail: string | null;
  partnerSlug: string | null;
}

export interface BrandingViewer {
  isPartnerAdmin: boolean;
  partnerSlug: string | null;
  partnerStatus: string | null;
}

export const DEFAULT_BRANDING: Branding = {
  productName: 'Zapeera',
  logoUrl: null,
  primaryColor: null,
  tagline: null,
  supportEmail: null,
  partnerSlug: null,
};

const DEFAULT_VIEWER: BrandingViewer = {
  isPartnerAdmin: false,
  partnerSlug: null,
  partnerStatus: null,
};

export const PARTNER_SLUG_STORAGE_KEY = 'zapeera_partner_slug';

/** Read the partner slug arriving with this page load: ?partner= wins,
 *  then a /join/<slug> path. Returns null when the visit is direct. */
export function partnerSlugFromLocation(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('partner');
    if (fromQuery && fromQuery.trim()) return fromQuery.trim().toLowerCase();
    const joinMatch = window.location.pathname.match(/^\/join\/([^/]+)/);
    if (joinMatch) return decodeURIComponent(joinMatch[1]).trim().toLowerCase();
  } catch {
    /* non-browser context */
  }
  return null;
}

export function storedPartnerSlug(): string | null {
  try {
    return localStorage.getItem(PARTNER_SLUG_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist an arriving partner slug (attribution survives signup →
 *  email verification → first business creation). */
export function capturePartnerSlug(): string | null {
  const slug = partnerSlugFromLocation();
  if (slug) {
    try {
      localStorage.setItem(PARTNER_SLUG_STORAGE_KEY, slug);
    } catch {
      /* storage unavailable */
    }
  }
  return slug || storedPartnerSlug();
}

function hexToHslComponents(hex: string): string | null {
  const m = hex.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) hue = ((b - r) / d + 2) * 60;
    else hue = ((r - g) / d + 4) * 60;
  }
  return `${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Apply (or clear) the partner accent color on <html>. Clearing
 *  removes the inline overrides so index.css defaults render — the
 *  exact pre-white-label theme. */
function applyPrimaryColor(hex: string | null) {
  const root = document.documentElement;
  const hsl = hex ? hexToHslComponents(hex) : null;
  if (hsl) {
    root.style.setProperty('--primary', hsl);
    root.style.setProperty('--ring', hsl);
    root.style.setProperty('--brand-primary', hex as string);
  } else {
    root.style.removeProperty('--primary');
    root.style.removeProperty('--ring');
    root.style.removeProperty('--brand-primary');
  }
}

interface BrandingContextValue {
  branding: Branding;
  viewer: BrandingViewer;
  isPartnerBranded: boolean;
  refreshBranding: () => void;
}

const BrandingContext = createContext<BrandingContextValue>({
  branding: DEFAULT_BRANDING,
  viewer: DEFAULT_VIEWER,
  isPartnerBranded: false,
  refreshBranding: () => undefined,
});

export const useBranding = () => useContext(BrandingContext);

export const BrandingProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, isAuthenticated } = useAuth();
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [viewer, setViewer] = useState<BrandingViewer>(DEFAULT_VIEWER);
  const [refreshTick, setRefreshTick] = useState(0);
  const requestSeq = useRef(0);

  // Capture an arriving slug once per mount (join link / ?partner=).
  useEffect(() => {
    capturePartnerSlug();
  }, []);

  const businessKey =
    (user as any)?.membership?.businessId || (user as any)?.companyId || null;
  const userKey = isAuthenticated ? (user as any)?.id || 'auth' : 'anon';

  useEffect(() => {
    const seq = ++requestSeq.current;
    const urlSlug = partnerSlugFromLocation();
    // Anonymous visitors arriving WITHOUT a slug use the slug they
    // carried in with (persisted) so the register page stays branded
    // through the whole signup flow; signed-in users always resolve
    // from their current business instead.
    const slug = urlSlug || (!isAuthenticated ? storedPartnerSlug() : null);

    (async () => {
      try {
        const res = await apiService.getBranding(slug || undefined);
        if (seq !== requestSeq.current) return; // stale response
        if (res.success && res.data) {
          const { viewer: v, ...b } = res.data as any;
          setBranding({ ...DEFAULT_BRANDING, ...b });
          if (v) setViewer({ ...DEFAULT_VIEWER, ...v });
        }
      } catch {
        // Branding must never break the app: stay on the default.
      }
    })();
  }, [userKey, businessKey, refreshTick, isAuthenticated]);

  useEffect(() => {
    applyPrimaryColor(branding.partnerSlug ? branding.primaryColor : null);
    return () => applyPrimaryColor(null);
  }, [branding.primaryColor, branding.partnerSlug]);

  const value = useMemo<BrandingContextValue>(
    () => ({
      branding,
      viewer,
      isPartnerBranded: !!branding.partnerSlug,
      refreshBranding: () => setRefreshTick((t) => t + 1),
    }),
    [branding, viewer]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
};

export default BrandingProvider;
