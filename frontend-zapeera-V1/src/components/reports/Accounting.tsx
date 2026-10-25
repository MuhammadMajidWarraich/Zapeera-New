import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BookOpenCheck, RefreshCw, Printer, TrendingUp, TrendingDown,
  Wallet, Users, Truck, AlertTriangle,
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";
import BankReconciliation from "./BankReconciliation";

/**
 * Accounting (Wave B8) — accounting-lite, read-only.
 * Every number on this page comes from the /reports/accounting/*
 * endpoints, which compute from real rows (sales, batch costs,
 * refunds, expenses, purchases, khata ledger, sale payments).
 * No figure is estimated or derived in the browser.
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

  const fetchAll = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const scopeParams: any = { companyId: selectedCompanyId };
      if (selectedBranchId) scopeParams.branchId = selectedBranchId;
      const periodParams = { ...scopeParams, period };

      const [pnlRes, cmpRes, cashRes, ageRes, payRes] = await Promise.all([
        apiService.getAccountingPnl(periodParams),
        apiService.getPnlComparison(periodParams),
        apiService.getCashbook(periodParams),
        apiService.getReceivablesAgeing(scopeParams),
        apiService.getPayables(scopeParams),
      ]);
      if (pnlRes.success) setPnl(pnlRes.data);
      if (cmpRes.success) setPnlCompare(cmpRes.data);
      if (cashRes.success) setCashbook(cashRes.data);
      if (ageRes.success) setAgeing(ageRes.data);
      if (payRes.success) setPayables(payRes.data);
      if (!pnlRes.success || !cashRes.success || !ageRes.success || !payRes.success) {
        toast({ title: "Error", description: "Some accounting figures failed to load", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to load accounting reports", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [period, selectedBranchId, selectedCompanyId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const unknownCostLines = (pnl?.cogs?.unknownCostLines || 0) + (pnl?.cogs?.unknownRefundCostLines || 0);

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
