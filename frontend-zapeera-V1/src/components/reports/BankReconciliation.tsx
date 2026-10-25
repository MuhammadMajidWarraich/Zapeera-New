import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Landmark, RefreshCw, Plus, Wand2, CheckCheck, EyeOff, Undo2 } from "lucide-react";
import { apiService } from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";

/**
 * Bank Reconciliation (Wave B — Item 8).
 * Accounts → statements (CSV paste or manual lines) → auto-match
 * against ledger rows (sale payments, expenses, refunds, khata
 * payments) → per-period reconciliation record. Matching never
 * creates or edits ledger rows; it only links a statement line to
 * a ledger entry. A statement is RECONCILED only when its books
 * agree (difference 0 and nothing unmatched).
 */

const formatPKR = (v: number) => `PKR ${Math.round(Number(v || 0)).toLocaleString()}`;
const formatDate = (d?: string) => (d ? new Date(d).toLocaleDateString() : "—");

const statusBadge = (status: string) => {
  if (status === "MATCHED") return <Badge className="bg-green-600">Matched</Badge>;
  if (status === "IGNORED") return <Badge variant="secondary">Ignored</Badge>;
  if (status === "RECONCILED") return <Badge className="bg-green-600">Reconciled</Badge>;
  if (status === "COMPLETED") return <Badge className="bg-green-600">Completed</Badge>;
  return <Badge variant="outline">Unmatched</Badge>;
};

interface ManualLine { date: string; description: string; reference: string; amount: string }

const emptyLine = (): ManualLine => ({ date: new Date().toISOString().slice(0, 10), description: "", reference: "", amount: "" });

const BankReconciliation = () => {
  const { selectedBranchId, selectedCompanyId } = useAdmin();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [statements, setStatements] = useState<any[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<any>(null);
  const [reconciliations, setReconciliations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [matching, setMatching] = useState(false);

  // Create-account form
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: "", bankName: "", accountNumber: "", accountType: "CURRENT", openingBalance: "0" });

  // Create-statement form
  const [showStatementForm, setShowStatementForm] = useState(false);
  const [stmtForm, setStmtForm] = useState({ periodStart: "", periodEnd: "", openingBalance: "0", closingBalance: "0", csvText: "" });
  const [manualLines, setManualLines] = useState<ManualLine[]>([emptyLine()]);
  const [useCsv, setUseCsv] = useState(true);

  const scopeParams = useCallback((): any => {
    const p: any = { companyId: selectedCompanyId };
    if (selectedBranchId) p.branchId = selectedBranchId;
    return p;
  }, [selectedBranchId, selectedCompanyId]);

  const fetchAccounts = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const res = await apiService.getBankAccounts(scopeParams());
      if (res.success) {
        setAccounts(res.data || []);
        if (res.data?.length && !selectedAccountId) setSelectedAccountId(res.data[0].id);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to load bank accounts", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, scopeParams, selectedAccountId]);

  const fetchStatements = useCallback(async () => {
    if (!selectedCompanyId || !selectedAccountId) return;
    try {
      const [stmtRes, reconRes] = await Promise.all([
        apiService.getBankStatements({ ...scopeParams(), bankAccountId: selectedAccountId }),
        apiService.getReconciliations({ ...scopeParams(), bankAccountId: selectedAccountId }),
      ]);
      if (stmtRes.success) setStatements(stmtRes.data || []);
      if (reconRes.success) setReconciliations(reconRes.data || []);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to load statements", variant: "destructive" });
    }
  }, [selectedCompanyId, selectedAccountId, scopeParams]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);
  useEffect(() => { fetchStatements(); }, [fetchStatements]);
  useEffect(() => { setSelectedStatement(null); }, [selectedAccountId]);

  const openStatement = async (id: string) => {
    try {
      const res = await apiService.getBankStatement(id);
      if (res.success) setSelectedStatement(res.data);
      else toast({ title: "Error", description: "Statement failed to load", variant: "destructive" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to load statement", variant: "destructive" });
    }
  };

  const submitAccount = async () => {
    if (!accountForm.name.trim()) {
      toast({ title: "Error", description: "Account name is required", variant: "destructive" });
      return;
    }
    try {
      const res = await apiService.createBankAccount({
        ...scopeParams(),
        name: accountForm.name.trim(),
        bankName: accountForm.bankName.trim() || undefined,
        accountNumber: accountForm.accountNumber.trim() || undefined,
        accountType: accountForm.accountType,
        openingBalance: Number(accountForm.openingBalance || 0),
      });
      if (res.success) {
        toast({ title: "Bank account added" });
        setShowAccountForm(false);
        setAccountForm({ name: "", bankName: "", accountNumber: "", accountType: "CURRENT", openingBalance: "0" });
        fetchAccounts();
      } else {
        toast({ title: "Error", description: res.message || "Could not add account", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Could not add account", variant: "destructive" });
    }
  };

  const submitStatement = async () => {
    if (!stmtForm.periodStart || !stmtForm.periodEnd) {
      toast({ title: "Error", description: "Statement period start and end are required", variant: "destructive" });
      return;
    }
    try {
      const payload: any = {
        bankAccountId: selectedAccountId,
        periodStart: stmtForm.periodStart,
        periodEnd: stmtForm.periodEnd,
        openingBalance: Number(stmtForm.openingBalance || 0),
        closingBalance: Number(stmtForm.closingBalance || 0),
      };
      if (useCsv) {
        if (!stmtForm.csvText.trim()) {
          toast({ title: "Error", description: "Paste the bank CSV export first", variant: "destructive" });
          return;
        }
        payload.csvText = stmtForm.csvText;
      } else {
        const lines = manualLines
          .filter((l) => l.description.trim() && l.amount.trim() !== "")
          .map((l) => ({ txnDate: l.date, description: l.description.trim(), reference: l.reference.trim() || undefined, amount: Number(l.amount) }));
        if (lines.length === 0) {
          toast({ title: "Error", description: "Add at least one statement line", variant: "destructive" });
          return;
        }
        payload.lines = lines;
      }
      const res = await apiService.createBankStatement(payload);
      if (res.success) {
        toast({ title: "Statement recorded", description: `${res.data?.lines?.length || 0} lines imported` });
        setShowStatementForm(false);
        setStmtForm({ periodStart: "", periodEnd: "", openingBalance: "0", closingBalance: "0", csvText: "" });
        setManualLines([emptyLine()]);
        fetchStatements();
      } else {
        toast({ title: "Error", description: (res as any).message || "Could not record statement", variant: "destructive" });
      }
    } catch (err: any) {
      const detail = err?.message || "Could not record statement";
      toast({ title: "Error", description: detail, variant: "destructive" });
    }
  };

  const runAutoMatch = async () => {
    if (!selectedStatement) return;
    setMatching(true);
    try {
      const res = await apiService.autoMatchStatement(selectedStatement.id);
      if (res.success) {
        toast({ title: "Auto-match complete", description: `${res.data.matched.length} line(s) matched, ${res.data.unmatchedLineIds.length} still unmatched` });
        openStatement(selectedStatement.id);
        fetchStatements();
      } else {
        toast({ title: "Error", description: "Auto-match failed", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Auto-match failed", variant: "destructive" });
    } finally {
      setMatching(false);
    }
  };

  const lineAction = async (lineId: string, action: "unmatch" | "ignore") => {
    if (!selectedStatement) return;
    try {
      const res = action === "unmatch"
        ? await apiService.unmatchStatementLine(selectedStatement.id, lineId)
        : await apiService.ignoreStatementLine(selectedStatement.id, lineId);
      if (res.success) openStatement(selectedStatement.id);
      else toast({ title: "Error", description: "Action failed", variant: "destructive" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Action failed", variant: "destructive" });
    }
  };

  const createRecon = async () => {
    if (!selectedStatement) return;
    try {
      const res = await apiService.createReconciliation({
        bankAccountId: selectedAccountId,
        statementId: selectedStatement.id,
        periodStart: selectedStatement.periodStart,
        periodEnd: selectedStatement.periodEnd,
      });
      if (res.success) {
        toast({ title: "Reconciliation recorded", description: `Difference ${formatPKR(res.data.difference)}` });
        fetchStatements();
      } else {
        toast({ title: "Error", description: "Could not record reconciliation", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Could not record reconciliation", variant: "destructive" });
    }
  };

  const completeRecon = async (reconId: string) => {
    try {
      const res = await apiService.completeReconciliation(reconId);
      if (res.success) {
        toast({
          title: res.data.statementBalanced ? "Reconciliation completed — books agree" : "Reconciliation completed with a difference",
          description: `Difference ${formatPKR(res.data.difference)} · ${res.data.summary.matchedCount} matched, ${res.data.summary.unmatchedCount} unmatched`,
        });
        fetchStatements();
        if (selectedStatement) openStatement(selectedStatement.id);
      } else {
        toast({ title: "Error", description: "Could not complete reconciliation", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Could not complete reconciliation", variant: "destructive" });
    }
  };

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const openRecon = selectedStatement
    ? reconciliations.find((r) => r.statementId === selectedStatement.id && r.status === "OPEN")
    : undefined;
  const summary = selectedStatement?.summary;

  return (
    <Card className="print:shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-primary" /> Bank Reconciliation
          <span className="text-sm font-normal text-muted-foreground">
            Match bank statement lines against sales, expenses, refunds and khata payments — no ledger rows are changed.
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Accounts */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="w-[280px]"><SelectValue placeholder="Select a bank account" /></SelectTrigger>
            <SelectContent>
              {accounts.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}{a.bankName ? ` — ${a.bankName}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchAccounts} disabled={loading} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" onClick={() => setShowAccountForm((v) => !v)}>
            <Plus className="mr-1 h-4 w-4" /> Add account
          </Button>
          {accounts.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">No bank accounts yet — add one to start reconciling.</p>
          )}
        </div>

        {showAccountForm && (
          <div className="grid gap-3 rounded-md border p-4 md:grid-cols-3">
            <div><Label>Account name *</Label><Input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} placeholder="HBL Current — Main" /></div>
            <div><Label>Bank</Label><Input value={accountForm.bankName} onChange={(e) => setAccountForm({ ...accountForm, bankName: e.target.value })} placeholder="HBL" /></div>
            <div><Label>Account no. (last 4 / masked)</Label><Input value={accountForm.accountNumber} onChange={(e) => setAccountForm({ ...accountForm, accountNumber: e.target.value })} placeholder="…4832" /></div>
            <div>
              <Label>Type</Label>
              <Select value={accountForm.accountType} onValueChange={(v) => setAccountForm({ ...accountForm, accountType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CURRENT">Current</SelectItem>
                  <SelectItem value="SAVINGS">Savings</SelectItem>
                  <SelectItem value="WALLET">Wallet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Opening balance (PKR)</Label><Input type="number" value={accountForm.openingBalance} onChange={(e) => setAccountForm({ ...accountForm, openingBalance: e.target.value })} /></div>
            <div className="flex items-end"><Button onClick={submitAccount}>Save account</Button></div>
          </div>
        )}

        {selectedAccount && (
          <>
            {/* Statements */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">Statements — {selectedAccount.name}</h4>
              <Button variant="outline" onClick={() => setShowStatementForm((v) => !v)}>
                <Plus className="mr-1 h-4 w-4" /> Record statement
              </Button>
            </div>

            {showStatementForm && (
              <div className="space-y-3 rounded-md border p-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div><Label>Period start *</Label><Input type="date" value={stmtForm.periodStart} onChange={(e) => setStmtForm({ ...stmtForm, periodStart: e.target.value })} /></div>
                  <div><Label>Period end *</Label><Input type="date" value={stmtForm.periodEnd} onChange={(e) => setStmtForm({ ...stmtForm, periodEnd: e.target.value })} /></div>
                  <div><Label>Opening balance (PKR)</Label><Input type="number" value={stmtForm.openingBalance} onChange={(e) => setStmtForm({ ...stmtForm, openingBalance: e.target.value })} /></div>
                  <div><Label>Closing balance (PKR)</Label><Input type="number" value={stmtForm.closingBalance} onChange={(e) => setStmtForm({ ...stmtForm, closingBalance: e.target.value })} /></div>
                </div>
                <div className="flex gap-2">
                  <Button variant={useCsv ? "default" : "outline"} size="sm" onClick={() => setUseCsv(true)}>Paste bank CSV</Button>
                  <Button variant={!useCsv ? "default" : "outline"} size="sm" onClick={() => setUseCsv(false)}>Enter lines manually</Button>
                </div>
                {useCsv ? (
                  <div>
                    <Label>Bank CSV — columns: date, description, reference, amount (signed: + in, − out)</Label>
                    <Textarea rows={5} value={stmtForm.csvText} onChange={(e) => setStmtForm({ ...stmtForm, csvText: e.target.value })} placeholder={"Date,Description,Reference,Amount\n2026-10-10,JazzCash settlement,TXN-1001,5000\n2026-10-11,Rent payment,EXP-9,-2500"} />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">Amount (PKR)</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {manualLines.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell><Input type="date" value={l.date} onChange={(e) => setManualLines(manualLines.map((m, j) => (j === i ? { ...m, date: e.target.value } : m)))} /></TableCell>
                          <TableCell><Input value={l.description} onChange={(e) => setManualLines(manualLines.map((m, j) => (j === i ? { ...m, description: e.target.value } : m)))} placeholder="Description" /></TableCell>
                          <TableCell><Input value={l.reference} onChange={(e) => setManualLines(manualLines.map((m, j) => (j === i ? { ...m, reference: e.target.value } : m)))} placeholder="Reference" /></TableCell>
                          <TableCell><Input type="number" className="text-right" value={l.amount} onChange={(e) => setManualLines(manualLines.map((m, j) => (j === i ? { ...m, amount: e.target.value } : m)))} placeholder="0" /></TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => setManualLines(manualLines.filter((_, j) => j !== i))} disabled={manualLines.length === 1}>✕</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {!useCsv && (
                  <Button variant="outline" size="sm" onClick={() => setManualLines([...manualLines, emptyLine()])}>
                    <Plus className="mr-1 h-4 w-4" /> Add line
                  </Button>
                )}
                <div><Button onClick={submitStatement}>Save statement</Button></div>
              </div>
            )}

            {statements.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead className="text-right">Matched</TableHead>
                    <TableHead className="text-right">Unmatched</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statements.map((s: any) => (
                    <TableRow key={s.id} className={selectedStatement?.id === s.id ? "bg-muted/50" : ""}>
                      <TableCell>{formatDate(s.periodStart)} – {formatDate(s.periodEnd)}</TableCell>
                      <TableCell>{statusBadge(s.status)}</TableCell>
                      <TableCell className="text-right">{s.lineCount}</TableCell>
                      <TableCell className="text-right">{s.summary?.matchedCount || 0}</TableCell>
                      <TableCell className="text-right">{s.summary?.unmatchedCount || 0}</TableCell>
                      <TableCell className="text-right">{formatPKR(s.summary?.difference || 0)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => openStatement(s.id)}>Open</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Selected statement detail */}
            {selectedStatement && (
              <div className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">
                    {formatDate(selectedStatement.periodStart)} – {formatDate(selectedStatement.periodEnd)}
                    {" "}· {selectedStatement.lines?.length || 0} lines
                  </h4>
                  <div className="flex gap-2">
                    <Button onClick={runAutoMatch} disabled={matching || selectedStatement.status === "RECONCILED"}>
                      <Wand2 className="mr-1 h-4 w-4" /> {matching ? "Matching…" : "Auto-match"}
                    </Button>
                    {!openRecon && (
                      <Button variant="outline" onClick={createRecon}>
                        <CheckCheck className="mr-1 h-4 w-4" /> Record reconciliation
                      </Button>
                    )}
                    {openRecon && (
                      <Button variant="outline" onClick={() => completeRecon(openRecon.id)}>
                        <CheckCheck className="mr-1 h-4 w-4" /> Complete reconciliation
                      </Button>
                    )}
                  </div>
                </div>
                {summary && (
                  <p className="text-sm text-muted-foreground">
                    Opening {formatPKR(selectedStatement.openingBalance)} · Closing {formatPKR(selectedStatement.closingBalance)} ·{" "}
                    Ledger closing {formatPKR(summary.ledgerClosingBalance)} ·{" "}
                    <span className={summary.difference === 0 ? "font-semibold text-green-600" : "font-semibold text-red-600"}>
                      Difference {formatPKR(summary.difference)}
                    </span>{" "}
                    · {summary.matchedCount} matched · {summary.unmatchedCount} unmatched · {summary.ignoredCount} ignored
                    {summary.isBalanced && " · Books agree ✓"}
                  </p>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selectedStatement.lines || []).map((l: any) => (
                      <TableRow key={l.id}>
                        <TableCell>{formatDate(l.txnDate)}</TableCell>
                        <TableCell>{l.description}</TableCell>
                        <TableCell>{l.reference || "—"}</TableCell>
                        <TableCell className={`text-right ${l.amount < 0 ? "text-red-600" : "text-green-700"}`}>{formatPKR(l.amount)}</TableCell>
                        <TableCell>{statusBadge(l.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {l.status === "MATCHED"
                            ? `${l.matchedLedgerKind} · ${l.matchMethod}${l.matchConfidence != null ? ` (${Math.round(l.matchConfidence)}%)` : ""}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {l.status === "MATCHED" && (
                            <Button variant="ghost" size="sm" title="Unmatch" onClick={() => lineAction(l.id, "unmatch")}>
                              <Undo2 className="h-4 w-4" />
                            </Button>
                          )}
                          {l.status === "UNMATCHED" && (
                            <Button variant="ghost" size="sm" title="Ignore (e.g. bank fee with no ledger row)" onClick={() => lineAction(l.id, "ignore")}>
                              <EyeOff className="h-4 w-4" />
                            </Button>
                          )}
                          {l.status === "IGNORED" && (
                            <Button variant="ghost" size="sm" title="Back to unmatched" onClick={() => lineAction(l.id, "unmatch")}>
                              <Undo2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {reconciliations.filter((r: any) => r.statementId === selectedStatement.id).length > 0 && (
                  <div>
                    <h5 className="mb-1 text-sm font-semibold">Reconciliations for this period</h5>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Matched</TableHead>
                          <TableHead className="text-right">Unmatched</TableHead>
                          <TableHead className="text-right">Difference</TableHead>
                          <TableHead>Completed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reconciliations.filter((r: any) => r.statementId === selectedStatement.id).map((r: any) => (
                          <TableRow key={r.id}>
                            <TableCell>{statusBadge(r.status)}</TableCell>
                            <TableCell className="text-right">{r.matchedCount}</TableCell>
                            <TableCell className="text-right">{r.unmatchedCount}</TableCell>
                            <TableCell className="text-right">{formatPKR(r.difference)}</TableCell>
                            <TableCell>{r.completedAt ? formatDate(r.completedAt) : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default BankReconciliation;
