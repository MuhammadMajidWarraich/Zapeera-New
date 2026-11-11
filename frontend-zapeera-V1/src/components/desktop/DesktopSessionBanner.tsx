import { useEffect, useState } from 'react';
import { AlertTriangle, ClockAlert } from 'lucide-react';
import { getLocalApi } from '@/services/api-clients';
import { useRuntime } from '@/lib/runtime';
import { useAdmin } from '@/contexts/useAdmin';

/**
 * v1.0.19 — Desktop session / subscription renewal banner.
 *
 * Reads the embedded backend's GET /auth/session-status (local session
 * window + mirrored per-business subscription period ends):
 * - Local sign-in session ≤7 days left → amber "connect to the
 *   internet to renew"; ≤3 days → stronger red treatment.
 * - Selected business's subscription period end ≤7 days away → amber;
 *   period end + 72h grace both passed → the workspace is in the
 *   read-only/export-only degrade (enforced by the embedded backend);
 *   the banner says so plainly.
 * Desktop only; renders nothing when everything is comfortably valid.
 */

interface SessionStatus {
  session: { expiresAt: string | null; offlineExpiresAt: string | null; offlineGrace: boolean } | null;
  businesses: Array<{ businessId: string; periodEnd: string | null }>;
  // Legacy alias tolerated defensively (v1.0.20.1): the embedded endpoint
  // once returned `subscriptions` here; a missing array must never crash
  // the workspace again.
  subscriptions?: Array<{ businessId: string; periodEnd: string | null }>;
  serverNow: string;
}

const DAY_MS = 24 * 3600 * 1000;

export function DesktopSessionBanner() {
  const runtime = useRuntime();
  const { selectedCompanyId } = useAdmin() as any;
  const [status, setStatus] = useState<SessionStatus | null>(null);

  useEffect(() => {
    if (!runtime?.isDesktop) return;
    let cancelled = false;
    const load = async () => {
      try {
        const local = getLocalApi();
        const res: any = await local.getSessionStatus();
        if (!cancelled && res?.success && res.data) setStatus(res.data as SessionStatus);
      } catch {
        // Embedded unreachable — no banner (never invent state).
      }
    };
    load();
    const timer = setInterval(load, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runtime?.isDesktop]);

  if (!runtime?.isDesktop || !status) return null;

  const now = Date.now();
  const messages: Array<{ level: 'amber' | 'red'; text: string }> = [];

  const expirySource = status.session?.offlineExpiresAt || status.session?.expiresAt;
  if (expirySource) {
    const daysLeft = Math.floor((new Date(expirySource).getTime() - now) / DAY_MS);
    if (daysLeft <= 3) {
      messages.push({
        level: 'red',
        text: `Your offline sign-in expires in ${Math.max(daysLeft, 0)} day${daysLeft === 1 ? '' : 's'} — connect to the internet now to renew it, otherwise you will need to sign in again.`,
      });
    } else if (daysLeft <= 7) {
      messages.push({
        level: 'amber',
        text: `Your offline sign-in expires in ${daysLeft} days — connect to the internet to renew it.`,
      });
    }
  }

  // v1.0.20.1: never .find() on a possibly-absent array — a missing
  // `businesses` list means "no subscription info", not a crash.
  const businessList = status.businesses ?? status.subscriptions ?? [];
  const biz = businessList.find((b) => b.businessId === selectedCompanyId);
  if (biz?.periodEnd) {
    const endMs = new Date(biz.periodEnd).getTime();
    const daysLeft = Math.floor((endMs - now) / DAY_MS);
    if (now > endMs + 72 * 3600 * 1000) {
      messages.push({
        level: 'red',
        text: 'This business’s subscription period has ended — the workspace is read-only (viewing and exports only) until it is renewed.',
      });
    } else if (daysLeft <= 7) {
      messages.push({
        level: 'amber',
        text:
          daysLeft >= 0
            ? `This business’s subscription renews/ends in ${Math.max(daysLeft, 0)} day${daysLeft === 1 ? '' : 's'} — connect to the internet so the renewal reaches this computer.`
            : 'This business’s subscription period has ended and is in its 72-hour grace — connect to the internet to renew before the workspace becomes read-only.',
      });
    }
  }

  if (messages.length === 0) return null;
  const top = messages.find((m) => m.level === 'red') || messages[0];

  return (
    <div
      className={`flex items-center gap-2.5 border-b px-5 py-2.5 text-sm ${
        top.level === 'red'
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      {top.level === 'red' ? (
        <ClockAlert className="h-4 w-4 shrink-0 text-red-600" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
      )}
      <span className="flex-1">{top.text}</span>
    </div>
  );
}
