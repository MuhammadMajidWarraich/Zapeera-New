import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  Building2,
  AlertTriangle,
  Loader2,
  Receipt,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { apiService } from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";

/**
 * Admin Reports — rebuilt on real data (audit A8). The previous version
 * rendered hardcoded datasets for every period/branch combination.
 *
 * Sources (all real endpoints already used elsewhere in the app):
 * - Period KPIs, payment methods, top products: GET /reports/sales
 * - Sales trend chart series:                    GET /dashboard/chart
 * - Overall totals, branch performance, recent
 *   sales, low stock:                            GET /dashboard/admin-stats
 */

type PeriodKey = "7d" | "30d" | "90d" | "1y";

const PERIODS: Array<{ id: PeriodKey; label: string; days: number }> = [
  { id: "7d", label: "Last 7 Days", days: 7 },
  { id: "30d", label: "Last 30 Days", days: 30 },
  { id: "90d", label: "Last 90 Days", days: 90 },
  { id: "1y", label: "Last Year", days: 365 },
];

interface SalesSummary {
  totalSales: number;
  totalRevenue: number;
  totalSubtotal: number;
  totalTax: number;
  totalDiscount: number;
}

interface PaymentMethodRow {
  paymentMethod: string;
  _sum: { totalAmount: number };
  _count: { id: number };
}

interface TopProductRow {
  productId: string;
  _sum: { quantity: number; totalPrice: number };
  product?: { id: string; name: string; category?: { name: string } };
}

interface AdminStats {
  totalRevenue: number;
  totalSales: number;
  totalUsers: number;
  totalBranches: number;
  recentSales: Array<{
    id: string;
    totalAmount: number;
    createdAt: string;
    customer?: { name: string };
    user?: { name: string };
    branch?: { name: string };
  }>;
  lowStockProducts: Array<{
    id: string;
    name: string;
    stock: number;
    minStock: number;
    branch?: { name: string };
  }>;
  branchPerformance: Array<{
    id: string;
    name: string;
    users: number;
    sales: number;
    revenue: number;
  }>;
}

const AdminReports = () => {
  const { selectedBranchId, selectedBranch, selectedCompanyId } = useAdmin();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [chartData, setChartData] = useState<
    Array<{ label: string; revenue: number; sales: number }>
  >([]);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");
    const periodDef = PERIODS.find((p) => p.id === period) || PERIODS[1];
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (periodDef.days - 1));
    const startDate = start.toISOString().split("T")[0];
    const endDate = end.toISOString().split("T")[0];

    try {
      const [salesRes, chartRes, statsRes] = await Promise.all([
        apiService.getSalesReport({
          startDate,
          endDate,
          branchId: selectedBranchId || undefined,
          groupBy: "day",
        }),
        apiService.getSalesChart(
          selectedBranchId || undefined,
          selectedCompanyId || undefined,
          period,
          "day"
        ),
        apiService.getAdminDashboardStats(),
      ]);

      if (salesRes.success && salesRes.data) {
        setSummary(salesRes.data.summary as SalesSummary);
        setPaymentMethods(
          (salesRes.data.salesByPaymentMethod || []) as unknown as PaymentMethodRow[]
        );
        setTopProducts((salesRes.data.topProducts || []) as unknown as TopProductRow[]);
      }
      if (chartRes.success && chartRes.data) {
        setChartData(
          (chartRes.data.chartData || []).map((d) => ({
            label: d.date || d.week || d.month || "",
            revenue: Number(d.revenue || 0),
            sales: Number(d.sales || 0),
          }))
        );
      }
      if (statsRes.success && statsRes.data) {
        setAdminStats(statsRes.data as unknown as AdminStats);
      }
    } catch (err: any) {
      console.error("Error loading admin reports:", err);
      setError(err?.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [period, selectedBranchId, selectedCompanyId]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const formatRs = (n: number) =>
    `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const averageSale =
    summary && summary.totalSales > 0 ? summary.totalRevenue / summary.totalSales : 0;

  return (
    <div className="p-6 space-y-6 bg-background min-h-screen">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Admin Reports</h1>
          <p className="text-muted-foreground">
            Business performance
            {selectedBranch ? ` — ${selectedBranch.name}` : " — all branches"}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertTriangle className="w-5 h-5 text-red-600 mr-2" />
            <p className="text-red-800 font-medium">{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          <span>Loading reports...</span>
        </div>
      ) : (
        <>
          {/* Period KPIs — GET /reports/sales */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card className="shadow-soft border-0">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Revenue (period)
                    </p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatRs(summary?.totalRevenue || 0)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Subtotal {formatRs(summary?.totalSubtotal || 0)} · Tax{" "}
                      {formatRs(summary?.totalTax || 0)}
                    </p>
                  </div>
                  <DollarSign className="w-8 h-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-soft border-0">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Transactions (period)
                    </p>
                    <p className="text-2xl font-bold text-foreground">
                      {summary?.totalSales || 0}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Discounts given {formatRs(summary?.totalDiscount || 0)}
                    </p>
                  </div>
                  <ShoppingCart className="w-8 h-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-soft border-0">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Average Sale</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatRs(averageSale)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Revenue ÷ transactions for the period
                    </p>
                  </div>
                  <Receipt className="w-8 h-8 text-purple-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-soft border-0">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      All-Time Revenue
                    </p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatRs(adminStats?.totalRevenue || 0)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {adminStats?.totalSales || 0} sales · {adminStats?.totalUsers || 0}{" "}
                      users · {adminStats?.totalBranches || 0} branches
                    </p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-emerald-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sales trend — GET /dashboard/chart series */}
          <Card className="shadow-soft border-0">
            <CardHeader>
              <CardTitle>Sales Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No sales recorded in this period.
                </p>
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: any, name: string) =>
                          name === "revenue" ? [formatRs(Number(value)), "Revenue"] : [value, "Sales"]
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#16a34a"
                        fill="#16a34a"
                        fillOpacity={0.15}
                        name="revenue"
                      />
                      <Area
                        type="monotone"
                        dataKey="sales"
                        stroke="#2563eb"
                        fill="#2563eb"
                        fillOpacity={0.1}
                        name="sales"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Payment methods — GET /reports/sales */}
            <Card className="shadow-soft border-0">
              <CardHeader>
                <CardTitle>Sales by Payment Method (period)</CardTitle>
              </CardHeader>
              <CardContent>
                {paymentMethods.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sales in this period.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">Transactions</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentMethods.map((row) => (
                        <TableRow key={row.paymentMethod}>
                          <TableCell className="font-medium">{row.paymentMethod}</TableCell>
                          <TableCell className="text-right">{row._count.id}</TableCell>
                          <TableCell className="text-right">
                            {formatRs(row._sum.totalAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Top products — GET /reports/sales */}
            <Card className="shadow-soft border-0">
              <CardHeader>
                <CardTitle>Top Products (period)</CardTitle>
              </CardHeader>
              <CardContent>
                {topProducts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No product sales in this period.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topProducts.slice(0, 10).map((row) => (
                        <TableRow key={row.productId}>
                          <TableCell className="font-medium">
                            {row.product?.name || "Unknown product"}
                            {row.product?.category?.name && (
                              <span className="block text-xs text-muted-foreground">
                                {row.product.category.name}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{row._sum.quantity}</TableCell>
                          <TableCell className="text-right">
                            {formatRs(row._sum.totalPrice)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Branch performance — GET /dashboard/admin-stats */}
            <Card className="shadow-soft border-0">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Building2 className="w-5 h-5" />
                  <span>Branch Performance (overall)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!adminStats || adminStats.branchPerformance.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No branch data available.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Branch</TableHead>
                        <TableHead className="text-right">Users</TableHead>
                        <TableHead className="text-right">Sales</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adminStats.branchPerformance.map((branch) => (
                        <TableRow key={branch.id}>
                          <TableCell className="font-medium">{branch.name}</TableCell>
                          <TableCell className="text-right">{branch.users}</TableCell>
                          <TableCell className="text-right">{branch.sales}</TableCell>
                          <TableCell className="text-right">
                            {formatRs(branch.revenue)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Low stock — GET /dashboard/admin-stats */}
            <Card className="shadow-soft border-0">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Package className="w-5 h-5" />
                  <span>Low Stock Products</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!adminStats || adminStats.lowStockProducts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing is at or below its minimum stock level.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {adminStats.lowStockProducts.slice(0, 10).map((product) => (
                      <div
                        key={product.id}
                        className="flex items-center justify-between border-b border-border/50 pb-2 text-sm"
                      >
                        <span>
                          {product.name}
                          {product.branch?.name && (
                            <span className="block text-xs text-muted-foreground">
                              {product.branch.name}
                            </span>
                          )}
                        </span>
                        <Badge variant="outline" className="text-red-600 border-red-200">
                          {product.stock} / min {product.minStock}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent sales — GET /dashboard/admin-stats */}
          <Card className="shadow-soft border-0">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Users className="w-5 h-5" />
                <span>Recent Sales</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!adminStats || adminStats.recentSales.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Sold By</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adminStats.recentSales.slice(0, 10).map((sale) => (
                      <TableRow key={sale.id}>
                        <TableCell>
                          {new Date(sale.createdAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </TableCell>
                        <TableCell>{sale.customer?.name || "Walk-in"}</TableCell>
                        <TableCell>{sale.user?.name || "—"}</TableCell>
                        <TableCell>{sale.branch?.name || "—"}</TableCell>
                        <TableCell className="text-right">
                          {formatRs(sale.totalAmount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            For detailed breakdowns (profit, expiry, batch, commission and 20+ more), use
            Reports and Advanced Reports from the sidebar.
          </p>
        </>
      )}
    </div>
  );
};

export default AdminReports;
