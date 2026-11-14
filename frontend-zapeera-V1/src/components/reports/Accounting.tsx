import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BookOpenCheck, RefreshCw, Printer, TrendingUp, TrendingDown,
  Wallet, Users, Truck, AlertTriangle, Scale,
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";
import BankReconciliation from "./BankReconciliation";

/**
 * Accounting (Wave B8) — accounting-lite, read-only, plus the
 * double-entry ledger (v1.0.22 full scope).
 * Every number on this page comes from the /reports/accounting/*
 * endpoints, which compute from real rows (sales, batch costs,
 * refunds, expenses, purchases, khata ledger, sale payments) or from
 * balanced journal entries. No figure is estimated or derived in the
 * browser, except the ledger-vs-derived reconciliation note, which
 * subtracts the two endpoint responses. The page's only write action
 * is posting opening balances (idempotent, server-side).
 */

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 Days" },
  { value: "last30", label: "Last 30 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "thisYear", label: "This Year" },
];

const formatPKR = (v: number) => `PKR ${Math.round(Number(v || 0)).toLocaleString()}`;
const formatDate = (d?: string) => (d ? new Date(d).toLocaleDateString() : "—");

interface TenderRow { method: string; amount: number; count: number }

const TenderTable = ({ rows }: { rows: TenderRow[] }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Method</TableHead>
        <TableHead className="text-right">Entries</TableHead>
        <TableHead className="text-right">Amount</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.length === 0 && (
        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No entries in this period</TableCell></TableRow>
      )}
      {rows.map((r) => (
        <TableRow key={r.method}>
          <TableCell>{r.method}</TableCell>
          <TableCell className="text-right">{r.count}</TableCell>
          <TableCell className="text-right">{formatPKR(r.amount)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const StatementRow = ({
  label, value, bold, muted, negative,
}: { label: React.ReactNode; value: number; bold?: boolean; muted?: boolean; negative?: boolean }) => (
  <div className={`flex items-center justify-between py-1.5 ${bold ? "border-t pt-2.5 font-bold text-base" : ""}`}>
    <span className={muted ? "text-muted-foreground pl-4" : ""}>{label}</span>
    <span className={negative ? "text-red-600" : ""}>{negative ? `− ${formatPKR(Math.abs(value))}` : formatPKR(value)}</span>
  </div>
);

const Accounting = () => {
  const { selectedBranchId, selectedCompanyId } = useAdmin();
  const [period, setPeriod] = useState("thisMonth");
  const [loading, setLoading] = useState(false);
  const [pnl, setPnl] = useState<any>(null);
  const [pnlCompare, setPnlCompare] = useState<any>(null);
  const [cashbook, setCashbook] = useState<any>(null);
  const [ageing, setAgeing] = useState<any>(null);
  const [payables, setPayables] = useState<any>(null);
  // Derived financial position (v1.0.22): point-in-time, so it takes
  // scope only, no period — like ageing and payables.
  const [position, setPosition] = useState<any>(null);
  // Double-entry ledger (v1.0.22 full scope): the PRIMARY trial
  // balance / balance sheet, from journals + opening balances. The
  // derived position above stays as a cross-check.
  const [ledgerTb, setLedgerTb] = useState<any>(null);
  const [ledgerBs, setLedgerBs] = useState<any>(null);
  const [postingOpening, setPostingOpening] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const scopeParams: any = { companyId: selectedCompanyId };
      if (selectedBranchId) scopeParams.branchId = selectedBranchId;
      const periodParams = { ...scopeParams, period };

      const [pnlRes, cmpRes, cashRes, ageRes, payRes, posRes, ledTbRes, ledBsRes] = await Promise.all([
        apiService.getAccountingPnl(periodParams),
        apiService.getPnlComparison(periodParams),
        apiService.getCashbook(periodParams),
        apiService.getReceivablesAgeing(scopeParams),
        apiService.getPayables(scopeParams),
        apiService.getFinancialPosition(scopeParams),
        apiService.getLedgerTrialBalance(scopeParams),
        apiService.getLedgerBalanceSheet(scopeParams),
      ]);
      if (pnlRes.success) setPnl(pnlRes.data);
      if (cmpRes.success) setPnlCompare(cmpRes.data);
      if (cashRes.success) setCashbook(cashRes.data);
      if (ageRes.success) setAgeing(ageRes.data);
      if (payRes.success) setPayables(payRes.data);
      if (posRes.success) setPosition(posRes.data);
      if (ledTbRes.success) setLedgerTb(ledTbRes.data);
      if (ledBsRes.success) setLedgerBs(ledBsRes.data);
      if (!pnlRes.success || !cashRes.success || !ageRes.success || !payRes.success || !posRes.success || !ledTbRes.success || !ledBsRes.success) {
        toast({ title: "Error", description: "Some accounting figures failed to load", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to load accounting reports", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [period, selectedBranchId, selectedCompanyId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Opening balances (v1.0.22): idempotent — scopes already posted
  // are skipped server-side. Runs for the selected branch, or every
  // scope of the business when no branch is selected.
  const handlePostOpening = async () => {
    if (!selectedCompanyId) return;
    setPostingOpening(true);
    try {
      const body: any = {};
      if (selectedBranchId) body.branchId = selectedBranchId;
      const res = await apiService.postLedgerOpeningBalances(body);
      if (res.success) {
        const created = (res.data?.results || []).filter((r: any) => r.status === 'created' || r.status === 'created-zero').length;
        const skipped = (res.data?.results || []).filter((r: any) => r.status === 'skipped-existing').length;
        toast({ title: "Opening balances posted", description: `${created} scope(s) posted, ${skipped} already posted.` });
        fetchAll();
      } else {
        toast({ title: "Error", description: "Failed to post opening balances", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to post opening balances", variant: "destructive" });
    } finally {
      setPostingOpening(false);
    }
  };

  const unknownCostLines = (pnl?.cogs?.unknownCostLines || 0) + (pnl?.cogs?.unknownRefundCostLines || 0);
  const ledgerOpeningPosted = ledgerTb?.openingPosted === true && ledgerBs?.openingPosted === true;
  const ledgerExceptions = ledgerTb?.exceptions;
  // Reconciliation note (computed in the browser from the two
  // responses — no new endpoint): ledger vs derived cross-check.
  const recon = ledgerBs && position ? {
    assetsDiff: Math.round((Number(ledgerBs.totalAssets) || 0) - (Number(position.assets?.total) || 0)),
    equitySideDiff: Math.round(((Number(ledgerBs.totalLiabilities) || 0) + (Number(ledgerBs.totalEquity) || 0)) - ((Number(position.liabilities?.total) || 0) + (Number(position.retainedProfit) || 0))),
  } : null;

  return (
    <div className="space-y-6 p-4 md:p-6 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <BookOpenCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Accounting</h1>
            <p className="text-sm text-muted-foreground">
              Profit &amp; loss, receivables ageing, payables and cashbook — computed from real sales, batch costs, expenses and the khata ledger.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchAll} disabled={loading} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" size="icon" onClick={() => window.print()} title="Print">
            <Printer className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ─── Profit & Loss ─── */}
      <Card className="print:shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {pnl && pnl.netProfit >= 0 ? <TrendingUp className="h-5 w-5 text-green-600" /> : <TrendingDown className="h-5 w-5 text-red-600" />}
            Profit &amp; Loss
            {pnl && (
              <span className="text-sm font-normal text-muted-foreground">
                {formatDate(pnl.period?.from)} – {formatDate(pnl.period?.to)} · {pnl.counts?.sales || 0} sales · {pnl.counts?.refunds || 0} refunds
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!pnl ? (
            <p className="text-muted-foreground">{loading ? "Loading…" : "No data"}</p>
          ) : (
            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <StatementRow label="Gross revenue" value={pnl.revenue.gross} />
                <StatementRow label="Less: refunds" value={pnl.revenue.refunds} muted negative />
                <StatementRow label="Net revenue" value={pnl.revenue.net} bold />
                <StatementRow label="Cost of goods sold (batch cost)" value={pnl.cogs.gross} muted />
                <StatementRow label="Less: refunded goods back in stock" value={pnl.cogs.refundReversal} muted negative />
                <StatementRow label="Net cost of goods sold" value={pnl.cogs.net} bold />
                <StatementRow label="Gross profit" value={pnl.grossProfit} bold />
                <StatementRow label="Less: expenses" value={pnl.expenses.total} muted negative />
                <StatementRow label="Net profit" value={pnl.netProfit} bold />
                {unknownCostLines > 0 && (
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-600">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {unknownCostLines} sale/refund line(s) have no batch cost on record, so their cost is
                    excluded from COGS — gross profit is overstated by that unknown amount.
                  </p>
                )}
              </div>
              <div>
                <h4 className="mb-2 text-sm font-semibold">Expenses by category ({pnl.expenses.count} entries)</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Entries</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(pnl.expenses.byCategory || []).length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No expenses in this period</TableCell></TableRow>
                    )}
                    {(pnl.expenses.byCategory || []).map((c: any) => (
                      <TableRow key={c.categoryId || "none"}>
                        <TableCell>{c.category}</TableCell>
                        <TableCell className="text-right">{c.count}</TableCell>
                        <TableCell className="text-right">{formatPKR(c.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          {/* ─── Period comparison + branch breakdown (Item 8) ─── */}
          {pnlCompare && (
            <div className="mt-8 space-y-6 border-t pt-6">
              <div>
                <h4 className="mb-2 text-sm font-semibold">
                  vs previous period ({formatDate(pnlCompare.previousPeriod?.from)} – {formatDate(pnlCompare.previousPeriod?.to)})
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead className="text-right">Current</TableHead>
                      <TableHead className="text-right">Previous</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="text-right">% change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { label: "Net revenue", d: pnlCompare.comparison?.revenue?.net },
                      { label: "Net COGS", d: pnlCompare.comparison?.cogs?.net },
                      { label: "Gross profit", d: pnlCompare.comparison?.grossProfit },
                      { label: "Expenses", d: pnlCompare.comparison?.expenses },
                      { label: "Net profit", d: pnlCompare.comparison?.netProfit },
                    ].map((r) => (
                      <TableRow key={r.label} className={r.label === "Net profit" ? "font-bold" : ""}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className="text-right">{formatPKR(r.d?.current || 0)}</TableCell>
                        <TableCell className="text-right">{formatPKR(r.d?.previous || 0)}</TableCell>
                        <TableCell className={`text-right ${(r.d?.change || 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {(r.d?.change || 0) >= 0 ? "+" : "−"}{formatPKR(Math.abs(r.d?.change || 0))}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.d?.pctChange == null ? "—" : `${r.d.pctChange >= 0 ? "+" : ""}${r.d.pctChange}%`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {(pnlCompare.byBranch || []).length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold">Branch breakdown — this period</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Branch</TableHead>
                        <TableHead className="text-right">Net revenue</TableHead>
                        <TableHead className="text-right">Gross profit</TableHead>
                        <TableHead className="text-right">Expenses</TableHead>
                        <TableHead className="text-right">Net profit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pnlCompare.byBranch.map((b: any) => (
                        <TableRow key={b.branchId}>
                          <TableCell className="font-medium">{b.branchName}</TableCell>
                          <TableCell className="text-right">{formatPKR(b.revenue?.net || 0)}</TableCell>
                          <TableCell className="text-right">{formatPKR(b.grossProfit || 0)}</TableCell>
                          <TableCell className="text-right">{formatPKR(b.expenses?.total || 0)}</TableCell>
                          <TableCell className={`text-right font-semibold ${(b.netProfit || 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{formatPKR(b.netProfit || 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Ledger — double-entry trial balance + balance sheet (v1.0.22 full scope) ─── */}
      {/* PRIMARY display: built from balanced journal entries posted by
          the sale, refund, purchase, expense, khata, gift-card, wallet
          and wastage flows, plus flagged opening balances derived once
          from live data at cutover. No historical backfill: journals
          record postings from cutover forward. Point-in-time: the
          period selector above does not apply. */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="print:shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" /> Trial Balance (Ledger)
              {ledgerTb && <span className="text-sm font-normal text-muted-foreground">as of {formatDate(ledgerTb.asOf)}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!ledgerTb ? (
              <p className="text-muted-foreground">{loading ? "Loading…" : "No data"}</p>
            ) : (
              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgerTb.rows.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No journal entries yet — post opening balances to start the books.</TableCell></TableRow>
                    )}
                    {ledgerTb.rows.map((row: any) => (
                      <TableRow key={row.accountId}>
                        <TableCell>
                          {row.code} — {row.name}
                          <span className="block text-xs text-muted-foreground">{row.type}</span>
                        </TableCell>
                        <TableCell className="text-right">{row.debitTotal ? formatPKR(row.debitTotal) : "—"}</TableCell>
                        <TableCell className="text-right">{row.creditTotal ? formatPKR(row.creditTotal) : "—"}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold">
                      <TableCell>Totals</TableCell>
                      <TableCell className="text-right">{formatPKR(ledgerTb.totalDebits)}</TableCell>
                      <TableCell className="text-right">{formatPKR(ledgerTb.totalCredits)}</TableCell>
                    </TableRow>
                    <TableRow className="font-semibold text-amber-800">
                      <TableCell>Difference (debits − credits, shown, never plugged)</TableCell>
                      <TableCell className="text-right" colSpan={2}>{formatPKR(ledgerTb.difference)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                {!ledgerOpeningPosted && (
                  <div className="space-y-2 rounded-md bg-amber-50 px-3 py-2 text-amber-800">
                    <p className="text-xs leading-relaxed">
                      Opening balances have not been posted for this scope yet. The ledger only holds
                      postings from cutover forward — post opening balances once to carry the prior
                      position (inventory, khata, payables, bank, gift cards, wallets) into the books.
                    </p>
                    <Button size="sm" onClick={handlePostOpening} disabled={postingOpening}>
                      {postingOpening ? "Posting…" : "Post opening balances"}
                    </Button>
                  </div>
                )}
                {ledgerExceptions && ledgerExceptions.unresolvedCount > 0 && (
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                    <span className="font-semibold">{ledgerExceptions.unresolvedCount} posting exception(s):</span>{" "}
                    postings that could not be fully constructed (e.g. unknown batch cost) — the source
                    operations completed, the gaps are listed here, never hidden.
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {ledgerExceptions.recent.slice(0, 5).map((e: any) => (
                        <li key={e.id}>{e.sourceType} — {e.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="print:shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" /> Balance Sheet (Ledger)
              {ledgerBs && <span className="text-sm font-normal text-muted-foreground">as of {formatDate(ledgerBs.asOf)}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!ledgerBs ? (
              <p className="text-muted-foreground">{loading ? "Loading…" : "No data"}</p>
            ) : (
              <div className="space-y-4 text-sm">
                <div>
                  <h4 className="mb-1 font-semibold">Assets</h4>
                  {ledgerBs.assets.length === 0 && <p className="text-muted-foreground">No asset balances yet.</p>}
                  {ledgerBs.assets.map((line: any) => (
                    <StatementRow key={line.code} label={`${line.code} — ${line.name}`} value={line.value} />
                  ))}
                  <div className="flex items-center justify-between border-t pt-2 font-bold">
                    <span>Total assets</span>
                    <span>{formatPKR(ledgerBs.totalAssets)}</span>
                  </div>
                </div>
                <div>
                  <h4 className="mb-1 font-semibold">Liabilities</h4>
                  {ledgerBs.liabilities.length === 0 && <p className="text-muted-foreground">No liability balances yet.</p>}
                  {ledgerBs.liabilities.map((line: any) => (
                    <StatementRow key={line.code} label={`${line.code} — ${line.name}`} value={line.value} />
                  ))}
                  <div className="flex items-center justify-between border-t pt-2 font-bold">
                    <span>Total liabilities</span>
                    <span>{formatPKR(ledgerBs.totalLiabilities)}</span>
                  </div>
                </div>
                <div>
                  <h4 className="mb-1 font-semibold">Equity</h4>
                  {ledgerBs.equityAccounts.map((line: any) => (
                    <StatementRow key={line.code} label={`${line.code} — ${line.name}`} value={line.value} />
                  ))}
                  <StatementRow label="Retained profit (from income − expense journals)" value={ledgerBs.netIncome} />
                  <div className="flex items-center justify-between border-t pt-2 font-bold">
                    <span>Total equity</span>
                    <span>{formatPKR(ledgerBs.totalEquity)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 font-semibold text-amber-800">
                  <span>Difference (assets − liabilities − equity, shown, never plugged)</span>
                  <span>{formatPKR(ledgerBs.difference)}</span>
                </div>
                {recon && (
                  <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    Reconciliation vs the derived cross-check below: assets differ by {formatPKR(Math.abs(recon.assetsDiff))}
                    {recon.assetsDiff === 0 ? " (agree)" : recon.assetsDiff > 0 ? " (ledger higher)" : " (derived higher)"};
                    liabilities + equity differ by {formatPKR(Math.abs(recon.equitySideDiff))}
                    {recon.equitySideDiff === 0 ? " (agree)" : recon.equitySideDiff > 0 ? " (ledger higher)" : " (derived higher)"}.
                    Differences point at postings the ledger could not construct (see exceptions above),
                    edits made after posting, or activity the ledger does not yet cover (folio
                    settlements, supplier payments, khata adjustments).
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Financial Position — derived balance sheet + trial balance (v1.0.22) ─── */}
      {/* CROSS-CHECK ONLY: a DERIVED position built from real inventory,
          khata, bank, purchase, gift-card, wallet and cumulative P&L
          figures. The ledger cards above are the primary books. The
          unreconciled difference is shown, never plugged. Point-in-time:
          the period selector above does not apply. */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="print:shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" /> Balance Sheet (Derived — cross-check only)
              {position && <span className="text-sm font-normal text-muted-foreground">as of {formatDate(position.asOf)}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!position ? (
              <p className="text-muted-foreground">{loading ? "Loading…" : "No data"}</p>
            ) : (
              <div className="space-y-4 text-sm">
                <div>
                  <h4 className="mb-1 font-semibold">Assets</h4>
                  {position.assets.lines.map((line: any) => (
                    <StatementRow key={line.label} label={line.label} value={line.amount} />
                  ))}
                  <div className="flex items-center justify-between border-t pt-2 font-bold">
                    <span>Total assets</span>
                    <span>{formatPKR(position.assets.total)}</span>
                  </div>
                </div>
                <div>
                  <h4 className="mb-1 font-semibold">Liabilities</h4>
                  {position.liabilities.lines.map((line: any) => (
                    <StatementRow key={line.label} label={line.label} value={line.amount} />
                  ))}
                  <div className="flex items-center justify-between border-t pt-2 font-bold">
                    <span>Total liabilities</span>
                    <span>{formatPKR(position.liabilities.total)}</span>
                  </div>
                </div>
                <StatementRow label="Retained profit (system-era cumulative net profit)" value={position.retainedProfit} bold />
                <div className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 font-semibold text-amber-800">
                  <span>Unreconciled difference (shown, never plugged)</span>
                  <span>{formatPKR(position.unreconciledDifference)}</span>
                </div>
                {position.unknownCostLines > 0 && (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                    {position.unknownCostLines} cumulative sale line(s) have no batch cost on record, so the
                    retained-profit figure understates cost for those lines.
                  </p>
                )}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Derived from real records — not a double-entry ledger. Inventory is valued at batch
                  purchase cost; bank figures come from entered statements and opening balances.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="print:shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" /> Trial Balance (Derived — cross-check only)
              {position && <span className="text-sm font-normal text-muted-foreground">all history to {formatDate(position.asOf)}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!position ? (
              <p className="text-muted-foreground">{loading ? "Loading…" : "No data"}</p>
            ) : (
              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {position.trialBalance.rows.map((row: any) => (
                      <TableRow key={row.account}>
                        <TableCell>
                          {row.account}
                          <span className="block text-xs text-muted-foreground">{row.source}</span>
                        </TableCell>
                        <TableCell className="text-right">{row.debit ? formatPKR(row.debit) : "—"}</TableCell>
                        <TableCell className="text-right">{row.credit ? formatPKR(row.credit) : "—"}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold">
                      <TableCell>Totals</TableCell>
                      <TableCell className="text-right">{formatPKR(position.trialBalance.totalDebits)}</TableCell>
                      <TableCell className="text-right">{formatPKR(position.trialBalance.totalCredits)}</TableCell>
                    </TableRow>
                    <TableRow className="font-semibold text-amber-800">
                      <TableCell>Difference (debits − credits)</TableCell>
                      <TableCell className="text-right" colSpan={2}>{formatPKR(position.trialBalance.difference)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <div>
                  <h4 className="mb-1 text-sm font-semibold">Why the books do not balance</h4>
                  <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                    {position.gaps.map((gap: string) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Bank Reconciliation (Item 8) ─── */}
      <BankReconciliation />

      {/* ─── Cashbook ─── */}
      <Card className="print:shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" /> Cashbook
            {cashbook && (
              <span className={`text-sm font-normal ${cashbook.netMovement >= 0 ? "text-green-600" : "text-red-600"}`}>
                Net movement {formatPKR(cashbook.netMovement)}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!cashbook ? (
            <p className="text-muted-foreground">{loading ? "Loading…" : "No data"}</p>
          ) : (
            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <h4 className="mb-1 text-sm font-semibold text-green-700">Money in — {formatPKR(cashbook.moneyIn.total)}</h4>
                <p className="mb-1 mt-3 text-xs font-medium uppercase text-muted-foreground">Sales receipts by tender</p>
                <TenderTable rows={cashbook.moneyIn.salesReceipts.byMethod} />
                <p className="mb-1 mt-3 text-xs font-medium uppercase text-muted-foreground">Khata payments received</p>
                <TenderTable rows={cashbook.moneyIn.khataPayments.byMethod} />
              </div>
              <div>
                <h4 className="mb-1 text-sm font-semibold text-red-700">Money out — {formatPKR(cashbook.moneyOut.total)}</h4>
                <p className="mb-1 mt-3 text-xs font-medium uppercase text-muted-foreground">Refunds paid out</p>
                <TenderTable rows={cashbook.moneyOut.refunds.byMethod} />
                <div className="mt-3 flex items-center justify-between border-t pt-2 text-sm">
                  <span>Expenses ({cashbook.moneyOut.expenses.count} entries)</span>
                  <span>{formatPKR(cashbook.moneyOut.expenses.total)}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ─── Receivables ageing ─── */}
        <Card className="print:shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" /> Receivables Ageing
              {ageing && <span className="text-sm font-normal text-muted-foreground">as of {formatDate(ageing.asOf)}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!ageing ? (
              <p className="text-muted-foreground">{loading ? "Loading…" : "No data"}</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">0–30d</TableHead>
                      <TableHead className="text-right">31–60d</TableHead>
                      <TableHead className="text-right">61–90d</TableHead>
                      <TableHead className="text-right">90d+</TableHead>
                      <TableHead className="text-right">Total due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(ageing.rows || []).length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No customer dues outstanding</TableCell></TableRow>
                    )}
                    {(ageing.rows || []).map((r: any) => (
                      <TableRow key={r.customerId}>
                        <TableCell>
                          <div className="font-medium">{r.customerName}</div>
                          {r.phone && <div className="text-xs text-muted-foreground">{r.phone}</div>}
                        </TableCell>
                        <TableCell className="text-right">{formatPKR(r.buckets.days0to30)}</TableCell>
                        <TableCell className="text-right">{formatPKR(r.buckets.days31to60)}</TableCell>
                        <TableCell className="text-right">{formatPKR(r.buckets.days61to90)}</TableCell>
                        <TableCell className="text-right">{formatPKR(r.buckets.over90)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatPKR(r.total)}</TableCell>
                      </TableRow>
                    ))}
                    {(ageing.rows || []).length > 0 && (
                      <TableRow className="font-bold">
                        <TableCell>Total ({ageing.customersWithDues} customers)</TableCell>
                        <TableCell className="text-right">{formatPKR(ageing.totals.days0to30)}</TableCell>
                        <TableCell className="text-right">{formatPKR(ageing.totals.days31to60)}</TableCell>
                        <TableCell className="text-right">{formatPKR(ageing.totals.days61to90)}</TableCell>
                        <TableCell className="text-right">{formatPKR(ageing.totals.over90)}</TableCell>
                        <TableCell className="text-right">{formatPKR(ageing.totals.total)}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {ageing.customerAdvances > 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Customer advances held (overpayments): <span className="font-medium text-foreground">{formatPKR(ageing.customerAdvances)}</span>
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ─── Payables ─── */}
        <Card className="print:shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" /> Payables
              {payables && <span className="text-sm font-normal text-muted-foreground">{formatPKR(payables.totalOutstanding)} outstanding on {payables.count} purchases</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!payables ? (
              <p className="text-muted-foreground">{loading ? "Loading…" : "No data"}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Age</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(payables.rows || []).length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nothing owed to suppliers</TableCell></TableRow>
                  )}
                  {(payables.rows || []).map((r: any) => (
                    <TableRow key={r.purchaseId}>
                      <TableCell className="font-medium">{r.supplier?.name || "—"}</TableCell>
                      <TableCell>{r.invoiceNo || "—"}</TableCell>
                      <TableCell>{formatDate(r.purchaseDate)}</TableCell>
                      <TableCell className="text-right">{r.ageDays}d</TableCell>
                      <TableCell className="text-right">{formatPKR(r.total)}</TableCell>
                      <TableCell className="text-right">{formatPKR(r.paid)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPKR(r.outstanding)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Accounting;
