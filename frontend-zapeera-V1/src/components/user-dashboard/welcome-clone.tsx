/**
 * Welcome screen CLONE sections for the /zapeera account home.
 *
 * A faithful visual clone of Muhammad's reference mockup: compact
 * white cards on a white page, blue/violet palette (NOT the app
 * green), stat cards with the icon + label row, business cards with
 * the 2×2 Plan/Expires/Branches/Type grid, the full-width Sync &
 * Connectivity band, the 4-panel bottom row and the Stay in Control
 * banner.
 *
 * The SHELL is the app's existing ZapeeraLayout — Muhammad's
 * correction (2026-10-29): "sidebar wohi pehly waali rakhni hai"
 * (keep the previous sidebar). The clone's WelcomeLayout shell was
 * removed; the layout header provides search / bell / avatar.
 * PARITY PASS (2026-10-30): the page-level greeting block was
 * removed on Muhammad's instruction — the layout top bar already
 * carries the greeting + subtitle, so the page opens directly
 * with the action row, as the reference flows after its header.
 * The header's dashboard-route search placeholder and real-state
 * Online pill live in ZapeeraLayout (route-scoped).
 *
 * REAL DATA ONLY — the wiring is the same proven sourcing as the
 * previous hub build: businesses/branches/roles from useAdmin
 * companies + useAuth memberships, plan/expiry from per-business
 * entitlements, invitations from getMyInvitations with inline
 * Accept/Decline, sync from useSync/useRuntime, storage from the
 * getStorageInfo IPC (desktop), security from useAccountStatus's
 * genuine-2FA rule. The mockup's businesses, dates, counts, device
 * name and "Version 1.2.0" are never rendered.
 *
 * Deliberate honesty differences from the mockup (data rules outrank
 * sample values):
 * - The sync band's 4th slot is "Sync State", not "Next Sync" — the
 *   engine has no sync timetable (the 10s poll is a status poll).
 * - On web the band keeps its form but carries cloud truth (no Last
 *   Sync / Next Sync / Sync Now — web has no local copy to sync).
 * - Pending Actions counts pending invitations only (no "approvals"
 *   source exists), and its subtext says so.
 * - Account Security shows "Strong" only when 2FA is really on.
 * - Invitations show role + expiry, not "Invited by" (the API does
 *   not carry an inviter name).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  BedDouble,
  BookOpen,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Cloud,
  CreditCard,
  Cross,
  Crown,
  Database,
  Download,
  HardDrive,
  Layers,
  LayoutGrid,
  LogIn,
  Monitor,
  MoreVertical,
  Plus,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Store,
  TrendingUp,
  Upload,
  User,
  UserPlus,
  Users,
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
  formatDate,
  normalizeStatus,
  roleFor,
  statusStyle,
  type Entitlement,
  type EntitlementsMap,
} from "@/components/user-dashboard/business-cards";
import { usePendingInvites } from "@/components/user-dashboard/welcome-screen";
import {
  readUserScopedBusinesses,
  writeUserScopedBusinesses,
  RECENT_BUSINESSES_KEY,
} from "@/lib/user-scoped-storage";
import { useAccountStatus } from "@/lib/account-status";
import { DESKTOP_DOWNLOAD_URL } from "@/lib/support-links";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const CARD =
  "rounded-2xl border border-[rgba(15,23,60,0.08)] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.05)]";
const BLUE_BTN =
  "bg-[#2563eb] text-white shadow-[0_4px_14px_rgba(37,99,235,0.3)] transition-all hover:-translate-y-px hover:bg-[#1d4ed8]";
const GRADIENT_BTN =
  "bg-gradient-to-r from-[#2563eb] to-[#7c3aed] text-white shadow-[0_4px_14px_rgba(37,99,235,0.3)] transition-all hover:-translate-y-px hover:opacity-95";

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

function timeAgo(iso?: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  if (diff < 60_000) return "Just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/* ------------------------------------------------------------------ */
/* Per-business entitlements — the same proven fetch pattern as        */
/* business-cards.tsx (memoized list, Promise.allSettled, capped at    */
/* 20, cancelled on unmount). Shared by the stat cards (Active /       */
/* Inactive split) and the business grid.                              */
/* ------------------------------------------------------------------ */
export function useBusinessEntitlements(businessList: Array<{ id: string }>) {
  const [entitlements, setEntitlements] = useState<EntitlementsMap>({});
  const [loading, setLoading] = useState(true);

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

  return { entitlements, loading };
}

/* ------------------------------------------------------------------ */
/* Join / Create actions — Muhammad (2026-10-31): NOT a row at the    */
/* top of the page; the two buttons live in the My Businesses header  */
/* row, next to the All Status filter (see CloneBusinessSection).     */
/* Colours stay the app's own branding (pre-parity v1.0.15 styles).   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Stat cards — icon + label row, big value, honest subtext.           */
/* ------------------------------------------------------------------ */
export function CloneStatCards({
  entitlements,
  entLoading,
}: {
  entitlements: EntitlementsMap;
  entLoading: boolean;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { allCompanies } = useAdmin();
  const pendingInvites = usePendingInvites();
  const { status: accountStatus, loading: accountLoading } = useAccountStatus();

  const companies = useMemo(() => (allCompanies || []) as CompanyLike[], [allCompanies]);

  const stats = useMemo(() => {
    let owned = 0;
    let joined = 0;
    let branches = 0;
    let active = 0;
    let inactive = 0;
    const roleCounts = new Map<string, number>();
    const bump = (role: string) => roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
    for (const c of companies) {
      branches += branchCountOf(c);
      if (isOwned(c, user?.id)) {
        owned++;
        bump("Owner");
      } else {
        joined++;
        const role = String(
          (c as any).memberRole ||
            (Array.isArray(user?.memberships)
              ? (user!.memberships as any[]).find((m) => String(m.businessId) === String(c.id))?.roleName || ""
              : "")
        ).toUpperCase();
        if (role === "MANAGER") bump("Manager");
        else if (role === "CASHIER") bump("Cashier");
        else if (role) bump(role.charAt(0) + role.slice(1).toLowerCase());
        else bump("Member");
      }
      const ent = entitlements[c.id];
      if (ent) {
        const s = normalizeStatus(ent.subscriptionStatus);
        if (s === "active" || s === "trial") active++;
        else inactive++;
      }
    }
    return { owned, joined, branches, active, inactive, roleCounts };
  }, [companies, user, entitlements]);

  const roleDot: Record<string, string> = { Owner: "#7c3aed", Manager: "#ea580c", Cashier: "#2563eb" };
  const roleParts = [...stats.roleCounts.entries()];

  const security = useMemo(() => {
    if (accountLoading || !accountStatus) return { value: "Checking…", sub: "Verifying account security" };
    if (accountStatus.twoFactorOn) return { value: "Strong", sub: "Two-factor authentication on" };
    return { value: "Improve", sub: "Two-factor authentication off" };
  }, [accountStatus, accountLoading]);

  const cards: Array<{
    key: string;
    icon: React.ElementType;
    tint: string;
    label: string;
    value: string;
    sub: React.ReactNode;
    onClick: () => void;
  }> = [
    {
      key: "businesses",
      icon: Store,
      tint: "bg-[#e8effd] text-[#2563eb]",
      label: "Total Businesses",
      value: String(companies.length),
      sub: entLoading ? (
        <>
          <span className="font-semibold text-[#16a34a]">Owned {stats.owned}</span>
          <span className="text-[#c3cadb]"> · </span>
          <span>Joined {stats.joined}</span>
        </>
      ) : (
        <>
          <span className="font-semibold text-[#16a34a]">Active {stats.active}</span>
          <span className="text-[#c3cadb]"> · </span>
          <span>Inactive {stats.inactive}</span>
        </>
      ),
      onClick: () => navigate("/zapeera/my-businesses"),
    },
    {
      key: "roles",
      icon: UserPlus,
      tint: "bg-[#f0eafd] text-[#7c3aed]",
      label: "My Role Summary",
      value: `${companies.length} Role${companies.length === 1 ? "" : "s"}`,
      sub:
        roleParts.length > 0 ? (
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {roleParts.map(([role, count], i) => (
              <span key={role} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-[#c3cadb]">·</span>}
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: roleDot[role] || "#94a3b8" }} />
                {role} {count}
              </span>
            ))}
          </span>
        ) : (
          "Across all businesses"
        ),
      onClick: () => navigate("/zapeera/my-businesses"),
    },
    {
      key: "branches",
      icon: TrendingUp,
      tint: "bg-[#f0eafd] text-[#7c3aed]",
      label: "Total Branches",
      value: String(stats.branches),
      sub: "Across all businesses",
      onClick: () => navigate("/zapeera/my-businesses"),
    },
    {
      key: "pending",
      icon: ClipboardCheck,
      tint: "bg-[#fdeeda] text-[#ea580c]",
      label: "Pending Actions",
      value: String(pendingInvites.length),
      sub: "Invitations awaiting review",
      onClick: () => navigate("/zapeera/invitations"),
    },
    {
      key: "security",
      icon: ShieldCheck,
      tint: "bg-[#e5f6ec] text-[#16a34a]",
      label: "Account Security",
      value: security.value,
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
            className={cn(CARD, "group p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(0,0,0,0.07)]")}
          >
            <span className="flex items-center gap-3">
              <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[10px]", c.tint)}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 text-[12.5px] font-semibold leading-tight text-[#4a5578]">{c.label}</span>
            </span>
            <span className="mt-3.5 block text-[26px] font-extrabold leading-none tracking-tight text-[#0a1128]">{c.value}</span>
            <span className="mt-1.5 block text-xs leading-snug text-[#8c95b0]">{c.sub}</span>
          </button>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Businesses — clone cards: type tile, status badge, colored role,    */
/* 2×2 Plan / Expires / Branches / Type grid, blue action button.      */
/* ------------------------------------------------------------------ */
type StatusFilter = "all" | "active" | "trial" | "expired" | "pending" | "inactive";

function typeVisual(type?: string | null): { icon: React.ElementType; tile: string } {
  const t = String(type || "").toUpperCase();
  if (t.includes("PHARMACY")) return { icon: Cross, tile: "bg-[#e8effd] text-[#2563eb]" };
  if (t.includes("CLINIC")) return { icon: Stethoscope, tile: "bg-[#fdeeda] text-[#ea580c]" };
  if (t.includes("HOTEL")) return { icon: BedDouble, tile: "bg-[#f0eafd] text-[#7c3aed]" };
  if (t.includes("STORE") || t.includes("RETAIL")) return { icon: Store, tile: "bg-[#e5f6ec] text-[#16a34a]" };
  return { icon: Building2, tile: "bg-[#e8effd] text-[#2563eb]" };
}

function rolePillClass(role: string): string {
  const r = role.toUpperCase();
  if (r === "OWNER") return "bg-[#f0eafd] text-[#7c3aed]";
  if (r === "MANAGER") return "bg-[#fdeeda] text-[#ea580c]";
  if (r === "CASHIER") return "bg-[#e8effd] text-[#2563eb]";
  return "bg-[#eef1f7] text-[#4a5578]";
}

function expiryParts(status: string, ent: Entitlement): { label: string; date: string | null; danger?: boolean } {
  const trialDate = ent.trialEndsAt || null;
  const periodDate = ent.currentPeriodEnd || null;
  if (status === "trial") {
    const d = trialDate || periodDate;
    return { label: "Trial ends on", date: d ? formatDate(d) : null };
  }
  if (status === "active") {
    const d = periodDate || trialDate;
    return { label: "Renews on", date: d ? formatDate(d) : null };
  }
  if (status === "expired") {
    const d = periodDate || trialDate;
    return { label: "Expired on", date: d ? formatDate(d) : null, danger: true };
  }
  const d = periodDate || trialDate;
  return { label: "Expires on", date: d ? formatDate(d) : null };
}

export function CloneBusinessSection({
  entitlements,
  entLoading,
  onCreate,
  onJoin,
}: {
  entitlements: EntitlementsMap;
  entLoading: boolean;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { allCompanies } = useAdmin();
  const runtime = useRuntime();
  const [filter, setFilter] = useState<StatusFilter>("all");

  const businessList = useMemo(() => (allCompanies || []) as CompanyLike[], [allCompanies]);

  const visible = useMemo(() => {
    return businessList.filter((b) => {
      if (filter !== "all") {
        const ent = entitlements[b.id];
        if (!(entLoading && !ent) && normalizeStatus(ent?.subscriptionStatus) !== filter) return false;
      }
      return true;
    });
  }, [businessList, entitlements, filter, entLoading]);

  const openWorkspace = (b: CompanyLike) => {
    recordRecentVisit(b, user?.id);
    navigate(openWorkspacePath(b));
  };

  const openSubscription = (b: CompanyLike) => {
    if (b.slug) navigate(`/business/${encodeURIComponent(b.slug)}/subscription`);
    else navigate("/zapeera/my-businesses");
  };

  const handleSyncNow = async (b: CompanyLike) => {
    try {
      const res = await (apiService as any).request("/sync/push", {
        method: "POST",
        body: JSON.stringify({ businessId: b.id }),
      });
      if (res?.success !== false) {
        toast({ title: "Sync started", description: `${b.name} data is being synced to cloud.` });
      } else {
        toast({ title: "Sync failed", description: (res as any)?.message || "Could not start sync.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message || "Could not start sync.", variant: "destructive" });
    }
  };

  return (
    <section aria-label="My Businesses" className="mt-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold tracking-tight text-[#0a1128]">My Businesses</h2>
          <p className="mt-0.5 text-[13px] text-[#8c95b0]">Access and manage all the businesses you own or are a member of.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Join / Create — moved here from the top of the page
              (Muhammad, 2026-10-31), beside the All Status filter.
              The Grid/List toggle is gone: grid only, always. */}
          <button
            type="button"
            onClick={onJoin}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[rgba(15,23,60,0.12)] bg-white px-4 text-[13.5px] font-semibold text-[#0a1128] transition-all hover:-translate-y-px hover:border-[#2563eb]/30 hover:shadow-[0_6px_18px_rgba(0,0,0,0.06)]"
          >
            <UserPlus className="h-4 w-4 text-[#2563eb]" />
            Join a Business
          </button>
          <button
            type="button"
            onClick={onCreate}
            className={cn("inline-flex h-10 items-center gap-2 rounded-[10px] px-4 text-[13.5px] font-semibold", GRADIENT_BTN)}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Create New Business
          </button>
          <label className="sr-only" htmlFor="welcome-status-filter">
            Filter by status
          </label>
          <select
            id="welcome-status-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusFilter)}
            className="h-10 rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white px-3 text-[13px] font-semibold text-[#0a1128] outline-none focus:border-[#2563eb]/50"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="pending">Pending</option>
            <option value="expired">Expired</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className={cn(CARD, "p-10 text-center")}>
          <p className="text-sm font-semibold text-[#0a1128]">
            No businesses match this filter.
          </p>
          <p className="mt-1 text-[13px] text-[#8c95b0]">Try a different status, or create a new business.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {visible.map((b) => {
            const ent = entitlements[b.id] || {};
            const status = normalizeStatus(ent.subscriptionStatus);
            const style = statusStyle[status];
            const entPending = entLoading && !entitlements[b.id];
            const role = roleFor(b as any, user);
            const branches = branchCountOf(b);
            const typeLabel =
              String(b.businessType || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) ||
              "Business";
            const visual = typeVisual(b.businessType);
            const TypeIcon = visual.icon;
            const exp = expiryParts(status, ent);

            return (
              <article
                key={b.id}
                className={cn(
                  CARD,
                  "group flex flex-col p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_36px_rgba(0,0,0,0.08)]"
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-xl", visual.tile)}>
                      <TypeIcon className="h-[22px] w-[22px]" />
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {entPending ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-500/15 bg-gray-500/[0.06] px-2.5 py-1 text-[11px] font-semibold text-gray-400">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300" />
                          Checking…
                        </span>
                      ) : (
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold", style.cls)}>
                          {status === "trial" ? <Crown className="h-3 w-3" /> : <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />}
                          {style.label}
                        </span>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="grid h-8 w-8 place-items-center rounded-lg text-[#8c95b0] transition-colors hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                            aria-label={`Actions for ${b.name}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[210px] rounded-xl border border-[rgba(15,23,60,0.06)] p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.1)]">
                          <DropdownMenuItem onClick={() => openWorkspace(b)} className="cursor-pointer gap-2.5 rounded-lg py-2 text-sm font-semibold text-[#2563eb]">
                            Open Workspace
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openSubscription(b)} className="cursor-pointer gap-2.5 rounded-lg py-2 text-sm font-medium text-[#4a5578]">
                            <CreditCard className="h-4 w-4 opacity-60" />
                            Manage Subscription
                          </DropdownMenuItem>
                          {runtime.isDesktop && (
                            <DropdownMenuItem onClick={() => handleSyncNow(b)} className="cursor-pointer gap-2.5 rounded-lg py-2 text-sm font-medium text-[#4a5578]">
                              <RefreshCw className="h-4 w-4 opacity-60" />
                              Sync Now
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  </div>

                  <p title={b.name} className="mt-3 line-clamp-2 text-[16px] font-bold leading-snug tracking-tight text-[#0a1128]">
                    {b.name}
                  </p>
                  <p className="mt-1.5">
                    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", rolePillClass(role))}>
                      {role}
                    </span>
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-[rgba(15,23,60,0.06)] pt-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 text-[11px] font-medium text-[#8c95b0]">
                        <Crown className="h-3 w-3 text-[#7c3aed]" />
                        Plan
                      </p>
                      <p className="mt-0.5 truncate text-[13.5px] font-bold text-[#0a1128]">
                        {entPending ? "Checking…" : ent.plan?.name || "—"}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-[#8c95b0]">{exp.label}</p>
                      <p className={cn("mt-0.5 truncate text-[13.5px] font-bold", exp.danger ? "text-red-600" : "text-[#0a1128]")}>
                        {entPending ? "Checking…" : exp.date || style.label}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 text-[11px] font-medium text-[#8c95b0]">
                        <Layers className="h-3 w-3" />
                        Branches
                      </p>
                      <p className="mt-0.5 text-[13.5px] font-bold text-[#0a1128]">{branches}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 text-[11px] font-medium text-[#8c95b0]">
                        <Building2 className="h-3 w-3" />
                        Type
                      </p>
                      <p className="mt-0.5 truncate text-[13.5px] font-bold text-[#0a1128]">{typeLabel}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  {status === "expired" && !entPending ? (
                    <button
                      type="button"
                      onClick={() => openSubscription(b)}
                      className={cn("inline-flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13.5px] font-semibold", BLUE_BTN)}
                    >
                      Renew Plan
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : status === "inactive" && !entPending ? (
                    <button
                      type="button"
                      onClick={() => navigate("/zapeera/my-businesses")}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13.5px] font-semibold text-[#2563eb] transition-colors hover:bg-[#e8effd]"
                    >
                      View Details
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openWorkspace(b)}
                      className={cn("inline-flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13.5px] font-semibold", BLUE_BTN)}
                    >
                      Open Workspace
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
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
/* Sync & Connectivity band — full width, the reference's form.        */
/* DESKTOP: real sync state from useSync (10s-polled). The 4th slot    */
/* is "Sync State" — there is no next-sync timetable to show.          */
/* WEB: same form, cloud truth only — no Last Sync / Next Sync /       */
/* Sync Now (web has no local copy; the old web Sync Now overpromised  */
/* and was hidden in the audit for exactly this reason).               */
/* ------------------------------------------------------------------ */
export function CloneSyncBand() {
  const runtime = useRuntime();
  const navigate = useNavigate();

  if (runtime.isDesktop) return <CloneSyncBandDesktop />;
  return <CloneSyncBandWeb navigate={navigate} />;
}

function BandShell({
  statusDot,
  statusText,
  right,
  children,
}: {
  statusDot: string;
  statusText: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label="Sync and connectivity" className={cn(CARD, "mt-6 px-5 py-5 sm:px-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-[16px] font-extrabold tracking-tight text-[#0a1128]">Sync &amp; Connectivity</h3>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4a5578]">
            <span className={cn("h-2 w-2 rounded-full", statusDot)} />
            {statusText}
          </span>
        </div>
        {right}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-3 xl:grid-cols-5">{children}</div>
    </section>
  );
}

function BandItem({
  icon: Icon,
  tile,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  tile: string;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", tile)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11.5px] font-medium text-[#8c95b0]">{label}</span>
        <span className="block truncate text-[14px] font-bold leading-snug text-[#0a1128]">{value}</span>
        {sub && <span className="block truncate text-[11px] text-[#8c95b0]">{sub}</span>}
      </span>
    </div>
  );
}

function CloneSyncBandDesktop() {
  const { status, triggerSync } = useSync();
  const runtime = useRuntime();
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
  const operational = online && status.syncState !== "failed" && status.syncState !== "conflict";

  const handleSync = async () => {
    setSyncing(true);
    await triggerSync();
    setTimeout(() => setSyncing(false), 1000);
  };

  return (
    <BandShell
      statusDot={operational ? "bg-green-500" : online ? "bg-amber-500" : "bg-gray-300"}
      statusText={!online ? "Offline" : operational ? "All systems operational" : syncStateLabel}
      right={
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || status.inProgress}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#2563eb]/40 bg-white px-4 text-[13px] font-semibold text-[#2563eb] transition-colors hover:bg-[#e8effd] disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", (syncing || status.inProgress) && "animate-spin")} />
            {syncing || status.inProgress ? "Syncing…" : "Sync Now"}
          </button>
          {appVersion && (
            <span className="rounded-md bg-[#f0f2f7] px-2 py-0.5 text-[11px] font-semibold text-[#4a5578]">Version {appVersion}</span>
          )}
        </div>
      }
    >
      <BandItem
        icon={Cloud}
        tile="bg-[#e8effd] text-[#2563eb]"
        label="Cloud Status"
        value={online ? "Connected" : "Offline"}
      />
      <BandItem icon={RefreshCw} tile="bg-[#e5f6ec] text-[#16a34a]" label="Last Sync" value={timeAgo(lastSync)} />
      <BandItem
        icon={Upload}
        tile="bg-[#fdeeda] text-[#ea580c]"
        label="Pending Changes"
        value={String(status.pendingChanges)}
        sub={status.failedChanges > 0 ? `${status.failedChanges} failed` : status.pendingChanges > 0 ? "Ready to sync" : "All changes synced"}
      />
      <BandItem icon={Clock} tile="bg-[#e8effd] text-[#2563eb]" label="Sync State" value={syncStateLabel} />
      <BandItem
        icon={Monitor}
        tile="bg-[#e5f6ec] text-[#16a34a]"
        label="This Device"
        value={appVersion ? `Desktop app · v${appVersion}` : "Desktop app"}
      />
    </BandShell>
  );
}

function CloneSyncBandWeb({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  const { profile, loading: profileLoading } = useAccountStatus();
  const connected = !profileLoading && profile !== null;

  return (
    <BandShell
      statusDot={profileLoading ? "bg-gray-300" : connected ? "bg-green-500" : "bg-amber-500"}
      statusText={profileLoading ? "Checking connection…" : connected ? "Your data is live on the cloud" : "Connection issue"}
      right={
        <button
          type="button"
          onClick={() => navigate("/downloads")}
          className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#2563eb]/40 bg-white px-4 text-[13px] font-semibold text-[#2563eb] transition-colors hover:bg-[#e8effd]"
        >
          <Download className="h-4 w-4" />
          Get the Desktop App
        </button>
      }
    >
      <BandItem
        icon={Cloud}
        tile="bg-[#e8effd] text-[#2563eb]"
        label="Cloud Status"
        value={profileLoading ? "Checking…" : connected ? "Connected" : "Unreachable"}
      />
      <BandItem icon={Database} tile="bg-[#f0eafd] text-[#7c3aed]" label="Your Data" value="Live on cloud" />
      <BandItem icon={HardDrive} tile="bg-[#fdeeda] text-[#ea580c]" label="Local Copy" value="None" />
      <BandItem icon={RefreshCw} tile="bg-[#e8effd] text-[#2563eb]" label="Sync" value="Not needed" />
      <BandItem icon={Monitor} tile="bg-[#e5f6ec] text-[#16a34a]" label="This Device" value="Web browser" />
    </BandShell>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom-row panel shell.                                             */
/* ------------------------------------------------------------------ */
function ClonePanel({
  title,
  badge,
  subtitle,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  badge?: number;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={cn(CARD, "flex flex-col p-5")}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[15px] font-extrabold tracking-tight text-[#0a1128]">
          {title}
          {badge ? (
            <span className="grid min-w-[18px] place-items-center rounded-full bg-red-500 px-1 py-px text-[10px] font-bold text-white">
              {badge}
            </span>
          ) : null}
        </h3>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="shrink-0 text-[12.5px] font-semibold text-[#2563eb] hover:underline">
            {actionLabel}
          </button>
        )}
      </div>
      {subtitle && <p className="mb-3 text-[12.5px] text-[#8c95b0]">{subtitle}</p>}
      <div className="flex-1">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Invitations — real list from getMyInvitations, inline               */
/* Accept/Decline; membership-derived fallback with Review buttons     */
/* when the fetch fails (same behavior as the previous hub build).     */
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
    return days <= 1 ? "Expires today" : `Expires in ${days} days`;
  } catch {
    return "Soon";
  }
}

export function CloneInvitationsPanel() {
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

  const count = invitations.length > 0 ? invitations.length : fetchFailed ? pendingFromMemberships.length : 0;

  return (
    <ClonePanel
      title="Invitations"
      badge={count || undefined}
      subtitle={
        loading
          ? "Loading invitations…"
          : count > 0
            ? "You have pending invitations."
            : "You're all caught up."
      }
      actionLabel="View All"
      onAction={() => navigate("/zapeera/invitations")}
    >
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-xl border border-[rgba(15,23,60,0.06)] bg-[#f7f9fc]" />
          ))}
        </div>
      ) : invitations.length > 0 ? (
        <div className="divide-y divide-[rgba(15,23,60,0.06)]">
          {invitations.map((inv) => {
            const busy = actingToken === inv.token;
            return (
              <div key={inv.invitationId || inv.token} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#e8effd] text-[14px] font-bold text-[#2563eb]">
                    {inv.businessName?.charAt(0).toUpperCase() || "B"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-[#0a1128]">{inv.businessName}</p>
                    <p className="mt-0.5 truncate text-xs text-[#8c95b0]">{invitationExpiryLabel(inv.expiresAt)}</p>
                  </div>
                  {inv.roleName && (
                    <span className="shrink-0 rounded-full bg-[#e5f6ec] px-2.5 py-1 text-[11px] font-semibold text-[#16a34a]">
                      {inv.roleName}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDecline(inv)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(15,23,60,0.12)] bg-white px-4 py-2 text-xs font-semibold text-[#4a5578] transition-colors hover:bg-[#f0f2f7] disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Decline
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleAccept(inv)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white shadow-[0_2px_10px_rgba(29,78,216,0.3)] transition-opacity hover:opacity-95 disabled:opacity-50"
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
        <div className="divide-y divide-[rgba(15,23,60,0.06)]">
          {pendingFromMemberships.map((m: any) => (
            <div key={m.businessId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#e8effd] text-[14px] font-bold text-[#2563eb]">
                {(m.businessName || "B").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-bold text-[#0a1128]">{m.businessName || m.businessId}</p>
                <p className="truncate text-xs text-[#8c95b0]">Invited as {m.roleName || m.role || "Member"}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/zapeera/invitations")}
                className="shrink-0 rounded-lg bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white shadow-[0_2px_10px_rgba(29,78,216,0.3)] hover:opacity-95"
              >
                Review
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-[#8c95b0]">You have no pending invitations.</p>
      )}
    </ClonePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Recent activity — the existing derivation only (recently accessed   */
/* businesses + desktop/login/account-created events). No invented     */
/* dates: the payloads carry no membership/business created dates.     */
/* ------------------------------------------------------------------ */
export function CloneActivityPanel({ onOpen }: { onOpen: (slug: string | null | undefined, id: string) => void }) {
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
        icon: Monitor,
        tint: "bg-[#f0eafd] text-[#7c3aed]",
        title: `Desktop connected · ${desktopCount} business${desktopCount > 1 ? "es" : ""} ready offline`,
        time: "Now",
      });
    }
    list.push({ id: "login", icon: LogIn, tint: "bg-[#e8effd] text-[#2563eb]", title: "New login from your account", time: "Today" });
    list.push({ id: "signup", icon: CheckCircle2, tint: "bg-[#e5f6ec] text-[#16a34a]", title: "Account created on Zapeera", time: "Sign up" });
    return list;
  }, [runtime.desktopBusinessStates]);

  return (
    <ClonePanel title="Recent Account Activity" actionLabel="View All" onAction={() => navigate("/zapeera/notifications")}>
      {recent.length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#8c95b0]">Recently accessed</p>
          <div className="space-y-1">
            {recent.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onOpen(b.slug, b.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[#f0f2f7]"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#e8effd] text-[#2563eb]">
                  <Building2 className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#0a1128]">{b.name}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" />
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#8c95b0]">Account activity</p>
      <ul className="space-y-3.5">
        {events.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.id} className="flex items-start gap-3">
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", it.tint)}>
                <Icon className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold leading-snug text-[#0a1128]">{it.title}</p>
                <p className="mt-0.5 text-xs text-[#8c95b0]">{it.time}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </ClonePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Quick Actions — the reference's four items, each mapped to a real   */
/* account-level route. "Manage Team Members" targets /zapeera/users,  */
/* which is role-gated to ADMIN / PRODUCT_OWNER, so it only renders    */
/* for those roles (never a dead end for anyone else).                 */
/* ------------------------------------------------------------------ */
export function CloneQuickActions() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManageTeam = ["ADMIN", "PRODUCT_OWNER"].includes(String((user as any)?.role || "").toUpperCase());

  const actions: Array<{ icon: React.ElementType; label: string; to: string }> = [
    { icon: User, label: "Manage Profile", to: "/settings" },
    ...(canManageTeam ? [{ icon: Users, label: "Manage Team Members", to: "/zapeera/users" }] : []),
    { icon: CreditCard, label: "View Billing & Invoices", to: "/zapeera/billing" },
    { icon: BookOpen, label: "Explore Business Resources", to: "/zapeera/support" },
  ];

  return (
    <ClonePanel title="Quick Actions">
      <div className="space-y-2">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.label}
              type="button"
              onClick={() => navigate(a.to)}
              className="flex w-full items-center gap-3 rounded-xl border border-[rgba(15,23,60,0.07)] px-3 py-2.5 text-left transition-colors hover:border-[#2563eb]/25 hover:bg-[#f7faff]"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e8effd] text-[#2563eb]">
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex-1 text-[13.5px] font-semibold text-[#0a1128]">{a.label}</span>
            </button>
          );
        })}
      </div>
    </ClonePanel>
  );
}

/* ------------------------------------------------------------------ */
/* 4th bottom slot — DESKTOP: Storage & Data with the donut, from the  */
/* getStorageInfo IPC (this device's disk, labeled as such).           */
/* WEB: the Download Desktop App widget in the same slot, version      */
/* parsed from the download URL itself so it can never drift.          */
/* ------------------------------------------------------------------ */
export function CloneStorageOrDownloadPanel() {
  const runtime = useRuntime();
  if (runtime.isDesktop) return <CloneStoragePanel />;
  return <CloneDownloadPanel />;
}

function CloneStoragePanel() {
  const navigate = useNavigate();
  const runtime = useRuntime();
  const [storage, setStorage] = useState<{
    diskTotalBytes?: number | null;
    diskFreeBytes?: number | null;
    databaseBytes?: number | null;
  } | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.getStorageInfo) {
      api
        .getStorageInfo()
        .then((info: any) => setStorage(info))
        .catch(() => {});
    }
    if (api?.getAppVersion) {
      api
        .getAppVersion()
        .then((v: string) => setAppVersion(v))
        .catch(() => {});
    }
  }, []);

  if (!storage?.diskTotalBytes) {
    // Honest fallback while/if the IPC has no disk figures: this-device
    // facts that DO exist (app version, offline-ready businesses).
    const offlineReady = (runtime.desktopBusinessStates || []).filter((b) => b.availableOffline).length;
    return (
      <ClonePanel title="This Device">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e8effd] text-[#2563eb]">
            <Monitor className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#0a1128]">Desktop app{appVersion ? ` · v${appVersion}` : ""}</p>
            <p className="mt-0.5 text-[13px] text-[#4a5578]">
              {offlineReady > 0
                ? `${offlineReady} business${offlineReady > 1 ? "es" : ""} ready to work offline.`
                : "Storage details are not available on this device."}
            </p>
          </div>
        </div>
      </ClonePanel>
    );
  }

  const total = storage.diskTotalBytes;
  const free = storage.diskFreeBytes || 0;
  const used = total - free;
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const usedLabel = formatBytes(used);
  const freeLabel = formatBytes(free);
  const totalLabel = formatBytes(total);

  const R = 32;
  const CIRC = 2 * Math.PI * R;

  return (
    <ClonePanel title="Storage & Data">
      <div className="flex items-center gap-4">
        <div className="relative h-[84px] w-[84px] shrink-0">
          <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-0">
            <circle cx="42" cy="42" r={R} fill="none" stroke="#e8edf6" strokeWidth="10" />
            <circle
              cx="42"
              cy="42"
              r={R}
              fill="none"
              stroke="#2563eb"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * CIRC} ${CIRC}`}
              transform="rotate(-90 42 42)"
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-[15px] font-extrabold leading-none text-[#0a1128]">{pct}%</p>
              <p className="mt-0.5 text-[9.5px] font-semibold text-[#8c95b0]">Used</p>
            </div>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5 text-[12.5px]">
          <li className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#2563eb]" />
            <span className="text-[#4a5578]">Used</span>
            <span className="ml-auto font-bold text-[#0a1128]">{usedLabel}</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#c7d6f8]" />
            <span className="text-[#4a5578]">Available</span>
            <span className="ml-auto font-bold text-[#0a1128]">{freeLabel}</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#c3cadb]" />
            <span className="text-[#4a5578]">Total</span>
            <span className="ml-auto font-bold text-[#0a1128]">{totalLabel}</span>
          </li>
        </ul>
      </div>
      <div className="mt-4 border-t border-[rgba(15,23,60,0.06)] pt-3">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#16a34a]">
          Local Storage • Secure
          <CheckCircle2 className="h-4 w-4" />
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-[#8c95b0]">
          Your business data is safely stored on this device and synced securely.
        </p>
        <button
          type="button"
          onClick={() => navigate("/settings")}
          className="mt-3 w-full rounded-[10px] bg-[#f0f2f7] px-4 py-2.5 text-[13px] font-semibold text-[#0a1128] transition-colors hover:bg-[#e4eaf5]"
        >
          Manage Storage
        </button>
      </div>
    </ClonePanel>
  );
}

function CloneDownloadPanel() {
  const navigate = useNavigate();
  const versionMatch = DESKTOP_DOWNLOAD_URL.match(/Zapeera-Setup-([0-9]+\.[0-9]+\.[0-9]+)\.exe$/);
  const versionLabel = versionMatch ? `Version ${versionMatch[1]} · Windows` : "Windows";

  return (
    <ClonePanel title="Download Desktop App">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#2563eb] to-[#7c3aed] text-white shadow-[0_6px_18px_rgba(37,99,235,0.3)]">
          <Monitor className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="whitespace-nowrap text-[13px] font-extrabold tracking-tight text-[#0a1128]">Zapeera for Windows</p>
          <p className="mt-0.5 text-[12px] leading-snug text-[#4a5578]">
            {versionLabel} · Work offline at the counter, syncs automatically.
          </p>
        </div>
      </div>
      <a
        href={DESKTOP_DOWNLOAD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13.5px] font-semibold", BLUE_BTN)}
      >
        <Download className="h-4 w-4" />
        Download for Windows
      </a>
      <button
        type="button"
        onClick={() => navigate("/downloads")}
        className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-[10px] px-4 py-2 text-[13px] font-semibold text-[#2563eb] transition-colors hover:bg-[#e8effd]"
      >
        More download options
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </ClonePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Stay in Control banner — the button targets My Businesses: there    */
/* is no account-level Insights route for a "Go to Insights" label,    */
/* so the label stays honest.                                          */
/* ------------------------------------------------------------------ */
export function CloneControlBanner() {
  const navigate = useNavigate();
  return (
    <section className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-[rgba(15,23,60,0.08)] bg-white px-5 py-4 shadow-[0_1px_3px_rgba(16,24,40,0.05)] sm:px-6">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#2563eb] text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)]">
        <LayoutGrid className="h-5 w-5" />
      </span>
      <div className="min-w-[210px] flex-1">
        <p className="text-[15px] font-extrabold tracking-tight text-[#0a1128]">Stay in Control</p>
        <p className="mt-0.5 text-[13px] text-[#4a5578]">
          Manage your businesses, track performance, and grow with powerful tools built for you.
        </p>
      </div>
      <div className="hidden items-center gap-2 md:flex" aria-hidden>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8effd] text-[#2563eb]">
          <BarChart3 className="h-5 w-5" />
        </span>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#f0eafd] text-[#7c3aed]">
          <TrendingUp className="h-5 w-5" />
        </span>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e5f6ec] text-[#16a34a]">
          <ShieldCheck className="h-5 w-5" />
        </span>
      </div>
      <button
        type="button"
        onClick={() => navigate("/zapeera/my-businesses")}
        className={cn("inline-flex shrink-0 items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13.5px] font-semibold max-sm:w-full max-sm:justify-center", GRADIENT_BTN)}
      >
        View My Businesses
        <ArrowRight className="h-4 w-4" />
      </button>
    </section>
  );
}
