import { useState, useEffect, useCallback } from "react";
import { Puzzle, CheckCircle2, Clock, XCircle, TrendingUp } from "lucide-react";
import { apiService } from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type CatalogueItem = {
  type: string;
  name: string;
  description: string;
  priceMonthly: number;
  stackable: boolean;
  unitLabel?: string;
};

type OwnedAddon = {
  id: string;
  type: string;
  name: string;
  quantity: number;
  status: string;
  priceMonthly: number | null;
  periodEnd: string | null;
};

type BusinessAddonsData = {
  businessId: string;
  planId: string;
  planName: string;
  isTrial: boolean;
  monthlyAddonSpend: number;
  addons: OwnedAddon[];
  limits: {
    maxBranches: number;
    maxStaffSeats: number;
    staffAllowed: boolean;
    financeAllowed: boolean;
    advancedReportsAllowed: boolean;
    multiBranchReportsAllowed: boolean;
    whatsappPack: boolean;
    voiceTokenQuota: number;
  };
};

// Plan prices (PKR/month) — the same figures the backend plan
// definitions and the pricing page use.
const PLAN_PRICES: Record<string, number> = {
  Starter: 2500,
  Growth: 5000,
  Scale: 10000,
};
const NEXT_PLAN: Record<string, { name: string; includes: string }> = {
  Starter: {
    name: "Growth",
    includes: "staff seats, the finance toolkit and advanced reports built in",
  },
  Growth: {
    name: "Scale",
    includes: "more branches and staff seats, plus multi-branch reporting built in",
  },
};
const MONTH_CHOICES = [1, 3, 6, 12];

function fmtMoney(amount: number): string {
  return `Rs ${Number(amount || 0).toLocaleString()}`;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

const BusinessAddons = ({ businesses }: { businesses: any[] }) => {
  const { toast } = useToast();
  const [businessId, setBusinessId] = useState<string>("");
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [data, setData] = useState<BusinessAddonsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyType, setBusyType] = useState<string>("");
  const [qtySel, setQtySel] = useState<Record<string, number>>({});
  const [monthsSel, setMonthsSel] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!businessId && businesses.length > 0) setBusinessId(String(businesses[0].id));
  }, [businesses, businessId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiService.getAddonCatalogue();
        if (res.success && Array.isArray(res.data)) setCatalogue(res.data as CatalogueItem[]);
      } catch {
        /* catalogue is best-effort; owned state still renders */
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await apiService.getBusinessAddons(businessId);
      if (res.success && res.data) {
        setData(res.data as BusinessAddonsData);
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const ownedByType = new Map<string, OwnedAddon>();
  (data?.addons || []).forEach((a) => {
    if (a.status !== "CANCELLED") ownedByType.set(a.type, a);
  });

  const handlePurchase = async (item: CatalogueItem) => {
    if (!businessId) return;
    setBusyType(item.type);
    try {
      const res = await apiService.purchaseAddon({
        businessId,
        type: item.type,
        quantity: item.stackable ? qtySel[item.type] || 1 : 1,
        months: monthsSel[item.type] || 1,
      });
      if (res.success) {
        toast({
          title: `${item.name} added`,
          description:
            res.data && (res.data as any).addon?.status === "PENDING"
              ? "Your request is in — it activates as soon as payment is confirmed."
              : `Active now. Upfront for the chosen period: ${fmtMoney((res.data as any)?.upfrontAmount || 0)}.`,
        });
        await load();
      } else {
        toast({
          title: "Could not add this add-on",
          description: (res as any).message || "Please try again.",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({
        title: "Could not add this add-on",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyType("");
    }
  };

  const handleCancel = async (item: CatalogueItem) => {
    if (!businessId) return;
    setBusyType(item.type);
    try {
      const res = await apiService.cancelAddon({ businessId, type: item.type });
      if (res.success) {
        toast({
          title: `${item.name} will cancel at period end`,
          description: "It stays active until the paid period ends. Nothing is deleted.",
        });
        await load();
      } else {
        toast({
          title: "Could not cancel this add-on",
          description: (res as any).message || "Please try again.",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({
        title: "Could not cancel this add-on",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyType("");
    }
  };

  const planName = data?.planName || "";
  const planPrice = PLAN_PRICES[planName] || 0;
  const spend = data?.monthlyAddonSpend || 0;
  const next = NEXT_PLAN[planName];
  const nextPrice = next ? PLAN_PRICES[next.name] : 0;
  // Honest nudge: only when add-on spend reaches at least 75% of the
  // price gap to the next plan.
  const showNudge =
    !!next && spend > 0 && planPrice > 0 && spend >= (nextPrice - planPrice) * 0.75;

  const statusChip = (a: OwnedAddon) => {
    if (a.status === "ACTIVE")
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/15 bg-green-500/[0.08] px-2.5 py-1 text-[11px] font-semibold text-green-600">
          <CheckCircle2 className="h-3 w-3" /> Active · until {fmtDate(a.periodEnd)}
        </span>
      );
    if (a.status === "CANCEL_PENDING")
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/15 bg-amber-500/[0.08] px-2.5 py-1 text-[11px] font-semibold text-amber-600">
          <Clock className="h-3 w-3" /> Cancels {fmtDate(a.periodEnd)} · active until then
        </span>
      );
    if (a.status === "PENDING")
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/15 bg-amber-500/[0.08] px-2.5 py-1 text-[11px] font-semibold text-amber-600">
          <Clock className="h-3 w-3" /> Pending activation
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/15 bg-red-500/[0.08] px-2.5 py-1 text-[11px] font-semibold text-red-600">
        <XCircle className="h-3 w-3" /> {a.status}
      </span>
    );
  };

  if (businesses.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[18px] font-extrabold tracking-tight text-[#0a1128]">Add-ons</h2>
          <p className="mt-0.5 text-[13px] text-[#8c95b0]">
            Add just the features you need to a plan — no full upgrade required. Prices are monthly; pay for several months at once if you prefer, at the same monthly rate.
          </p>
        </div>
        <select
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          className="h-10 shrink-0 rounded-[10px] border border-[rgba(15,23,60,0.12)] bg-white px-3 text-sm font-semibold text-[#0a1128]"
          aria-label="Choose a business"
        >
          {businesses.map((b: any) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {data?.isTrial && (
        <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-[13px] text-[#4a5578]">
          Add-ons are available on paid plans. The 15-day free trial is owner-only — choose a plan for this business to add features.
        </div>
      )}

      {showNudge && next && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-[#1a52c5]/15 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] p-4">
          <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-[#1a52c5]" />
          <p className="text-[13px] text-[#4a5578]">
            <span className="font-bold text-[#0a1128]">Worth a look:</span> your add-ons cost{" "}
            <span className="font-semibold text-[#0a1128]">{fmtMoney(spend)}/mo</span> on top of {planName} ({fmtMoney(planPrice)}/mo) —{" "}
            {fmtMoney(planPrice + spend)}/mo in total. <span className="font-semibold text-[#0a1128]">{next.name} is {fmtMoney(nextPrice)}/mo</span>{" "}
            and includes {next.includes}. Upgrading could cost about the same and give you more.
          </p>
        </div>
      )}

      {data && (
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px] font-medium text-[#4a5578]">
          <span>
            Branches: <span className="font-bold text-[#0a1128]">{data.limits.maxBranches}</span>
          </span>
          <span>
            Staff seats: <span className="font-bold text-[#0a1128]">{data.limits.staffAllowed ? data.limits.maxStaffSeats : "Owner only"}</span>
          </span>
          <span>
            Voice AI quota: <span className="font-bold text-[#0a1128]">{data.limits.voiceTokenQuota.toLocaleString()} tokens/mo</span>
          </span>
          <span>
            Add-on spend: <span className="font-bold text-[#0a1128]">{fmtMoney(spend)}/mo</span>
          </span>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {catalogue.map((item) => {
            const owned = ownedByType.get(item.type);
            const qty = qtySel[item.type] ?? owned?.quantity ?? 1;
            const months = monthsSel[item.type] || 1;
            const monthlyTotal = item.priceMonthly * (item.stackable ? qty : 1);
            const busy = busyType === item.type;
            return (
              <div
                key={item.type}
                className="flex flex-col rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white">
                      <Puzzle className="h-4 w-4" />
                    </div>
                    <h3 className="text-[15px] font-bold text-[#0a1128]">{item.name}</h3>
                  </div>
                  <span className="shrink-0 text-[15px] font-extrabold text-[#0a1128]">
                    {fmtMoney(item.priceMonthly)}
                    <span className="text-[11px] font-semibold text-[#8c95b0]">/mo{item.stackable && item.unitLabel ? ` per ${item.unitLabel}` : ""}</span>
                  </span>
                </div>
                <p className="mt-2.5 flex-1 text-[13px] leading-relaxed text-[#4a5578]">{item.description}</p>

                {owned ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {statusChip(owned)}
                      {item.stackable && (
                        <span className="text-[12px] font-semibold text-[#4a5578]">
                          Quantity: {owned.quantity} {item.unitLabel || ""}
                          {owned.quantity !== 1 && item.unitLabel ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {item.stackable && owned.status !== "PENDING" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex items-center rounded-lg border border-[rgba(15,23,60,0.12)]">
                          <button
                            type="button"
                            className="px-2.5 py-1.5 text-sm font-bold text-[#4a5578]"
                            onClick={() => setQtySel((s) => ({ ...s, [item.type]: Math.max(1, qty - 1) }))}
                          >
                            −
                          </button>
                          <span className="min-w-8 text-center text-sm font-bold text-[#0a1128]">{qty}</span>
                          <button
                            type="button"
                            className="px-2.5 py-1.5 text-sm font-bold text-[#4a5578]"
                            onClick={() => setQtySel((s) => ({ ...s, [item.type]: qty + 1 }))}
                          >
                            +
                          </button>
                        </div>
                        <Button
                          disabled={busy || data?.isTrial}
                          onClick={() => handlePurchase(item)}
                          className="h-9 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-4 text-xs font-semibold text-white hover:opacity-95"
                        >
                          Update quantity
                        </Button>
                      </div>
                    )}
                    {owned.status !== "CANCEL_PENDING" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleCancel(item)}
                        className="text-xs font-semibold text-red-500 hover:text-red-600 disabled:opacity-50"
                      >
                        Cancel at period end
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.stackable && (
                        <div className="inline-flex items-center rounded-lg border border-[rgba(15,23,60,0.12)]">
                          <button
                            type="button"
                            className="px-2.5 py-1.5 text-sm font-bold text-[#4a5578]"
                            onClick={() => setQtySel((s) => ({ ...s, [item.type]: Math.max(1, qty - 1) }))}
                          >
                            −
                          </button>
                          <span className="min-w-8 text-center text-sm font-bold text-[#0a1128]">{qty}</span>
                          <button
                            type="button"
                            className="px-2.5 py-1.5 text-sm font-bold text-[#4a5578]"
                            onClick={() => setQtySel((s) => ({ ...s, [item.type]: qty + 1 }))}
                          >
                            +
                          </button>
                        </div>
                      )}
                      <div className="inline-flex overflow-hidden rounded-lg border border-[rgba(15,23,60,0.12)]">
                        {MONTH_CHOICES.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setMonthsSel((s) => ({ ...s, [item.type]: m }))}
                            className={cn(
                              "px-2.5 py-1.5 text-xs font-bold",
                              months === m ? "bg-[#1a52c5] text-white" : "text-[#4a5578] hover:bg-[#f0f2f7]"
                            )}
                          >
                            {m} mo
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="text-[12px] font-medium text-[#4a5578]">
                      {fmtMoney(item.priceMonthly)}/mo — pay for {months} month{months !== 1 ? "s" : ""}:{" "}
                      <span className="font-bold text-[#0a1128]">{fmtMoney(monthlyTotal * months)} upfront</span>
                      <span className="text-[#8c95b0]"> (capped at your plan's paid-through date)</span>
                    </p>
                    <Button
                      disabled={busy || data?.isTrial}
                      onClick={() => handlePurchase(item)}
                      className="h-9 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-4 text-xs font-semibold text-white hover:opacity-95"
                    >
                      Add {item.name}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default BusinessAddons;
