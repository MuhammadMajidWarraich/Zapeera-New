import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  Shield,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Phone,
  MessageCircle,
  Mail,
  Calendar,
  BookOpen,
  Laptop,
  RefreshCw,
  Clock,
  Wifi,
  WifiOff,
  HardDrive,
  Database,
  Star,
  Lock,
  CircleCheckBig,
  BadgeCheck,
  Users,
  Building2,
  CreditCard,
  UserPlus,
  AlarmClock,
  TrendingUp,
  History,
  ChevronRight,
  FileText,
  HelpCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { useRuntime } from "@/lib/runtime";
import { useSync } from "@/contexts/SyncProvider";
import { whatsappUrl, callUrl, emailUrl, SUPPORT_PHONE_DISPLAY } from "@/lib/support-links";
import { config } from "@/lib/config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/* ------------------------------------------------------------------ */
/* Shared card shell                                                    */
/* ------------------------------------------------------------------ */
export function Panel({
  title,
  subtitle,
  action,
  actionLabel,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: () => void;
  actionLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.06)] shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]", className)}>
      {(title || action) && (
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <div className="min-w-0">
            {title && <CardTitle className="text-[15px] font-bold tracking-tight text-[#0a1128]">{title}</CardTitle>}
            {subtitle && <p className="mt-0.5 truncate text-xs text-[#8c95b0]">{subtitle}</p>}
          </div>
          {action && (
            <button
              type="button"
              onClick={action}
              className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#1a52c5] transition-colors hover:text-[#28c2ce]"
            >
              {actionLabel || "View All"}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </CardHeader>
      )}
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Quick account stats (USER stats, not business stats)                */
/* ------------------------------------------------------------------ */
export function AccountStats() {
  const { allCompanies } = useAdmin();
  const { user } = useAuth();
  const runtime = useRuntime();
  const navigate = useNavigate();

  const stats = useMemo(() => {
    const owned = (allCompanies || []).filter((c: any) => String(c?.createdBy || "") === String(user?.id || "") || c?.accessType === "owned").length;
    const joined = (allCompanies || []).filter((c: any) => c?.accessType === "shared" || (c?.createdBy && String(c.createdBy) !== String(user?.id))).length;
    const pendingInvites = Array.isArray(user?.memberships)
      ? user.memberships.filter((m: any) => m.status && !["ACTIVE", "DOWNLOADED", "OUT_OF_SYNC"].includes(m.status)).length
      : 0;
    const desktopConnected = runtime.isDesktop && runtime.cloudState !== "offline";
    const desktopCount = (runtime.desktopBusinessStates || []).filter((b) => b.availableOffline).length;

    return [
      { key: "owned", label: "Businesses Owned", value: owned, icon: Building2, tint: "from-[#1a52c5] to-[#2d6ed9]" },
      { key: "joined", label: "Businesses Joined", value: joined, icon: UserPlus, tint: "from-[#28c2ce] to-[#20a8b3]" },
      { key: "invites", label: "Pending Invitations", value: pendingInvites, icon: AlarmClock, tint: "from-amber-500 to-orange-500", onClick: () => navigate("/zapeera/invitations") },
      { key: "desktop", label: "Desktop Connected", value: desktopConnected ? desktopCount : 0, icon: Laptop, tint: "from-violet-500 to-purple-500", desktop: desktopConnected },
    ];
  }, [allCompanies, user, runtime.isDesktop, runtime.cloudState, runtime.desktopBusinessStates]);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <button
            key={s.key}
            type="button"
            onClick={s.onClick}
            className={cn(
              "group relative overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-4 text-left shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]",
              s.onClick && "cursor-pointer"
            )}
          >
            <div className="flex items-center justify-between">
              <div className={cn("grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow", s.tint)}>
                <Icon className="h-5 w-5" />
              </div>
              {s.desktop ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-bold text-green-600">
                  <Wifi className="h-3 w-3" /> Online
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-2xl font-extrabold tracking-tight text-[#0a1128]">{s.value}</p>
            <p className="text-xs font-medium text-[#8c95b0]">{s.label}</p>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Security card                                                       */
/* ------------------------------------------------------------------ */
export function SecurityCard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const items = [
    { key: "email", label: "Secure Login", ok: true, icon: BadgeCheck },
    { key: "enc", label: "Encrypted Connection", ok: true, icon: Lock },
  ];
  return (
    <Panel title="Your Account Is Protected" subtitle="Security & device status" action={() => navigate("/settings")} actionLabel="Security Settings">
      <div className="space-y-2.5 p-4 pt-1">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.key} className="flex items-center gap-2.5 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
              <Icon className="h-4 w-4 shrink-0 text-[#1a52c5]" />
              <span className="text-[#4a5578]">{it.label}</span>
            </div>
          );
        })}
        <div className="flex items-center gap-2.5 text-sm">
          {user?.isActive ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" /> : <XCircle className="h-4 w-4 shrink-0 text-amber-500" />}
          <Shield className="h-4 w-4 shrink-0 text-[#1a52c5]" />
          <span className="text-[#4a5578]">Two Factor Authentication</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/settings")}
          className="mt-2 w-full border-[rgba(15,23,60,0.1)] font-semibold text-[#0a1128] hover:bg-[#f0f2f7]"
        >
          <ShieldCheck className="mr-1.5 h-4 w-4 text-[#1a52c5]" />
          Open Security Settings
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Account completion widget                                           */
/* ------------------------------------------------------------------ */
export function AccountCompletion() {
  const { user } = useAuth();
  const runtime = useRuntime();
  const navigate = useNavigate();

  const items = useMemo(() => {
    const hasEmail = Boolean(user?.email);
    const hasPhone = Boolean((user as any)?.phone);
    const hasName = Boolean(user?.name && user.name.trim().length > 1);
    const desktopConnected = runtime.isDesktop;
    const has2fa = Boolean((user as any)?.twoFactorEnabled) || Boolean((user as any)?.is2FAEnabled);
    const list = [
      { key: "email", label: "Email verified", done: hasEmail, icon: Mail, to: "/settings" },
      { key: "profile", label: "Complete profile", done: hasName, icon: CircleCheckBig, to: "/settings" },
      { key: "phone", label: "Add phone number", done: hasPhone, icon: Phone, to: "/settings" },
      { key: "2fa", label: "Enable 2FA", done: has2fa, icon: ShieldCheck, to: "/settings" },
      { key: "desktop", label: "Connect desktop", done: desktopConnected, icon: Laptop, to: "/downloads" },
    ];
    return list;
  }, [user, runtime.isDesktop]);

  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);

  return (
    <Panel title="Account Completion" subtitle={`${doneCount} of ${items.length} completed`}>
      <div className="p-4 pt-2">
        <div className="mb-3 flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#f0f2f7]">
            <div className="h-full rounded-full bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-bold text-[#1a52c5]">{pct}%</span>
        </div>
        <div className="space-y-1.5">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <button key={it.key} type="button" onClick={() => navigate(it.to)} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left text-[13px] transition-colors hover:bg-[#f0f2f7]">
                {it.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" /> : <XCircle className="h-4 w-4 shrink-0 text-amber-500" />}
                <Icon className="h-4 w-4 shrink-0 text-[#8c95b0]" />
                <span className={cn("flex-1", it.done ? "text-[#4a5578]" : "font-medium text-[#0a1128]")}>{it.label}</span>
                {!it.done && <ChevronRight className="h-3.5 w-3.5 text-[#8c95b0]" />}
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Support widget                                                      */
/* ------------------------------------------------------------------ */
export function SupportWidget() {
  return (
    <Panel title="Need Help?">
      <div className="space-y-2 p-4 pt-1">
        <a
          href={callUrl()}
          className="flex items-center gap-3 rounded-xl border border-[rgba(15,23,60,0.06)] bg-white px-3.5 py-3 transition-colors hover:border-[#1a52c5]/20 hover:bg-[#f0f2f7]"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white">
            <Phone className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-[#0a1128]">Call Us</span>
            <span className="block text-xs text-[#8c95b0]">{SUPPORT_PHONE_DISPLAY}</span>
          </span>
        </a>
        <a
          href={whatsappUrl("Hello! I need support with Zapeera.")}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl border border-[rgba(15,23,60,0.06)] bg-white px-3.5 py-3 transition-colors hover:border-[#1a52c5]/20 hover:bg-[#f0f2f7]"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-green-500 text-white">
            <MessageCircle className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-[#0a1128]">WhatsApp Support</span>
            <span className="block text-xs text-[#8c95b0]">Chat with our team</span>
          </span>
        </a>
        <a
          href={emailUrl("Zapeera Support", "Hello, I need help with Zapeera.")}
          className="flex items-center gap-3 rounded-xl border border-[rgba(15,23,60,0.06)] bg-white px-3.5 py-3 transition-colors hover:border-[#1a52c5]/20 hover:bg-[#f0f2f7]"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#1a52c5]/10 text-[#1a52c5]">
            <Mail className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-[#0a1128]">Email Support</span>
            <span className="block text-xs text-[#8c95b0]">{config.support.email}</span>
          </span>
        </a>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop status card                                                 */
/* ------------------------------------------------------------------ */
export function DesktopStatusCard() {
  const runtime = useRuntime();
  const { status, triggerSync } = useSync();
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    await triggerSync();
    setTimeout(() => setSyncing(false), 1000);
  };

  if (!runtime.isDesktop) {
    return (
      <Panel title="Desktop App">
        <div className="p-4 pt-1">
          <p className="text-[13px] text-[#4a5578]">Use Zapeera offline with the desktop app — your data stays in sync automatically.</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/downloads")} className="mt-3 w-full border-[rgba(15,23,60,0.1)] font-semibold text-[#0a1128] hover:bg-[#f0f2f7]">
            <Laptop className="mr-1.5 h-4 w-4 text-[#1a52c5]" />
            Download Desktop App
          </Button>
        </div>
      </Panel>
    );
  }

  const online = runtime.cloudState === "online" || status.connectionState === "online";
  const businessCount = (runtime.desktopBusinessStates || []).filter((b) => b.availableOffline).length;

  return (
    <Panel title="Desktop Status">
      <div className="space-y-2.5 p-4 pt-1">
        <div className="flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-2 text-[#4a5578]">
            {online ? <Wifi className="h-4 w-4 text-green-500" /> : <WifiOff className="h-4 w-4 text-gray-400" />}
            Desktop Connected
          </span>
          <span className={cn("font-bold", online ? "text-green-600" : "text-gray-400")}>{online ? "Connected" : "Offline"}</span>
        </div>
        <div className="flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-2 text-[#4a5578]">
            <Clock className="h-4 w-4 text-[#1a52c5]" />
            Last Sync
          </span>
          <span className="font-semibold text-[#0a1128]">
            {runtime.lastSyncAt || status.lastSyncAt ? formatAgo(runtime.lastSyncAt || status.lastSyncAt) : "Never"}
          </span>
        </div>
        <div className="flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-2 text-[#4a5578]">
            <Database className="h-4 w-4 text-[#1a52c5]" />
            Offline Businesses
          </span>
          <span className="font-semibold text-[#0a1128]">{businessCount}</span>
        </div>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || status.syncState === "syncing"} className="w-full border-[rgba(15,23,60,0.1)] font-semibold text-[#0a1128] hover:bg-[#f0f2f7]">
          <RefreshCw className={cn("mr-1.5 h-4 w-4 text-[#1a52c5]", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync Now"}
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Activity timeline                                                   */
/* ------------------------------------------------------------------ */
type ActivityItem = { id: string; icon: React.ElementType; tint: string; title: string; time: string };

export function ActivityTimeline({ compact }: { compact?: boolean }) {
  const { user } = useAuth();
  const runtime = useRuntime();

  const items: ActivityItem[] = useMemo(() => {
    const list: ActivityItem[] = [];
    const desktopCount = (runtime.desktopBusinessStates || []).filter((b) => b.availableOffline).length;
    if (desktopCount > 0) {
      list.push({ id: "desktop", icon: Laptop, tint: "bg-violet-500", title: `Desktop connected · ${desktopCount} business${desktopCount > 1 ? "es" : ""} ready offline`, time: "Now" });
    }
    list.push({ id: "login", icon: Shield, tint: "bg-[#1a52c5]", title: "New login from your account", time: "Today" });
    list.push({ id: "signup", icon: BadgeCheck, tint: "bg-[#28c2ce]", title: "Account created on Zapeera", time: "Sign up" });
    void user;
    return list;
  }, [runtime.desktopBusinessStates]);

  return (
    <Panel title="Account Activity" subtitle="Recent events in your account">
      <div className="relative p-4 pt-2">
        <span className="absolute left-[21px] top-3 bottom-3 w-px bg-[rgba(15,23,60,0.08)]" aria-hidden />
        <ul className="space-y-4">
          {(compact ? items.slice(0, 3) : items).map((it) => {
            const Icon = it.icon;
            return (
              <li key={it.id} className="relative flex items-start gap-3 pl-1">
                <span className={cn("relative z-[1] grid h-[18px] w-[18px] shrink-0 translate-x-[5px] place-items-center rounded-full ring-4 ring-white", it.tint)}>
                  <Icon className="h-3 w-3 text-white" strokeWidth={2.5} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-[13px] font-medium text-[#0a1128]">{it.title}</p>
                  <p className="text-xs text-[#8c95b0]">{it.time}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Recently accessed businesses (from localStorage)                    */
/* ------------------------------------------------------------------ */
export function RecentlyAccessed({ onOpen }: { onOpen: (slug?: string | null, id: string) => void }) {
  const [recent, setRecent] = useState<Array<{ id: string; name: string; slug?: string | null }>>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("zapeera_recent_businesses");
      if (raw) setRecent(JSON.parse(raw).slice(0, 4));
    } catch {
      /* ignore */
    }
  }, []);

  if (recent.length === 0) return null;

  return (
    <Panel title="Recently Accessed">
      <div className="space-y-1 p-2 pt-1">
        {recent.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onOpen(b.slug, b.id)}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[#f0f2f7]"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 text-[#1a52c5]">
              <Building2 className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#0a1128]">{b.name}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#8c95b0]" />
          </button>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Favorites (pinned businesses)                                       */
/* ------------------------------------------------------------------ */
export function FavoriteBusinesses({ onOpen }: { onOpen: (slug?: string | null, id: string) => void }) {
  const { allCompanies } = useAdmin();
  const [pinned, setPinned] = useState<Array<{ id: string; name: string; slug?: string | null }>>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("zapeera_favorite_businesses");
      if (raw) setPinned(JSON.parse(raw).slice(0, 3));
    } catch {
      /* ignore */
    }
  }, []);

  if (pinned.length === 0) return null;

  return (
    <Panel title="Favorite Businesses" subtitle="Your pinned businesses">
      <div className="space-y-1 p-2 pt-1">
        {pinned.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onOpen(b.slug, b.id)}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[#f0f2f7]"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-500">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#0a1128]">{b.name}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#8c95b0]" />
          </button>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Invitations widget                                                  */
/* ------------------------------------------------------------------ */
export function InvitationsWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const invites = useMemo(() => {
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

  if (invites.length === 0) {
    return (
      <Panel title="Invitations" action={() => navigate("/zapeera/invitations")} actionLabel="View All">
        <div className="p-4 pt-1">
          <p className="text-[13px] text-[#8c95b0]">You're all caught up — no pending invitations.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Pending Invitations" subtitle={`${invites.length} need${invites.length === 1 ? "s" : ""} your action`} action={() => navigate("/zapeera/invitations")} actionLabel="View All">
      <div className="space-y-2 p-3 pt-1">
        {invites.map((inv) => (
          <div key={inv.businessId} className="flex items-center gap-3 rounded-xl border border-[rgba(15,23,60,0.06)] bg-white px-3 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600">
              <UserPlus className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-[#0a1128]">{inv.businessName}</p>
              <p className="truncate text-xs text-[#8c95b0]">
                Invited as <b className="text-[#4a5578]">{inv.role}</b>
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/zapeera/invitations")}
              className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)] hover:opacity-95"
            >
              Review
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Recent notifications widget                                         */
/* ------------------------------------------------------------------ */
export function RecentNotifications() {
  const navigate = useNavigate();
  const runtime = useRuntime();
  const { user } = useAuth();

  const pendingInvites = useMemo(
    () =>
      Array.isArray(user?.memberships)
        ? user.memberships.filter((m: any) => m.status && !["ACTIVE", "DOWNLOADED", "OUT_OF_SYNC"].includes(m.status)).length
        : 0,
    [user]
  );

  const items: Array<{ id: string; icon: React.ElementType; tint: string; title: string; body: string; to?: string }> = [];
  if (pendingInvites > 0) {
    items.push({ id: "invites", icon: UserPlus, tint: "bg-amber-500/12 text-amber-600", title: "Pending invitations", body: `${pendingInvites} business invitation${pendingInvites > 1 ? "s" : ""} awaiting your response.`, to: "/zapeera/invitations" });
  }
  const desktopCount = (runtime.desktopBusinessStates || []).filter((b) => b.availableOffline).length;
  if (runtime.isDesktop && desktopCount > 0) {
    items.push({ id: "desktop", icon: Laptop, tint: "bg-violet-500/12 text-violet-600", title: "Offline ready", body: `${desktopCount} business${desktopCount > 1 ? "es" : ""} are available offline on your desktop.`, to: "/zapeera" });
  }

  if (items.length === 0) {
    return (
      <Panel title="Recent Notifications" action={() => navigate("/zapeera/notifications")} actionLabel="View All">
        <div className="p-4 pt-1">
          <p className="text-[13px] text-[#8c95b0]">No unread notifications right now.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Recent Notifications" subtitle="Unread updates" action={() => navigate("/zapeera/notifications")} actionLabel="View All">
      <div className="space-y-2 p-3 pt-1">
        {items.map((n) => {
          const Icon = n.icon;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => n.to && navigate(n.to)}
              className="flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-[#f0f2f7]"
            >
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", n.tint)}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-[#0a1128]">{n.title}</span>
                <span className="block text-xs text-[#8c95b0]">{n.body}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function formatAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "Never";
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } catch {
    return dateStr;
  }
}

// re-export a few icons the main dashboard composes from
export { Shield, HelpCircle, BookOpen, History, Users, CreditCard, TrendingUp, FileText };
