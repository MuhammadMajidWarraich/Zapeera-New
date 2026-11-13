import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Loader2, RefreshCw, Search } from "lucide-react";
import { apiService } from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";

// Wastage / damage recording (v1.0.22): write stock off against one
// batch — the batch quantity drops AND a WASTAGE stock movement is
// written in the same server transaction, so inventory stays
// consistent. Records are append-only history; the report values the
// loss at the batch's purchase price at write-off time.

interface WastageRecord {
  id: string;
  quantity: number;
  reason: string;
  reasonNote?: string | null;
  unitCost?: number | null;
  recordedAt: string;
  product?: { id: string; name: string; sku?: string | null } | null;
  batch?: { id: string; batchNo: string; expireDate?: string | null } | null;
  branch?: { id: string; name: string } | null;
  recorder?: { id: string; name: string } | null;
}

interface BranchOption { id: string; name: string }
interface ProductOption { id: string; name: string; sku?: string | null }
interface BatchOption { id: string; batchNo: string; quantity: number; expireDate?: string | null; purchasePrice?: number | null }

const REASONS = ["DAMAGED", "EXPIRED", "SPOILAGE", "THEFT", "OTHER"];
const formatPKR = (v: number) => `PKR ${Number(v || 0).toFixed(2)}`;
const formatDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

const reasonBadge = (reason: string) => {
  const styles: Record<string, string> = {
    DAMAGED: "border-red-200 bg-red-50 text-red-700",
    EXPIRED: "border-amber-200 bg-amber-50 text-amber-700",
    SPOILAGE: "border-orange-200 bg-orange-50 text-orange-700",
    THEFT: "border-purple-200 bg-purple-50 text-purple-700",
    OTHER: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return <Badge variant="outline" className={styles[reason] || styles.OTHER}>{reason}</Badge>;
};

const Wastage: React.FC = () => {
  const { selectedBranchId, selectedCompanyId } = useAdmin();
  const [records, setRecords] = useState<WastageRecord[]>([]);
  const [report, setReport] = useState<any>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reasonFilter, setReasonFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Record form
  const [formBranchId, setFormBranchId] = useState("");
  const [formProductId, setFormProductId] = useState("");
  const [formProductName, setFormProductName] = useState("");
  const [formBatchId, setFormBatchId] = useState("");
  const [formQuantity, setFormQuantity] = useState("");
  const [formReason, setFormReason] = useState("DAMAGED");
  const [formNote, setFormNote] = useState("");
  const [isRecording, setIsRecording] = useState(false);

  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<ProductOption[]>([]);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);
  const productSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const scope: any = {};
      if (selectedBranchId) scope.branchId = selectedBranchId;
      if (fromDate) scope.from = fromDate;
      if (toDate) scope.to = toDate;
      const [listRes, reportRes] = await Promise.all([
        apiService.getWastageRecords({ ...scope, reason: reasonFilter || undefined, page, limit: 25 }),
        apiService.getWastageReport(scope),
      ]);
      if (listRes.success && listRes.data) {
        setRecords(listRes.data as WastageRecord[]);
        setTotalPages(listRes.pagination?.pages || 1);
      }
      if (reportRes.success && reportRes.data) setReport(reportRes.data);
    } catch {
      toast({ title: "Error", description: "Failed to load wastage records", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [selectedBranchId, reasonFilter, fromDate, toDate, page]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    (async () => {
      try {
        const response = await apiService.getBranches();
        if (response.success) {
          const list = ((response.data as any)?.branches || response.data || []) as any[];
          const options = list.map((b: any) => ({ id: b.id, name: b.name })).filter((b: BranchOption) => b.id);
          setBranches(options);
          if (!formBranchId && options.length > 0) setFormBranchId(selectedBranchId || options[0].id);
        }
      } catch {
        // Branch picker stays empty; recording reports the problem.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId]);

  useEffect(() => {
    if (selectedBranchId) setFormBranchId(selectedBranchId);
  }, [selectedBranchId]);

  const searchProducts = useCallback((term: string) => {
    if (productSearchTimer.current) clearTimeout(productSearchTimer.current);
    if (!term.trim()) { setProductResults([]); return; }
    productSearchTimer.current = setTimeout(async () => {
      try {
        const response = await apiService.getProducts({ search: term.trim(), limit: 8, branchId: formBranchId || undefined });
        if (response.success && response.data) {
          const list = ((response.data as any)?.products || []) as any[];
          setProductResults(list.map((p: any) => ({ id: p.id, name: p.name, sku: p.sku || null })));
        }
      } catch {
        setProductResults([]);
      }
    }, 300);
  }, [formBranchId]);

  const loadBatches = useCallback(async (productId: string, branchId: string) => {
    setIsLoadingBatches(true);
    try {
      const response = await apiService.getBatches({ productId, branchId, isActive: true, limit: 50 });
      if (response.success && response.data) {
        const list = ((response.data as any)?.batches || response.data || []) as any[];
        setBatches(list.map((b: any) => ({ id: b.id, batchNo: b.batchNo, quantity: b.quantity, expireDate: b.expireDate || null, purchasePrice: b.purchasePrice ?? null })));
      } else {
        setBatches([]);
      }
    } catch {
      setBatches([]);
    } finally {
      setIsLoadingBatches(false);
    }
  }, []);

  const pickProduct = (p: ProductOption) => {
    setFormProductId(p.id);
    setFormProductName(p.name);
    setFormBatchId("");
    setProductSearch("");
    setProductResults([]);
    if (formBranchId) loadBatches(p.id, formBranchId);
  };

  const handleRecord = async () => {
    const qty = parseInt(formQuantity, 10);
    if (!formBranchId || !formProductId || !formBatchId || !qty || qty <= 0) {
      toast({ title: "Check the write-off", description: "Pick a branch, product and batch, and enter a quantity greater than zero.", variant: "destructive" });
      return;
    }
    const batch = batches.find((b) => b.id === formBatchId);
    if (batch && qty > batch.quantity) {
      toast({ title: "Not enough stock in this batch", description: `Batch ${batch.batchNo} holds only ${batch.quantity} units.`, variant: "destructive" });
      return;
    }
    setIsRecording(true);
    try {
      const response = await apiService.recordWastage({
        branchId: formBranchId,
        productId: formProductId,
        batchId: formBatchId,
        quantity: qty,
        reason: formReason,
        reasonNote: formNote.trim() || undefined,
      });
      if (response.success) {
        toast({ title: "Write-off recorded", description: `${qty} unit(s) written off — batch stock and the movement history are updated.` });
        setFormQuantity("");
        setFormNote("");
        setFormBatchId("");
        if (formProductId && formBranchId) loadBatches(formProductId, formBranchId);
        loadAll();
      } else {
        toast({ title: "Could not record the write-off", description: response.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not record the write-off", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsRecording(false);
    }
  };

  const selectedBatch = batches.find((b) => b.id === formBatchId);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Wastage &amp; Damage</h1>
            <p className="text-sm text-muted-foreground">Write stock off against a batch. Every write-off decrements the batch and posts a stock movement.</p>
          </div>
        </div>
        <Button variant="outline" size="icon" onClick={loadAll} disabled={isLoading} title="Refresh">
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Record a write-off</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Branch</label>
              <Select
                value={formBranchId}
                onValueChange={(v) => {
                  setFormBranchId(v);
                  setFormBatchId("");
                  if (formProductId) loadBatches(formProductId, v);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Product</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search products…"
                  value={productSearch}
                  onChange={(e) => { setProductSearch(e.target.value); searchProducts(e.target.value); }}
                />
                {productResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg">
                    {productResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => pickProduct(p)}
                      >
                        {p.name}{p.sku ? ` · ${p.sku}` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {formProductId && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Selected: <span className="font-medium text-foreground">{formProductName}</span>{" "}
                  <button type="button" className="text-xs font-bold text-red-500 hover:underline" onClick={() => { setFormProductId(""); setFormProductName(""); setFormBatchId(""); setBatches([]); }}>Clear</button>
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Batch</label>
              <Select value={formBatchId} onValueChange={setFormBatchId} disabled={!formProductId || isLoadingBatches}>
                <SelectTrigger><SelectValue placeholder={formProductId ? "Select batch" : "Pick a product first"} /></SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.batchNo} — {b.quantity} on hand{b.expireDate ? ` · expires ${formatDate(b.expireDate)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedBatch && (
                <p className="mt-1 text-xs text-muted-foreground">
                  On hand: {selectedBatch.quantity} units
                  {selectedBatch.purchasePrice != null && ` · cost ${formatPKR(selectedBatch.purchasePrice)} per unit`}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Quantity (base units)</label>
              <Input type="number" min="1" step="1" value={formQuantity} onChange={(e) => setFormQuantity(e.target.value)} placeholder="e.g. 5" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Reason</label>
              <Select value={formReason} onValueChange={setFormReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Note (optional)</label>
              <Input value={formNote} onChange={(e) => setFormNote(e.target.value)} placeholder="e.g. Broken during delivery" />
            </div>
          </div>
          <Button onClick={handleRecord} disabled={isRecording}>
            {isRecording && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record write-off
          </Button>
        </CardContent>
      </Card>

      {report && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Units written off</p>
            <p className="text-2xl font-bold">{report.totals?.quantity || 0}</p>
            <p className="text-xs text-muted-foreground">{report.totals?.events || 0} event(s)</p>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Value lost (at cost)</p>
            <p className="text-2xl font-bold">{formatPKR(report.totals?.value || 0)}</p>
            <p className="text-xs text-muted-foreground">Batch purchase price at write-off time</p>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Top reason</p>
            <p className="text-2xl font-bold">{(report.byReason || [])[0]?.reason || "—"}</p>
            <p className="text-xs text-muted-foreground">{(report.byReason || [])[0] ? `${(report.byReason[0] as any).quantity} units · ${formatPKR((report.byReason[0] as any).value)}` : "No write-offs yet"}</p>
          </CardContent></Card>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>By product</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="text-right">Events</TableHead></TableRow></TableHeader>
              <TableBody>
                {(report?.byProduct || []).length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No write-offs yet</TableCell></TableRow>
                )}
                {(report?.byProduct || []).map((r: any) => (
                  <TableRow key={r.productId}>
                    <TableCell className="font-medium">{r.productName}{r.sku ? ` · ${r.sku}` : ""}</TableCell>
                    <TableCell className="text-right">{r.quantity}</TableCell>
                    <TableCell className="text-right">{formatPKR(r.value)}</TableCell>
                    <TableCell className="text-right">{r.events}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>By reason</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Reason</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="text-right">Events</TableHead></TableRow></TableHeader>
              <TableBody>
                {(report?.byReason || []).length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No write-offs yet</TableCell></TableRow>
                )}
                {(report?.byReason || []).map((r: any) => (
                  <TableRow key={r.reason}>
                    <TableCell>{reasonBadge(r.reason)}</TableCell>
                    <TableCell className="text-right">{r.quantity}</TableCell>
                    <TableCell className="text-right">{formatPKR(r.value)}</TableCell>
                    <TableCell className="text-right">{r.events}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Write-off history</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} aria-label="From date" className="w-[160px]" />
              <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} aria-label="To date" className="w-[160px]" />
              <Select value={reasonFilter || "all"} onValueChange={(v) => { setReasonFilter(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead>Batch</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Recorded by</TableHead></TableRow></TableHeader>
              <TableBody>
                {records.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No write-offs recorded</TableCell></TableRow>
                )}
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDate(r.recordedAt)}</TableCell>
                    <TableCell className="font-medium">{r.product?.name || "—"}</TableCell>
                    <TableCell>{r.batch?.batchNo || "—"}</TableCell>
                    <TableCell>{reasonBadge(r.reason)}{r.reasonNote ? <span className="block text-xs text-muted-foreground">{r.reasonNote}</span> : null}</TableCell>
                    <TableCell className="text-right">{r.quantity}</TableCell>
                    <TableCell className="text-right">{formatPKR((r.quantity || 0) * (r.unitCost || 0))}</TableCell>
                    <TableCell>{r.recorder?.name || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Wastage;
