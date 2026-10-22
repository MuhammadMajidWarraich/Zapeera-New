import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  Handshake,
  CheckCheck,
  CheckCircle2,
  LifeBuoy,
  Loader2,
  Receipt,
  Timer,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useBackofficeAuth } from '../auth/BackofficeAuthContext';
import { backofficeApi } from '../services/api';
import type {
  BackofficeNotificationItem,
  BackofficeNotificationKind,
  BackofficeNotifications,
} from '../types';

const KIND_ICON: Record<BackofficeNotificationKind, typeof Receipt> = {
  payment_proof: Receipt,
  affiliate_payout: Wallet,
  affiliate_application: UserPlus,
  new_business: Building2,
  trial_expiring: Timer,
  support_ticket: LifeBuoy,
  partner_application: Handshake,
};

const KIND_ICON_CLASSES: Record<BackofficeNotificationKind, string> = {
  payment_proof: 'bg-amber-50 text-amber-600',
  affiliate_payout: 'bg-emerald-50 text-emerald-600',
  affiliate_application: 'bg-violet-50 text-violet-600',
  new_business: 'bg-blue-50 text-blue-600',
  trial_expiring: 'bg-orange-50 text-orange-600',
  support_ticket: 'bg-rose-50 text-rose-600',
  partner_application: 'bg-cyan-50 text-cyan-600',
};

function lastSeenKey(adminId: string) {
  return `backoffice_notifications_last_seen:${adminId}`;
}

function readLastSeen(adminId: string): number | null {
  try {
    const raw = localStorage.getItem(lastSeenKey(adminId));
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Header notification bell fed by GET /backoffice/notifications — every
 * item is a real pending row (payment proofs, affiliate payouts and
 * applications, new businesses, expiring trials, open support tickets).
 * The badge counts only items newer than this admin's stored "last seen"
 * timestamp; there is no decorative dot.
 */
export function NotificationsBell() {
  const navigate = useNavigate();
  const { admin } = useBackofficeAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BackofficeNotifications | null>(null);
  const [lastSeen, setLastSeen] = useState<number | null>(() =>
    admin ? readLastSeen(admin.id) : null,
  );
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backofficeApi.getNotifications();
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError('Could not load notifications');
      }
    } catch {
      setError('Could not load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open ]);

  const items = data?.items ?? [];
  const unseenCount = items.filter(
    (item) => lastSeen === null || new Date(item.createdAt).getTime() > lastSeen,
  ).length;

  const markAllSeen = () => {
    const now = Date.now();
    setLastSeen(now);
    if (admin) {
      try {
        localStorage.setItem(lastSeenKey(admin.id), String(now));
      } catch { /* storage unavailable — state still updates for the session */ }
    }
  };

  const handleToggle = () => {
    setOpen((prev) => {
      if (!prev) load(); // refresh the feed each time the panel opens
      return !prev;
    });
  };

  const handleItemClick = (item: BackofficeNotificationItem) => {
    setOpen(false);
    navigate(item.link);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={handleToggle}
        className="p-2.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition relative"
        aria-label={unseenCount > 0 ? `Notifications, ${unseenCount} new` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell className="w-5 h-5" />
        {unseenCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white">
            {unseenCount > 99 ? '99+' : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] max-w-[calc(100vw-2rem)] max-sm:fixed max-sm:left-3 max-sm:right-3 max-sm:top-[4.25rem] max-sm:mt-0 max-sm:w-auto max-sm:max-w-none bg-white rounded-2xl shadow-xl shadow-gray-900/5 border border-gray-200/80 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div>
              <p className="text-sm font-semibold text-gray-900">Notifications</p>
              <p className="text-xs text-gray-400">
                {data ? `${data.total} item${data.total === 1 ? '' : 's'} need attention` : 'Pending work across the platform'}
              </p>
            </div>
            <button
              onClick={markAllSeen}
              disabled={unseenCount === 0}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-300 disabled:cursor-not-allowed transition"
            >
              <CheckCheck className="w-4 h-4" />
              Mark all as seen
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {loading && (
              <div className="p-4 space-y-3" aria-label="Loading notifications">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-start gap-3 animate-pulse">
                    <div className="w-9 h-9 rounded-lg bg-gray-100 flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-gray-100 rounded w-2/3" />
                      <div className="h-3 bg-gray-100 rounded w-full" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && error && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-gray-500 mb-3">{error}</p>
                <button
                  onClick={load}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 rounded-lg px-3 py-1.5 transition"
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">You're all caught up</p>
                <p className="text-xs text-gray-400 mt-1">Nothing is waiting for review right now.</p>
              </div>
            )}

            {!loading && !error && items.length > 0 && (
              <ul className="divide-y divide-gray-50">
                {items.map((item) => {
                  const Icon = KIND_ICON[item.kind];
                  const isUnseen = lastSeen === null || new Date(item.createdAt).getTime() > lastSeen;
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => handleItemClick(item)}
                        className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition ${isUnseen ? 'bg-blue-50/50' : ''}`}
                      >
                        <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${KIND_ICON_CLASSES[item.kind]}`}>
                          <Icon className="w-[18px] h-[18px]" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 truncate">{item.title}</span>
                            {isUnseen && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />}
                          </span>
                          <span className="block text-xs text-gray-500 truncate mt-0.5">{item.detail}</span>
                          <span className="block text-[11px] text-gray-400 mt-0.5">
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {loading && (
            <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
