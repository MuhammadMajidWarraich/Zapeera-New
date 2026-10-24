import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Loader2, BarChart3, Info } from "lucide-react";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Gap Item 4 — Aging reports.
// Five read-only reports over rows that already exist:
//  · Supplier aging — unpaid purchase invoices per supplier, bucketed
//    0–30 / 31–60 / 61–90 / 90+ days since the purchase date.
//  · Customer aging — khata receivables per customer, FIFO-aged, with
//    oldest due, last payment and a CURRENT/WATCH/OVERDUE/CRITICAL band.
//  · Stock aging — live stock value per product, bucketed by days since
//    the batch was received, plus expired and expiring-soon value.
//  · Fast/slow-moving — units sold vs current stock: daily rate, days of
//    cover, FAST / MEDIUM / SLOW / DEAD class.
//  · Profitability — per-product revenue minus batch-cost COGS; lines
//    with no batch cost are counted, never silently priced at zero.

type TabKey = "supplier" | "customer" | "stock" | "movement" | "profitability";

interface Buckets {
  days0to30: number;
  days31to60: number;
  days61to90: number;
  over90: number;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : "—";

const bucketHeaders = ["0–30 days", "31–60 days", "61–90 days", "90+ days"];

const riskBadge: Record<string, string> = {
  CURRENT: "bg-green-100 text-green-800",
  WATCH: "bg-amber-100 text-amber-800",
  OVERDUE: "bg-orange-100 text-orange-800",
  CRITICAL: "bg-red-100 text-red-800",
};

const movementBadge: Record<string, string> = {
  FAST: "bg-green-100 text-green-800",
  MEDIUM: "bg-blue-100 text-blue-800",
  SLOW: "bg-amber-100 text-amber-800",
  DEAD: "bg-gray-100 text-gray-600",
};

const AgingReports: React.FC = () => {
  const [tab, setTab] = useState<TabKey>("supplier");
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(true);
  const [supplierData, setSupplierData] = useState<{
    rows: Array<{
      supplier: { id: string; name: string; phone?: string } | null;
      buckets: Buckets;
      total: number;
      openInvoices: number;
      oldestDueDate: string | null;
      oldestDueAgeDays: number | null;
    }>;
    totals: Buckets;
    totalOutstanding: number;
    suppliersWithDues: number;
  } | null>(null);
  const [customerData, setCustomerData] = useState<{
    rows: Array<{
      customerId: string;
      customerName: string;
      phone: string | null;
      total: number;
      buckets: Buckets;
      oldestDueDate: string | null;
      oldestDueAgeDays: number | null;
      lastPaymentDate: string | null;
      riskBand: string;
    }>;
    totals: Buckets;
    total: number;
    customerAdvances: number;
    customersWithDues: number;
  } | null>(null);
  const [stockData, setStockData] = useState<{
    rows: Array<{
      productId: string;
      productName: string;
      sku: string;
      totalQty: number;
      totalValue: number;
      buckets: Buckets & { days91to180: number; over180: number };
      expiredQty: number;
      expiredValue: number;
      expiringQty: number;
      expiringValue: number;
      oldestBatchAgeDays: number;
      lastSaleDate: string | null;
      daysSinceLastSale: number | null;
      nonMoving90d: boolean;
    }>;
    totals: {
      totalQty: number;
      totalValue: number;
      expiredValue: number;
      expiringValue: number;
      nonMovingProducts: number;
      buckets: Buckets & { days91to180: number; over180: number };
    };
  } | null>(null);
  const [movementData, setMovementData] = useState<{
    rows: Array<{
      productId: string;
      productName: string;
      sku: string;
      unitsSold: number;
      currentStock: number;
      minStock: number;
      dailyRate: number;
      daysOfCover: number | null;
      movementClass: string;
    }>;
    counts: { FAST: number; MEDIUM: number; SLOW: number; DEAD: number };
    products: number;
    days: number;
  } | null>(null);
  const [profitData, setProfitData] = useState<{
    rows: Array<{
      productId: string;
      productName: string;
      sku: string | null;
      revenue: number;
      cost: number;
      grossProfit: number;
      marginPct: number | null;
      unitsSold: number;
      unknownCostUnits: number;
    }>;
    totals: { revenue: number; cost: number; grossProfit: number; unitsSold: number; unknownCostUnits: number };
    days: number;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      if (tab === "supplier") {
        const r = await apiService.getSupplierAgingReport();
        if (r.success && r.data) setSupplierData(r.data);
      } else if (tab === "customer") {
        const r = await apiService.getCustomerAgingReport();
        if (r.success && r.data) setCustomerData(r.data);
      } else if (tab === "stock") {
        const r = await apiService.getStockAgingReport();
        if (r.success && r.data) setStockData(r.data);
      } else if (tab === "movement") {
        const r = await apiService.getMovementReport(Number(days));
        if (r.success && r.data) setMovementData(r.data);
      } else {
        const r = await apiService.getProfitabilityReport(Number(days));
        if (r.success && r.data) setProfitData(r.data);
      }
    } catch (err) {
      console.error("Load aging report error:", err);
      toast({
        title: "Failed to load report",
        description: "Could not load the aging report.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [tab, days]);

  useEffect(() => {
    load();
  }, [load]);

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "supplier", label: "Supplier Aging" },
    { key: "customer", label: "Customer Aging" },
    { key: "stock", label: "Stock Aging" },
    { key: "movement", label: "Fast / Slow-Moving" },
    { key: "profitability", label: "Profitability" },
  ];

  return (
    <div className="min-h-screen bg-[#f8f9fa] p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center">
            <BarChart3 className="w-8 h-8 mr-3 text-blue-600" />
            Aging Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Supplier payables, khata receivables, stock age, movement and
            per-medicine profitability — read-only, computed from live rows.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(tab === "movement" || tab === "profitability") && (
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Window" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" onClick={load}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? "default" : "outline"}
            onClick={() => setTab(t.key)}
            className={tab === t.key ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="ml-2 text-gray-600">Loading report...</span>
        </div>
      ) : (
        <>
          {tab === "supplier" && supplierData && (
            <Card className="bg-white border-0 shadow-soft">
              <CardHeader>
                <CardTitle>
                  Supplier Aging — {formatCurrency(supplierData.totalOutstanding)} outstanding across{" "}
                  {supplierData.suppliersWithDues} supplier(s)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {supplierData.rows.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No outstanding supplier payables.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 px-3 font-medium text-gray-600">Supplier</th>
                          {bucketHeaders.map((h) => (
                            <th key={h} className="text-right py-2 px-3 font-medium text-gray-600">{h}</th>
                          ))}
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Total</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Open Invoices</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Oldest Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierData.rows.map((r, i) => (
                          <tr key={r.supplier?.id || i} className="border-b border-gray-100">
                            <td className="py-2 px-3 font-medium text-gray-900">{r.supplier?.name || "Unknown supplier"}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.days0to30)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.days31to60)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.days61to90)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.over90)}</td>
                            <td className="py-2 px-3 text-right font-medium">{formatCurrency(r.total)}</td>
                            <td className="py-2 px-3 text-right">{r.openInvoices}</td>
                            <td className="py-2 px-3 text-right">
                              {r.oldestDueAgeDays != null ? `${r.oldestDueAgeDays}d (${formatDate(r.oldestDueDate)})` : "—"}
                            </td>
                          </tr>
                        ))}
                        <tr className="font-medium bg-gray-50">
                          <td className="py-2 px-3">Total</td>
                          <td className="py-2 px-3 text-right">{formatCurrency(supplierData.totals.days0to30)}</td>
                          <td className="py-2 px-3 text-right">{formatCurrency(supplierData.totals.days31to60)}</td>
                          <td className="py-2 px-3 text-right">{formatCurrency(supplierData.totals.days61to90)}</td>
                          <td className="py-2 px-3 text-right">{formatCurrency(supplierData.totals.over90)}</td>
                          <td className="py-2 px-3 text-right">{formatCurrency(supplierData.totalOutstanding)}</td>
                          <td className="py-2 px-3" colSpan={2} />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {tab === "customer" && customerData && (
            <Card className="bg-white border-0 shadow-soft">
              <CardHeader>
                <CardTitle>
                  Customer Aging (Khata) — {formatCurrency(customerData.total)} due from{" "}
                  {customerData.customersWithDues} customer(s)
                  {customerData.customerAdvances > 0 && (
                    <span className="text-sm font-normal text-gray-500">
                      {" "}· {formatCurrency(customerData.customerAdvances)} in customer advances
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {customerData.rows.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No open khata dues.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 px-3 font-medium text-gray-600">Customer</th>
                          {bucketHeaders.map((h) => (
                            <th key={h} className="text-right py-2 px-3 font-medium text-gray-600">{h}</th>
                          ))}
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Total Due</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Oldest Due</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Last Payment</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerData.rows.map((r) => (
                          <tr key={r.customerId} className="border-b border-gray-100">
                            <td className="py-2 px-3 font-medium text-gray-900">
                              {r.customerName}
                              {r.phone && <span className="text-gray-500 font-normal"> ({r.phone})</span>}
                            </td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.days0to30)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.days31to60)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.days61to90)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.over90)}</td>
                            <td className="py-2 px-3 text-right font-medium">{formatCurrency(r.total)}</td>
                            <td className="py-2 px-3 text-right">
                              {r.oldestDueAgeDays != null ? `${r.oldestDueAgeDays}d` : "—"}
                            </td>
                            <td className="py-2 px-3 text-right">{formatDate(r.lastPaymentDate)}</td>
                            <td className="py-2 px-3 text-right">
                              <Badge className={riskBadge[r.riskBand] || "bg-gray-100 text-gray-600"}>{r.riskBand}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {tab === "stock" && stockData && (
            <Card className="bg-white border-0 shadow-soft">
              <CardHeader>
                <CardTitle>
                  Stock Aging — {formatCurrency(stockData.totals.totalValue)} sellable value ·{" "}
                  {formatCurrency(stockData.totals.expiredValue)} expired ·{" "}
                  {formatCurrency(stockData.totals.expiringValue)} expiring within 30 days ·{" "}
                  {stockData.totals.nonMovingProducts} non-moving (90d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stockData.rows.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No live stock.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 px-3 font-medium text-gray-600">Product</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Qty</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">0–30d</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">31–60d</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">61–90d</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">91–180d</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">180+d</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Value</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Expired</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Last Sale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockData.rows.map((r) => (
                          <tr key={r.productId} className="border-b border-gray-100">
                            <td className="py-2 px-3 font-medium text-gray-900">
                              {r.productName}
                              <span className="text-gray-500 font-normal"> ({r.sku})</span>
                              {r.nonMoving90d && (
                                <Badge className="ml-2 bg-gray-100 text-gray-600">Non-moving 90d</Badge>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right">{r.totalQty}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.days0to30)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.days31to60)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.days61to90)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.days91to180)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.buckets.over180)}</td>
                            <td className="py-2 px-3 text-right font-medium">{formatCurrency(r.totalValue)}</td>
                            <td className="py-2 px-3 text-right text-red-600">
                              {r.expiredValue > 0 ? formatCurrency(r.expiredValue) : "—"}
                            </td>
                            <td className="py-2 px-3 text-right">
                              {r.daysSinceLastSale != null ? `${r.daysSinceLastSale}d ago` : "never"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {tab === "movement" && movementData && (
            <Card className="bg-white border-0 shadow-soft">
              <CardHeader>
                <CardTitle>
                  Fast / Slow-Moving — last {movementData.days} days ·{" "}
                  {movementData.counts.FAST} fast · {movementData.counts.MEDIUM} medium ·{" "}
                  {movementData.counts.SLOW} slow · {movementData.counts.DEAD} dead
                </CardTitle>
              </CardHeader>
              <CardContent>
                {movementData.rows.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No products in scope.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 px-3 font-medium text-gray-600">Product</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Units Sold</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Daily Rate</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Current Stock</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Days of Cover</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Class</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movementData.rows.map((r) => (
                          <tr key={r.productId} className="border-b border-gray-100">
                            <td className="py-2 px-3 font-medium text-gray-900">
                              {r.productName}
                              <span className="text-gray-500 font-normal"> ({r.sku})</span>
                            </td>
                            <td className="py-2 px-3 text-right">{r.unitsSold}</td>
                            <td className="py-2 px-3 text-right">{r.dailyRate}/day</td>
                            <td className="py-2 px-3 text-right">{r.currentStock}</td>
                            <td className="py-2 px-3 text-right">{r.daysOfCover != null ? `${r.daysOfCover}d` : "—"}</td>
                            <td className="py-2 px-3 text-right">
                              <Badge className={movementBadge[r.movementClass] || "bg-gray-100 text-gray-600"}>
                                {r.movementClass}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {tab === "profitability" && profitData && (
            <Card className="bg-white border-0 shadow-soft">
              <CardHeader>
                <CardTitle>
                  Medicine-wise Profitability — last {profitData.days} days · revenue{" "}
                  {formatCurrency(profitData.totals.revenue)} · COGS {formatCurrency(profitData.totals.cost)} ·{" "}
                  gross profit {formatCurrency(profitData.totals.grossProfit)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800 mb-4">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Cost is the batch purchase price (COGS basis).{" "}
                    {profitData.totals.unknownCostUnits} unit(s) sold had no batch
                    cost on record and are excluded from cost — never priced at zero.
                    Refunds are not netted here; net profit lives in the P&amp;L.
                  </span>
                </div>
                {profitData.rows.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No sales in this window.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 px-3 font-medium text-gray-600">Product</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Units Sold</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Revenue</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">COGS</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Gross Profit</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profitData.rows.map((r) => (
                          <tr key={r.productId} className="border-b border-gray-100">
                            <td className="py-2 px-3 font-medium text-gray-900">
                              {r.productName}
                              {r.sku && <span className="text-gray-500 font-normal"> ({r.sku})</span>}
                              {r.unknownCostUnits > 0 && (
                                <span className="text-xs text-amber-600 font-normal">
                                  {" "}· {r.unknownCostUnits}u unknown cost
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right">{r.unitsSold}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.revenue)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(r.cost)}</td>
                            <td className={`py-2 px-3 text-right font-medium ${r.grossProfit < 0 ? "text-red-600" : ""}`}>
                              {formatCurrency(r.grossProfit)}
                            </td>
                            <td className="py-2 px-3 text-right">
                              {r.marginPct != null ? `${r.marginPct.toFixed(1)}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default AgingReports;
