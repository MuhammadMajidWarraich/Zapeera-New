import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Search, Gift, Wallet, Copy, Check, Loader2, RefreshCw, Ban, Plus, ExternalLink, MonitorSmartphone } from "lucide-react";
import { apiService } from "@/services/api";
import { useAuth, getMembershipRole } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";

// Gift Cards & Wallet — staff page (Wave C9 — gap item 9, retail
// only). Three jobs in one place:
//   (1) Gift cards: sell a card at the counter (the issued code is
//       shown big for the receipt), look one up by code, list cards,
//       void one (OWNER/MANAGER/ADMIN). Redemption is NOT here — a
//       card is spent as tender on a POS sale (Gift Card method).
//   (2) eWallet: pick a customer, see the balance, top it up at the
//       counter, read the statement. Spending is tender on a POS sale
//       (eWallet method, needs the sale customer).
//   (3) Kiosk orders: the pending KIOSK-channel sales queue + the
//       public kiosk link per branch (/kiosk/<branchId>).
// Everything is gated server-side on the GIFT_CARD_KIOSK_PACK
// add-on; this page shows the gate state instead of failing blind.

const pkr = (n: number) => `PKR ${Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface GiftCardRow {
  id: string;
  code: string;
  balance: number;
  initialValue: number;
  status: string;
  recipientName: string | null;
  recipientPhone: string | null;
  expiresAt: string | null;
  createdAt: string;
  transactions?: Array<{ id: string; type: string; amount: number; balanceAfter: number; saleId: string | null; createdAt: string }>;
}

interface WalletRow {
  id: string;
  customerId: string;
  balance: number;
  customer: { id: string; name: string; phone: string };
}

interface KioskOrderRow {
  id: string;
  invoiceNumber?: string | null;
  totalAmount: number;
  paymentStatus: string;
  status: string;
  createdAt: string;
  customer?: { id: string; name: string; phone: string };
  branch: { id: string; name: string };
  items: Array<{ id: string; productId: string; quantity: number; unitPrice: number; totalPrice: number; product: { id: string; name: string } }>;
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  EXHAUSTED: "bg-slate-100 text-slate-600",
  EXPIRED: "bg-amber-50 text-amber-700",
  VOIDED: "bg-rose-50 text-rose-700",
};

/** Compact customer search-select (by name/phone) for the wallet tab. */
const CustomerPicker: React.FC<{
  value: { id: string; name: string; phone: string } | null;
  onChange: (c: { id: string; name: string; phone: string } | null) => void;
}> = ({ value, onChange }) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; name: string; phone: string }>>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (term: string) => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const response = await apiService.getCustomers({ page: 1, limit: 10, search: term });
      const customers = (response as any)?.data?.customers;
      setResults(
        Array.isArray(customers)
          ? customers.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone }))
          : []
      );
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(query.trim()), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runSearch]);

  if (value) {
    return (
      <div className="flex h-10 items-center gap-2 rounded-[10px] border bg-white px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {value.name} • {value.phone}
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQuery("");
            setOpen(true);
          }}
          className="text-xs font-bold text-[#1a52c5] hover:underline"
        >
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        placeholder="Search customer by name or phone…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-10 rounded-[10px] bg-white"
      />
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-48 overflow-y-auto rounded-[10px] border bg-white shadow-lg">
          {searching ? (
            <div className="px-3 py-2.5 text-xs text-[#8c95b0]">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-[#8c95b0]">No customers found — try a name or phone number.</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-[#f4f6fa]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              >
                {c.name} • {c.phone}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const GiftCards = () => {
  const { user } = useAuth();
  const role = getMembershipRole(user);
  const canVoid = ["OWNER", "MANAGER", "ADMIN"].includes(role);
  const { selectedBusinessId } = useAdmin();

  const [tab, setTab] = useState<"cards" | "wallet" | "kiosk">("cards");
  const [loading, setLoading] = useState(true);
  const [packEnabled, setPackEnabled] = useState(false);
  const [pricingPending, setPricingPending] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [copied, setCopied] = useState("");

  // Gift cards
  const [cards, setCards] = useState<GiftCardRow[]>([]);
  const [cardSearch, setCardSearch] = useState("");
  const [cardStatus, setCardStatus] = useState("");
  const [sellBranchId, setSellBranchId] = useState("");
  const [sellValue, setSellValue] = useState("");
  const [sellName, setSellName] = useState("");
  const [sellPhone, setSellPhone] = useState("");
  const [sellMethod, setSellMethod] = useState("CASH");
  const [sellBusy, setSellBusy] = useState(false);
  const [issued, setIssued] = useState<GiftCardRow | null>(null);
  const [lookupCode, setLookupCode] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<GiftCardRow | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  // Wallet
  const [walletCustomer, setWalletCustomer] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletExists, setWalletExists] = useState(false);
  const [walletTxns, setWalletTxns] = useState<Array<{ id: string; type: string; amount: number; balanceAfter: number; saleId: string | null; method: string | null; createdAt: string }>>([]);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpMethod, setTopUpMethod] = useState("CASH");
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [wallets, setWallets] = useState<WalletRow[]>([]);

  // Kiosk orders
  const [kioskOrders, setKioskOrders] = useState<KioskOrderRow[]>([]);

  const loadCards = useCallback(async () => {
    try {
      const res = await apiService.listGiftCards({ search: cardSearch.trim() || undefined, status: cardStatus || undefined, limit: 50 });
      if (res.success && res.data) setCards(res.data.giftCards || []);
    } catch {
      /* empty state */
    }
  }, [cardSearch, cardStatus]);

  const loadWallets = useCallback(async () => {
    try {
      const res = await apiService.listWallets({ limit: 50 });
      if (res.success && res.data) setWallets(res.data.wallets || []);
    } catch {
      /* empty state */
    }
  }, []);

  const loadKioskOrders = useCallback(async () => {
    try {
      const res = await apiService.getSales({ channel: "KIOSK", status: "PENDING", limit: 50 });
      if (res.success && res.data) setKioskOrders(((res.data as any).sales || []) as KioskOrderRow[]);
    } catch {
      /* empty state */
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const branchesRes = await apiService.getBranches();
      if (branchesRes.success && branchesRes.data) {
        const list = (branchesRes.data.branches || []).filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name }));
        setBranches(list);
        setSellBranchId((prev) => prev || list[0]?.id || "");
      }
      if (selectedBusinessId) {
        const [addonsRes, catalogueRes] = await Promise.all([
          apiService.getBusinessAddons(selectedBusinessId),
          apiService.getAddonCatalogue(),
        ]);
        if (addonsRes.success && addonsRes.data) setPackEnabled(!!addonsRes.data.limits?.giftCardKioskAllowed);
        if (catalogueRes.success && catalogueRes.data) {
          const entry = catalogueRes.data.find((a) => a.type === "GIFT_CARD_KIOSK_PACK");
          setPricingPending(!!entry?.pricingPending);
        }
      }
      await Promise.all([loadCards(), loadWallets(), loadKioskOrders()]);
    } catch {
      toast({ title: "Could not load gift cards", description: "Please refresh and try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, loadCards, loadWallets, loadKioskOrders]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const t = setTimeout(() => void loadCards(), 300);
    return () => clearTimeout(t);
  }, [cardSearch, cardStatus, loadCards]);

  const loadWalletDetail = useCallback(async (customerId: string) => {
    try {
      const [walletRes, txnsRes] = await Promise.all([
        apiService.getWallet(customerId),
        apiService.getWalletTransactions(customerId, { limit: 20 }),
      ]);
      if (walletRes.success && walletRes.data) {
        setWalletBalance(walletRes.data.balance);
        setWalletExists(walletRes.data.exists);
      }
      if (txnsRes.success && txnsRes.data) setWalletTxns(txnsRes.data.transactions || []);
    } catch {
      toast({ title: "Could not load the wallet", description: "Please try again.", variant: "destructive" });
    }
  }, []);

  useEffect(() => {
    if (walletCustomer) void loadWalletDetail(walletCustomer.id);
    else {
      setWalletBalance(null);
      setWalletTxns([]);
    }
  }, [walletCustomer, loadWalletDetail]);

  const sellCard = async () => {
    const value = Number(sellValue);
    if (!sellBranchId) {
      toast({ title: "Pick a branch", description: "A gift card is sold from a branch.", variant: "destructive" });
      return;
    }
    if (!(value > 0)) {
      toast({ title: "Enter a value", description: "The gift card value must be more than zero.", variant: "destructive" });
      return;
    }
    setSellBusy(true);
    try {
      const res = await apiService.purchaseGiftCard({
        branchId: sellBranchId,
        value,
        recipientName: sellName.trim() || undefined,
        recipientPhone: sellPhone.trim() || undefined,
        paymentMethod: sellMethod,
      });
      if (!res.success || !res.data) {
        toast({ title: "Could not sell the card", description: res.message || "Please try again.", variant: "destructive" });
        return;
      }
      setIssued(res.data as GiftCardRow);
      setSellValue("");
      setSellName("");
      setSellPhone("");
      toast({ title: "Gift card sold", description: `Code ${(res.data as GiftCardRow).code} — ${pkr(value)}.` });
      void loadCards();
    } finally {
      setSellBusy(false);
    }
  };

  const lookup = async () => {
    const code = lookupCode.trim();
    if (!code) return;
    setLookupBusy(true);
    try {
      const res = await apiService.lookupGiftCardByCode(code);
      if (!res.success || !res.data) {
        toast({ title: "Not found", description: res.message || "No gift card with this code in this business.", variant: "destructive" });
        setLookupResult(null);
        return;
      }
      setLookupResult(res.data as GiftCardRow);
    } finally {
      setLookupBusy(false);
    }
  };

  const voidCard = async (id: string) => {
    setVoidingId(id);
    try {
      const res = await apiService.voidGiftCard(id);
      if (!res.success) {
        toast({ title: "Could not void the card", description: res.message || "Please try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Gift card voided", description: "Any remaining balance was written off." });
      setLookupResult(null);
      void loadCards();
    } finally {
      setVoidingId(null);
    }
  };

  const topUp = async () => {
    if (!walletCustomer) return;
    const amount = Number(topUpAmount);
    if (!(amount > 0)) {
      toast({ title: "Enter an amount", description: "The top-up must be more than zero.", variant: "destructive" });
      return;
    }
    setTopUpBusy(true);
    try {
      const res = await apiService.topUpWallet(walletCustomer.id, { amount, method: topUpMethod });
      if (!res.success || !res.data) {
        toast({ title: "Top-up failed", description: res.message || "Please try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Wallet topped up", description: `New balance ${pkr(res.data.balanceAfter)}.` });
      setTopUpAmount("");
      void loadWalletDetail(walletCustomer.id);
      void loadWallets();
    } finally {
      setTopUpBusy(false);
    }
  };

  const copyLink = async (branchId: string) => {
    const url = `${window.location.origin}/kiosk/${branchId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(branchId);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      toast({ title: "Copy failed", description: url });
    }
  };

  const tabs = [
    { key: "cards" as const, label: "Gift Cards", icon: Gift },
    { key: "wallet" as const, label: "eWallet", icon: Wallet },
    { key: "kiosk" as const, label: `Kiosk Orders${kioskOrders.length > 0 ? ` (${kioskOrders.length})` : ""}`, icon: MonitorSmartphone },
  ];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Gift Cards &amp; Wallet</h1>
          <p className="text-sm text-muted-foreground">
            Sell gift cards, top up customer wallets, and work the self-ordering kiosk queue.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {!loading && !packEnabled && (
        <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Gift Cards, eWallet &amp; Kiosk is not enabled for this business.</strong>{" "}
          {pricingPending
            ? "The add-on has no price yet — it is being decided. Until then only backoffice activation can enable it."
            : "Enable the add-on to sell gift cards, top up wallets and open the kiosk."}
        </div>
      )}

      <div className="flex gap-2">
        {tabs.map(({ key, label, icon: Icon }) => (
          <Button key={key} variant={tab === key ? "default" : "outline"} size="sm" onClick={() => setTab(key)}>
            <Icon className="mr-2 h-4 w-4" /> {label}
          </Button>
        ))}
      </div>

      {tab === "cards" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4 rounded-[14px] border bg-white p-4">
            <h2 className="text-base font-bold">Sell a gift card</h2>
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <select
                value={sellBranchId}
                onChange={(e) => setSellBranchId(e.target.value)}
                className="h-10 w-full rounded-[10px] border bg-white px-3 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Value (PKR)</Label>
              <Input type="number" min="0" step="1" placeholder="e.g. 1000" value={sellValue} onChange={(e) => setSellValue(e.target.value)} className="h-10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Recipient name (optional)</Label>
                <Input placeholder="Who is it for?" value={sellName} onChange={(e) => setSellName(e.target.value)} className="h-10" />
              </div>
              <div className="space-y-1.5">
                <Label>Recipient phone (optional)</Label>
                <Input placeholder="03xx-xxxxxxx" value={sellPhone} onChange={(e) => setSellPhone(e.target.value)} className="h-10" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Paid by</Label>
              <div className="flex gap-1.5">
                {["CASH", "CARD", "JAZZCASH", "EASYPAISA"].map((m) => (
                  <Button key={m} size="sm" variant={sellMethod === m ? "default" : "outline"} onClick={() => setSellMethod(m)}>
                    {m === "EASYPAISA" ? "Easypaisa" : m.charAt(0) + m.slice(1).toLowerCase()}
                  </Button>
                ))}
              </div>
            </div>
            <Button onClick={() => void sellCard()} disabled={sellBusy || !packEnabled} className="w-full">
              {sellBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Sell gift card
            </Button>
            {issued && (
              <div className="rounded-[10px] bg-emerald-50 px-4 py-3 text-sm">
                <p className="font-bold text-emerald-800">Card issued — write this code on the card / receipt:</p>
                <p className="mt-1 font-mono text-xl font-extrabold tracking-wider text-emerald-900">{issued.code}</p>
                <p className="text-emerald-700">
                  {pkr(issued.balance)} • {issued.recipientName || "No recipient named"}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-[14px] border bg-white p-4">
            <h2 className="text-base font-bold">Look up a card</h2>
            <div className="flex gap-2">
              <Input placeholder="GC-XXXX-XXXX" value={lookupCode} onChange={(e) => setLookupCode(e.target.value.toUpperCase())} className="h-10 font-mono" />
              <Button onClick={() => void lookup()} disabled={lookupBusy || !lookupCode.trim()}>
                {lookupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            {lookupResult && (
              <div className="space-y-2 rounded-[10px] border bg-[#f8f9fc] p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold">{lookupResult.code}</span>
                  <Badge className={STATUS_BADGE[lookupResult.status] || ""}>{lookupResult.status}</Badge>
                </div>
                <p>
                  Balance <strong>{pkr(lookupResult.balance)}</strong> of {pkr(lookupResult.initialValue)}
                  {lookupResult.expiresAt ? ` • expires ${new Date(lookupResult.expiresAt).toLocaleDateString()}` : " • no expiry"}
                </p>
                {(lookupResult.transactions || []).length > 0 && (
                  <ul className="divide-y text-xs">
                    {(lookupResult.transactions || []).slice(0, 5).map((t) => (
                      <li key={t.id} className="flex justify-between py-1">
                        <span>
                          {t.type} • {new Date(t.createdAt).toLocaleString()}
                        </span>
                        <span className={t.amount < 0 ? "font-bold text-rose-600" : "font-bold text-emerald-700"}>
                          {t.amount < 0 ? "−" : "+"}
                          {pkr(Math.abs(t.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {canVoid && lookupResult.status !== "VOIDED" && (
                  <Button size="sm" variant="outline" className="text-rose-600" onClick={() => void voidCard(lookupResult.id)} disabled={voidingId === lookupResult.id}>
                    <Ban className="mr-2 h-4 w-4" /> Void this card
                  </Button>
                )}
              </div>
            )}
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input placeholder="Search code / recipient…" value={cardSearch} onChange={(e) => setCardSearch(e.target.value)} className="h-9" />
                <select value={cardStatus} onChange={(e) => setCardStatus(e.target.value)} className="h-9 rounded-[10px] border bg-white px-2 text-sm">
                  <option value="">All statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="EXHAUSTED">Exhausted</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="VOIDED">Voided</option>
                </select>
              </div>
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : cards.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No gift cards yet — sell the first one above.</p>
              ) : (
                <ul className="divide-y">
                  {cards.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-mono font-bold">{c.code}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.recipientName || c.recipientPhone || "No recipient"} • {new Date(c.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-bold tabular-nums">{pkr(c.balance)}</span>
                        <Badge className={STATUS_BADGE[c.status] || ""}>{c.status}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "wallet" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4 rounded-[14px] border bg-white p-4">
            <h2 className="text-base font-bold">Customer wallet</h2>
            <CustomerPicker value={walletCustomer} onChange={setWalletCustomer} />
            {walletCustomer && (
              <>
                <div className="rounded-[10px] bg-[#f8f9fc] px-4 py-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#8c95b0]">Balance</p>
                  <p className="text-2xl font-extrabold tabular-nums">{walletBalance === null ? "…" : pkr(walletBalance)}</p>
                  {!walletExists && <p className="text-xs text-muted-foreground">No wallet yet — the first top-up creates it.</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Top-up amount (PKR)</Label>
                  <Input type="number" min="0" step="1" placeholder="e.g. 500" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label>Paid by</Label>
                  <div className="flex gap-1.5">
                    {["CASH", "CARD", "JAZZCASH", "EASYPAISA"].map((m) => (
                      <Button key={m} size="sm" variant={topUpMethod === m ? "default" : "outline"} onClick={() => setTopUpMethod(m)}>
                        {m === "EASYPAISA" ? "Easypaisa" : m.charAt(0) + m.slice(1).toLowerCase()}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button onClick={() => void topUp()} disabled={topUpBusy || !packEnabled} className="w-full">
                  {topUpBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Top up wallet
                </Button>
                {walletTxns.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[#8c95b0]">Statement</p>
                    <ul className="divide-y text-sm">
                      {walletTxns.map((t) => (
                        <li key={t.id} className="flex justify-between gap-2 py-1.5">
                          <span>
                            {t.type}
                            {t.method ? ` • ${t.method}` : ""} • {new Date(t.createdAt).toLocaleDateString()}
                          </span>
                          <span className={t.amount < 0 ? "font-bold text-rose-600 tabular-nums" : "font-bold text-emerald-700 tabular-nums"}>
                            {t.amount < 0 ? "−" : "+"}
                            {pkr(Math.abs(t.amount))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="space-y-4 rounded-[14px] border bg-white p-4">
            <h2 className="text-base font-bold">All wallets</h2>
            {wallets.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No wallets yet — top up a customer to create one.</p>
            ) : (
              <ul className="divide-y">
                {wallets.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:bg-[#f8f9fc]"
                      onClick={() => setWalletCustomer({ id: w.customer.id, name: w.customer.name, phone: w.customer.phone })}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {w.customer.name} • {w.customer.phone}
                        </span>
                      </span>
                      <span className="shrink-0 font-bold tabular-nums">{pkr(w.balance)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "kiosk" && (
        <div className="space-y-4">
          <div className="rounded-[14px] border bg-white p-4">
            <h2 className="text-base font-bold">Kiosk links — one per branch</h2>
            <p className="text-sm text-muted-foreground">
              Open a link on the branch tablet to run the self-ordering screen. No login — customers browse and order, then pay at the counter.
            </p>
            <ul className="mt-3 space-y-2">
              {branches.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 rounded-[10px] border bg-[#f8f9fc] px-3 py-2 text-sm">
                  <span className="font-medium">{b.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="hidden font-mono text-xs text-muted-foreground sm:inline">/kiosk/{b.id}</span>
                    <Button size="sm" variant="outline" onClick={() => void copyLink(b.id)}>
                      {copied === b.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <a href={`/kiosk/${b.id}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md border bg-white px-2 text-xs font-bold">
                      <ExternalLink className="h-3.5 w-3.5" /> Open
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[14px] border bg-white p-4">
            <h2 className="text-base font-bold">Pending kiosk orders</h2>
            <p className="text-sm text-muted-foreground">Orders placed on a kiosk screen, waiting to be taken and paid at the counter.</p>
            {kioskOrders.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No pending kiosk orders.</p>
            ) : (
              <ul className="mt-3 divide-y">
                {kioskOrders.map((o) => (
                  <li key={o.id} className="py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{o.invoiceNumber || o.id.slice(-8)}</span>
                      <span className="font-bold tabular-nums">{pkr(o.totalAmount)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {o.branch?.name} • {new Date(o.createdAt).toLocaleString()}
                      {o.customer ? ` • ${o.customer.name} (${o.customer.phone})` : " • Walk-in"}
                    </p>
                    <ul className="mt-1 text-xs">
                      {(o.items || []).map((i) => (
                        <li key={i.id}>
                          {i.quantity} × {i.product?.name || i.productId} — {pkr(i.totalPrice)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default GiftCards;
