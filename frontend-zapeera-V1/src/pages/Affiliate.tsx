import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Copy,
  Check,
  Loader2,
  Users,
  Building2,
  Wallet,
  TrendingUp,
  HandCoins,
  CircleDollarSign,
  Link2,
  Clock3,
} from "lucide-react";
import { apiService, type AffiliateDashboardData, type AffiliateReferralItem, type AffiliateCommissionItem, type AffiliatePayoutItem, type AffiliatePayoutDetails } from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Zapeera Affiliate Program — account-level dashboard (NOT business
// scoped: an affiliate may also own businesses, and the two views
// coexist). Covers: join (PENDING → backoffice approves to ACTIVE),
// referral link, referred businesses, commissions, payout details,
// and payout requests once the available balance reaches the minimum.

const money = (n: number) => `Rs. ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

const statusBadge = (status: string) => {
  const tone: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-800",
    APPROVED: "bg-blue-100 text-blue-800",
    ACTIVE: "bg-emerald-100 text-emerald-800",
    PAID: "bg-emerald-100 text-emerald-800",
    VOID: "bg-rose-100 text-rose-800",
    REQUESTED: "bg-amber-100 text-amber-800",
    REJECTED: "bg-rose-100 text-rose-800",
    SUSPENDED: "bg-rose-100 text-rose-800",
    TRIAL: "bg-sky-100 text-sky-800",
  };
  return <Badge className={tone[status] || "bg-gray-100 text-gray-800"} variant="secondary">{status}</Badge>;
};

const Affiliate: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [data, setData] = useState<AffiliateDashboardData | null>(null);
  const [referrals, setReferrals] = useState<AffiliateReferralItem[]>([]);
  const [commissions, setCommissions] = useState<AffiliateCommissionItem[]>([]);
  const [payouts, setPayouts] = useState<AffiliatePayoutItem[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [details, setDetails] = useState<AffiliatePayoutDetails>({
    method: "BANK_TRANSFER",
    accountTitle: "",
    accountNumber: "",
    bankName: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiService.getMyAffiliate();
      const d = (res as any)?.data as AffiliateDashboardData;
      setData(d);
      if (d?.affiliate?.payoutDetails) {
        setDetails({
          method: d.affiliate.payoutDetails.method,
          accountTitle: d.affiliate.payoutDetails.accountTitle || "",
          accountNumber: d.affiliate.payoutDetails.accountNumber || "",
          bankName: d.affiliate.payoutDetails.bankName || "",
        });
      }
      if (d?.hasProfile) {
        const [refs, comms, pays] = await Promise.all([
          apiService.getMyAffiliateReferrals(),
          apiService.getMyAffiliateCommissions({ limit: 50 }),
          apiService.getMyAffiliatePayouts(),
        ]);
        setReferrals(((refs as any)?.data as AffiliateReferralItem[]) || []);
        setCommissions(((comms as any)?.data?.commissions as AffiliateCommissionItem[]) || []);
        setPayouts(((pays as any)?.data as AffiliatePayoutItem[]) || []);
      }
    } catch (e: any) {
      toast({ title: "Could not load affiliate dashboard", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const join = async () => {
    setJoining(true);
    try {
      await apiService.joinAffiliate();
      toast({ title: "Application submitted", description: "Your affiliate account is pending approval from the Zapeera team." });
      await load();
    } catch (e: any) {
      toast({ title: "Join failed", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setJoining(false);
    }
  };

  const copyLink = async () => {
    if (!data?.referralLink) return;
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Select the link and copy it manually.", variant: "destructive" });
    }
  };

  const saveDetails = async () => {
    if (!details.accountTitle.trim() || !details.accountNumber.trim()) {
      toast({ title: "Missing payout details", description: "Account title and account number are required.", variant: "destructive" });
      return;
    }
    setSavingDetails(true);
    try {
      await apiService.updateAffiliatePayoutDetails(details);
      toast({ title: "Payout details saved" });
      await load();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSavingDetails(false);
    }
  };

  const requestPayout = async () => {
    setRequesting(true);
    try {
      await apiService.requestAffiliatePayout();
      toast({ title: "Payout requested", description: "The Zapeera team will process it shortly." });
      await load();
    } catch (e: any) {
      toast({ title: "Request failed", description: e?.message || "Your balance may be below the minimum payout.", variant: "destructive" });
    } finally {
      setRequesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading affiliate dashboard…
      </div>
    );
  }

  // ── Not an affiliate yet ────────────────────────────────────────────
  if (!data?.hasProfile) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Zapeera Affiliate Program</h1>
          <p className="mt-1 text-sm text-gray-500">Earn commission on every paid subscription from businesses you refer.</p>
        </div>
        <Card className="border-0 bg-white shadow-soft">
          <CardContent className="space-y-5 p-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-emerald-50 p-4">
                <TrendingUp className="mb-2 h-5 w-5 text-emerald-600" />
                <p className="text-sm font-semibold text-gray-900">{data?.config?.defaultRate ?? 20}% commission</p>
                <p className="text-xs text-gray-500">On every subscription payment by a referred business.</p>
              </div>
              <div className="rounded-xl bg-sky-50 p-4">
                <Link2 className="mb-2 h-5 w-5 text-sky-600" />
                <p className="text-sm font-semibold text-gray-900">Your own link</p>
                <p className="text-xs text-gray-500">Share it — signups through it are credited to you automatically.</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-4">
                <HandCoins className="mb-2 h-5 w-5 text-amber-600" />
                <p className="text-sm font-semibold text-gray-900">Payouts from {money(data?.config?.minPayout ?? 5000)}</p>
                <p className="text-xs text-gray-500">Request a payout any time your balance crosses the minimum.</p>
              </div>
            </div>
            <Button onClick={join} disabled={joining} className="w-full sm:w-auto">
              {joining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Join the affiliate program
            </Button>
            <p className="text-xs text-gray-400">Applications are reviewed by the Zapeera team before your link starts earning.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const affiliate = data.affiliate!;
  const stats = data.stats!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Affiliate Program</h1>
          <p className="mt-1 text-sm text-gray-500">
            Code <span className="font-mono font-semibold text-gray-800">{affiliate.code}</span> · earning {affiliate.effectiveRate}% per payment
          </p>
        </div>
        {statusBadge(affiliate.status)}
      </div>

      {affiliate.status === "PENDING" && (
        <Card className="border-amber-200 bg-amber-50 shadow-soft">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-amber-900">
            <Clock3 className="h-5 w-5 shrink-0" />
            Your application is being reviewed. Your referral link is ready to share and attribution already works — commissions start earning once the Zapeera team activates your account.
          </CardContent>
        </Card>
      )}
      {affiliate.status === "SUSPENDED" && (
        <Card className="border-rose-200 bg-rose-50 shadow-soft">
          <CardContent className="p-4 text-sm text-rose-900">
            Your affiliate account is suspended. New commissions no longer accrue — please contact Zapeera support.
          </CardContent>
        </Card>
      )}

      {/* Referral link */}
      <Card className="border-0 bg-white shadow-soft">
        <CardHeader><CardTitle className="text-base">Your referral link</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input readOnly value={data.referralLink || ""} className="font-mono text-sm" />
          <Button onClick={copyLink} variant="outline" className="shrink-0">
            {copied ? <Check className="mr-2 h-4 w-4 text-emerald-600" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Referrals", value: String(stats.referralsCount), icon: Users },
          { label: "Active businesses", value: String(stats.activeReferredBusinesses), icon: Building2 },
          { label: "Total earned", value: money(stats.totalEarned), icon: CircleDollarSign },
          { label: "Pending approval", value: money(stats.pendingApproval), icon: Clock3 },
          { label: "Paid out", value: money(stats.payoutsPaid), icon: HandCoins },
          { label: "Available balance", value: money(stats.availableBalance), icon: Wallet },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="border-0 bg-white shadow-soft">
            <CardContent className="p-4">
              <Icon className="mb-2 h-5 w-5 text-emerald-600" />
              <p className="text-lg font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Referred businesses */}
        <Card className="border-0 bg-white shadow-soft lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Referred businesses</CardTitle></CardHeader>
          <CardContent className="p-0">
            {referrals.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">No referrals yet — share your link to get started.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-4 py-2">Business</th>
                    <th className="px-4 py-2">Signed up</th>
                    <th className="px-4 py-2">Plan</th>
                    <th className="px-4 py-2">Subscription</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.businessName || "—"}</td>
                      <td className="px-4 py-3 text-gray-500">{fmtDate(r.signedUpAt)}</td>
                      <td className="px-4 py-3 text-gray-500">{r.planName || "—"}</td>
                      <td className="px-4 py-3">{r.subscriptionStatus ? statusBadge(r.subscriptionStatus) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Payout details + request */}
        <Card className="border-0 bg-white shadow-soft">
          <CardHeader><CardTitle className="text-base">Payouts</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={details.method} onValueChange={(v) => setDetails({ ...details, method: v as AffiliatePayoutDetails["method"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                  <SelectItem value="JAZZCASH">JazzCash</SelectItem>
                  <SelectItem value="EASYPAISA">Easypaisa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Account title</Label>
              <Input value={details.accountTitle} onChange={(e) => setDetails({ ...details, accountTitle: e.target.value })} placeholder="e.g. Ahmed Raza" />
            </div>
            <div className="space-y-2">
              <Label>Account number</Label>
              <Input value={details.accountNumber} onChange={(e) => setDetails({ ...details, accountNumber: e.target.value })} placeholder="IBAN or wallet number" />
            </div>
            {details.method === "BANK_TRANSFER" && (
              <div className="space-y-2">
                <Label>Bank name</Label>
                <Input value={details.bankName || ""} onChange={(e) => setDetails({ ...details, bankName: e.target.value })} placeholder="e.g. Meezan Bank" />
              </div>
            )}
            <Button onClick={saveDetails} disabled={savingDetails} variant="outline" className="w-full">
              {savingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save payout details
            </Button>
            <div className="border-t pt-4">
              <Button onClick={requestPayout} disabled={requesting || !stats.canRequestPayout} className="w-full">
                {requesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Request payout — {money(stats.availableBalance)}
              </Button>
              {!stats.canRequestPayout && (
                <p className="mt-2 text-xs text-gray-400">
                  {affiliate.status !== "ACTIVE"
                    ? "Payouts unlock once your account is ACTIVE."
                    : !affiliate.payoutDetails
                      ? "Add payout details above to request a payout."
                      : stats.payoutsRequested > 0
                        ? "A payout request is already in progress."
                        : `Available balance must reach ${money(data.config.minPayout)}.`}
                </p>
              )}
            </div>
            {payouts.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                {payouts.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{fmtDate(p.createdAt)}</span>
                    <span className="font-medium text-gray-900">{money(p.amount)}</span>
                    {statusBadge(p.status)}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Commissions */}
      <Card className="border-0 bg-white shadow-soft">
        <CardHeader><CardTitle className="text-base">Commissions</CardTitle></CardHeader>
        <CardContent className="p-0">
          {commissions.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No commissions yet. They appear here when a referred business pays for a subscription.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Business</th>
                  <th className="px-4 py-2">Payment</th>
                  <th className="px-4 py-2">Rate</th>
                  <th className="px-4 py-2">Commission</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="px-4 py-3 text-gray-500">{fmtDate(c.createdAt)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{c.businessName || "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{money(c.basisAmount)}</td>
                    <td className="px-4 py-3 text-gray-500">{c.rateApplied}%</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{money(c.amount)}</td>
                    <td className="px-4 py-3">{statusBadge(c.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Affiliate;
