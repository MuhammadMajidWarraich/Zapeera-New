import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { ClipboardList, Loader2, Plus, RefreshCw, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Stock-takes (Wave C6 — Retail pack): a formal physical count of
// one branch. Open a session, count batches (the system quantity is
// snapshotted at count time), watch the variance live, then complete
// — completion rewrites the counted batches to the counted
// quantities and posts a STOCK_TAKE_ADJUSTMENT movement per
// variance, all in one server transaction. Only one OPEN session
// per branch. Completed sessions are frozen history.

interface StockTakeSummary {
  lineCount: number;
  countedLines: number;
  varianceLines: number;
  totalVarianceUnits: number;
  shortageUnits: number;
  surplusUnits: number;
}

interface StockTakeLine {
  id: string;
  batchId: string;
  productId: string;
  systemQty: number;
  countedQty: number | null;
  variance: number | null;
  adjustmentMovementId?: string | null;
  product?: { id: string; name: string; sku?: string | null } | null;
  batch?: {
    id: string;
    batchNo: string;
    variantId?: string | null;
    variant?: { id: string; name: string } | null;
  } | null;
}

interface StockTake {
  id: string;
  branchId: string;
  status: "OPEN" | "COMPLETED" | "CANCELLED" | string;
  note?: string | null;
  startedBy?: string | null;
  completedBy?: string | null;
  completedAt?: string | null;
  createdAt: string;
  branch?: { id: string; name: string } | null;
  lines: StockTakeLine[];
  summary: StockTakeSummary;
}

interface BranchOption {
  id: string;
  name: string;
}

interface BatchOption {
  id: string;
  batchNo: string;
  quantity: number;
  product?: { id: string; name: string } | null;
  variant?: { id: string; name: string } | null;
}

const varianceBadge = (variance: number | null) => {
  if (variance === null || variance === undefined) return <span className="text-[#8c95b0]">—</span>;
  if (variance === 0) return <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">0</Badge>;
  if (variance < 0) return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">{variance}</Badge>;
  return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">+{variance}</Badge>;
};

const StockTakes: React.FC = () => {
  const [takes, setTakes] = useState<StockTake[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selected, setSelected] = useState<StockTake | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const [newBranchId, setNewBranchId] = useState("");
  const [newNote, setNewNote] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [branchBatches, setBranchBatches] = useState<BatchOption[]>([]);
  const [countBatchId, setCountBatchId] = useState("");
  const [countQty, setCountQty] = useState("");
  const [countInputs, setCountInputs] = useState<Record<string, string>>({});
  const [isSavingCount, setIsSavingCount] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"complete" | "cancel" | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const loadTakes = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiService.getStockTakes();
      if (response.success && Array.isArray(response.data)) {
        setTakes(response.data as StockTake[]);
      }
    } catch {
      toast({ title: "Error", description: "Failed to load stock-takes", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setIsDetailLoading(true);
    try {
      const response = await apiService.getStockTake(id);
      if (response.success && response.data) {
        const take = response.data as StockTake;
        setSelected(take);
        const inputs: Record<string, string> = {};
        for (const line of take.lines || []) {
          if (line.countedQty !== null && line.countedQty !== undefined) {
            inputs[line.batchId] = String(line.countedQty);
          }
        }
        setCountInputs(inputs);
        // Batches of the session branch power the count picker.
        const batchResponse = await apiService.getBatches({
          page: 1,
          limit: 100,
          branchId: take.branchId,
          isActive: true,
        } as any);
        if (batchResponse.success) {
          const list = ((batchResponse.data as any)?.batches || []) as any[];
          setBranchBatches(list.map((b) => ({
            id: b.id,
            batchNo: b.batchNo,
            quantity: b.quantity ?? 0,
            product: b.product ? { id: b.product.id, name: b.product.name } : null,
            variant: b.variant ? { id: b.variant.id, name: b.variant.name } : null,
          })));
        }
      }
    } catch {
      toast({ title: "Error", description: "Failed to load the stock-take", variant: "destructive" });
    } finally {
      setIsDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTakes();
    (async () => {
      try {
        const response = await apiService.getBranches();
        if (response.success) {
          const list = ((response.data as any)?.branches || response.data || []) as any[];
          const options = list.map((b: any) => ({ id: b.id, name: b.name })).filter((b: BranchOption) => b.id);
          setBranches(options);
          if (options.length > 0) setNewBranchId(options[0].id);
        }
      } catch {
        // Branch picker stays empty; creation reports the problem.
      }
    })();
  }, [loadTakes]);

  const countedBatchIds = useMemo(
    () => new Set((selected?.lines || []).map((l) => l.batchId)),
    [selected],
  );
  const availableToCount = useMemo(
    () => branchBatches.filter((b) => !countedBatchIds.has(b.id)),
    [branchBatches, countedBatchIds],
  );

  const handleCreate = async () => {
    if (!newBranchId) {
      toast({ title: "Pick a branch", description: "A stock-take counts one branch", variant: "destructive" });
      return;
    }
    setIsCreating(true);
    try {
      const response = await apiService.createStockTake({ branchId: newBranchId, note: newNote.trim() || undefined });
      if (response.success && response.data) {
        toast({ title: "Stock-take opened", description: "Start counting batches below" });
        setNewNote("");
        await loadTakes();
        await loadDetail((response.data as StockTake).id);
      } else {
        toast({
          title: "Could not open stock-take",
          description: (response as any)?.message || "A stock-take may already be open for this branch",
          variant: "destructive",
        });
        await loadTakes();
      }
    } catch (error: any) {
      toast({ title: "Could not open stock-take", description: error?.message || "Request failed", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  const saveCount = async (batchId: string, countedQtyText: string) => {
    if (!selected) return;
    const countedQty = parseInt(countedQtyText, 10);
    if (Number.isNaN(countedQty) || countedQty < 0) {
      toast({ title: "Invalid count", description: "Enter a counted quantity of 0 or more", variant: "destructive" });
      return;
    }
    setIsSavingCount(true);
    try {
      const response = await apiService.upsertStockTakeLine(selected.id, { batchId, countedQty });
      if (response.success) {
        await loadDetail(selected.id);
        await loadTakes();
      } else {
        toast({ title: "Could not record the count", description: (response as any)?.message || "Failed", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not record the count", description: error?.message || "Request failed", variant: "destructive" });
    } finally {
      setIsSavingCount(false);
    }
  };

  const handleRemoveLine = async (line: StockTakeLine) => {
    if (!selected) return;
    try {
      const response = await apiService.deleteStockTakeLine(selected.id, line.id);
      if (response.success) {
        await loadDetail(selected.id);
        await loadTakes();
      }
    } catch {
      toast({ title: "Error", description: "Failed to remove the line", variant: "destructive" });
    }
  };

  const handleCloseAction = async () => {
    if (!selected || !confirmAction) return;
    setIsClosing(true);
    try {
      const response = confirmAction === "complete"
        ? await apiService.completeStockTake(selected.id)
        : await apiService.cancelStockTake(selected.id);
      if (response.success) {
        toast({
          title: confirmAction === "complete" ? "Stock-take completed" : "Stock-take cancelled",
          description: confirmAction === "complete"
            ? "Batch quantities now match the counts; adjustments are in the stock movements."
            : "No stock was changed.",
        });
        setConfirmAction(null);
        await loadTakes();
        await loadDetail(selected.id);
      } else {
        toast({ title: "Action failed", description: (response as any)?.message || "Failed", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Action failed", description: error?.message || "Request failed", variant: "destructive" });
    } finally {
      setIsClosing(false);
    }
  };

  const statusBadge = (status: string) => {
    if (status === "OPEN") return <Badge className="bg-blue-600 hover:bg-blue-600">Open</Badge>;
    if (status === "COMPLETED") return <Badge className="bg-green-600 hover:bg-green-600">Completed</Badge>;
    return <Badge variant="outline">Cancelled</Badge>;
  };

  return (
    <div className="w-full space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-[14px] bg-gradient-to-br from-[#1a52c5]/14 to-[#28c2ce]/12">
          <ClipboardList className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-[#0a1128]">Stock Takes</h1>
          <p className="text-sm text-[#8c95b0]">Physical counts with variance — completing a count corrects batch stock and logs the adjustment.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadTakes()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      {/* Open a session */}
      <div className="rounded-[16px] border border-[rgba(15,23,60,0.08)] bg-white p-4 shadow-[0_2px_14px_rgba(15,23,60,0.04)]">
        <h2 className="text-sm font-bold text-[#0a1128]">Open a stock-take</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-56 space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Branch</label>
            <Select value={newBranchId} onValueChange={setNewBranchId}>
              <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-52 flex-1 space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Note (optional)</label>
            <Input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="e.g. Monthly full count" />
          </div>
          <Button onClick={handleCreate} disabled={isCreating || !newBranchId}>
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="ml-1.5">Open stock-take</span>
          </Button>
        </div>
        <p className="mt-2 text-xs text-[#8c95b0]">One open session per branch — complete or cancel the current one before starting another.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        {/* History */}
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-[#0a1128]">Sessions</h2>
          {takes.length === 0 && !isLoading && (
            <p className="rounded-[12px] border border-dashed border-[rgba(15,23,60,0.15)] p-4 text-sm text-[#8c95b0]">No stock-takes yet.</p>
          )}
          {takes.map((take) => (
            <button
              key={take.id}
              type="button"
              onClick={() => void loadDetail(take.id)}
              className={`w-full rounded-[14px] border p-3 text-left transition-colors ${selected?.id === take.id ? "border-[#1a52c5]/40 bg-[#1a52c5]/[0.04]" : "border-[rgba(15,23,60,0.08)] bg-white hover:bg-[#f8f9fc]"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-[#0a1128]">{take.branch?.name || "Branch"}</span>
                {statusBadge(take.status)}
              </div>
              <p className="mt-1 text-xs text-[#8c95b0]">
                {new Date(take.createdAt).toLocaleString()} • {take.summary.countedLines}/{take.summary.lineCount} counted
              </p>
              <p className="mt-0.5 text-xs text-[#8c95b0]">
                Variance: <span className={take.summary.totalVarianceUnits === 0 ? "" : take.summary.totalVarianceUnits < 0 ? "font-semibold text-red-600" : "font-semibold text-amber-600"}>
                  {take.summary.totalVarianceUnits > 0 ? "+" : ""}{take.summary.totalVarianceUnits} units
                </span>
                {take.note ? ` • ${take.note}` : ""}
              </p>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="rounded-[16px] border border-[rgba(15,23,60,0.08)] bg-white p-4 shadow-[0_2px_14px_rgba(15,23,60,0.04)]">
          {!selected ? (
            <p className="py-10 text-center text-sm text-[#8c95b0]">Select a session to count or review it.</p>
          ) : isDetailLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-[#1a52c5]" /></div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-[#0a1128]">{selected.branch?.name || "Branch"} count</h2>
                {statusBadge(selected.status)}
                <span className="text-xs text-[#8c95b0]">Opened {new Date(selected.createdAt).toLocaleString()}</span>
                {selected.status === "OPEN" && (
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirmAction("cancel")}>
                      <XCircle className="h-4 w-4" /><span className="ml-1.5">Cancel session</span>
                    </Button>
                    <Button size="sm" onClick={() => setConfirmAction("complete")}>
                      <CheckCircle2 className="h-4 w-4" /><span className="ml-1.5">Complete &amp; adjust stock</span>
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">Lines: {selected.summary.lineCount}</Badge>
                <Badge variant="outline">Counted: {selected.summary.countedLines}</Badge>
                <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Shortage: {selected.summary.shortageUnits} units</Badge>
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Surplus: {selected.summary.surplusUnits} units</Badge>
                <Badge variant="outline">Net variance: {selected.summary.totalVarianceUnits > 0 ? "+" : ""}{selected.summary.totalVarianceUnits}</Badge>
              </div>

              {selected.status === "OPEN" && (
                <div className="flex flex-wrap items-end gap-2 rounded-[12px] bg-[#f8f9fc] p-3">
                  <div className="min-w-64 flex-1 space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Batch to count</label>
                    <Select value={countBatchId} onValueChange={setCountBatchId}>
                      <SelectTrigger><SelectValue placeholder="Choose a batch" /></SelectTrigger>
                      <SelectContent>
                        {availableToCount.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.product?.name || "Product"} — {b.batchNo}{b.variant ? ` (${b.variant.name})` : ""} • system {b.quantity}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-32 space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Counted qty</label>
                    <Input type="number" min={0} value={countQty} onChange={(e) => setCountQty(e.target.value)} placeholder="0" />
                  </div>
                  <Button
                    onClick={() => { void saveCount(countBatchId, countQty); setCountQty(""); }}
                    disabled={!countBatchId || countQty === "" || isSavingCount}
                  >
                    {isSavingCount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    <span className="ml-1.5">Record count</span>
                  </Button>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[rgba(15,23,60,0.08)] text-left text-xs uppercase tracking-wide text-[#8c95b0]">
                      <th className="px-2 py-2 font-semibold">Product / Batch</th>
                      <th className="px-2 py-2 font-semibold">System</th>
                      <th className="px-2 py-2 font-semibold">Counted</th>
                      <th className="px-2 py-2 font-semibold">Variance</th>
                      {selected.status === "OPEN" && <th className="px-2 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {(selected.lines || []).length === 0 && (
                      <tr><td colSpan={5} className="px-2 py-6 text-center text-[#8c95b0]">No batches counted yet.</td></tr>
                    )}
                    {(selected.lines || []).map((line) => {
                      const liveVariance = line.countedQty === null || line.countedQty === undefined
                        ? null
                        : line.countedQty - line.systemQty;
                      return (
                        <tr key={line.id} className="border-b border-[rgba(15,23,60,0.05)]">
                          <td className="px-2 py-2">
                            <div className="font-medium text-[#0a1128]">{line.product?.name || "Product"}</div>
                            <div className="text-xs text-[#8c95b0]">
                              {line.batch?.batchNo || line.batchId}
                              {line.batch?.variant ? ` • ${line.batch.variant.name}` : ""}
                              {line.adjustmentMovementId ? " • adjusted" : ""}
                            </div>
                          </td>
                          <td className="px-2 py-2 tabular-nums">{line.systemQty}</td>
                          <td className="px-2 py-2">
                            {selected.status === "OPEN" ? (
                              <div className="flex items-center gap-1.5">
                                <Input
                                  type="number"
                                  min={0}
                                  className="h-8 w-24"
                                  value={countInputs[line.batchId] ?? ""}
                                  onChange={(e) => setCountInputs((prev) => ({ ...prev, [line.batchId]: e.target.value }))}
                                  onBlur={() => {
                                    const text = countInputs[line.batchId];
                                    if (text !== undefined && text !== "" && parseInt(text, 10) !== line.countedQty) {
                                      void saveCount(line.batchId, text);
                                    }
                                  }}
                                />
                              </div>
                            ) : (
                              <span className="tabular-nums">{line.countedQty ?? "—"}</span>
                            )}
                          </td>
                          <td className="px-2 py-2">{varianceBadge(selected.status === "COMPLETED" ? line.variance : liveVariance)}</td>
                          {selected.status === "OPEN" && (
                            <td className="px-2 py-2">
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600 hover:bg-red-50" onClick={() => void handleRemoveLine(line)} title="Remove line">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={!!confirmAction} onOpenChange={(isOpen) => { if (!isOpen) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction === "complete" ? "Complete this stock-take?" : "Cancel this stock-take?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "complete"
                ? "Every counted batch will be set to its counted quantity and a stock adjustment movement will be recorded for each variance. Uncounted batches are not touched. This cannot be undone."
                : "The session will be closed and its counts discarded. No stock will change."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClosing}>Keep counting</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleCloseAction()} disabled={isClosing}>
              {isClosing ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmAction === "complete" ? "Complete & adjust" : "Cancel session"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default StockTakes;
