import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Scale,
  WifiOff,
} from "lucide-react";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Sync Review (R3) + Stock Reconciliation (R7) — multi-counter fix, 2026-10-26.
//
// When two counters sell the same stock, or a counter works offline for
// hours, the cloud replay (R1) can no longer silently absorb the clash:
// an oversold sale, an offline sale, or a sale whose replay never ran
// lands HERE with the reason, so a human can see it and mark it
// reviewed. Nothing on this page deletes or re-deducts stock — resolving
// is an acknowledgement that the clash was seen and handled (usually a
// physical count / stock take). The reconciliation section below does
// the same for the nightly ledger check: expected vs actual per batch,
// with one-click stock-take creation for the variance.

interface ReviewItem {
  id: string;
  invoiceNumber?: string | null;
  terminalInvoiceNumber?: string | null;
  totalAmount?: number;
  createdAt: string;
  offlineSale?: boolean;
  oversold?: boolean;
  stockReplayedAt?: string | null;
  // The replay stores the shortfall array directly (Json); older rows
  // could carry { shortfall: [...] } — the page normalizes both.
  oversellDetail?: Array<{ productName?: string; required?: number; available?: number; allocated?: number; shortfall?: number }> | { shortfall?: Array<{ productName?: string; required?: number; available?: number; allocated?: number; shortfall?: number }> } | null;
  branch?: { id: string; name: string } | null;
  items?: Array<{ productName?: string; product?: { name?: string } | null; quantity: number; unitsDeducted?: number | null }>;
}

interface ReviewSummary {
  open: number;
  oversold: number;
  offline: number;
  pendingReplay: number;
  pendingRestock: number;
  reviewed: number;
  total: number;
}

interface ReconciliationRun {
  id: string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  unverifiableBatches: number;
  branch?: { id: string; name: string } | null;
  lines?: Array<{
    id: string;
    variance: number;
    reason: string;
    product?: { name?: string } | null;
    batch?: { batchNo?: string } | null;
  }>;
}

function fmtMoney(n: number | undefined | null) {
  return `Rs ${(n ?? 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function fmtDate(s: string | undefined | null) {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
}

export default function SyncReview() {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [rows, setRows] = useState<ReviewItem[]>([]);
  const [filter, setFilter] = useState<"open" | "all" | "reviewed">("open");
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runningRecon, setRunningRecon] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, listRes] = await Promise.all([
        apiService.getSyncReviewSummary(),
        apiService.getSyncReview(filter, 50),
      ]);
      setSummary((summaryRes.data as ReviewSummary) || null);
      // The endpoint wraps the rows as { sales: [...] }.
      const listData = listRes.data as unknown;
      setRows((Array.isArray(listData) ? listData : (listData as { sales?: ReviewItem[] } | null)?.sales || []).filter(Boolean));
    } catch (e) {
      toast({ title: "Review list failed to load", description: e instanceof Error ? e.message : "Cloud unavailable", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const res = await apiService.listStockReconciliations(undefined, 10);
      // The endpoint wraps the runs as { runs: [...] }.
      const runsData = res.data as unknown;
      setRuns((Array.isArray(runsData) ? runsData : (runsData as { runs?: ReconciliationRun[] } | null)?.runs || []));
    } catch {
      // Reconciliation is a background ledger — a failed list must not
      // break the review page.
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  const resolve = async (saleId: string) => {
    setResolvingId(saleId);
    try {
      const res = await apiService.resolveSyncReview(saleId, note.trim() || undefined);
      if (res.success === false) throw new Error(res.message || "Resolve failed");
      toast({ title: "Marked reviewed", description: "The sale is now in the reviewed list." });
      setNote("");
      await load();
    } catch (e) {
      toast({ title: "Resolve failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setResolvingId(null);
    }
  };

  const runReconciliation = async () => {
    setRunningRecon(true);
    try {
      const res = await apiService.runStockReconciliation();
      if (res.success === false) throw new Error(res.message || "Run failed");
      toast({ title: "Reconciliation started", description: "Expected vs actual stock is being recomputed." });
      await loadRuns();
    } catch (e) {
      toast({ title: "Reconciliation failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setRunningRecon(false);
    }
  };

  const createTake = async (runId: string) => {
    try {
      const res = await apiService.createStockTakeFromReconciliation(runId);
      if (res.success === false) throw new Error(res.message || "Failed");
      toast({ title: "Stock take created", description: `${(res.data as { created?: number } | undefined)?.created ?? 0} take(s) opened, pre-filled from the variance.` });
      await loadRuns();
    } catch (e) {
      toast({ title: "Stock take failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  };

  const shortfallOf = (r: ReviewItem) => {
    if (Array.isArray(r.oversellDetail)) return r.oversellDetail;
    return r.oversellDetail?.shortfall || [];
  };

  const flagsOf = (r: ReviewItem) => {
    const flags: string[] = [];
    if (r.oversold) flags.push("Oversold");
    if (r.offlineSale) flags.push("Offline sale");
    if (!r.stockReplayedAt) flags.push("Replay pending");
    return flags;
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            Sync Review
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sales where two counters clashed, a counter sold offline, or the cloud stock replay never ran. Nothing here is lost — review it, count it, mark it reviewed.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Open</div><div className="text-2xl font-bold">{summary.open}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Oversold</div><div className="text-2xl font-bold text-red-600">{summary.oversold}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Offline sales</div><div className="text-2xl font-bold text-amber-600">{summary.offline}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Replay pending</div><div className="text-2xl font-bold">{summary.pendingReplay}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Restock pending</div><div className="text-2xl font-bold">{summary.pendingRestock}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Reviewed</div><div className="text-2xl font-bold text-green-600">{summary.reviewed}</div></div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(["open", "all", "reviewed"] as const).map((f) => (
          <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
            {f === "open" ? "Open" : f === "all" ? "All" : "Reviewed"}
          </Button>
        ))}
        <Input
          placeholder="Review note (optional, saved with the resolve)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading review list…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border p-6 text-center text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-600" />
          No {filter === "open" ? "open" : filter} sales to review — counters are in sync.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{r.invoiceNumber || r.id}</span>
                  {r.terminalInvoiceNumber && r.terminalInvoiceNumber !== r.invoiceNumber && (
                    <Badge variant="outline" title="The terminal's original number — the cloud renamed this sale because another counter used the same number first.">
                      was {r.terminalInvoiceNumber}
                    </Badge>
                  )}
                  {flagsOf(r).map((f) => (
                    <Badge key={f} variant={f === "Oversold" ? "destructive" : "secondary"}>
                      {f === "Offline sale" ? <WifiOff className="h-3 w-3 mr-1" /> : f === "Replay pending" ? <Clock className="h-3 w-3 mr-1" /> : null}
                      {f}
                    </Badge>
                  ))}
                </div>
                <div className="text-sm text-muted-foreground">{fmtDate(r.createdAt)} · {r.branch?.name || "—"} · {fmtMoney(r.totalAmount)}</div>
              </div>
              {shortfallOf(r).length > 0 ? (
                <div className="text-sm text-red-700 bg-red-50 rounded p-2">
                  Sold more than the cloud had:{" "}
                  {shortfallOf(r).map((s) => `${s.productName || "item"} — needed ${s.required ?? "?"}, had ${s.available ?? "?"}`).join("; ")}
                </div>
              ) : null}
              {r.items?.length ? (
                <div className="text-sm text-muted-foreground">
                  {r.items.map((it) => `${it.productName || it.product?.name || "Item"} × ${it.quantity}`).join(", ")}
                </div>
              ) : null}
              {filter !== "reviewed" && (
                <Button size="sm" variant="outline" onClick={() => resolve(r.id)} disabled={resolvingId === r.id}>
                  {resolvingId === r.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Mark reviewed
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="border-t pt-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Stock Reconciliation
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Nightly ledger check: expected stock (purchases − sales − refunds ± transfers, from the last completed stock take) vs actual batches. Variances become stock takes.
            </p>
          </div>
          <Button onClick={runReconciliation} disabled={runningRecon}>
            {runningRecon ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Scale className="h-4 w-4 mr-2" />}
            Run now
          </Button>
        </div>
        {runsLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading runs…</div>
        ) : runs.length === 0 ? (
          <div className="rounded-lg border p-4 text-muted-foreground text-sm">No reconciliation runs yet — the nightly job creates one per business.</div>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <div key={run.id} className="rounded-lg border p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={run.status === "REVIEWED" || run.status === "RESOLVED" ? "secondary" : run.status === "COMPLETED" ? "default" : "outline"}>{run.status}</Badge>
                    <span className="text-sm text-muted-foreground">{fmtDate(run.createdAt)} · {run.branch?.name || "All branches"}</span>
                  </div>
                  <div className="flex gap-2">
                    {(run.lines?.length ?? 0) > 0 && run.status !== "RESOLVED" && (
                      <Button size="sm" variant="outline" onClick={() => createTake(run.id)}>Create stock take</Button>
                    )}
                  </div>
                </div>
                {(run.lines?.length ?? 0) > 0 ? (
                  <div className="text-sm">
                    {run.lines!.map((l) => (
                      <div key={l.id} className="flex justify-between border-t py-1">
                        <span>{l.product?.name || "Product"} {l.batch?.batchNo ? `(${l.batch.batchNo})` : ""} <span className="text-muted-foreground">· {l.reason}</span></span>
                        <span className={l.variance < 0 ? "text-red-600 font-semibold" : "text-green-600 font-semibold"}>
                          {l.variance > 0 ? "+" : ""}{l.variance}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No variances{run.unverifiableBatches ? ` · ${run.unverifiableBatches} batch(es) unverifiable (no stock take or purchase link — counted, never guessed).` : "."}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
