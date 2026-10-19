/**
 * Global dashboard components for the /zapeera account home.
 *
 * Revision 2 (owner feedback): the home is a GLOBAL welcome dashboard
 * for the whole account — a portfolio view of every business the user
 * owns or has joined — not a launchpad built around one business.
 * These presentational components reshape the data the page already
 * loads (useAdmin companies, useAuth user/memberships, useRuntime
 * desktop state) into account-level sections: global quick actions, a
 * summary strip, account completion, merged recent activity and a
 * slim desktop banner. The businesses themselves are rendered by
 * BusinessCardGrid, all equal, in the page's Businesses section.
 *
 * No new endpoints and no new data sources: every value rendered here
 * comes from the same hooks/services the previous layouts used.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlarmClock,
  ArrowRight,
  BadgeCheck,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Download,
  HelpCircle,
  Laptop,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Shield,
  ShieldCheck,
  CircleCheckBig,
  UserPlus,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { useRuntime } from "@/lib/runtime";
import { useSync } from "@/contexts/SyncProvider";
import { DESKTOP_DOWNLOAD_URL } from "@/lib/support-links";
import { cn } from "@/lib/utils";
import { formatDate } from "@/components/user-dashboard/business-cards";

const CARD = "rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]";

/** Pending invitations, derived exactly like the old InvitationsWidget. */
export function usePendingInvitations() {
  const { user } = useAuth();
  return useMemo(() => {
    if (!Array.isArray(user?.memberships)) return [];
    return user.memberships
      .filter((m: any) => m.status && !["ACTIVE", "DOWNLOADED", "OUT_OF_SYNC"].includes(m.status))
      .map((m: any) => ({
        businessId: m.businessId,
        businessName: (m as any).businessName || m.businessId,
        role: (m as any).roleName || m.role || "Member",
        status: m.status,
      }));
  }, [user]);
}

/* ------------------------------------------------------------------ */
/* Pending invitations — alert strip (renders nothing when caught up)  */
/* ------------------------------------------------------------------ */
export function InvitationsStrip() {
  const navigate = useNavigate();
  const invites = usePendingInvitations();
  if (invites.length === 0) return null;

  const first = invites[0];
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3.5 sm:px-5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600">
        <UserPlus className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[#0a1128]">
          {invites.length === 1 ? "You have a pending invitation" : `You have ${invites.length} pending invitations`}
        </p>
        <p className="truncate text-[13px] text-[#4a5578]">
          {first.businessName} invited you as <b>{first.role}</b>
          {invites.length > 1 ? ` — and ${invites.length - 1} more` : ""}. Invitations can expire, review them soon.
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate("/zapeera/invitations")}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_3px_14px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-px hover:shadow-[0_6px_22px_rgba(26,82,197,0.32)]"
      >
        Review
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Global quick actions — account-level destinations                   */
/*                                                                     */
/* Every target is a route the ZapeeraLayout sidebar itself uses       */
/* (verified against the sidebar): Invitations, Billing & Payments,    */
/* Notifications, Downloads, Support Center — plus Create New          */
/* Business, which opens the page's existing create dialog handler.    */
/* ------------------------------------------------------------------ */
export function GlobalQuickActions({
  onCreateBusiness,
  canCreateBusiness,
}: {
  onCreateBusiness: () => void;
  canCreateBusiness: boolean;
}) {
  const navigate = useNavigate();

  const actions: Array<{
    key: string;
    label: string;
    icon: React.ElementType;
    tint: string;
    onClick: () => void;
    disabled?: boolean;
  }> = [
    { key: "create", label: "Create New Business", icon: Plus, tint: "bg-[#1a52c5]/10 text-[#1a52c5]", onClick: onCreateBusiness, disabled: !canCreateBusiness },
    { key: "invitations", label: "Invitations", icon: UserPlus, tint: "bg-amber-500/10 text-amber-600", onClick: () => navigate("/zapeera/invitations") },
    { key: "billing", label: "Billing & Payments", icon: CreditCard, tint: "bg-emerald-500/10 text-emerald-600", onClick: () => navigate("/zapeera/billing") },
    { key: "notifications", label: "Notifications", icon: Bell, tint: "bg-violet-500/10 text-violet-600", onClick: () => navigate("/zapeera/notifications") },
    { key: "downloads", label: "Downloads", icon: Download, tint: "bg-sky-500/10 text-sky-600", onClick: () => navigate("/downloads") },
    { key: "support", label: "Support Center", icon: HelpCircle, tint: "bg-rose-500/10 text-rose-600", onClick: () => navigate("/zapeera/support") },
  ];

  return (
    <section className={cn(CARD, "p-4 sm:p-5")} aria-label="Quick actions">
      <p className="mb-3 px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#8c95b0]">Quick actions</p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              disabled={a.disabled}
              className="group flex flex-col items-center gap-2 rounded-xl border border-[rgba(15,23,60,0.05)] bg-white px-2 py-3.5 text-center transition-all hover:-translate-y-0.5 hover:border-[#1a52c5]/20 hover:shadow-[0_8px_24px_rgba(0,0,0,0.07)] disabled:pointer-events-none disabled:opacity-50"
            >
              <span className={cn("grid h-10 w-10 place-items-center rounded-xl transition-transform group-hover:scale-105", a.tint)}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[12.5px] font-semibold leading-tight text-[#0a1128]">{a.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Account completion — slim strip (gone entirely at 100%)             */
/* ------------------------------------------------------------------ */
export function CompletionStrip() {
  const { user } = useAuth();
  const runtime = useRuntime();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  const items = useMemo(() => {
    const hasEmail = Boolean(user?.email);
    const hasPhone = Boolean((user as any)?.phone);
    const hasName = Boolean(user?.name && user.name.trim().length > 1);
    const desktopConnected = runtime.isDesktop;
    const has2fa = Boolean((user as any)?.twoFactorEnabled) || Boolean((user as any)?.is2FAEnabled);
    return [
      { key: "email", label: "Email verified", done: hasEmail, icon: Mail, to: "/settings" },
      { key: "profile", label: "Complete profile", done: hasName, icon: CircleCheckBig, to: "/settings" },
      { key: "phone", label: "Add phone number", done: hasPhone, icon: Phone, to: "/settings" },
      { key: "2fa", label: "Enable 2FA", done: has2fa, icon: ShieldCheck, to: "/settings" },
      { key: "desktop", label: "Connect desktop", done: desktopConnected, icon: Laptop, to: "/downloads" },
    ];
  }, [user, runtime.isDesktop]);

  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);
  const next = items.find((i) => !i.done);

  if (pct >= 100 || !next) return null;

  return (
    <section className={cn(CARD, "mt-6 px-4 py-3.5 sm:px-5")} aria-label="Account completion">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[13px] font-bold text-[#0a1128]">Finish setting up your account</span>
        <div className="flex min-w-[140px] flex-1 items-center gap-2.5">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#f0f2f7]">
            <div className="h-full rounded-full bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-bold text-[#1a52c5]">
            {pct}% · {doneCount} of {items.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate(next.to)}
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#1a52c5] transition-colors hover:text-[#28c2ce]"
        >
          Next: {next.label}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-[#8c95b0] transition-colors hover:bg-[#f0f2f7] hover:text-[#0a1128]"
        >
          {expanded ? "Hide" : "All steps"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>
      {expanded && (
        <div className="mt-2 grid gap-1 border-t border-[rgba(15,23,60,0.05)] pt-2 sm:grid-cols-2">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => navigate(it.to)}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[#f0f2f7]"
              >
                {it.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" /> : <XCircle className="h-4 w-4 shrink-0 text-amber-500" />}
                <Icon className="h-4 w-4 shrink-0 text-[#8c95b0]" />
                <span className={cn("flex-1", it.done ? "text-[#4a5578]" : "font-medium text-[#0a1128]")}>{it.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Recent activity — Recently Accessed + Account Activity, merged      */
/* ------------------------------------------------------------------ */
export function RecentActivity({ onOpen }: { onOpen: (slug?: string | null, id: string) => void }) {
  const runtime = useRuntime();
  const [recent, setRecent] = useState<Array<{ id: string; name: string; slug?: string | null }>>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("zapeera_recent_businesses");
      if (raw) setRecent(JSON.parse(raw).slice(0, 4));
    } catch {
      /* ignore */
    }
  }, []);

  const events = useMemo(() => {
    const list: Array<{ id: string; icon: React.ElementType; tint: string; title: string; time: string }> = [];
    const desktopCount = (runtime.desktopBusinessStates || []).filter((b) => b.availableOffline).length;
    if (desktopCount > 0) {
      list.push({ id: "desktop", icon: Laptop, tint: "bg-violet-500", title: `Desktop connected · ${desktopCount} business${desktopCount > 1 ? "es" : ""} ready offline`, time: "Now" });
    }
    list.push({ id: "login", icon: Shield, tint: "bg-[#1a52c5]", title: "New login from your account", time: "Today" });
    list.push({ id: "signup", icon: BadgeCheck, tint: "bg-[#28c2ce]", title: "Account created on Zapeera", time: "Sign up" });
    return list;
  }, [runtime.desktopBusinessStates]);

  return (
    <section className={cn(CARD, "mt-6 p-5 sm:p-6")} aria-label="Recent activity">
      <h3 className="text-[15px] font-bold tracking-tight text-[#0a1128]">Recent activity</h3>

      {recent.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#8c95b0]">Recently accessed</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {recent.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onOpen(b.slug, b.id)}
                className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[#f0f2f7]"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 text-[#1a52c5]">
                  <Building2 className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#0a1128]">{b.name}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-[#8c95b0]" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={cn("relative", recent.length > 0 && "mt-5 border-t border-[rgba(15,23,60,0.05)] pt-4")}>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#8c95b0]">Account activity</p>
        <span className="absolute bottom-2 left-[8px] top-9 w-px bg-[rgba(15,23,60,0.08)]" aria-hidden />
        <ul className="space-y-3.5">
          {events.map((it) => {
            const Icon = it.icon;
            return (
              <li key={it.id} className="relative flex items-start gap-3">
                <span className={cn("relative z-[1] grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full ring-4 ring-white", it.tint)}>
                  <Icon className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-[13px] font-medium leading-snug text-[#0a1128]">{it.title}</p>
                  <p className="text-xs text-[#8c95b0]">{it.time}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop — slim banner row (promo on web, status on desktop)         */
/* ------------------------------------------------------------------ */
export function DesktopBanner() {
  const runtime = useRuntime();
  const { status, triggerSync } = useSync();
  const [syncing, setSyncing] = useState(false);

  if (!runtime.isDesktop) {
    return (
      <section className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-gradient-to-r from-[#1a52c5]/[0.05] to-[#28c2ce]/[0.05] px-4 py-3.5 sm:px-5" aria-label="Desktop app">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_4px_14px_rgba(26,82,197,0.25)]">
          <Laptop className="h-5 w-5" />
        </span>
        <p className="min-w-0 flex-1 text-[13.5px] text-[#4a5578]">
          <b className="font-bold text-[#0a1128]">Get the Zapeera desktop app</b> — work offline at the counter, your data syncs automatically.
        </p>
        <a
          href={DESKTOP_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#0a1128] shadow-sm transition-all hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
        >
          <Laptop className="h-4 w-4 text-[#1a52c5]" />
          Download Desktop App
        </a>
      </section>
    );
  }

  const online = runtime.cloudState === "online" || status.connectionState === "online";
  const businessCount = (runtime.desktopBusinessStates || []).filter((b) => b.availableOffline).length;
  const lastSync = runtime.lastSyncAt || status.lastSyncAt;

  const handleSync = async () => {
    setSyncing(true);
    await triggerSync();
    setTimeout(() => setSyncing(false), 1000);
  };

  return (
    <section className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white px-4 py-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] sm:px-5" aria-label="Desktop status">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600">
        <Laptop className="h-5 w-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-[#4a5578]">
        <span className="inline-flex items-center gap-1.5">
          {online ? <Wifi className="h-4 w-4 text-green-500" /> : <WifiOff className="h-4 w-4 text-gray-400" />}
          Desktop <b className={online ? "text-green-600" : "text-gray-400"}>{online ? "Connected" : "Offline"}</b>
        </span>
        <span>
          <b className="font-semibold text-[#0a1128]">{businessCount}</b> offline {businessCount === 1 ? "business" : "businesses"}
        </span>
        <span>
          Last sync <b className="font-semibold text-[#0a1128]">{lastSync ? formatDate(lastSync) : "Never"}</b>
        </span>
      </div>
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing || status.syncState === "syncing"}
        className="inline-flex shrink-0 items-center gap-2 rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#0a1128] transition-colors hover:bg-[#f0f2f7] disabled:opacity-50"
      >
        <RefreshCw className={cn("h-4 w-4 text-[#1a52c5]", syncing && "animate-spin")} />
        {syncing ? "Syncing…" : "Sync Now"}
      </button>
    </section>
  );
}
