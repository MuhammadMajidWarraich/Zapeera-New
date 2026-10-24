import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  apiService,
  ControlledInspectionPack,
  ControlledRegisterEntry,
  ControlledRegisterSummary,
  ControlledStaffAuditRow,
} from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";
import { Download, Printer, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";

// Controlled / narcotics register (Gap item 2) — the append-only
// dispense log for scheduled/controlled medicines. Register viewing is
// OWNER/MANAGER-only (the route guard + server reports.read enforce
// it); corrections are REVERSAL rows, never edits — there is no edit or
// delete affordance anywhere on this page.

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function scheduleLabel(entry: ControlledRegisterEntry): string {
  return entry.product?.controlledSchedule || "CONTROLLED";
}

const ControlledRegister = () => {
  const { selectedBranchId } = useAdmin();
  const [tab, setTab] = useState("register");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [branchId, setBranchId] = useState("all");
  const [entryType, setEntryType] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);

  const [entries, setEntries] = useState<ControlledRegisterEntry[]>([]);
  const [summary, setSummary] = useState<ControlledRegisterSummary[]>([]);
  const [totals, setTotals] = useState({ totalDispensed: 0, totalReversed: 0, netDispensed: 0, entryCount: 0 });
  const [totalPages, setTotalPages] = useState(1);
  const [staffAudit, setStaffAudit] = useState<ControlledStaffAuditRow[]>([]);
  const [staffTotals, setStaffTotals] = useState({ totalDispensed: 0, totalReversed: 0, netDispensed: 0, entryCount: 0 });
  const [pack, setPack] = useState<ControlledInspectionPack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reversalTarget, setReversalTarget] = useState<ControlledRegisterEntry | null>(null);
  const [reversalQty, setReversalQty] = useState("");
  const [reversalReason, setReversalReason] = useState("");
  const [reversalBusy, setReversalBusy] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);

  const filters = useMemo(() => {
    const params: Record<string, string> = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    if (branchId !== "all") params.branchId = branchId;
    if (entryType === "DISPENSE" || entryType === "REVERSAL") params.entryType = entryType;
    return params;
  }, [startDate, endDate, branchId, entryType]);

  const loadBranches = useCallback(async () => {
    try {
      const res = await apiService.getBranches();
      if (res.success && res.data?.branches) {
        setBranches(res.data.branches.map((b) => ({ id: b.id, name: b.name })));
      }
    } catch {
      // Branch filter simply stays on "All branches".
    }
  }, []);

  const loadRegister = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiService.getControlledRegister({ ...filters, page, limit: 100 });
      if (!res.success || !res.data) {
        setError(res.message || "Could not load the controlled-medicines register.");
        return;
      }
      setEntries(res.data.entries);
      setSummary(res.data.summary);
      setTotals(res.data.totals);
      setTotalPages(res.data.pagination.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the controlled-medicines register.");
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  const loadStaffAudit = useCallback(async () => {
    try {
      const res = await apiService.getControlledStaffAudit(filters);
      if (res.success && res.data) {
        setStaffAudit(res.data.staff);
        setStaffTotals(res.data.totals);
      }
    } catch {
      // Staff tab shows its own empty state; the register tab stays authoritative.
    }
  }, [filters]);

  const loadPack = useCallback(async () => {
    try {
      const res = await apiService.getControlledInspectionPack(filters);
      if (res.success && res.data) setPack(res.data);
    } catch {
      // Inspection tab shows its own empty state.
    }
  }, [filters]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    if (selectedBranchId) setBranchId(selectedBranchId);
  }, [selectedBranchId]);

  useEffect(() => {
    loadRegister();
  }, [loadRegister]);

  useEffect(() => {
    if (tab === "staff") loadStaffAudit();
    if (tab === "pack") loadPack();
  }, [tab, loadStaffAudit, loadPack]);

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.product?.name, e.batchNo, e.customerName, e.staffName, e.invoiceNumber, e.prescriptionRef]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [entries, search]);

  const openReversal = (entry: ControlledRegisterEntry) => {
    setReversalTarget(entry);
    setReversalQty(String(entry.quantity));
    setReversalReason("");
    setReversalError(null);
  };

  const submitReversal = async () => {
    if (!reversalTarget) return;
    const qty = Number(reversalQty);
    if (!Number.isInteger(qty) || qty < 1) {
      setReversalError("Quantity must be a whole number of at least 1.");
      return;
    }
    if (!reversalReason.trim()) {
      setReversalError("A reason is required — reversals are part of the audit trail.");
      return;
    }
    setReversalBusy(true);
    setReversalError(null);
    try {
      const res = await apiService.createControlledReversal({
        originalEntryId: reversalTarget.id,
        quantity: qty,
        reason: reversalReason.trim(),
      });
      if (!res.success) {
        setReversalError(res.message || "Could not record the reversal.");
        return;
      }
      setReversalTarget(null);
      await loadRegister();
    } catch (e) {
      setReversalError(e instanceof Error ? e.message : "Could not record the reversal.");
    } finally {
      setReversalBusy(false);
    }
  };

  const downloadCsv = async () => {
    try {
      await apiService.downloadControlledInspectionPackCsv(filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download the inspection pack.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-red-600" />
            Controlled Medicines Register
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Append-only dispense log for controlled / scheduled medicines. Entries are never edited or
            deleted — corrections are reversal entries.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadRegister} disabled={loading}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" onClick={downloadCsv}>
            <Download className="w-4 h-4 mr-2" />
            Inspection Pack (CSV)
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4 text-sm text-red-800">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cr-start">From</Label>
              <Input id="cr-start" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-end">To</Label>
              <Input id="cr-end" type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-branch">Branch</Label>
              <Select value={branchId} onValueChange={(v) => { setBranchId(v); setPage(1); }}>
                <SelectTrigger id="cr-branch">
                  <SelectValue placeholder="All branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-type">Entry type</Label>
              <Select value={entryType} onValueChange={(v) => { setEntryType(v); setPage(1); }}>
                <SelectTrigger id="cr-type">
                  <SelectValue placeholder="All entries" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All entries</SelectItem>
                  <SelectItem value="DISPENSE">Dispenses</SelectItem>
                  <SelectItem value="REVERSAL">Reversals</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-search">Search</Label>
              <Input id="cr-search" placeholder="Product, batch, customer, invoice…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total dispensed</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totals.totalDispensed}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total reversed</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totals.totalReversed}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Net dispensed</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totals.netDispensed}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Register entries</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totals.entryCount}</div></CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="staff">By staff</TabsTrigger>
          <TabsTrigger value="pack">Inspection pack</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Running balance by product / batch</CardTitle></CardHeader>
            <CardContent>
              {summary.length === 0 ? (
                <p className="text-sm text-muted-foreground">No controlled medicines dispensed in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead className="text-right">Dispensed</TableHead>
                      <TableHead className="text-right">Reversed</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Last entry</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.map((s) => (
                      <TableRow key={`${s.productId}|${s.batchId || ""}`}>
                        <TableCell className="font-medium">{s.productName || s.productId}</TableCell>
                        <TableCell>{s.batchNo || "—"}</TableCell>
                        <TableCell className="text-right">{s.totalDispensed}</TableCell>
                        <TableCell className="text-right">{s.totalReversed}</TableCell>
                        <TableCell className="text-right">{s.netDispensed}</TableCell>
                        <TableCell className="text-right font-medium">{s.currentBalance}</TableCell>
                        <TableCell>{formatDateTime(s.lastEntryAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Entries</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading register…</p>
              ) : visibleEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No register entries match these filters.</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Batch</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead>Staff</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Prescription</TableHead>
                        <TableHead>Invoice</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleEntries.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap">{formatDateTime(e.createdAt)}</TableCell>
                          <TableCell>
                            <Badge variant={e.entryType === "DISPENSE" ? "default" : "secondary"}>
                              {e.entryType === "DISPENSE" ? "Dispense" : "Reversal"}
                            </Badge>
                            {e.entryType === "REVERSAL" && e.reason && (
                              <div className="text-xs text-muted-foreground mt-1">{e.reason}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{e.product?.name || e.productId}</div>
                            <div className="text-xs text-muted-foreground">{scheduleLabel(e)}</div>
                          </TableCell>
                          <TableCell>{e.batchNo || "—"}</TableCell>
                          <TableCell className="text-right">{e.quantity}</TableCell>
                          <TableCell className="text-right font-medium">{e.balanceAfter}</TableCell>
                          <TableCell>{e.staffName || e.staffUserId}</TableCell>
                          <TableCell>{e.customerName || "—"}</TableCell>
                          <TableCell>{e.prescriptionRef || "—"}</TableCell>
                          <TableCell>{e.invoiceNumber || "—"}</TableCell>
                          <TableCell>
                            {e.entryType === "DISPENSE" && (
                              <Button variant="outline" size="sm" onClick={() => openReversal(e)}>
                                <RotateCcw className="w-3 h-3 mr-1" />
                                Reverse
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                        Previous
                      </Button>
                      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="staff">
          <Card>
            <CardHeader><CardTitle>Dispensing audit by staff</CardTitle></CardHeader>
            <CardContent>
              {staffAudit.length === 0 ? (
                <p className="text-sm text-muted-foreground">No dispensing activity in this period.</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Staff</TableHead>
                        <TableHead className="text-right">Dispensed</TableHead>
                        <TableHead className="text-right">Reversed</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                        <TableHead>Last entry</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {staffAudit.map((row) => (
                        <TableRow key={row.staffUserId}>
                          <TableCell className="font-medium">{row.staffName || row.staffUserId}</TableCell>
                          <TableCell className="text-right">{row.totalDispensed}</TableCell>
                          <TableCell className="text-right">{row.totalReversed}</TableCell>
                          <TableCell className="text-right">{row.netDispensed}</TableCell>
                          <TableCell className="text-right">{row.entryCount}</TableCell>
                          <TableCell>{formatDateTime(row.lastEntryAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="text-sm text-muted-foreground mt-4">
                    Totals — dispensed {staffTotals.totalDispensed}, reversed {staffTotals.totalReversed}, net {staffTotals.netDispensed}.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pack">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Inspection pack</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={downloadCsv}>
                    <Download className="w-4 h-4 mr-2" />
                    Download CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => window.print()}>
                    <Printer className="w-4 h-4 mr-2" />
                    Print
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!pack ? (
                <p className="text-sm text-muted-foreground">No inspection pack for this period.</p>
              ) : (
                <div className="space-y-4">
                  <div className="text-sm space-y-1">
                    <p><span className="font-medium">Business:</span> {pack.businessName || "—"}</p>
                    <p><span className="font-medium">Branches:</span> {pack.branchNames.length > 0 ? pack.branchNames.join(", ") : "All branches"}</p>
                    <p><span className="font-medium">Period:</span> {formatDate(pack.period.from) || "—"} → {formatDate(pack.period.to) || "—"}</p>
                    <p><span className="font-medium">Generated:</span> {formatDateTime(pack.generatedAt)}{pack.generatedBy ? ` by ${pack.generatedBy}` : ""}</p>
                    <p>
                      <span className="font-medium">Totals:</span> dispensed {pack.totals.totalDispensed}, reversed {pack.totals.totalReversed}, net {pack.totals.netDispensed}, {pack.totals.entryCount} entries.
                    </p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Batch</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead>Staff</TableHead>
                        <TableHead>Branch</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pack.entries.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap">{formatDateTime(e.createdAt)}</TableCell>
                          <TableCell>{e.entryType === "DISPENSE" ? "Dispense" : "Reversal"}</TableCell>
                          <TableCell>{e.product?.name || e.productId}</TableCell>
                          <TableCell>{e.batchNo || "—"}</TableCell>
                          <TableCell className="text-right">{e.quantity}</TableCell>
                          <TableCell className="text-right">{e.balanceAfter}</TableCell>
                          <TableCell>{e.staffName || e.staffUserId}</TableCell>
                          <TableCell>{e.branchName || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={reversalTarget !== null} onOpenChange={(open) => { if (!open) setReversalTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse a dispense</DialogTitle>
            <DialogDescription>
              This appends a REVERSAL entry to the register. The original dispense entry is never changed.
              {reversalTarget && (
                <> Reversing {reversalTarget.product?.name || reversalTarget.productId} — {reversalTarget.quantity} units dispensed on {formatDateTime(reversalTarget.createdAt)}.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cr-reversal-qty">Quantity to reverse (units)</Label>
              <Input
                id="cr-reversal-qty"
                type="number"
                min={1}
                max={reversalTarget?.quantity}
                value={reversalQty}
                onChange={(e) => setReversalQty(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-reversal-reason">Reason (required)</Label>
              <Textarea
                id="cr-reversal-reason"
                placeholder="e.g. Refund: customer returned 4 tablets"
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
              />
            </div>
            {reversalError && <p className="text-sm text-red-600">{reversalError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReversalTarget(null)} disabled={reversalBusy}>
                Cancel
              </Button>
              <Button onClick={submitReversal} disabled={reversalBusy}>
                {reversalBusy ? "Recording…" : "Record reversal"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ControlledRegister;
