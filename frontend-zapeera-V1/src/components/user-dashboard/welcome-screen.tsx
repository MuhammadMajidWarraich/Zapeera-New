/**
 * Welcome screen sections for the /zapeera account home.
 *
 * Restyle of the existing portfolio hub to the approved mockup layout:
 * stat cards, a filterable business grid, sync/cloud status, invitations
 * with inline actions, recent activity, quick actions, storage (desktop
 * only) and a control banner.
 *
 * REAL DATA ONLY (Muhammad's standing rule — every number traces to a
 * source, nothing here is mockup data):
 * - Businesses/branches/roles: useAdmin companies + useAuth memberships
 *   (the same two payloads the old hub already loaded).
 * - Plan/expiry: per-business entitlements, fetched with the same proven
 *   pattern as business-cards.tsx (memoized list, Promise.allSettled,
 *   capped at 20, cancelled on unmount) — never the mockup's 2025 dates.
 * - Pending Actions = pending invitations derived from memberships, the
 *   same derivation as InvitationsStrip. There is no "approvals" source
 *   in the code, so the card says invitations, not approvals.
 * - Account Security: useAccountStatus (fresh GET /auth/profile) and its
 *   genuine-2FA rule. "Strong" only when twoFactorOn is true; otherwise
 *   the card shows the honest improve state. The old SecurityCard's use
 *   of user.isActive as the 2FA signal was wrong (isActive = account
 *   active, not 2FA) and is NOT repeated here.
 * - Sync panel: useSync status (already polling every 10s on desktop).
 *   No "Next Sync" row — no data-sync schedule exists in the code (the
 *   10s poll is a status poll, not a sync timetable), and no device id
 *   (the mockup's DESKTOP-7F3L90K is invented).
 * - Storage panel: electronAPI.getStorageInfo() (statfs + database size,
 *   the same IPC Settings uses), DESKTOP ONLY, labeled as this device's
 *   disk. Omitted entirely when the IPC is absent, and on web.
 * - Recent activity: exactly the existing RecentActivity derivation
 *   (desktop-connected count, login-today, account-created without an
 *   invented date, user-scoped recently-accessed businesses). Membership
 *   / business created dates are NOT in the frontend payload types, so
 *   no such dates are rendered.
 * - Search: intentionally NOT duplicated here. ZapeeraLayout's header
 *   already has a working global search over businesses/invitations/
 *   support; a second search box on the page would be a duplicate
 *   control. The page therefore has no search input of its own.
 * - Header: also intentionally not duplicated. The layout header already
 *   provides the time-aware greeting, search, notification bell and
 *   avatar with real data; the page leads with its own greeting title
 *   block (same time-of-day rule) instead of a second header row.
 * - "Go to Insights" has no account-level route, so the banner button
 *   goes to My Businesses. "Manage Team Members" has no account-level
 *   route either and is not listed as a quick action.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Cloud,
  CreditCard,
  Crown,
  Download,
  HardDrive,
  Laptop,
  Layers,
  LayoutGrid,
  List,
  LogIn,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  User,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { useRuntime } from "@/lib/runtime";
import { useSync } from "@/contexts/SyncProvider";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  expiryLabel,
  formatDate,
  normalizeStatus,
  roleFor,
  statusStyle,
  type Entitlement,
  type EntitlementsMap,
} from "@/components/user-dashboard/business-cards";
import {
  readUserScopedBusinesses,
  writeUserScopedBusinesses,
  RECENT_BUSINESSES_KEY,
} from "@/lib/user-scoped-storage";
import { useAccountStatus } from "@/lib/account-status";
import { DESKTOP_DOWNLOAD_URL } from "@/lib/support-links";

const CARD =
  "rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]";

/** Same time-of-day rule as ZapeeraLayout's greeting (local time). */
export function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Pending invitations, derived exactly like InvitationsStrip. */
export function usePendingInvites() {
  const { user } = useAuth();
  return useMemo(() => {
    if (!Array.isArray(user?.memberships)) return [];
    return user.memberships.filter(
      (m: any) => m.status && !["ACTIVE", "DOWNLOADED", "OUT_OF_SYNC"].includes(m.status)
    );
  }, [user]);
}

function formatBytes(bytes?: number | null): string | null {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

type CompanyLike = {
  id: string;
  name: string;
  slug?: string | null;
  businessType?: string | null;
  createdBy?: string | null;
  accessType?: "owned" | "shared";
  memberRole?: string | null;
  branches?: Array<{ id: string; name?: string }>;
  _count?: { branches?: number };
};

function isOwned(c: CompanyLike, userId?: string | null): boolean {
  return String(c?.createdBy || "") === String(userId || "") || c?.accessType === "owned";
}

function branchCountOf(c: CompanyLike): number {
  return c?._count?.branches ?? c?.branches?.length ?? 0;
}

function openWorkspacePath(b: CompanyLike): string {
  const slug = b.slug?.trim();
  return slug ? `/business/${encodeURIComponent(slug)}/dashboard` : "/zapeera/my-businesses";
}

function recordRecentVisit(b: CompanyLike, userId?: string | null) {
  const list = readUserScopedBusinesses(RECENT_BUSINESSES_KEY, userId);
  const filtered = list.filter((x) => x.id !== b.id);
  filtered.unshift({ id: b.id, name: b.name, slug: b.slug || null });
  writeUserScopedBusinesses(RECENT_BUSINESSES_KEY, userId, filtered.slice(0, 5));
}

/* ------------------------------------------------------------------ */
/* Stat cards — Total Businesses, Role Summary, Total Branches,        */
/* Pending Actions (= pending invitations, honestly labeled), Account  */
/* Security (genuine 2FA rule, never a claimed "Strong").              */
/* ------------------------------------------------------------------ */
export function WelcomeStatCards() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { allCompanies } = useAdmin();
  const pendingInvites = usePendingInvites();
  const { status: accountStatus, loading: accountLoading } = useAccountStatus();

  const companies = (allCompanies || []) as CompanyLike[];

  const { owned, joined, roleSummary, totalBranches } = useMemo(() => {
    let ownedCount = 0;
    let joinedCount = 0;
    let owners = 0;
    let managers = 0;
    let cashiers = 0;
    let branches = 0;
    for (const c of companies) {
      branches += branchCountOf(c);
      if (isOwned(c, user?.id)) {
        ownedCount++;
        owners++;
      } else {
        joinedCount++;
        const role = String(
          (c as any).memberRole ||
            (Array.isArray(user?.memberships)
              ? (user!.memberships as any[]).find((m) => String(m.businessId) === String(c.id))?.roleName || ""
              : "")
        ).toUpperCase();
        if (role === "MANAGER") managers++;
        else if (role === "CASHIER") cashiers++;
      }
    }
    const parts: string[] = [];
    if (owners > 0) parts.push(`Owner ${owners}`);
    if (managers > 0) parts.push(`Manager ${managers}`);
    if (cashiers > 0) parts.push(`Cashier ${cashiers}`);
    return {
      owned: ownedCount,
      joined: joinedCount,
      roleSummary: parts.length > 0 ? parts.join(" · ") : "—",
      totalBranches: branches,
    };
  }, [companies, user]);

  const security = useMemo(() => {
    if (accountLoading || !accountStatus) {
      return { value: "Checking…", sub: "Verifying account security", tone: "text-[#8c95b0]", strong: false };
    }
    if (accountStatus.twoFactorOn) {
      return { value: "Strong", sub: "Two-factor authentication on", tone: "text-green-600", strong: true };
    }
    return { value: "Improve", sub: "Two-factor authentication off", tone: "text-amber-600", strong: false };
  }, [accountStatus, accountLoading]);

  const cards = [
    {
      key: "businesses",
      icon: Building2,
      tint: "bg-[#1a52c5]/10 text-[#1a52c5]",
      value: String(companies.length),
      label: "Total Businesses",
      sub: `${owned} owned · ${joined} joined`,
      onClick: () => navigate("/zapeera/my-businesses"),
    },
    {
      key: "roles",
      icon: Users,
      tint: "bg-teal-500/10 text-teal-600",
      value: roleSummary,
      label: "My Role Summary",
      sub: "Across all businesses",
      onClick: () => navigate("/zapeera/my-businesses"),
    },
    {
      key: "branches",
      icon: Layers,
      tint: "bg-violet-500/10 text-violet-600",
      value: String(totalBranches),
      label: "Total Branches",
      sub: "Across all businesses",
      onClick: () => navigate("/zapeera/my-businesses"),
    },
    {
      key: "pending",
      icon: Clock,
      tint: "bg-orange-500/10 text-orange-500",
      value: String(pendingInvites.length),
      label: "Pending Actions",
      sub: "Invitations awaiting review",
      onClick: () => navigate("/zapeera/invitations"),
    },
    {
      key: "security",
      icon: ShieldCheck,
      tint: "bg-green-500/10 text-green-600",
      value: security.value,
      label: "Account Security",
      sub: security.sub,
      onClick: () => navigate("/settings"),
    },
  ];

  return (
    <section aria-label="Account overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.key}
            type="button"
            onClick={c.onClick}
            className={cn(
              CARD,
              "group p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
            )}
          >
            <span className={cn("grid h-11 w-11 place-items-center rounded-xl", c.tint)}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="mt-3 block text-xl font-extrabold leading-tight tracking-tight text-[#0a1128]">{c.value}</span>
            <span className="mt-0.5 block text-[13px] font-semibold text-[#4a5578]">{c.label}</span>
            <span className="mt-0.5 block text-xs leading-snug text-[#8c95b0]">{c.sub}</span>
          </button>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Businesses — compact cards with Grid/List toggle + status filter.   */
/* Plan/expiry come from the same per-business entitlement fetches as  */
/* the old grid (memoized list, parallel, capped at 20). Full business */
/* management (delete/leave/favorites) lives on My Businesses.         */
/* ------------------------------------------------------------------ */
type BusinessView = "grid" | "list";
type StatusFilter = "all" | "active" | "trial" | "expired" | "pending" | "inactive";

export function WelcomeBusinessSection({
  onCreate,
  onJoin,
}: {
  onCreate: () => void;
  onJoin: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { allCompanies } = useAdmin();
  const [view, setView] = useState<BusinessView>("grid");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [entitlements, setEntitlements] = useState<EntitlementsMap>({});
  const [loading, setLoading] = useState(true);

  // Memoized on purpose: a fresh array identity every render refired the
  // entitlement effect endlessly in the old grid (~1 request/sec).
  const businessList = useMemo(() => (allCompanies || []) as CompanyLike[], [allCompanies]);

  useEffect(() => {
    if (businessList.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const map: EntitlementsMap = {};
      await Promise.allSettled(
        businessList.slice(0, 20).map(async (c) => {
          try {
            const res = await apiService.getBusinessEntitlements(c.id);
            if (res.success && res.data) map[c.id] = res.data as Entitlement;
          } catch {
            /* ignore per-business entitlement errors */
          }
        })
      );
      if (!cancelled) {
        setEntitlements(map);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessList]);

  const visible = useMemo(() => {
    if (filter === "all") return businessList;
    return businessList.filter((b) => {
      const ent = entitlements[b.id];
      // While this business's entitlement is still loading, its status is
      // unknown — keep it visible rather than hiding it on a guess.
      if (loading && !ent) return true;
      return normalizeStatus(ent?.subscriptionStatus) === filter;
    });
  }, [businessList, entitlements, filter, loading]);

  const openWorkspace = (b: CompanyLike) => {
    recordRecentVisit(b, user?.id);
    navigate(openWorkspacePath(b));
  };

  const openSubscription = (b: CompanyLike) => {
    if (b.slug) navigate(`/business/${encodeURIComponent(b.slug)}/subscription`);
    else navigate("/zapeera/my-businesses");
  };

  return (
    <section aria-label="My Businesses" className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-[#0a1128]">My Businesses</h2>
          <p className="text-[13px] text-[#8c95b0]">Access and manage all the businesses you own or are a member of.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="sr-only" htmlFor="welcome-status-filter">
            Filter by status
          </label>
          <select
            id="welcome-status-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusFilter)}
            className="h-11 rounded-xl border border-[rgba(15,23,60,0.1)] bg-white px-3 text-sm font-semibold text-[#0a1128] outline-none focus:border-[#1a52c5]/40"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="pending">Pending</option>
            <option value="expired">Expired</option>
            <option value="inactive">Inactive</option>
          </select>
          <div className="flex overflow-hidden rounded-xl border border-[rgba(15,23,60,0.1)] bg-white" role="group" aria-label="View mode">
            <button
              type="button"
              onClick={() => setView("grid")}
              aria-pressed={view === "grid"}
              aria-label="Grid view"
              className={cn(
                "grid h-11 w-11 place-items-center transition-colors",
                view === "grid" ? "bg-[#1a52c5] text-white" : "text-[#4a5578] hover:bg-[#f0f2f7]"
              )}
            >
              <LayoutGrid className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              aria-label="List view"
              className={cn(
                "grid h-11 w-11 place-items-center transition-colors",
                view === "list" ? "bg-[#1a52c5] text-white" : "text-[#4a5578] hover:bg-[#f0f2f7]"
              )}
            >
              <List className="h-[18px] w-[18px]" />
            </button>
          </div>
          <button
            type="button"
            onClick={onJoin}
            className="inline-flex items-center gap-2 rounded-xl border border-[rgba(15,23,60,0.1)] bg-white px-5 py-3 text-sm font-semibold text-[#0a1128] shadow-sm transition-all hover:-translate-y-px hover:border-[#1a52c5]/25 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
          >
            <UserPlus className="h-[16px] w-[16px] text-[#1a52c5]" />
            Join a Business
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:-translate-y-px hover:bg-primary/90 hover:shadow-medium"
          >
            <Plus className="h-[16px] w-[16px]" strokeWidth={2.5} />
            Create New Business
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className={cn(CARD, "p-10 text-center")}>
          <p className="text-sm font-semibold text-[#0a1128]">No businesses match this filter.</p>
          <p className="mt-1 text-[13px] text-[#8c95b0]">Try a different status, or create a new business.</p>
        </div>
      ) : (
        <div className={cn(view === "grid" ? "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" : "grid grid-cols-1 gap-4")}>
          {visible.map((b) => {
            const ent = entitlements[b.id] || {};
            const status = normalizeStatus(ent.subscriptionStatus);
            const style = statusStyle[status];
            const entLoading = loading && !entitlements[b.id];
            const role = roleFor(b as any, user);
            const branches = branchCountOf(b);
            const typeLabel =
              String(b.businessType || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) ||
              "Business";

            return (
              <article
                key={b.id}
                className={cn(
                  CARD,
                  "group flex flex-col gap-3 p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_44px_rgba(0,0,0,0.09)]",
                  view === "list" && "md:flex-row md:items-center md:gap-6"
                )}
              >
                <div className={cn("min-w-0", view === "list" && "md:flex-1")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-base font-bold text-white shadow-[0_6px_18px_rgba(26,82,197,0.25)]">
                        {b.name?.charAt(0).toUpperCase() || "B"}
                      </div>
                      <div className="min-w-0">
                        <p title={b.name} className="line-clamp-2 text-[15px] font-bold leading-snug tracking-tight text-[#0a1128]">
                          {b.name}
                        </p>
                        <p className="truncate text-xs text-[#8c95b0]">{typeLabel}</p>
                      </div>
                    </div>
                    {entLoading ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-500/15 bg-gray-500/[0.06] px-2.5 py-1 text-[11px] font-semibold text-gray-400">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300" />
                        Checking plan…
                      </span>
                    ) : (
                      <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold", style.cls)}>
                        {status === "trial" ? <Crown className="h-3 w-3" /> : <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />}
                        {style.label}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f0f2f7] px-2.5 py-1 text-[11px] font-semibold text-[#4a5578]">
                      <User className="h-3 w-3 opacity-60" /> {role}
                    </span>
                    {!entLoading && ent.plan?.name && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1a52c5]/[0.07] px-2.5 py-1 text-[11px] font-semibold text-[#1a52c5]">
                        <CreditCard className="h-3 w-3 opacity-70" /> {ent.plan.name}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 space-y-1.5 text-[13px] text-[#4a5578]">
                    <p className="flex items-center gap-2">
                      <Layers className="h-4 w-4 shrink-0 text-[#8c95b0]" />
                      {branches} {branches === 1 ? "Branch" : "Branches"}
                    </p>
                    <p className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 shrink-0 text-[#8c95b0]" />
                      <span className="truncate">{entLoading ? "Checking plan…" : expiryLabel(status, ent)}</span>
                    </p>
                  </div>
                </div>
                <div className={cn("flex gap-2", view === "list" && "md:w-60 md:shrink-0 md:flex-col")}>
                  {status === "expired" && !entLoading && (
                    <button
                      type="button"
                      onClick={() => openSubscription(b)}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#1a52c5]/25 bg-[#1a52c5]/[0.06] px-4 py-3 text-sm font-semibold text-[#1a52c5] transition-colors hover:bg-[#1a52c5]/10"
                    >
                      Renew Plan
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openWorkspace(b)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:-translate-y-px hover:bg-primary/90 hover:shadow-medium"
                  >
                    Open Workspace
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Shared panel shell for the bottom grid.                             */
/* ------------------------------------------------------------------ */
function WelcomePanel({
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={cn(CARD, "p-5 sm:p-6")}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-extrabold tracking-tight text-[#0a1128]">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-[#8c95b0]">{subtitle}</p>}
        </div>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#f0f2f7] px-3 py-1.5 text-[13px] font-semibold text-[#1a52c5] transition-colors hover:bg-[#e4eaf5]"
          >
            {actionLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sync & Connectivity — DESKTOP ONLY. Real sync state from useSync.   */
/* No "Next Sync" row (no sync schedule exists in code) and no device  */
/* id (the mockup's DESKTOP-7F3L90K is invented). Version comes from   */
/* the Electron app version (package.json), never a hardcoded number. */
/* ------------------------------------------------------------------ */
export function WelcomeSyncPanel() {
  const runtime = useRuntime();
  const { status, triggerSync } = useSync();
  const [syncing, setSyncing] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.getAppVersion) {
      api
        .getAppVersion()
        .then((v: string) => setAppVersion(v))
        .catch(() => {});
    }
  }, []);

  if (!runtime.isDesktop) return null;

  const online = runtime.cloudState === "online" || status.connectionState === "online";
  const syncStateLabel =
    status.syncState === "synced"
      ? "Synced"
      : status.syncState === "pending"
        ? "Pending"
        : status.syncState === "offline"
          ? "Offline"
          : status.syncState === "failed"
            ? "Sync failed"
            : status.syncState === "conflict"
              ? "Needs review"
              : "Idle";
  const lastSync = (runtime as any).lastSyncAt || status.lastSyncAt;

  const handleSync = async () => {
    setSyncing(true);
    await triggerSync();
    setTimeout(() => setSyncing(false), 1000);
  };

  const rows: Array<{ icon: React.ElementType; label: string; value: React.ReactNode }> = [
    {
      icon: online ? Wifi : WifiOff,
      label: "Cloud Status",
      value: <b className={online ? "text-green-600" : "text-[#8c95b0]"}>{online ? "Connected" : "Offline"}</b>,
    },
    { icon: Clock, label: "Last Sync", value: <b className="text-[#0a1128]">{formatDateTime(lastSync)}</b> },
    {
      icon: RefreshCw,
      label: "Pending Changes",
      value: (
        <b className="text-[#0a1128]">
          {status.pendingChanges}
          {status.failedChanges > 0 ? ` · ${status.failedChanges} failed` : ""} ready to sync
        </b>
      ),
    },
    { icon: Laptop, label: "Sync State", value: <b className="text-[#0a1128]">{syncStateLabel}</b> },
  ];
  if (appVersion) {
    rows.push({ icon: HardDrive, label: "This Device", value: <b className="text-[#0a1128]">Desktop app · v{appVersion}</b> });
  } else {
    rows.push({ icon: HardDrive, label: "This Device", value: <b className="text-[#0a1128]">Desktop app</b> });
  }

  return (
    <WelcomePanel title="Sync & Connectivity" subtitle="All systems operational">
      <ul className="space-y-3">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <li key={r.label} className="flex items-center gap-3 text-[13px]">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#1a52c5]/10 text-[#1a52c5]">
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-[#4a5578]">{r.label}</span>
              <span className="ml-auto text-right">{r.value}</span>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing || status.inProgress}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(15,23,60,0.1)] bg-white px-4 py-3 text-sm font-semibold text-[#0a1128] transition-colors hover:bg-[#f0f2f7] disabled:opacity-50"
      >
        <RefreshCw className={cn("h-4 w-4 text-[#1a52c5]", syncing && "animate-spin")} />
        {syncing ? "Syncing…" : "Sync Now"}
      </button>
    </WelcomePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Cloud status — WEB ONLY. Web has no local copy, so this panel shows */
/* connection truth and honest copy, never sync timestamps (the web    */
/* Sync Now button already overpromised this way and was hidden).     */
/* "Connected" is NOT the sync engine's connectionState: in web mode   */
/* the engine does not run, so that field never reads online even     */
/* while real data is loading. The honest session signal is the fresh  */
/* profile fetch (same deduped source the stat cards already use):    */
/* success = the cloud API answered in this session. While it is      */
/* still loading the panel says "Checking…", never a false negative.  */
/* ------------------------------------------------------------------ */
export function WelcomeCloudPanel() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { profile, loading: profileLoading } = useAccountStatus();

  if (runtime.isDesktop) return null;

  const connected = !profileLoading && profile !== null;

  return (
    <WelcomePanel title="Cloud Status" subtitle="Your workspace connection">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#1a52c5]/10 text-[#1a52c5]">
          <Cloud className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#0a1128]">
            {profileLoading ? "Checking…" : connected ? "Connected" : "Connection issue"}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-[#4a5578]">
            {profileLoading
              ? "Verifying the cloud connection…"
              : connected
                ? "Your data is live on the cloud — no sync needed."
                : "Could not reach the cloud. Check your connection and try again."}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate("/downloads")}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(15,23,60,0.1)] bg-white px-4 py-3 text-sm font-semibold text-[#0a1128] transition-colors hover:bg-[#f0f2f7]"
      >
        <Download className="h-4 w-4 text-[#1a52c5]" />
        Get the Desktop App for Offline Work
      </button>
    </WelcomePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Invitations — real list from getMyInvitations (tokens + expiry),    */
/* so Accept/Decline work inline. If that fetch fails, fall back to    */
/* the membership-derived list with Review buttons (no fake actions). */
/* ------------------------------------------------------------------ */
type HubInvitation = {
  invitationId: string;
  token: string;
  businessName: string;
  roleName: string | null;
  status: string;
  expiresAt: string;
};

function invitationExpiryLabel(iso?: string): string {
  if (!iso) return "Soon";
  try {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const days = Math.ceil(diff / 86400000);
    return days <= 1 ? "Today" : `${days} days`;
  } catch {
    return "Soon";
  }
}

export function WelcomeInvitationsPanel() {
  const navigate = useNavigate();
  const { refreshCompanies } = useAdmin();
  const pendingFromMemberships = usePendingInvites();
  const [invitations, setInvitations] = useState<HubInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [actingToken, setActingToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiService.getMyInvitations();
        if (!cancelled && res.success && res.data) {
          setInvitations(Array.isArray(res.data.invitations) ? res.data.invitations : []);
        } else if (!cancelled) {
          setFetchFailed(true);
        }
      } catch {
        if (!cancelled) setFetchFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAccept = async (inv: HubInvitation) => {
    setActingToken(inv.token);
    try {
      const res = await apiService.acceptInvitation(inv.token);
      if (res.success) {
        toast({ title: "Invitation accepted", description: `You've joined ${inv.businessName}.` });
        setInvitations((prev) => prev.filter((i) => i.token !== inv.token));
        await refreshCompanies();
      } else {
        toast({ title: "Could not accept", description: res.message || "Failed to accept invitation.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not accept", description: e.message || "Failed to accept invitation.", variant: "destructive" });
    } finally {
      setActingToken(null);
    }
  };

  const handleDecline = async (inv: HubInvitation) => {
    setActingToken(inv.token);
    try {
      const res = await apiService.rejectInvitation(inv.token);
      if (res.success) {
        toast({ title: "Invitation declined", description: `You declined ${inv.businessName}.` });
        setInvitations((prev) => prev.filter((i) => i.token !== inv.token));
      } else {
        toast({ title: "Could not decline", description: res.message || "Failed to decline invitation.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not decline", description: e.message || "Failed to decline invitation.", variant: "destructive" });
    } finally {
      setActingToken(null);
    }
  };

  return (
    <WelcomePanel
      title="Invitations"
      subtitle={
        loading
          ? "Loading invitations…"
          : invitations.length > 0
            ? `${invitations.length} need${invitations.length === 1 ? "s" : ""} your action`
            : fetchFailed && pendingFromMemberships.length > 0
              ? `${pendingFromMemberships.length} pending — open the invitations page to act`
              : "You're all caught up"
      }
      actionLabel="View All"
      onAction={() => navigate("/zapeera/invitations")}
    >
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-xl border border-[rgba(15,23,60,0.06)] bg-[#f7f9fc]" />
          ))}
        </div>
      ) : invitations.length > 0 ? (
        <div className="space-y-2">
          {invitations.map((inv) => {
            const busy = actingToken === inv.token;
            return (
              <div
                key={inv.invitationId || inv.token}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-[rgba(15,23,60,0.06)] bg-white px-3 py-3"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600">
                  <UserPlus className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[#0a1128]">{inv.businessName}</p>
                  <p className="truncate text-xs text-[#8c95b0]">
                    Invited as <b className="text-[#4a5578]">{inv.roleName || "Member"}</b>
                    {" · "}Expires {invitationExpiryLabel(inv.expiresAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDecline(inv)}
                    className="inline-flex items-center gap-1 rounded-lg border border-[rgba(15,23,60,0.1)] bg-white px-3 py-1.5 text-xs font-semibold text-[#4a5578] transition-colors hover:bg-[#f0f2f7] disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Decline
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleAccept(inv)}
                    className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)] hover:opacity-95 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {busy ? "Working…" : "Accept"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : fetchFailed && pendingFromMemberships.length > 0 ? (
        <div className="space-y-2">
          {pendingFromMemberships.map((m: any) => (
            <div
              key={m.businessId}
              className="flex items-center gap-3 rounded-xl border border-[rgba(15,23,60,0.06)] bg-white px-3 py-3"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600">
                <UserPlus className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-[#0a1128]">{m.businessName || m.businessId}</p>
                <p className="truncate text-xs text-[#8c95b0]">
                  Invited as <b className="text-[#4a5578]">{m.roleName || m.role || "Member"}</b>
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
      ) : (
        <p className="text-[13px] text-[#8c95b0]">You have no pending invitations.</p>
      )}
    </WelcomePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Recent activity — the existing derivation, compact: user-scoped     */
/* recently-accessed businesses + desktop-connected / login / account- */
/* created events. No invented dates (payloads carry no created dates).*/
/* ------------------------------------------------------------------ */
export function WelcomeActivityPanel({ onOpen }: { onOpen: (slug: string | null | undefined, id: string) => void }) {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [recent, setRecent] = useState<Array<{ id: string; name: string; slug?: string | null }>>([]);

  useEffect(() => {
    setRecent(readUserScopedBusinesses(RECENT_BUSINESSES_KEY, user?.id).slice(0, 4));
  }, [user?.id]);

  const events = useMemo(() => {
    const list: Array<{ id: string; icon: React.ElementType; tint: string; title: string; time: string }> = [];
    const desktopCount = (runtime.desktopBusinessStates || []).filter((b) => b.availableOffline).length;
    if (desktopCount > 0) {
      list.push({
        id: "desktop",
        icon: Laptop,
        tint: "bg-violet-500/10 text-violet-600",
        title: `Desktop connected · ${desktopCount} business${desktopCount > 1 ? "es" : ""} ready offline`,
        time: "Now",
      });
    }
    list.push({ id: "login", icon: LogIn, tint: "bg-[#1a52c5]/10 text-[#1a52c5]", title: "New login from your account", time: "Today" });
    list.push({ id: "signup", icon: CheckCircle2, tint: "bg-[#28c2ce]/10 text-[#159dab]", title: "Account created on Zapeera", time: "Sign up" });
    return list;
  }, [runtime.desktopBusinessStates]);

  return (
    <WelcomePanel title="Recent Account Activity" actionLabel="View All" onAction={() => navigate("/zapeera/notifications")}>
      {recent.length > 0 && (
        <div className="mb-4">
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
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#8c95b0]">Account activity</p>
      <ul className="space-y-3.5">
        {events.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.id} className="flex items-center gap-3.5">
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-4 ring-white", it.tint)}>
                <Icon className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug text-[#0a1128]">{it.title}</p>
                <p className="mt-0.5 text-xs text-[#8c95b0]">{it.time}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </WelcomePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Quick actions — only routes that exist at account level. "Manage    */
/* Team Members" is deliberately absent: team management lives inside  */
/* a workspace, not at account level.                                 */
/* ------------------------------------------------------------------ */
export function WelcomeQuickActions({ onCreate }: { onCreate: () => void }) {
  const navigate = useNavigate();
  const actions = [
    { icon: User, label: "Manage Profile", to: "/settings" },
    { icon: CreditCard, label: "View Billing & Invoices", to: "/zapeera/billing" },
    { icon: Plus, label: "Create New Business", action: onCreate },
    { icon: UserPlus, label: "Join a Business", to: "/zapeera/invitations" },
    { icon: MessageCircle, label: "Support Center", to: "/zapeera/support" },
  ];
  return (
    <WelcomePanel title="Quick Actions">
      <div className="space-y-1">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.label}
              type="button"
              onClick={() => (a.action ? a.action() : navigate(a.to!))}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-[#f0f2f7]"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#1a52c5]/10 text-[#1a52c5]">
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex-1 text-[13px] font-semibold text-[#0a1128]">{a.label}</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-[#8c95b0]" />
            </button>
          );
        })}
      </div>
    </WelcomePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Storage & Data — DESKTOP ONLY, via the same getStorageInfo IPC      */
/* Settings uses (statfs device disk + local database file). Labeled   */
/* as this device's disk — never "Zapeera storage". Renders nothing    */
/* when the IPC is absent or returns no disk figures, and never on web.*/
/* ------------------------------------------------------------------ */
export function WelcomeStoragePanel() {
  const runtime = useRuntime();
  const [storage, setStorage] = useState<{
    diskTotalBytes?: number | null;
    diskFreeBytes?: number | null;
    databaseBytes?: number | null;
  } | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.getStorageInfo) {
      api
        .getStorageInfo()
        .then((info: any) => setStorage(info))
        .catch(() => {});
    }
  }, []);

  if (!runtime.isDesktop) return null;
  if (!storage?.diskTotalBytes) return null;

  const total = storage.diskTotalBytes;
  const free = storage.diskFreeBytes || 0;
  const used = total - free;
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const usedLabel = formatBytes(used);
  const freeLabel = formatBytes(free);
  const totalLabel = formatBytes(total);
  const dbLabel = formatBytes(storage.databaseBytes);

  return (
    <WelcomePanel title="Storage & Data" subtitle="This device">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#1a52c5]/10 text-[#1a52c5]">
          <HardDrive className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[#0a1128]">{pct}% used</p>
          <p className="mt-0.5 truncate text-[13px] text-[#4a5578]">
            {usedLabel} used · {freeLabel} available · {totalLabel} total
          </p>
        </div>
      </div>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[#e8edf6]">
        <div className="h-full rounded-full bg-gradient-to-r from-[#1a52c5] to-[#28c2ce]" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-[rgba(15,23,60,0.05)] pt-3 text-[13px] text-[#4a5578]">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[#1a52c5]" />
        <span>
          Local Zapeera database{dbLabel ? `: ${dbLabel}` : ""}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-green-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> Local Storage · Secure
        </span>
      </div>
    </WelcomePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Download Desktop App — WEB ONLY. On desktop the app is already     */
/* installed, so this renders nothing there. The version label is     */
/* parsed from DESKTOP_DOWNLOAD_URL itself (never hardcoded), so the  */
/* label can never drift from the file the button downloads.         */
/* ------------------------------------------------------------------ */
export function WelcomeDownloadWidget() {
  const runtime = useRuntime();
  const navigate = useNavigate();

  if (runtime.isDesktop) return null;

  const versionMatch = DESKTOP_DOWNLOAD_URL.match(/Zapeera-Setup-([0-9]+\.[0-9]+\.[0-9]+)\.exe$/);
  const versionLabel = versionMatch ? `Version ${versionMatch[1]} · Windows` : "Windows";

  return (
    <section className={cn(CARD, "p-5 sm:p-6")}>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_6px_18px_rgba(26,82,197,0.3)]">
          <Laptop className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold tracking-tight text-[#0a1128]">Download Zapeera for Windows</p>
          <p className="mt-0.5 text-[13px] text-[#4a5578]">
            {versionLabel} · Work offline at the counter, syncs automatically.
          </p>
        </div>
      </div>
      <a
        href={DESKTOP_DOWNLOAD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:-translate-y-px hover:bg-primary/90 hover:shadow-medium"
      >
        <Download className="h-4 w-4" />
        Download for Windows
      </a>
      <button
        type="button"
        onClick={() => navigate("/downloads")}
        className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-xl px-4 py-2 text-[13px] font-semibold text-[#1a52c5] transition-colors hover:bg-[#f0f2f7]"
      >
        More download options
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stay in Control banner — the button goes to My Businesses: there   */
/* is no account-level Insights route for "Go to Insights" to target. */
/* ------------------------------------------------------------------ */
export function WelcomeControlBanner() {
  const navigate = useNavigate();
  return (
    <section className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white px-5 py-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] sm:px-6">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#1a52c5]/10 text-[#1a52c5]">
        <ShieldCheck className="h-5 w-5" />
      </span>
      <div className="min-w-[210px] flex-1">
        <p className="text-[15px] font-extrabold tracking-tight text-[#0a1128]">Stay in Control</p>
        <p className="mt-0.5 text-[13px] text-[#4a5578]">
          Manage your businesses, track performance, and grow with powerful tools built for you.
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate("/zapeera/my-businesses")}
        className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:-translate-y-px hover:bg-primary/90 hover:shadow-medium max-sm:w-full max-sm:justify-center"
      >
        View My Businesses
        <ArrowRight className="h-4 w-4" />
      </button>
    </section>
  );
}
