import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiService } from '../services/api';

/**
 * /demo — public live-demo entry for the marketing hero.
 *
 * Calls POST /api/auth/demo-login (no credentials; the backend signs in
 * the one server-designated demo account), then hard-navigates into the
 * demo business workspace so the app boots exactly like a fresh login.
 * The ?to= target is whitelisted to the hero's six screens; anything else
 * falls back to the dashboard. The demo account is fenced server-side and
 * its data resets nightly.
 */
const DEMO_TARGETS: Record<string, string> = {
  dashboard: 'dashboard',
  pos: 'pos',
  inventory: 'products',
  voice: 'dashboard',
  branches: 'branches',
  reports: 'reports',
};

const FALLBACK_SLUG = 'demo-pharmacy';

export default function DemoPage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return; // StrictMode double-invoke guard
    startedRef.current = true;

    (async () => {
      const toRaw = (searchParams.get('to') || 'dashboard').toLowerCase();
      const to = DEMO_TARGETS[toRaw] ? toRaw : 'dashboard';
      const segment = DEMO_TARGETS[to];

      // Voice deep-link hint: the workspace voice panel opens on arrival.
      if (to === 'voice') {
        try {
          sessionStorage.setItem('zapeera:open-voice', '1');
        } catch {
          /* storage unavailable — landing on the dashboard is still fine */
        }
      }

      const result = await apiService.demoLogin();
      if (!result.success) {
        setError(
          result.message ||
            'The live demo is unavailable right now. Please try again in a minute.'
        );
        return;
      }

      // Resolve the demo business slug from the account's own companies
      // (robust to slug suffixing); fall back to the expected slug.
      let slug = FALLBACK_SLUG;
      try {
        const res: any = await apiService.getMyCompanies();
        const payload = res?.data ?? res;
        const owned = Array.isArray(payload?.owned) ? payload.owned : [];
        const shared = Array.isArray(payload?.shared) ? payload.shared : [];
        const first = owned[0] || shared[0];
        if (first?.slug) slug = String(first.slug);
      } catch {
        /* keep fallback slug */
      }

      // Hard navigation: AuthContext boots from the stored user + cookie,
      // identical to a normal login followed by a refresh.
      window.location.assign(`/business/${slug}/${segment}`);
    })();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#060d1f] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-xl font-bold text-white">
          Z
        </div>
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-white">Live demo unavailable</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-full bg-gradient-to-r from-[#1a52c5] to-[#28c2ce] px-5 py-2.5 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-white">Starting the live demo…</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Signing you into the Demo Pharmacy workspace. Everything you see is the
              real Zapeera app — feel free to click around.
            </p>
            <div className="mx-auto mt-6 h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-[#1a52c5] to-[#28c2ce]" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
