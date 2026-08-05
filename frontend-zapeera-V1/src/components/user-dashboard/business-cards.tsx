import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  MoreVertical,
  ExternalLink,
  CreditCard,
  UserMinus,
  Trash2,
  Star,
  Building2,
  Layers,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { useRuntime, type DesktopBusinessState } from "@/lib/runtime";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type Entitlement = {
  companyId?: string;
  planId?: string | null;
  isSubscribed?: boolean;
  subscriptionStatus?: string | null;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  plan?: { name?: string } | null;
};

export type EntitlementsMap = Record<string, Entitlement>;

type BusinessCardData = {
  id: string;
  name: string;
  slug?: string | null;
  businessType?: string | null;
  createdBy?: string | null;
  accessType?: "owned" | "shared";
  memberRole?: "MANAGER" | "CASHIER" | string | null;
  branches?: Array<{ id: string; name?: string }>;
  _count?: { branches?: number };
  updatedAt?: string | null;
};

function normalizeStatus(status?: string | null): "active" | "trial" | "expired" | "inactive" | "pending" {
  const value = String(status || "").trim().toLowerCase();
  if (["active", "trial"].includes(value)) return value as "active" | "trial";
  if (["grace"].includes(value)) return "pending";
  if (["expired"].includes(value)) return "expired";
  if (["pending", "pending_payment", "pending_payment_approval", "payment_pending_approval", "awaiting approval", "waiting for approval"].includes(value)) return "pending";
  return "inactive";
}

const statusStyle: Record<string, { label: string; cls: string; dot: string }> = {
  active: { label: "Active", cls: "border-green-500/15 bg-green-500/[0.08] text-green-600", dot: "bg-green-500" },
  trial: { label: "Trial", cls: "border-orange-500/15 bg-orange-500/[0.08] text-orange-600", dot: "bg-orange-500" },
  pending: { label: "Pending", cls: "border-amber-500/15 bg-amber-500/[0.08] text-amber-600", dot: "bg-amber-500" },
  expired: { label: "Expired", cls: "border-red-500/15 bg-red-500/[0.08] text-red-600", dot: "bg-red-500" },
  inactive: { label: "Inactive", cls: "border-gray-500/15 bg-gray-500/[0.08] text-gray-500", dot: "bg-gray-400" },
};

function roleFor(business: BusinessCardData, user: any): string {
  if (business.accessType === "shared" || (business.memberRole && String(business.createdBy || "") !== String(user?.id || ""))) {
    return String(business.memberRole || "MANAGER");
  }
  return "Owner";
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

/** Correct expiry date for a business card based on its subscription status. */
function expiryLabel(status: string, ent: Entitlement): string {
  const trialDate = ent.trialEndsAt || null;
  const periodDate = ent.currentPeriodEnd || null;
  if (status === "trial") {
    return trialDate ? `Trial ends ${formatDate(trialDate)}` : periodDate ? `Expires ${formatDate(periodDate)}` : "Trial";
  }
  if (status === "active") {
    return periodDate ? `Renews ${formatDate(periodDate)}` : trialDate ? `Renews ${formatDate(trialDate)}` : "Active";
  }
  if (status === "expired") {
    return periodDate ? `Expired ${formatDate(periodDate)}` : trialDate ? `Expired ${formatDate(trialDate)}` : "Expired";
  }
  if (status === "pending") {
    return periodDate ? `Expires ${formatDate(periodDate)}` : trialDate ? `Expires ${formatDate(trialDate)}` : "Pending";
  }
  return periodDate ? `Expires ${formatDate(periodDate)}` : trialDate ? `Expires ${formatDate(trialDate)}` : "Inactive";
}

/** Best available "last synced" date for a business card. */
function lastSyncedFor(business: BusinessCardData, desktopState: DesktopBusinessState | undefined, isDesktop: boolean): string | null {
  if (isDesktop && desktopState?.lastSyncedAt) return desktopState.lastSyncedAt;
  if (business.updatedAt) return business.updatedAt;
  return null;
}

export function BusinessCardGrid() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { allCompanies, refreshCompanies } = useAdmin();
  const runtime = useRuntime();
  const [entitlements, setEntitlements] = useState<EntitlementsMap>({});
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [confirmAction, setConfirmAction] = useState<null | { type: "delete" | "leave"; business: BusinessCardData }>(null);
  const [deleting, setDeleting] = useState(false);

  const desktopByBusiness = new Map<string, DesktopBusinessState>((runtime.desktopBusinessStates || []).map((s) => [s.businessId, s]));

  const businessList = allCompanies || [];

  // Load favorites on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("zapeera_favorite_businesses");
      if (raw) setFavorites(JSON.parse(raw).map((b: any) => b.id));
    } catch {
      /* ignore */
    }
  }, []);

  // Load entitlements for visible businesses (capped to avoid bursts)
  useEffect(() => {
    if (businessList.length === 0) return;
    let cancelled = false;
    (async () => {
      const map: EntitlementsMap = {};
      await Promise.allSettled(
        businessList.slice(0, 20).map(async (c: any) => {
          try {
            const res = await apiService.getBusinessEntitlements(c.id);
            if (res.success && res.data) map[c.id] = res.data as Entitlement;
          } catch {
            /* ignore per-business entitlement errors */
          }
        })
      );
      if (!cancelled) setEntitlements(map);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessList]);

  const toggleFavorite = (b: BusinessCardData) => {
    const next = favorites.includes(b.id) ? favorites.filter((id) => id !== b.id) : [...favorites, b.id];
    setFavorites(next);
    try {
      const raw = localStorage.getItem("zapeera_favorite_businesses");
      const list = raw ? JSON.parse(raw) : [];
      const filtered = list.filter((x: any) => x.id !== b.id);
      if (next.includes(b.id)) {
        filtered.push({ id: b.id, name: b.name, slug: b.slug || null });
      }
      localStorage.setItem("zapeera_favorite_businesses", JSON.stringify(filtered));
    } catch {
      /* ignore */
    }
  };

  const openWorkspace = (b: BusinessCardData) => {
    const slug = b.slug?.trim();
    if (slug) {
      navigate(`/business/${encodeURIComponent(slug)}/dashboard`);
    } else {
      navigate("/zapeera/my-businesses");
    }
    try {
      const raw = localStorage.getItem("zapeera_recent_businesses");
      const list = raw ? JSON.parse(raw) : [];
      const filtered = list.filter((x: any) => x.id !== b.id);
      filtered.unshift({ id: b.id, name: b.name, slug: b.slug || null });
      localStorage.setItem("zapeera_recent_businesses", JSON.stringify(filtered.slice(0, 5)));
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async () => {
    if (!confirmAction || confirmAction.type !== "delete") return;
    setDeleting(true);
    try {
      const res = await apiService.deleteCompany(confirmAction.business.id);
      if (res.success) {
        toast({ title: "Business deleted", description: `${confirmAction.business.name} was deleted.` });
        await refreshCompanies();
      } else {
        toast({ title: "Delete failed", description: res.message || "Could not delete business.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message || "Could not delete business.", variant: "destructive" });
    } finally {
      setDeleting(false);
      setConfirmAction(null);
    }
  };

  const handleLeave = () => {
    if (!confirmAction || confirmAction.type !== "leave") return;
    setConfirmAction(null);
    toast({
      title: "Leave request",
      description: "Only the business owner can remove members. Please contact the owner to be removed.",
    });
  };

  if (loading && businessList.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-[220px] animate-pulse rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white" />
        ))}
      </div>
    );
  }

  if (businessList.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[rgba(15,23,60,0.12)] bg-white/60 p-10 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 text-[#1a52c5]">
          <Building2 className="h-7 w-7" />
        </div>
        <h3 className="text-lg font-bold text-[#0a1128]">Create Your First Business</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-[#8c95b0]">
          Start managing sales, inventory and staff in minutes. Or join an existing business with an invitation.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/zapeera?create=1")}
            className="inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
          >
            Create Your First Business
          </button>
          <button
            type="button"
            onClick={() => navigate("/zapeera/invitations")}
            className="inline-flex items-center gap-2 rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white px-5 py-2.5 text-sm font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
          >
            Join Existing Business
          </button>
        </div>
      </div>
    );
  }

  const isOwner = (b: BusinessCardData) => String(b.createdBy || "") === String(user?.id || "");

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {businessList.map((b: any) => {
          const ent = entitlements[b.id] || {};
          const status = normalizeStatus(ent.subscriptionStatus);
          const style = statusStyle[status];
          const desktopState = desktopByBusiness.get(b.id);
          const role = roleFor(b, user);
          const branchCount = b._count?.branches ?? b.branches?.length ?? 0;
          const isFav = favorites.includes(b.id);
          const owned = isOwner(b);

          return (
            <div
              key={b.id}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_44px_rgba(0,0,0,0.09)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-[15px] font-bold text-white">
                    {b.name?.charAt(0).toUpperCase() || "B"}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[15px] font-bold tracking-tight text-[#0a1128]">{b.name}</p>
                      <button
                        type="button"
                        onClick={() => toggleFavorite(b)}
                        aria-label={isFav ? "Unpin business" : "Pin business"}
                        className="shrink-0"
                      >
                        <Star className={cn("h-3.5 w-3.5", isFav ? "fill-amber-400 text-amber-400" : "text-[#c3cadb] hover:text-amber-400")} />
                      </button>
                    </div>
                    <p className="truncate text-xs text-[#8c95b0]">
                      {String(b.businessType || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) || "Business"}
                    </p>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#8c95b0] transition-colors hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                      aria-label="Quick actions"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[210px] rounded-xl border border-[rgba(15,23,60,0.06)] p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.1)]">
                    <DropdownMenuItem onClick={() => openWorkspace(b)} className="cursor-pointer gap-2.5 rounded-lg py-2 text-sm font-semibold text-[#1a52c5]">
                      <ExternalLink className="h-4 w-4" />
                      Open Workspace
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => b.slug && navigate(`/business/${encodeURIComponent(b.slug)}/subscription`)}
                      className="cursor-pointer gap-2.5 rounded-lg py-2 text-sm font-medium text-[#4a5578]"
                    >
                      <CreditCard className="h-4 w-4 opacity-60" />
                      Manage Subscription
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {!owned && (
                      <DropdownMenuItem onClick={() => setConfirmAction({ type: "leave", business: b })} className="cursor-pointer gap-2.5 rounded-lg py-2 text-sm font-medium text-amber-600 focus:text-amber-600">
                        <UserMinus className="h-4 w-4" />
                        Leave Business
                      </DropdownMenuItem>
                    )}
                    {owned && (
                      <DropdownMenuItem onClick={() => setConfirmAction({ type: "delete", business: b })} className="cursor-pointer gap-2.5 rounded-lg py-2 text-sm font-medium text-red-600 focus:text-red-600">
                        <Trash2 className="h-4 w-4" />
                        Delete Business
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f0f2f7] px-2.5 py-1 text-[11px] font-semibold text-[#4a5578]">
                  <UserMinus className="h-3 w-3 opacity-60" /> {role}
                </span>
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold", style.cls)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                  {ent.plan?.name ? `${ent.plan.name} · ${style.label}` : style.label}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
                <div className="flex items-center gap-2 text-[#4a5578]">
                  <Layers className="h-4 w-4 text-[#8c95b0]" />
                  {branchCount} {branchCount === 1 ? "Branch" : "Branches"}
                </div>
                <div className="flex items-center gap-2 text-[#4a5578]">
                  <CreditCard className="h-4 w-4 text-[#8c95b0]" />
                  <span className="truncate">{expiryLabel(status, ent)}</span>
                </div>
              </div>

              {/* Desktop sync status */}
              <div className="mt-3 flex items-center gap-2 border-t border-[rgba(15,23,60,0.05)] pt-3 text-xs text-[#8c95b0]">
                {runtime.isDesktop ? (
                  desktopState?.availableOffline ? (
                    <>
                      <Wifi className="h-3.5 w-3.5 text-green-500" />
                      <span className="text-green-600">Available offline</span>
                      <span className="mx-1">·</span>
                      <Clock className="h-3.5 w-3.5" />
                      <span>{formatDate(desktopState.lastSyncedAt)}</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-amber-600">Cloud only</span>
                      <span className="mx-1">·</span>
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Sync pending</span>
                    </>
                  )
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Last synced {formatDate(lastSyncedFor(b, desktopState, runtime.isDesktop))}</span>
                  </>
                )}
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => openWorkspace(b)}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_3px_14px_rgba(26,82,197,0.22)] transition-all hover:-translate-y-px hover:shadow-[0_6px_22px_rgba(26,82,197,0.32)]"
                >
                  Open Workspace
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={confirmAction !== null} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === "delete" ? `Delete ${confirmAction?.business.name}?` : `Leave ${confirmAction?.business.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === "delete"
                ? "This will permanently delete the business and all of its data. This action cannot be undone."
                : "You will lose access to this business unless the owner re-invites you."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAction?.type === "delete" ? handleDelete : handleLeave}
              disabled={deleting}
              className={cn("rounded-lg", confirmAction?.type === "delete" && "bg-red-600 text-white hover:bg-red-700")}
            >
              {confirmAction?.type === "delete" ? (deleting ? "Deleting…" : "Delete") : "Leave"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
