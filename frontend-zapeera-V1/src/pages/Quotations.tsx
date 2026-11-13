import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { FileText, Loader2, Plus, RefreshCw, Search, Trash2, ArrowLeft, Send, Check, X, ShoppingCart } from "lucide-react";
import { apiService } from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";

// Quotations / estimates (v1.0.22): a pre-sale document — price a
// cart for a customer, send it, and convert it into a real sale when
// they accept. A quotation never touches stock; conversion goes
// through the normal sale-creation path, so the converted invoice is
// a real sale like any other. Totals are computed by the server (tax
// included); the editor shows a lines-only estimate and says so.

interface QuotationLine {
  id?: string;
  productId: string;
  product?: { id: string; name: string; sku?: string | null } | null;
  variantName?: string | null;
  quantity: number;
  unitLevel?: string | null;
  unitFactor?: number | null;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  totalPrice: number;
}

interface Quotation {
  id: string;
  quotationNumber: string;
  status: string;
  branchId: string;
  customerId?: string | null;
  validUntil?: string | null;
  subtotal: number;
  discountAmount: number;
  discountPercentage?: number | null;
  taxAmount: number;
  totalAmount: number;
  notes?: string | null;
  sentAt?: string | null;
  convertedSaleId?: string | null;
  createdAt: string;
  branch?: { id: string; name: string } | null;
  customer?: { id: string; name: string; phone?: string | null } | null;
  lines: QuotationLine[];
}

interface BranchOption { id: string; name: string }
interface ProductOption {
  id: string;
  name: string;
  sku?: string | null;
  sellingPrice: number;
  unitsPerPack?: number | null;
  unitsPerStrip?: number | null;
  unitType?: string | null;
}
interface CustomerOption { id: string; name: string; phone?: string | null }

interface EditorLine {
  key: string;
  productId: string;
  productName: string;
  quantity: string;
  unitLevel: string;
  unitPrice: string;
  discountAmount: string;
}

const STATUS_FILTERS = ["", "DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"];
const UNIT_LEVELS = ["", "PACK", "STRIP", "UNIT"];
const PAYMENT_METHODS = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "MOBILE"];

const formatPKR = (v: number) => `PKR ${Number(v || 0).toFixed(2)}`;
const formatDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

const statusBadge = (status: string) => {
  const styles: Record<string, string> = {
    DRAFT: "border-slate-200 bg-slate-50 text-slate-700",
    SENT: "border-blue-200 bg-blue-50 text-blue-700",
    ACCEPTED: "border-green-200 bg-green-50 text-green-700",
    REJECTED: "border-red-200 bg-red-50 text-red-700",
    EXPIRED: "border-amber-200 bg-amber-50 text-amber-700",
    CONVERTED: "border-violet-200 bg-violet-50 text-violet-700",
  };
  return <Badge variant="outline" className={styles[status] || styles.DRAFT}>{status}</Badge>;
};

let lineKeyCounter = 0;
const newEditorLine = (product?: ProductOption): EditorLine => ({
  key: `line-${Date.now()}-${lineKeyCounter++}`,
  productId: product?.id || "",
  productName: product?.name || "",
  quantity: "1",
  unitLevel: "",
  unitPrice: product ? String(product.sellingPrice ?? "") : "",
  discountAmount: "",
});

const Quotations: React.FC = () => {
  const { selectedBranchId, selectedCompanyId } = useAdmin();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [view, setView] = useState<"list" | "editor" | "detail">("list");
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [detail, setDetail] = useState<Quotation | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isActing, setIsActing] = useState(false);

  // Editor state
  const [editorBranchId, setEditorBranchId] = useState("");
  const [editorCustomerId, setEditorCustomerId] = useState("");
  const [editorValidUntil, setEditorValidUntil] = useState("");
  const [editorNotes, setEditorNotes] = useState("");
  const [editorDiscountPercentage, setEditorDiscountPercentage] = useState("");
  const [editorDiscountAmount, setEditorDiscountAmount] = useState("");
  const [editorLines, setEditorLines] = useState<EditorLine[]>([newEditorLine()]);
  const [isSaving, setIsSaving] = useState(false);

  // Product + customer pickers
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<ProductOption[]>([]);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [customerName, setCustomerName] = useState("");
  const productSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customerSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Convert dialog state
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertPaymentMethod, setConvertPaymentMethod] = useState("CASH");
  const [convertPaidAmount, setConvertPaidAmount] = useState("");
  const [convertPaymentStatus, setConvertPaymentStatus] = useState("COMPLETED");
  const [isConverting, setIsConverting] = useState(false);

  const loadQuotations = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiService.getQuotations({
        branchId: selectedBranchId || undefined,
        status: statusFilter || undefined,
        search: search.trim() || undefined,
        page,
        limit: 25,
      });
      if (response.success && response.data) {
        setQuotations(response.data as Quotation[]);
        setTotalPages(response.pagination?.pages || 1);
      }
    } catch {
      toast({ title: "Error", description: "Failed to load quotations", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [selectedBranchId, statusFilter, search, page]);

  useEffect(() => { loadQuotations(); }, [loadQuotations]);

  useEffect(() => {
    (async () => {
      try {
        const response = await apiService.getBranches();
        if (response.success) {
          const list = ((response.data as any)?.branches || response.data || []) as any[];
          const options = list.map((b: any) => ({ id: b.id, name: b.name })).filter((b: BranchOption) => b.id);
          setBranches(options);
          if (!editorBranchId && options.length > 0) {
            setEditorBranchId(selectedBranchId || options[0].id);
          }
        }
      } catch {
        // Branch picker stays empty; saving reports the problem.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId]);

  useEffect(() => {
    if (selectedBranchId) setEditorBranchId(selectedBranchId);
  }, [selectedBranchId]);

  const searchProducts = useCallback((term: string) => {
    if (productSearchTimer.current) clearTimeout(productSearchTimer.current);
    if (!term.trim()) { setProductResults([]); return; }
    productSearchTimer.current = setTimeout(async () => {
      setIsSearchingProducts(true);
      try {
        const response = await apiService.getProducts({ search: term.trim(), limit: 8, branchId: editorBranchId || undefined });
        if (response.success && response.data) {
          const list = ((response.data as any)?.products || []) as any[];
          setProductResults(list.map((p: any) => ({
            id: p.id, name: p.name, sku: p.sku || null,
            sellingPrice: Number(p.sellingPrice || 0),
            unitsPerPack: p.unitsPerPack ?? null, unitsPerStrip: p.unitsPerStrip ?? null,
            unitType: p.unitType ?? null,
          })));
        }
      } catch {
        setProductResults([]);
      } finally {
        setIsSearchingProducts(false);
      }
    }, 300);
  }, [editorBranchId]);

  const searchCustomers = useCallback((term: string) => {
    if (customerSearchTimer.current) clearTimeout(customerSearchTimer.current);
    if (!term.trim()) { setCustomerResults([]); return; }
    customerSearchTimer.current = setTimeout(async () => {
      try {
        const response = await apiService.getCustomers({ search: term.trim(), limit: 8 });
        if (response.success && response.data) {
          const list = ((response.data as any)?.customers || []) as any[];
          setCustomerResults(list.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone || null })));
        }
      } catch {
        setCustomerResults([]);
      }
    }, 300);
  }, []);

  const editorEstimate = useMemo(() => {
    const lineTotals = editorLines.map((l) => {
      const qty = parseFloat(l.quantity) || 0;
      const price = parseFloat(l.unitPrice) || 0;
      const discount = Math.min(Math.max(0, parseFloat(l.discountAmount) || 0), qty * price);
      return Math.max(0, qty * price - discount);
    });
    const subtotal = lineTotals.reduce((s, t) => s + t, 0);
    const pct = parseFloat(editorDiscountPercentage) || 0;
    const discount = pct > 0
      ? (subtotal * pct) / 100
      : Math.min(Math.max(0, parseFloat(editorDiscountAmount) || 0), subtotal);
    return { subtotal, discount, estimate: Math.max(0, subtotal - discount) };
  }, [editorLines, editorDiscountPercentage, editorDiscountAmount]);

  const openNewEditor = () => {
    setEditing(null);
    setEditorCustomerId("");
    setCustomerName("");
    setCustomerSearch("");
    setEditorValidUntil("");
    setEditorNotes("");
    setEditorDiscountPercentage("");
    setEditorDiscountAmount("");
    setEditorLines([newEditorLine()]);
    setView("editor");
  };

  const openEditEditor = (q: Quotation) => {
    setEditing(q);
    setEditorBranchId(q.branchId);
    setEditorCustomerId(q.customerId || "");
    setCustomerName(q.customer?.name || "");
    setCustomerSearch("");
    setEditorValidUntil(q.validUntil ? q.validUntil.slice(0, 10) : "");
    setEditorNotes(q.notes || "");
    setEditorDiscountPercentage(q.discountPercentage ? String(q.discountPercentage) : "");
    setEditorDiscountAmount(q.discountPercentage ? "" : String(q.discountAmount || ""));
    setEditorLines(q.lines.map((l) => ({
      key: `line-${l.id || Math.random()}`,
      productId: l.productId,
      productName: l.product?.name || "",
      quantity: l.unitLevel && l.unitFactor ? String(l.quantity / l.unitFactor) : String(l.quantity),
      unitLevel: l.unitLevel || "",
      unitPrice: String(l.unitPrice),
      discountAmount: l.discountAmount ? String(l.discountAmount) : "",
    })));
    setView("editor");
  };

  const openDetail = async (id: string) => {
    setIsDetailLoading(true);
    try {
      const response = await apiService.getQuotation(id);
      if (response.success && response.data) {
        setDetail(response.data as Quotation);
        setView("detail");
      } else {
        toast({ title: "Error", description: response.message || "Quotation not found", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to load the quotation", variant: "destructive" });
    } finally {
      setIsDetailLoading(false);
    }
  };

  const validateEditor = (): string | null => {
    if (!editorBranchId) return "Pick a branch for this quotation.";
    if (editorLines.length === 0) return "Add at least one line.";
    for (const line of editorLines) {
      if (!line.productId) return "Every line needs a product — pick one from the search.";
      const qty = parseFloat(line.quantity);
      if (!qty || qty <= 0) return "Every line needs a quantity greater than zero.";
      if (!line.unitLevel && !Number.isInteger(qty)) return "Without a selling level, quantities must be whole numbers.";
      const price = parseFloat(line.unitPrice);
      if (!price || price <= 0) return "Every line needs a unit price greater than zero.";
    }
    const pct = parseFloat(editorDiscountPercentage);
    if (editorDiscountPercentage && (Number.isNaN(pct) || pct < 0 || pct > 100)) return "Discount percentage must be between 0 and 100.";
    return null;
  };

  const handleSave = async () => {
    const problem = validateEditor();
    if (problem) {
      toast({ title: "Check the quotation", description: problem, variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        branchId: editorBranchId,
        customerId: editorCustomerId || null,
        validUntil: editorValidUntil || null,
        notes: editorNotes.trim() || null,
        discountPercentage: editorDiscountPercentage ? parseFloat(editorDiscountPercentage) : null,
        discountAmount: editorDiscountPercentage ? null : (editorDiscountAmount ? parseFloat(editorDiscountAmount) : null),
        lines: editorLines.map((l) => ({
          productId: l.productId,
          quantity: parseFloat(l.quantity),
          unitLevel: l.unitLevel || undefined,
          unitPrice: parseFloat(l.unitPrice),
          discountAmount: l.discountAmount ? parseFloat(l.discountAmount) : 0,
        })),
      };
      const response = editing
        ? await apiService.updateQuotation(editing.id, payload)
        : await apiService.createQuotation(payload);
      if (response.success && response.data) {
        toast({ title: editing ? "Quotation updated" : "Quotation created", description: `${(response.data as Quotation).quotationNumber} — total ${formatPKR((response.data as Quotation).totalAmount)} including tax.` });
        setView("list");
        loadQuotations();
      } else {
        toast({ title: "Could not save the quotation", description: response.message || "Please check the values and try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not save the quotation", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAction = async (id: string, action: "mark-sent" | "accept" | "reject") => {
    setIsActing(true);
    try {
      const response = action === "mark-sent"
        ? await apiService.markQuotationSent(id)
        : action === "accept"
          ? await apiService.acceptQuotation(id)
          : await apiService.rejectQuotation(id);
      if (response.success) {
        toast({ title: "Quotation updated", description: `Status is now ${(response.data as Quotation).status}.` });
        if (view === "detail") openDetail(id);
        loadQuotations();
      } else {
        toast({ title: "Could not update the quotation", description: response.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not update the quotation", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsActing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    setIsDeleting(true);
    try {
      const response = await apiService.deleteQuotation(confirmDeleteId);
      if (response.success) {
        toast({ title: "Quotation deleted" });
        setConfirmDeleteId(null);
        if (view === "detail") setView("list");
        loadQuotations();
      } else {
        toast({ title: "Could not delete the quotation", description: response.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not delete the quotation", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const openConvert = (q: Quotation) => {
    setDetail(q);
    setConvertPaymentMethod("CASH");
    setConvertPaidAmount(String(q.totalAmount));
    setConvertPaymentStatus("COMPLETED");
    setConvertOpen(true);
  };

  const handleConvert = async () => {
    if (!detail) return;
    setIsConverting(true);
    try {
      const response = await apiService.convertQuotation(detail.id, {
        paymentMethod: convertPaymentMethod,
        paidAmount: convertPaidAmount ? parseFloat(convertPaidAmount) : 0,
        paymentStatus: convertPaymentStatus,
      });
      if (response.success && response.data) {
        const sale = (response.data as any).sale;
        toast({ title: "Quotation converted to a sale", description: sale?.invoiceNumber ? `Invoice ${sale.invoiceNumber} created.` : "Sale created." });
        setConvertOpen(false);
        setView("list");
        loadQuotations();
      } else {
        toast({ title: "Could not convert the quotation", description: response.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not convert the quotation", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsConverting(false);
    }
  };

  const addProductLine = (product: ProductOption) => {
    setEditorLines((prev) => {
      const empty = prev.find((l) => !l.productId);
      const line = newEditorLine(product);
      if (empty) return prev.map((l) => (l.key === empty.key ? { ...line, key: l.key } : l));
      return [...prev, line];
    });
    setProductSearch("");
    setProductResults([]);
  };

  const setLine = (key: string, patch: Partial<EditorLine>) => {
    setEditorLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const canEdit = (q: Quotation) => q.status === "DRAFT" || q.status === "SENT";
  const canConvert = (q: Quotation) => q.status === "DRAFT" || q.status === "SENT" || q.status === "ACCEPTED";

  if (view === "editor") {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setView("list")} title="Back to quotations">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{editing ? `Edit ${editing.quotationNumber}` : "New Quotation"}</h1>
              <p className="text-sm text-muted-foreground">Price a cart for a customer. Tax is computed on save — the estimate below is lines only.</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Create quotation"}
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Branch</label>
              <Select value={editorBranchId} onValueChange={setEditorBranchId}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Customer (optional)</label>
              <div className="relative">
                <Input
                  placeholder="Search customers by name or phone…"
                  value={customerSearch}
                  onChange={(e) => { setCustomerSearch(e.target.value); searchCustomers(e.target.value); }}
                />
                {customerResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg">
                    {customerResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => { setEditorCustomerId(c.id); setCustomerName(c.name); setCustomerSearch(""); setCustomerResults([]); }}
                      >
                        {c.name}{c.phone ? ` — ${c.phone}` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {editorCustomerId && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Selected: <span className="font-medium text-foreground">{customerName}</span>{" "}
                  <button type="button" className="text-xs font-bold text-red-500 hover:underline" onClick={() => { setEditorCustomerId(""); setCustomerName(""); }}>Clear</button>
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Valid until (optional)</label>
              <Input type="date" value={editorValidUntil} onChange={(e) => setEditorValidUntil(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">Past the validity date, an open quotation reads as EXPIRED.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Notes (optional)</label>
              <Input value={editorNotes} onChange={(e) => setEditorNotes(e.target.value)} placeholder="e.g. Delivery within 3 days" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Discount % (optional)</label>
              <Input type="number" min="0" max="100" step="0.01" value={editorDiscountPercentage} onChange={(e) => setEditorDiscountPercentage(e.target.value)} placeholder="0" />
              <p className="mt-1 text-xs text-muted-foreground">A percentage takes precedence over a flat amount, as on sales.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Discount amount PKR (optional)</label>
              <Input type="number" min="0" step="0.01" value={editorDiscountAmount} onChange={(e) => setEditorDiscountAmount(e.target.value)} placeholder="0" disabled={!!editorDiscountPercentage} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Lines</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search products to add a line…"
                value={productSearch}
                onChange={(e) => { setProductSearch(e.target.value); searchProducts(e.target.value); }}
              />
              {isSearchingProducts && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
              {productResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg">
                  {productResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                      onClick={() => addProductLine(p)}
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground"> — {formatPKR(p.sellingPrice)}{p.sku ? ` · ${p.sku}` : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {editorLines.map((line) => (
              <div key={line.key} className="grid items-end gap-3 rounded-lg border p-3 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Product</label>
                  <Input value={line.productName} disabled placeholder="Pick a product from the search above" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Qty</label>
                  <Input
                    type="number" min="0" step="any"
                    value={line.quantity}
                    onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Selling level</label>
                  <Select value={line.unitLevel || "none"} onValueChange={(v) => setLine(line.key, { unitLevel: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Whole units</SelectItem>
                      {UNIT_LEVELS.filter(Boolean).map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Unit price PKR</label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => setLine(line.key, { unitPrice: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Line discount PKR</label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={line.discountAmount}
                    onChange={(e) => setLine(line.key, { discountAmount: e.target.value })}
                  />
                </div>
                <Button variant="outline" size="icon" onClick={() => setEditorLines((prev) => prev.filter((l) => l.key !== line.key))} disabled={editorLines.length <= 1} title="Remove line">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" onClick={() => setEditorLines((prev) => [...prev, newEditorLine()])}>
              <Plus className="mr-2 h-4 w-4" /> Add line
            </Button>

            <div className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Lines subtotal</span><span>{formatPKR(editorEstimate.subtotal)}</span></div>
              {editorEstimate.discount > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="text-emerald-600">−{formatPKR(editorEstimate.discount)}</span></div>
              )}
              <div className="flex justify-between font-bold"><span>Estimate (before tax)</span><span>{formatPKR(editorEstimate.estimate)}</span></div>
              <p className="text-xs text-muted-foreground">Tax is computed by the server on save, from the same tax rules as sales — the saved quotation shows the final total.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (view === "detail" && detail) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setView("list")} title="Back to quotations">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold">{detail.quotationNumber} {statusBadge(detail.status)}</h1>
              <p className="text-sm text-muted-foreground">
                {detail.branch?.name || "—"} · {detail.customer ? `${detail.customer.name}${detail.customer.phone ? ` — ${detail.customer.phone}` : ""}` : "Walk-in"} · Created {formatDate(detail.createdAt)}
                {detail.validUntil ? ` · Valid until ${formatDate(detail.validUntil)}` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit(detail) && <Button variant="outline" onClick={() => openEditEditor(detail)}>Edit</Button>}
            {detail.status === "DRAFT" && <Button variant="outline" onClick={() => handleAction(detail.id, "mark-sent")} disabled={isActing}><Send className="mr-2 h-4 w-4" /> Mark sent</Button>}
            {detail.status === "SENT" && (
              <>
                <Button variant="outline" onClick={() => handleAction(detail.id, "accept")} disabled={isActing}><Check className="mr-2 h-4 w-4" /> Accept</Button>
                <Button variant="outline" onClick={() => handleAction(detail.id, "reject")} disabled={isActing}><X className="mr-2 h-4 w-4" /> Reject</Button>
              </>
            )}
            {canConvert(detail) && <Button onClick={() => openConvert(detail)}><ShoppingCart className="mr-2 h-4 w-4" /> Convert to sale</Button>}
            {detail.status !== "CONVERTED" && (
              <Button variant="outline" onClick={() => setConfirmDeleteId(detail.id)} className="text-red-600"><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
            )}
          </div>
        </div>

        {isDetailLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-2">
                {(detail.lines || []).map((l) => (
                  <div key={l.id || `${l.productId}-${l.unitPrice}`} className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0">
                    <div>
                      <p className="font-medium">{l.product?.name || "Product"}{l.variantName ? ` (${l.variantName})` : ""}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.unitLevel ? `${l.quantity / (l.unitFactor || 1)} ${l.unitLevel} (${l.quantity} units)` : `${l.quantity} units`}
                        {" × "}{formatPKR(l.unitPrice)}
                        {l.discountAmount > 0 && ` · Discount ${formatPKR(l.discountAmount)}`}
                        {l.taxAmount > 0 && ` · Tax ${formatPKR(l.taxAmount)}`}
                      </p>
                    </div>
                    <span className="font-semibold">{formatPKR(l.totalPrice)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-1 border-t pt-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatPKR(detail.subtotal)}</span></div>
                {detail.discountAmount > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Discount{detail.discountPercentage ? ` (${detail.discountPercentage}%)` : ""}</span><span className="text-emerald-600">−{formatPKR(detail.discountAmount)}</span></div>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{formatPKR(detail.taxAmount)}</span></div>
                <div className="flex justify-between text-base font-bold"><span>Total</span><span>{formatPKR(detail.totalAmount)}</span></div>
              </div>
              {detail.notes && <p className="mt-4 text-sm text-muted-foreground">Notes: {detail.notes}</p>}
              {detail.convertedSaleId && (
                <p className="mt-4 rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-700">Converted to a sale — sale record {detail.convertedSaleId}.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Quotations</h1>
            <p className="text-sm text-muted-foreground">Estimates that convert into real sales. Quotations never touch stock until converted.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={loadQuotations} disabled={isLoading} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={openNewEditor}><Plus className="mr-2 h-4 w-4" /> New quotation</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by number or customer…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={statusFilter || "all"} onValueChange={(v) => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_FILTERS.filter(Boolean).map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : quotations.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No quotations found. Create one to price a cart for a customer.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {quotations.map((q) => (
            <Card key={q.id} className="cursor-pointer hover:shadow-md" onClick={() => openDetail(q.id)}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="flex items-center gap-2 font-bold">{q.quotationNumber} {statusBadge(q.status)}</p>
                  <p className="text-sm text-muted-foreground">
                    {q.branch?.name || "—"} · {q.customer?.name || "Walk-in"} · {q.lines?.length || 0} line(s) · {formatDate(q.createdAt)}
                    {q.validUntil ? ` · Valid until ${formatDate(q.validUntil)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold">{formatPKR(q.totalAmount)}</span>
                  {canConvert(q) && (
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); openConvert(q); }}>
                      <ShoppingCart className="mr-2 h-4 w-4" /> Convert
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this quotation?</AlertDialogTitle>
            <AlertDialogDescription>Converted quotations cannot be deleted. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-red-600 hover:bg-red-700">
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={convertOpen} onOpenChange={setConvertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert {detail?.quotationNumber} to a sale</AlertDialogTitle>
            <AlertDialogDescription>
              The quotation becomes a real sale through the normal sale path — stock is deducted and an invoice is created. The quotation is marked CONVERTED and can never be converted twice.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Payment method</label>
              <Select value={convertPaymentMethod} onValueChange={setConvertPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Amount paid PKR</label>
              <Input type="number" min="0" step="0.01" value={convertPaidAmount} onChange={(e) => setConvertPaidAmount(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">Quotation total: {detail ? formatPKR(detail.totalAmount) : "—"}. Less than the total leaves the remainder as khata due.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Payment status</label>
              <Select value={convertPaymentStatus} onValueChange={setConvertPaymentStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPLETED">Paid</SelectItem>
                  <SelectItem value="PENDING">Unpaid / credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConvert} disabled={isConverting}>
              {isConverting ? "Converting…" : "Convert to sale"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Quotations;
