import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Search, Store, Copy, Check, Loader2, RefreshCw, Eye, CheckCircle2, XCircle, Plus, Trash2, ExternalLink } from "lucide-react";
import { apiService, type PrescriptionRecord, type PrescriptionItemPayload } from "@/services/api";
import { useAuth, getMembershipRole } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";

// Online Store — staff page (Wave C5 — gap item 5). Three jobs in one
// place: (1) the store's status + the public link per branch,
// (2) the online-orders queue (sales with channel ONLINE_STORE, still
// PENDING — cash on delivery, waiting to be accepted/fulfilled),
// (3) the pharmacist review queue for customer prescription uploads
// (PENDING + ONLINE_UPLOAD). Review transcribes the paper
// prescription's medicines and approves (or rejects) it — approval is
// what unblocks dispensing/checkout against that prescription.

const pkr = (n: number) => `PKR ${Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface OrderRow {
  id: string;
  invoiceNumber?: string | null;
  totalAmount: number;
  paymentStatus: string;
  status: string;
  createdAt: string;
  customer?: { id: string; name: string; phone: string };
  branch: { id: string; name: string };
  deliveryAddress?: string | null;
  deliveryPhone?: string | null;
  deliveryNotes?: string | null;
  items: Array<{ id: string; productId: string; quantity: number; unitPrice: number; totalPrice: number; product: { id: string; name: string } }>;
}

/** Compact product search-select for transcribing upload items. */
const Picker: React.FC<{
  value: { productId: string; productName: string };
  onChange: (productId: string, productName: string) => void;
}> = ({ value, onChange }) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; name: string }>>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (term: string) => {
    setSearching(true);
    try {
      const response = await apiService.getProducts({ page: 1, limit: 10, search: term } as any);
      const products = (response as any)?.data?.products;
      setResults(Array.isArray(products) ? products.map((p: any) => ({ id: p.id, name: p.name })) : []);
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
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open, runSearch]);

  if (value.productId) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-[10px] border bg-white px-2.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{value.productName}</span>
        <button type="button" onClick={() => { onChange("", ""); setQuery(""); setOpen(true); }} className="text-xs font-bold text-[#1a52c5] hover:underline">
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        placeholder="Search medicine…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-9 rounded-[10px] bg-white"
      />
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-48 overflow-y-auto rounded-[10px] border bg-white shadow-lg">
          {searching ? (
            <div className="px-3 py-2.5 text-xs text-[#8c95b0]">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-[#8c95b0]">No products found</div>
          ) : (
            results.map((product) => (
              <button
                key={product.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-[#f4f6fa]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(product.id, product.name); setOpen(false); }}
              >
                {product.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

interface TranscribeRow {
  productId: string;
  productName: string;
  quantity: string;
  dosage: string;
}

const OnlineStore = () => {
  const { user } = useAuth();
  const role = getMembershipRole(user);
  // NOTE: do not write `role === "ADMIN"` here — getMembershipRole's
  // return type narrows to OWNER | MANAGER | CASHIER, so a direct
  // === "ADMIN" comparison is a TS2367 error (the same latent error
  // already sits in Prescriptions.tsx's canManage line). includes()
  // on the role list typechecks and reads the same.
  const canReview = ["OWNER", "MANAGER", "ADMIN"].includes(role);
  const { selectedBusinessId } = useAdmin();

  const [loading, setLoading] = useState(true);
  const [storeEnabled, setStoreEnabled] = useState(false);
  const [pricingPending, setPricingPending] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [uploads, setUploads] = useState<PrescriptionRecord[]>([]);
  const [copied, setCopied] = useState("");

  const [reviewing, setReviewing] = useState<PrescriptionRecord | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [rows, setRows] = useState<TranscribeRow[]>([{ productId: "", productName: "", quantity: "1", dosage: "" }]);
  const [reviewingBusy, setReviewingBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [branchesRes, ordersRes, uploadsRes] = await Promise.all([
        apiService.getBranches(),
        apiService.getSales({ channel: "ONLINE_STORE", status: "PENDING", limit: 50 }),
        apiService.getPrescriptions({ reviewStatus: "PENDING", source: "ONLINE_UPLOAD", limit: 50 }),
      ]);
      if (branchesRes.success && branchesRes.data) {
        setBranches((branchesRes.data.branches || []).filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name })));
      }
      if (ordersRes.success && ordersRes.data) setOrders((ordersRes.data as any).sales || []);
      if (uploadsRes.success && uploadsRes.data) setUploads(uploadsRes.data);
      if (selectedBusinessId) {
        const [addonsRes, catalogueRes] = await Promise.all([
          apiService.getBusinessAddons(selectedBusinessId),
          apiService.getAddonCatalogue(),
        ]);
        if (addonsRes.success && addonsRes.data) setStoreEnabled(!!addonsRes.data.limits?.onlineStoreAllowed);
        if (catalogueRes.success && catalogueRes.data) {
          const entry = catalogueRes.data.find((a) => a.type === "ONLINE_STORE_PACK");
          setPricingPending(!!entry?.pricingPending);
        }
      }
    } catch {
      // errors surface per-section as empty states; toast once
      toast({ title: "Could not load the online store", description: "Please refresh and try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const copyLink = async (branchId: string) => {
    const url = `${window.location.origin}/store/${branchId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(branchId);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      toast({ title: "Copy failed", description: url });
    }
  };

  const openReview = (record: PrescriptionRecord) => {
    setReviewing(record);
    setReviewNote("");
    setRows(
      (record.items || []).length > 0
        ? record.items!.map((i) => ({ productId: i.productId, productName: i.productName, quantity: String(i.quantity), dosage: i.dosage || "" }))
        : [{ productId: "", productName: "", quantity: "1", dosage: "" }]
    );
  };

  const submitReview = async (decision: "REVIEWED" | "REJECTED") => {
    if (!reviewing) return;
    if (decision === "REVIEWED") {
      const items: PrescriptionItemPayload[] = rows
        .filter((r) => r.productId && Number(r.quantity) > 0)
        .map((r) => ({ productId: r.productId, quantity: Number(r.quantity), dosage: r.dosage.trim() || null }));
      if (items.length === 0) {
        toast({ title: "Transcribe the medicines first", description: "An approval needs at least one medicine line from the photo.", variant: "destructive" });
        return;
      }
      setReviewingBusy(true);
      try {
        const res = await apiService.reviewPrescription(reviewing.id, { decision, note: reviewNote.trim() || null, items });
        if (!res.success) {
          toast({ title: "Review failed", description: res.message || "Please try again.", variant: "destructive" });
          return;
        }
        toast({ title: "Prescription approved", description: "The patient can now check out with it." });
      } finally {
        setReviewingBusy(false);
      }
    } else {
      setReviewingBusy(true);
      try {
        const res = await apiService.reviewPrescription(reviewing.id, { decision, note: reviewNote.trim() || null });
        if (!res.success) {
          toast({ title: "Review failed", description: res.message || "Please try again.", variant: "destructive" });
          return;
        }
        toast({ title: "Prescription rejected", description: "The patient will see your note on the storefront." });
      } finally {
        setReviewingBusy(false);
      }
    }
    setReviewing(null);
    void loadAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[#0a1128]"><Store className="h-6 w-6" /> Online Store</h1>
          <p className="text-sm text-[#5b6b8c]">Your public pharmacy storefront, online orders and prescription reviews.</p>
        </div>
        <Button variant="outline" onClick={() => void loadAll()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <section className="rounded-[10px] border bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-[#0a1128]">Storefront status</h2>
          {storeEnabled ? (
            <Badge className="bg-[#e8f5e9] text-[#1b7a2e] hover:bg-[#e8f5e9]">Enabled</Badge>
          ) : (
            <Badge variant="outline">Not enabled</Badge>
          )}
        </div>
        {storeEnabled ? (
          <p className="mt-1 text-sm text-[#5b6b8c]">Customers can browse, order (cash on delivery) and upload prescriptions from these links — one per branch:</p>
        ) : (
          <p className="mt-1 text-sm text-[#5b6b8c]">
            The storefront is gated on the Online Pharmacy Store add-on (ONLINE_STORE_PACK).
            {pricingPending ? " Its price is not set yet, so it cannot be bought from the add-ons page — ask the backoffice to activate it, or wait for the price to be set." : " Enable it from the add-ons page to open the store."}
          </p>
        )}
        <div className="mt-3 space-y-2">
          {branches.map((b) => {
            const url = `${window.location.origin}/store/${b.id}`;
            return (
              <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.name}</span>
                <span className="hidden truncate font-mono text-xs text-[#5b6b8c] md:block">{url}</span>
                <Button size="sm" variant="outline" onClick={() => void copyLink(b.id)}>
                  {copied === b.id ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
                  {copied === b.id ? "Copied" : "Copy link"}
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
                </Button>
              </div>
            );
          })}
          {branches.length === 0 ? <p className="text-sm text-[#5b6b8c]">No active branches yet.</p> : null}
        </div>
      </section>

      <section className="rounded-[10px] border bg-white p-4">
        <h2 className="text-base font-bold text-[#0a1128]">Online orders waiting ({orders.length})</h2>
        <p className="mt-1 text-sm text-[#5b6b8c]">Cash-on-delivery orders placed on the storefront. They are real sales (status PENDING) — fulfil them from the sales/invoices flow.</p>
        {orders.length === 0 ? (
          <p className="mt-3 text-sm text-[#5b6b8c]">No pending online orders.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {orders.map((o) => (
              <div key={o.id} className="rounded-[10px] border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-bold">{o.invoiceNumber || o.id.slice(0, 8)}</span>
                  <span className="text-[#5b6b8c]">{new Date(o.createdAt).toLocaleString()}</span>
                  <span className="font-bold">{pkr(o.totalAmount)}</span>
                </div>
                <p className="mt-1 text-sm text-[#5b6b8c]">
                  {o.customer?.name || "Guest"} {o.deliveryPhone ? `· ${o.deliveryPhone}` : ""} · {o.branch.name}
                  {o.deliveryAddress ? ` · ${o.deliveryAddress}` : " · Pickup"}
                </p>
                <p className="mt-1 text-sm">{o.items.map((i) => `${i.product?.name || i.productId} × ${i.quantity}`).join(", ")}</p>
                {o.deliveryNotes ? <p className="mt-1 text-xs text-[#5b6b8c]">Note: {o.deliveryNotes}</p> : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[10px] border bg-white p-4">
        <h2 className="text-base font-bold text-[#0a1128]">Prescription uploads waiting for review ({uploads.length})</h2>
        <p className="mt-1 text-sm text-[#5b6b8c]">Patients cannot check out with these until a pharmacist approves them. Approval needs the medicines transcribed from the photo.</p>
        {uploads.length === 0 ? (
          <p className="mt-3 text-sm text-[#5b6b8c]">No uploads waiting.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {uploads.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{u.patientName} {u.patientPhone ? `· ${u.patientPhone}` : ""}</p>
                  <p className="text-xs text-[#5b6b8c]">
                    {u.doctorName ? `Dr ${u.doctorName} · ` : ""}Uploaded {new Date(u.createdAt).toLocaleString()}
                  </p>
                </div>
                <Button size="sm" disabled={!canReview} onClick={() => openReview(u)}>
                  <Eye className="mr-1 h-4 w-4" /> Review
                </Button>
              </div>
            ))}
          </div>
        )}
        {!canReview ? <p className="mt-2 text-xs text-[#5b6b8c]">Review needs an OWNER, MANAGER or ADMIN role.</p> : null}
      </section>

      <Dialog open={!!reviewing} onOpenChange={(open) => { if (!open) setReviewing(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review prescription upload</DialogTitle>
            <DialogDescription>
              {reviewing ? `${reviewing.patientName}${reviewing.patientPhone ? ` · ${reviewing.patientPhone}` : ""}${reviewing.doctorName ? ` · Dr ${reviewing.doctorName}` : ""}` : ""}
            </DialogDescription>
          </DialogHeader>
          {reviewing ? (
            <div className="space-y-4">
              {reviewing.imageUrl ? (
                <img src={reviewing.imageUrl} alt="Uploaded prescription" className="max-h-72 w-full rounded-[10px] border object-contain" />
              ) : (
                <p className="text-sm text-[#5b6b8c]">No photo attached to this upload.</p>
              )}
              <div>
                <Label>Medicines on the prescription (transcribe from the photo)</Label>
                <div className="mt-2 space-y-2">
                  {rows.map((row, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[200px] flex-1">
                        <Picker
                          value={{ productId: row.productId, productName: row.productName }}
                          onChange={(productId, productName) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, productId, productName } : r)))}
                        />
                      </div>
                      <Input
                        type="number" min={1} value={row.quantity}
                        onChange={(e) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))}
                        className="w-20" placeholder="Qty"
                      />
                      <Input
                        value={row.dosage}
                        onChange={(e) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, dosage: e.target.value } : r)))}
                        className="w-28" placeholder="Dosage 1+0+1"
                      />
                      <Button size="sm" variant="ghost" onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))} disabled={rows.length <= 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setRows((prev) => [...prev, { productId: "", productName: "", quantity: "1", dosage: "" }])}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add medicine
                  </Button>
                </div>
              </div>
              <div>
                <Label>Note to the patient (shown on the storefront)</Label>
                <Textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Optional — e.g. why it was rejected" className="mt-1" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={reviewingBusy} onClick={() => void submitReview("REVIEWED")}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                </Button>
                <Button variant="destructive" disabled={reviewingBusy} onClick={() => void submitReview("REJECTED")}>
                  <XCircle className="mr-1 h-4 w-4" /> Reject
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <div className="flex items-center gap-2 text-sm text-[#5b6b8c]">
        <Search className="h-4 w-4" />
        <span>Full prescription register (including reviewed uploads) lives on the Prescriptions page.</span>
      </div>
    </div>
  );
};

export default OnlineStore;
