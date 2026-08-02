import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CreditCard,
  Receipt,
  Building2,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type BillingRecord = {
  id: string;
  amount: number;
  status: "success" | "failed" | "pending";
  method: string;
  date: string;
  invoiceNumber: string;
  description: string;
};

type Entitlement = {
  companyId?: string;
  planId?: string | null;
  isSubscribed?: boolean;
  subscriptionStatus?: string | null;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  plan?: { name?: string } | null;
};

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

const BillingPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { allCompanies } = useAdmin();
  const [history, setHistory] = useState<BillingRecord[]>([]);
  const [entitlements, setEntitlements] = useState<Record<string, Entitlement>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes] = await Promise.allSettled([apiService.getBillingHistory()]);
      if (hRes.status === "fulfilled" && hRes.value.success && Array.isArray(hRes.value.data)) {
        setHistory(hRes.value.data as BillingRecord[]);
      }
    } catch (e) {
      console.error("Failed to load billing:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!allCompanies || allCompanies.length === 0) return;
    let cancelled = false;
    (async () => {
      const map: Record<string, Entitlement> = {};
      await Promise.allSettled(
        allCompanies.slice(0, 20).map(async (c: any) => {
          try {
            const res = await apiService.getBusinessEntitlements(c.id);
            if (res.success && res.data) map[c.id] = res.data as Entitlement;
          } catch {
            /* ignore */
          }
        })
      );
      if (!cancelled) setEntitlements(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [allCompanies]);

  const handleDownload = async (invoiceId: string) => {
    try {
      const res = await apiService.downloadInvoice(invoiceId);
      if (res.success && res.data?.downloadUrl) {
        window.open(res.data.downloadUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      console.error("Failed to download invoice:", e);
    }
  };

  const statusStyle: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
    success: { label: "Paid", cls: "border-green-500/15 bg-green-500/[0.08] text-green-600", icon: CheckCircle2 },
    pending: { label: "Pending", cls: "border-amber-500/15 bg-amber-500/[0.08] text-amber-600", icon: Clock },
    failed: { label: "Failed", cls: "border-red-500/15 bg-red-500/[0.08] text-red-600", icon: XCircle },
  };

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-7">
        <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
          <CreditCard className="h-3.5 w-3.5" />
          Account
        </div>
        <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Billing & Payments</h1>
        <p className="mt-1 text-sm text-[#8c95b0]">Plans, invoices and payment history for your account.</p>
      </div>

      {/* Plans callout */}
      <section className="mb-6 overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.06)] bg-gradient-to-br from-[#1a52c5]/[0.05] via-white to-[#28c2ce]/[0.05] p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[16px] font-bold text-[#0a1128]">Choose a plan that grows with you</h3>
              <p className="mt-0.5 text-[13px] text-[#8c95b0]">
                Each of your businesses manages its own subscription. Explore plans to unlock more branches, staff and tools.
              </p>
            </div>
          </div>
          <Button
            onClick={() => navigate("/zapeera/my-businesses")}
            className="h-10 shrink-0 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-5 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
          >
            <Sparkles className="mr-1.5 h-4 w-4" />
            Explore Plans
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Business subscriptions */}
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[18px] font-extrabold tracking-tight text-[#0a1128]">Business Subscriptions</h2>
          </div>
          {allCompanies.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[rgba(15,23,60,0.12)] bg-white/60 p-10 text-center">
              <p className="text-sm text-[#8c95b0]">No businesses to show yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {allCompanies.map((b: any) => {
                const ent = entitlements[b.id] || {};
                const status = String(ent.subscriptionStatus || "").trim().toLowerCase();
                const active = status === "active" || status === "trial";
                const pending = status === "pending" || status === "pending_payment" || status === "pending_payment_approval";
                return (
                  <div key={b.id} className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-sm font-bold text-white">
                          {b.name?.charAt(0).toUpperCase() || "B"}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-bold text-[#0a1128]">{b.name}</p>
                          <p className="truncate text-xs text-[#8c95b0]">
                            {ent.plan?.name ? `${ent.plan.name} plan` : "No active plan"}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                            active
                              ? "border-green-500/15 bg-green-500/[0.08] text-green-600"
                              : pending
                                ? "border-amber-500/15 bg-amber-500/[0.08] text-amber-600"
                                : "border-red-500/15 bg-red-500/[0.08] text-red-600"
                          )}
                        >
                          {active ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                          {status === "trial" ? "Trial" : active ? "Active" : pending ? "Pending" : "Expired"}
                        </span>
                        {b.slug && (
                          <button
                            type="button"
                            onClick={() => navigate(`/business/${encodeURIComponent(b.slug)}/subscription`)}
                            className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)] hover:opacity-95"
                          >
                            Manage
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[rgba(15,23,60,0.05)] pt-3 text-[13px]">
                      <div className="text-[#4a5578]">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#8c95b0]">Renews / Expires</span>
                        <span className="font-semibold text-[#0a1128]">{status === "trial" ? fmtDate(ent.trialEndsAt) : fmtDate(ent.currentPeriodEnd)}</span>
                      </div>
                      <div className="text-right text-[#4a5578]">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#8c95b0]">Owner</span>
                        <span className="font-semibold text-[#0a1128]">
                          {String(b.createdBy || "") === String(user?.id || "") ? "You" : "Other"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Billing history */}
          <div className="mb-3 mt-8 flex items-center justify-between">
            <h2 className="text-[18px] font-extrabold tracking-tight text-[#0a1128]">Billing History</h2>
          </div>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl border border-[rgba(15,23,60,0.06)] bg-white" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[rgba(15,23,60,0.12)] bg-white/60 p-10 text-center">
              <Receipt className="mx-auto mb-3 h-8 w-8 text-[#8c95b0]" />
              <p className="text-sm text-[#8c95b0]">No billing records yet. Once a subscription is active, invoices will appear here.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[rgba(15,23,60,0.06)] text-xs font-bold uppercase tracking-wide text-[#8c95b0]">
                      <th className="px-5 py-3.5">Invoice</th>
                      <th className="px-5 py-3.5">Description</th>
                      <th className="px-5 py-3.5">Date</th>
                      <th className="px-5 py-3.5">Amount</th>
                      <th className="px-5 py-3.5">Status</th>
                      <th className="px-5 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((rec) => {
                      const st = statusStyle[rec.status] || statusStyle.pending;
                      const Icon = st.icon;
                      return (
                        <tr key={rec.id} className="border-b border-[rgba(15,23,60,0.04)] last:border-0">
                          <td className="px-5 py-3.5 font-semibold text-[#0a1128]">{rec.invoiceNumber || rec.id.slice(0, 8)}</td>
                          <td className="px-5 py-3.5 text-[#4a5578]">{rec.description || "Subscription payment"}</td>
                          <td className="px-5 py-3.5 text-[#4a5578]">{fmtDate(rec.date)}</td>
                          <td className="px-5 py-3.5 font-semibold text-[#0a1128]">{fmtMoney(rec.amount)}</td>
                          <td className="px-5 py-3.5">
                            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold", st.cls)}>
                              <Icon className="h-3 w-3" />
                              {st.label}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => handleDownload(rec.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-[rgba(15,23,60,0.1)] px-2.5 py-1.5 text-xs font-semibold text-[#4a5578] transition-colors hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Invoice
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* Side summary */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-2.5 text-[16px] font-bold text-[#0a1128]">
              <Building2 className="h-5 w-5 text-[#1a52c5]" />
              Summary
            </div>
            <div className="mt-4 space-y-3">
              {[
                { label: "Businesses", value: allCompanies.length },
                { label: "Active subscriptions", value: Object.values(entitlements).filter((e) => e.subscriptionStatus === "active" || e.subscriptionStatus === "trial").length },
                { label: "Pending payments", value: Object.values(entitlements).filter((e) => ["pending", "pending_payment", "pending_payment_approval"].includes(String(e.subscriptionStatus || ""))).length },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between border-b border-[rgba(15,23,60,0.06)] pb-3 last:border-0 last:pb-0">
                  <span className="text-sm text-[#4a5578]">{row.label}</span>
                  <span className="text-lg font-extrabold text-[#0a1128]">{row.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <h3 className="text-[15px] font-bold text-[#0a1128]">Payment questions?</h3>
            <p className="mt-1 text-[13px] text-[#8c95b0]">Need a refund, invoice correction or help paying? Our team can help.</p>
            <Button
              variant="outline"
              onClick={() => (window.location.href = "mailto:support@zapeera.com?subject=Billing%20support")}
              className="mt-4 h-10 w-full rounded-[10px] border-[rgba(15,23,60,0.1)] font-semibold text-[#0a1128] hover:bg-[#f0f2f7]"
            >
              Contact Billing Support
            </Button>
          </section>
        </div>
      </div>
    </main>
  );
};

export default BillingPage;
