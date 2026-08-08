import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import {
  DollarSign, ShoppingCart, Package, Users, UserCheck,
  TrendingUp, TrendingDown, BarChart3,
  Calendar, RefreshCw, CreditCard, Wallet, Truck,
  AlertTriangle, CheckCircle, Clock, ArrowLeftRight,
  FileText, Percent, Building2, Receipt, Repeat,
  Activity, PieChart as PieChartIcon, TrendingUp as TrendingUpIcon,
  Layers, DollarSign as DollarSignIcon, CalendarDays, Users2
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 Days" },
  { value: "last30", label: "Last 30 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "thisYear", label: "This Year" },
];

const COLORS = ["#007bff", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

const formatPKR = (v: number) => `PKR ${Math.round(v).toLocaleString()}`;

interface TabConfig {
  key: string;
  label: string;
  icon: React.ElementType;
}

const TABS: TabConfig[] = [
  { key: "sales", label: "Sales & Revenue", icon: ShoppingCart },
  { key: "inventory", label: "Inventory & Stock", icon: Package },
  { key: "customers", label: "Customers", icon: Users },
  { key: "staff", label: "Staff & Performance", icon: UserCheck },
  { key: "financial", label: "Financial Overview", icon: DollarSign },
  { key: "purchases", label: "Purchases & Suppliers", icon: Truck },
  { key: "refunds", label: "Refunds & Returns", icon: ArrowLeftRight },
  { key: "expiry", label: "Expiry Analysis", icon: AlertTriangle },
  { key: "category", label: "Category Performance", icon: Layers },
  { key: "branch", label: "Branch Comparison", icon: Building2 },
  { key: "tax", label: "Tax Reports", icon: Receipt },
  { key: "payment", label: "Payment Trends", icon: CreditCard },
  { key: "attendance", label: "Staff Attendance", icon: Clock },
  { key: "stock", label: "Stock Movements", icon: ArrowLeftRight },
  { key: "expense", label: "Expense Reports", icon: FileText },
  { key: "shift", label: "Shift Reports", icon: CalendarDays },
  { key: "supplier", label: "Supplier Performance", icon: Truck },
  { key: "retention", label: "Customer Retention", icon: Repeat },
  { key: "commission", label: "Commission Details", icon: Percent },
  { key: "profit", label: "Profit & Loss", icon: TrendingUpIcon },
  { key: "cashflow", label: "Cash Flow", icon: Activity },
  { key: "batch", label: "Batch Analysis", icon: Package },
  { key: "discount", label: "Discount Analysis", icon: Percent },
  { key: "product", label: "Product Performance", icon: BarChart3 },
  { key: "turnover", label: "Inventory Turnover", icon: PieChartIcon },
  { key: "daily", label: "Daily Sales Trends", icon: Calendar },
];

const AdvancedReports = () => {
  const { selectedBranchId, selectedCompanyId } = useAdmin();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("sales");
  const [period, setPeriod] = useState("today");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, any>>({});

  const fetchReport = useCallback(async (tab: string) => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const params: any = { period, companyId: selectedCompanyId };
      if (selectedBranchId) params.branchId = selectedBranchId;

      let response;
      switch (tab) {
        case "sales":
          response = await apiService.getAdvancedSalesReport(params);
          break;
        case "inventory":
          response = await apiService.getAdvancedInventoryReport(params);
          break;
        case "customers":
          response = await apiService.getAdvancedCustomerReport(params);
          break;
        case "staff":
          response = await apiService.getAdvancedStaffReport(params);
          break;
        case "financial":
          response = await apiService.getAdvancedFinancialReport(params);
          break;
        case "purchases":
          response = await apiService.getAdvancedPurchaseReport(params);
          break;
        case "refunds":
          response = await apiService.getAdvancedRefundsReport?.(params) || { success: true, data: {} };
          break;
        case "expiry":
          response = await apiService.getAdvancedExpiryReport?.(params) || { success: true, data: {} };
          break;
        case "category":
          response = await apiService.getAdvancedCategoryReport?.(params) || { success: true, data: {} };
          break;
        case "branch":
          response = await apiService.getAdvancedBranchReport?.(params) || { success: true, data: {} };
          break;
        case "tax":
          response = await apiService.getAdvancedTaxReport?.(params) || { success: true, data: {} };
          break;
        case "payment":
          response = await apiService.getAdvancedPaymentTrendsReport?.(params) || { success: true, data: {} };
          break;
        case "attendance":
          response = await apiService.getAdvancedAttendanceReport?.(params) || { success: true, data: {} };
          break;
        case "stock":
          response = await apiService.getAdvancedStockMovementsReport?.(params) || { success: true, data: {} };
          break;
        case "expense":
          response = await apiService.getAdvancedExpenseReport?.(params) || { success: true, data: {} };
          break;
        case "shift":
          response = await apiService.getAdvancedShiftReport?.(params) || { success: true, data: {} };
          break;
        case "supplier":
          response = await apiService.getAdvancedSupplierReport?.(params) || { success: true, data: {} };
          break;
        case "retention":
          response = await apiService.getAdvancedRetentionReport?.(params) || { success: true, data: {} };
          break;
        case "commission":
          response = await apiService.getAdvancedCommissionReport?.(params) || { success: true, data: {} };
          break;
        case "profit":
          response = await apiService.getAdvancedProfitReport?.(params) || { success: true, data: {} };
          break;
        case "cashflow":
          response = await apiService.getAdvancedCashflowReport?.(params) || { success: true, data: {} };
          break;
        case "batch":
          response = await apiService.getAdvancedBatchReport?.(params) || { success: true, data: {} };
          break;
        case "discount":
          response = await apiService.getAdvancedDiscountReport?.(params) || { success: true, data: {} };
          break;
        case "product":
          response = await apiService.getAdvancedProductReport?.(params) || { success: true, data: {} };
          break;
        case "turnover":
          response = await apiService.getAdvancedTurnoverReport?.(params) || { success: true, data: {} };
          break;
        case "daily":
          response = await apiService.getAdvancedDailyReport?.(params) || { success: true, data: {} };
          break;
        default:
          response = { success: true, data: {} };
      }

      if (response.success) {
        setData((prev) => ({ ...prev, [tab]: response.data }));
      } else {
        toast({ title: "Error", description: response.message || "Failed to load report", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to load report", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [period, selectedBranchId, selectedCompanyId]);

  useEffect(() => {
    fetchReport(activeTab);
  }, [activeTab, fetchReport]);

  const currentData = data[activeTab];

  const SummaryCard = ({ label, value, change, icon: Icon, tone = "blue" }: any) => {
    const toneClasses: Record<string, string> = {
      blue: "bg-blue-50 text-blue-600",
      green: "bg-green-50 text-green-600",
      amber: "bg-amber-50 text-amber-600",
      red: "bg-red-50 text-red-600",
      purple: "bg-purple-50 text-purple-600",
    };
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">{label}</p>
              <p className="text-2xl font-bold text-slate-900">{value}</p>
              {change !== undefined && (
                <div className={`flex items-center gap-1 text-xs mt-1 ${change >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  <span>{change >= 0 ? "+" : ""}{change}%</span>
                </div>
              )}
            </div>
            <div className={`p-2.5 rounded-lg ${toneClasses[tone] || toneClasses.blue}`}>
              <Icon className="w-5 h-5" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderSalesTab = () => {
    const d = currentData;
    if (!d) return null;
    const s = d.summary || {};
    const paymentData = (d.byPaymentMethod || []).map((p: any) => ({
      name: p.paymentMethod || "Unknown",
      value: p._sum?.totalAmount || 0,
      orders: p._count?.id || 0,
    }));
    const hourlyData = d.byHour || [];
    const topProducts = d.topProducts || [];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Revenue" value={formatPKR(s.totalRevenue || 0)} icon={DollarSign} tone="green" />
          <SummaryCard label="Total Orders" value={s.totalOrders || 0} icon={ShoppingCart} tone="blue" />
          <SummaryCard label="Avg Order Value" value={formatPKR(s.avgOrderValue || 0)} icon={CreditCard} tone="purple" />
          <SummaryCard label="Total Discounts" value={formatPKR(s.totalDiscount || 0)} icon={Wallet} tone="amber" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Sales by Hour</CardTitle></CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="hour" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `PKR ${v}`} />
                    <Tooltip formatter={(v: any) => formatPKR(v)} />
                    <Bar dataKey="total" fill="#007bff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Sales by Payment Method</CardTitle></CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={paymentData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {paymentData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatPKR(v as number)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Top Selling Products</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Quantity Sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topProducts.map((p: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{p.product?.name || "Unknown"}</TableCell>
                    <TableCell className="text-slate-500">{p.product?.category?.name || "—"}</TableCell>
                    <TableCell className="text-right">{p._sum?.quantity || 0}</TableCell>
                    <TableCell className="text-right">{formatPKR(p._sum?.totalPrice || 0)}</TableCell>
                  </TableRow>
                ))}
                {topProducts.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-slate-400 py-8">No sales data available</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderInventoryTab = () => {
    const d = currentData;
    if (!d) return null;
    const s = d.summary || {};
    const lowStock = d.lowStockBatches || [];
    const nearExpiry = d.nearExpiryBatches || [];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Products" value={s.totalProducts || 0} icon={Package} tone="blue" />
          <SummaryCard label="Total Stock" value={s.totalStock || 0} icon={BarChart3} tone="green" />
          <SummaryCard label="Stock Value" value={formatPKR(s.totalValue || 0)} icon={DollarSign} tone="purple" />
          <SummaryCard label="Expired Batches" value={s.expiredBatches || 0} icon={AlertTriangle} tone="red" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Low Stock Batches</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Batch</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Expiry</TableHead></TableRow></TableHeader>
                <TableBody>
                  {lowStock.map((b: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{b.product?.name || "—"}</TableCell>
                      <TableCell className="text-slate-500">{b.batchNo}</TableCell>
                      <TableCell className="text-right"><Badge variant="destructive">{b.quantity}</Badge></TableCell>
                      <TableCell className="text-slate-500">{b.expireDate ? new Date(b.expireDate).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {lowStock.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-400 py-8">No low stock items</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Near Expiry (30 Days)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Batch</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Expiry</TableHead></TableRow></TableHeader>
                <TableBody>
                  {nearExpiry.map((b: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{b.product?.name || "—"}</TableCell>
                      <TableCell className="text-slate-500">{b.batchNo}</TableCell>
                      <TableCell className="text-right">{b.quantity}</TableCell>
                      <TableCell className="text-amber-600">{b.expireDate ? new Date(b.expireDate).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {nearExpiry.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-400 py-8">No batches near expiry</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  const renderCustomersTab = () => {
    const d = currentData;
    if (!d) return null;
    const s = d.summary || {};
    const top = d.topCustomers || [];
    const sales = d.customerSales || [];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Customers" value={s.totalCustomers || 0} icon={Users} tone="blue" />
          <SummaryCard label="VIP Customers" value={s.vipCustomers || 0} icon={CheckCircle} tone="purple" />
          <SummaryCard label="New Customers" value={s.newCustomers || 0} icon={UserCheck} tone="green" />
          <SummaryCard label="Avg Spent" value={formatPKR(s.averageSpent || 0)} icon={DollarSign} tone="amber" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Top Customers by Spending</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Phone</TableHead><TableHead className="text-right">Total Spent</TableHead><TableHead className="text-right">Orders</TableHead></TableRow></TableHeader>
                <TableBody>
                  {top.map((c: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium flex items-center gap-2">
                        {c.name}
                        {c.isVIP && <Badge className="bg-purple-100 text-purple-700 text-[10px]">VIP</Badge>}
                      </TableCell>
                      <TableCell className="text-slate-500">{c.phone || "—"}</TableCell>
                      <TableCell className="text-right">{formatPKR(c.totalPurchases || 0)}</TableCell>
                      <TableCell className="text-right">{c._count?.sales || 0}</TableCell>
                    </TableRow>
                  ))}
                  {top.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-400 py-8">No customer data</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Customer Sales Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sales.slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="customerName" stroke="#94a3b8" fontSize={11} angle={-20} textAnchor="end" height={60} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `PKR ${v}`} />
                    <Tooltip formatter={(v: any) => formatPKR(v)} />
                    <Bar dataKey="_sum.totalAmount" fill="#007bff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  const renderStaffTab = () => {
    const d = currentData;
    if (!d) return null;
    const s = d.summary || {};
    const salesByStaff = d.salesByStaff || [];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Staff" value={s.totalEmployees || 0} icon={Users} tone="blue" />
          <SummaryCard label="Attendance Records" value={s.attendanceRecords || 0} icon={Clock} tone="green" />
          <SummaryCard label="Total Commissions" value={formatPKR(s.totalCommissions || 0)} icon={DollarSign} tone="purple" />
          <SummaryCard label="Commission Count" value={s.commissionCount || 0} icon={CheckCircle} tone="amber" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Sales by Staff Member</CardTitle></CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesByStaff} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `PKR ${v}`} />
                  <YAxis dataKey="staffName" type="category" stroke="#94a3b8" fontSize={12} width={120} />
                  <Tooltip formatter={(v: any) => formatPKR(v)} />
                  <Legend />
                  <Bar dataKey="_sum.totalAmount" name="Revenue" fill="#007bff" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="_count.id" name="Orders" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderFinancialTab = () => {
    const d = currentData;
    if (!d) return null;
    const s = d.summary || {};

    const chartData = [
      { name: "Revenue", value: s.totalRevenue || 0 },
      { name: "Refunds", value: s.totalRefunds || 0 },
      { name: "Purchases", value: s.totalPurchases || 0 },
      { name: "Net Profit", value: s.netProfit || 0 },
    ];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Revenue" value={formatPKR(s.totalRevenue || 0)} icon={DollarSign} tone="green" />
          <SummaryCard label="Total Refunds" value={formatPKR(s.totalRefunds || 0)} icon={AlertTriangle} tone="red" />
          <SummaryCard label="Total Purchases" value={formatPKR(s.totalPurchases || 0)} icon={ShoppingCart} tone="blue" />
          <SummaryCard label="Net Profit" value={formatPKR(s.netProfit || 0)} icon={TrendingUp} tone="purple" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Financial Overview</CardTitle></CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `PKR ${v}`} />
                    <Tooltip formatter={(v: any) => formatPKR(v)} />
                    <Bar dataKey="value" fill="#007bff" radius={[4, 4, 0, 0]}>
                      {chartData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Profit Margin</CardTitle></CardHeader>
            <CardContent className="flex flex-col items-center justify-center h-72">
              <div className="text-5xl font-bold text-slate-900">{s.profitMargin?.toFixed(1) || "0.0"}%</div>
              <p className="text-sm text-slate-500 mt-2">Net profit as % of revenue</p>
              <div className="mt-6 w-full max-w-xs">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Revenue</span>
                  <span>{formatPKR(s.totalRevenue || 0)}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 mb-4">
                  <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: "100%" }} />
                </div>
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Net Profit</span>
                  <span>{formatPKR(s.netProfit || 0)}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5">
                  <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${Math.max(0, Math.min(100, s.profitMargin || 0))}%` }} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  const renderPurchasesTab = () => {
    const d = currentData;
    if (!d) return null;
    const s = d.summary || {};
    const bySupplier = d.bySupplier || [];
    const byStatus = d.byStatus || [];
    const recent = d.recentPurchases || [];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Purchases" value={s.totalPurchases || 0} icon={Truck} tone="blue" />
          <SummaryCard label="Total Amount" value={formatPKR(s.totalAmount || 0)} icon={DollarSign} tone="green" />
          <SummaryCard label="Paid Amount" value={formatPKR(s.paidAmount || 0)} icon={Wallet} tone="amber" />
          <SummaryCard label="Outstanding" value={formatPKR(s.outstanding || 0)} icon={CreditCard} tone="purple" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Purchases by Supplier</CardTitle></CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={bySupplier} dataKey="_sum.totalAmount" nameKey="supplierName" cx="50%" cy="50%" outerRadius={90} label>
                      {bySupplier.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatPKR(v as number)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Purchase Status Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byStatus}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="status" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="_count.id" name="Count" fill="#007bff" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="_sum.totalAmount" name="Amount" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Recent Purchase Orders</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>
                {recent.map((p: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{p.invoiceNo || "—"}</TableCell>
                    <TableCell className="text-slate-500">{p.supplier?.name || "—"}</TableCell>
                    <TableCell className="text-right">{formatPKR(p.totalAmount || 0)}</TableCell>
                    <TableCell><Badge variant={p.status === "COMPLETED" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                    <TableCell className="text-slate-500">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                ))}
                {recent.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">No purchases found</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderRefundsTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Refunds" value={s.totalRefunds || 0} icon={ArrowLeftRight} tone="red" />
          <SummaryCard label="Refund Amount" value={formatPKR(s.totalRefundAmount || 0)} icon={DollarSign} tone="amber" />
        </div>
      </div>
    );
  };
  const renderExpiryTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const byMonth = d.byMonth || [];
    const expired = d.expiredBatches || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Expired Items" value={s.expiredItems || 0} icon={AlertTriangle} tone="red" />
          <SummaryCard label="Expiring Soon (30d)" value={s.expiringSoon || 0} icon={Clock} tone="amber" />
          <SummaryCard label="Expiry Value" value={formatPKR(s.expiryValue || 0)} icon={DollarSign} tone="purple" />
          <SummaryCard label="Waste Rate" value={`${(s.wasteRate || 0).toFixed(1)}%`} icon={Percent} tone="blue" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Expiry by Month</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="count" name="Items" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderCategoryTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const byCategory = d.byCategory || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Categories" value={s.totalCategories || 0} icon={Layers} tone="blue" />
          <SummaryCard label="Category Sales" value={formatPKR(s.totalCategorySales || 0)} icon={DollarSign} tone="green" />
          <SummaryCard label="Top Category" value={s.topCategory || "—"} icon={TrendingUp} tone="purple" />
          <SummaryCard label="Avg Category Value" value={formatPKR(s.avgCategoryValue || 0)} icon={BarChart3} tone="amber" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Sales by Category</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCategory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="categoryName" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `PKR ${v}`} />
                  <Tooltip formatter={(v: any) => formatPKR(v)} />
                  <Bar dataKey="_sum.totalAmount" fill="#007bff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderBranchTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const byBranch = d.byBranch || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Branches" value={s.totalBranches || 0} icon={Building2} tone="blue" />
          <SummaryCard label="Top Branch" value={s.topBranch || "—"} icon={TrendingUp} tone="green" />
          <SummaryCard label="Branch Revenue" value={formatPKR(s.totalBranchRevenue || 0)} icon={DollarSign} tone="purple" />
          <SummaryCard label="Avg Branch Sales" value={formatPKR(s.avgBranchSales || 0)} icon={BarChart3} tone="amber" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Branch Performance</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byBranch}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="branchName" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `PKR ${v}`} />
                  <Tooltip formatter={(v: any) => formatPKR(v)} />
                  <Bar dataKey="totalRevenue" fill="#007bff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderTaxTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const byCategory = d.byCategory || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Tax Collected" value={formatPKR(s.totalTax || 0)} icon={Receipt} tone="green" />
          <SummaryCard label="Tax Rate" value={`${(s.taxRate || 0).toFixed(1)}%`} icon={Percent} tone="blue" />
          <SummaryCard label="Taxable Sales" value={formatPKR(s.taxableSales || 0)} icon={DollarSign} tone="purple" />
          <SummaryCard label="Exempt Sales" value={formatPKR(s.exemptSales || 0)} icon={CreditCard} tone="amber" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Tax by Category</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCategory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="categoryName" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `PKR ${v}`} />
                  <Tooltip formatter={(v: any) => formatPKR(v)} />
                  <Bar dataKey="taxAmount" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderPaymentTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Cash Payments" value={formatPKR(s.cashPayments || 0)} icon={Wallet} tone="green" />
          <SummaryCard label="Card Payments" value={formatPKR(s.cardPayments || 0)} icon={CreditCard} tone="blue" />
        </div>
      </div>
    );
  };
  const renderAttendanceTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const byStaff = d.byStaff || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Attendance Records" value={s.totalRecords || 0} icon={Clock} tone="blue" />
          <SummaryCard label="Present" value={s.present || 0} icon={CheckCircle} tone="green" />
          <SummaryCard label="Late" value={s.late || 0} icon={AlertTriangle} tone="amber" />
          <SummaryCard label="Absent" value={s.absent || 0} icon={UserCheck} tone="red" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Attendance by Staff Member</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Staff Member</TableHead><TableHead className="text-right">Present</TableHead><TableHead className="text-right">Late</TableHead><TableHead className="text-right">Absent</TableHead><TableHead className="text-right">Total Hours</TableHead></TableRow></TableHeader>
              <TableBody>
                {byStaff.map((row: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.staffName}</TableCell>
                    <TableCell className="text-right"><Badge variant="default">{row.present}</Badge></TableCell>
                    <TableCell className="text-right text-amber-600">{row.late}</TableCell>
                    <TableCell className="text-right text-red-600">{row.absent}</TableCell>
                    <TableCell className="text-right">{Number(row.totalHours || 0).toFixed(1)}</TableCell>
                  </TableRow>
                ))}
                {byStaff.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">No attendance records found</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderStockTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Stock Transfers" value={s.transfers || 0} icon={ArrowLeftRight} tone="blue" />
          <SummaryCard label="Stock Adjustments" value={s.adjustments || 0} icon={AlertTriangle} tone="amber" />
          <SummaryCard label="Total Moved" value={s.totalMoved || 0} icon={Package} tone="green" />
          <SummaryCard label="Movement Value" value={formatPKR(s.movementValue || 0)} icon={DollarSign} tone="purple" />
        </div>
      </div>
    );
  };
  const renderExpenseTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Expenses" value={formatPKR(s.totalExpenses || 0)} icon={FileText} tone="red" />
          <SummaryCard label="Operating Costs" value={formatPKR(s.operatingCosts || 0)} icon={DollarSign} tone="amber" />
          <SummaryCard label="Fixed Costs" value={formatPKR(s.fixedCosts || 0)} icon={CreditCard} tone="blue" />
          <SummaryCard label="Variable Costs" value={formatPKR(s.variableCosts || 0)} icon={Wallet} tone="purple" />
        </div>
      </div>
    );
  };
  const renderShiftTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const byStaff = d.byStaff || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Shifts" value={s.totalShifts || 0} icon={CalendarDays} tone="blue" />
          <SummaryCard label="Active" value={s.active || 0} icon={Activity} tone="green" />
          <SummaryCard label="Completed" value={s.completed || 0} icon={CheckCircle} tone="purple" />
          <SummaryCard label="Net Difference" value={formatPKR(s.netDifference || 0)} icon={AlertTriangle} tone={(s.netDifference || 0) < 0 ? "red" : "amber"} />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Shift Summary by Staff Member</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Staff Member</TableHead><TableHead className="text-right">Shifts</TableHead><TableHead className="text-right">Cash In</TableHead><TableHead className="text-right">Cash Out</TableHead><TableHead className="text-right">Difference</TableHead></TableRow></TableHeader>
              <TableBody>
                {byStaff.map((row: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.staffName}</TableCell>
                    <TableCell className="text-right">{row.shifts}</TableCell>
                    <TableCell className="text-right">{formatPKR(row.cashIn || 0)}</TableCell>
                    <TableCell className="text-right">{formatPKR(row.cashOut || 0)}</TableCell>
                    <TableCell className={`text-right ${(row.difference || 0) < 0 ? "text-red-600" : "text-green-600"}`}>{formatPKR(row.difference || 0)}</TableCell>
                  </TableRow>
                ))}
                {byStaff.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">No shift records found</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderSupplierTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const bySupplier = d.bySupplier || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Suppliers" value={s.totalSuppliers || 0} icon={Truck} tone="blue" />
          <SummaryCard label="Purchase Orders" value={s.totalPurchases || 0} icon={ShoppingCart} tone="green" />
          <SummaryCard label="Total Purchases" value={formatPKR(s.totalAmount || 0)} icon={DollarSign} tone="purple" />
          <SummaryCard label="Outstanding" value={formatPKR(s.outstanding || 0)} icon={Wallet} tone="amber" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Supplier Performance</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Total Amount</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader>
              <TableBody>
                {bySupplier.map((row: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.supplierName}</TableCell>
                    <TableCell className="text-right">{row.purchases}</TableCell>
                    <TableCell className="text-right">{formatPKR(row.totalAmount || 0)}</TableCell>
                    <TableCell className="text-right">{formatPKR(row.paidAmount || 0)}</TableCell>
                    <TableCell className={`text-right ${(row.outstanding || 0) > 0 ? "text-amber-600" : "text-green-600"}`}>{formatPKR(row.outstanding || 0)}</TableCell>
                  </TableRow>
                ))}
                {bySupplier.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">No supplier data found</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderRetentionTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const topCustomers = d.topCustomers || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Customers" value={s.totalCustomers || 0} icon={Users} tone="blue" />
          <SummaryCard label="Repeat Customers" value={s.repeatCustomers || 0} icon={Repeat} tone="green" />
          <SummaryCard label="Retention Rate" value={`${(s.retentionRate || 0).toFixed(1)}%`} icon={TrendingUp} tone="purple" />
          <SummaryCard label="Avg Orders / Customer" value={Number(s.avgOrdersPerCustomer || 0).toFixed(2)} icon={ShoppingCart} tone="amber" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Top Customers by Repeat Purchases</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Total Spent</TableHead></TableRow></TableHeader>
              <TableBody>
                {topCustomers.map((row: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.customerName}</TableCell>
                    <TableCell className="text-right">{row.orderCount}</TableCell>
                    <TableCell className="text-right">{formatPKR(row.totalSpent || 0)}</TableCell>
                  </TableRow>
                ))}
                {topCustomers.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-slate-400 py-8">No retention data available</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderCommissionTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const byStaff = d.byStaff || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Commission Records" value={s.totalCommissions || 0} icon={Percent} tone="blue" />
          <SummaryCard label="Total Commission" value={formatPKR(s.totalAmount || 0)} icon={DollarSign} tone="purple" />
          <SummaryCard label="Paid" value={formatPKR(s.paid || 0)} icon={CheckCircle} tone="green" />
          <SummaryCard label="Pending" value={formatPKR(s.pending || 0)} icon={Clock} tone="amber" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Commission by Staff Member</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Staff Member</TableHead><TableHead className="text-right">Transactions</TableHead><TableHead className="text-right">Total Sales</TableHead><TableHead className="text-right">Commission</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {byStaff.map((row: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.staffName}</TableCell>
                    <TableCell className="text-right">{row.totalTransactions || 0}</TableCell>
                    <TableCell className="text-right">{formatPKR(row.totalSales || 0)}</TableCell>
                    <TableCell className="text-right">{formatPKR(row.totalCommission || 0)}</TableCell>
                    <TableCell><Badge variant={String(row.status || "").toUpperCase() === "PAID" ? "default" : "secondary"}>{row.status || "PENDING"}</Badge></TableCell>
                  </TableRow>
                ))}
                {byStaff.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">No commission data found</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderProfitTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Gross Profit" value={formatPKR(s.grossProfit || 0)} icon={TrendingUpIcon} tone="green" />
          <SummaryCard label="Net Profit" value={formatPKR(s.netProfit || 0)} icon={DollarSign} tone="blue" />
          <SummaryCard label="Gross Margin" value={`${(s.grossMargin || 0).toFixed(1)}%`} icon={Percent} tone="purple" />
          <SummaryCard label="Net Margin" value={`${(s.netMargin || 0).toFixed(1)}%`} icon={Percent} tone="amber" />
        </div>
      </div>
    );
  };
  const renderCashflowTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Cash Inflow" value={formatPKR(s.cashInflow || 0)} icon={Activity} tone="green" />
          <SummaryCard label="Cash Outflow" value={formatPKR(s.cashOutflow || 0)} icon={Activity} tone="red" />
          <SummaryCard label="Net Cash Flow" value={formatPKR(s.netCashflow || 0)} icon={DollarSign} tone="blue" />
          <SummaryCard label="Cash Balance" value={formatPKR(s.cashBalance || 0)} icon={Wallet} tone="purple" />
        </div>
      </div>
    );
  };
  const renderBatchTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const batches = d.batches || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Batches" value={s.totalBatches || 0} icon={Layers} tone="blue" />
          <SummaryCard label="Active" value={s.activeBatches || 0} icon={CheckCircle} tone="green" />
          <SummaryCard label="Expired" value={s.expiredBatches || 0} icon={AlertTriangle} tone="red" />
          <SummaryCard label="Batch Value" value={formatPKR(s.totalValue || 0)} icon={DollarSign} tone="purple" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Batch Inventory Analysis</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Batch No</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Selling Price</TableHead><TableHead>Expiry</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {batches.map((b: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{b.product?.name || "—"}</TableCell>
                    <TableCell className="text-slate-500">{b.batchNo}</TableCell>
                    <TableCell className="text-right">{b.quantity}</TableCell>
                    <TableCell className="text-right">{formatPKR(b.purchasePrice || 0)}</TableCell>
                    <TableCell className="text-right">{formatPKR(b.sellingPrice || 0)}</TableCell>
                    <TableCell className={b.expireDate && new Date(b.expireDate) < new Date() ? "text-red-600" : "text-slate-500"}>
                      {b.expireDate ? new Date(b.expireDate).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell><Badge variant={b.isActive ? "default" : "secondary"}>{b.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                  </TableRow>
                ))}
                {batches.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-8">No batch data found</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderDiscountTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const byMethod = (d.byMethod || []).map((m: any) => ({
      name: m.paymentMethod || "Unknown",
      value: m._sum?.discountAmount || 0,
      orders: m._count?.id || 0,
    }));
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Discount" value={formatPKR(s.totalDiscount || 0)} icon={Percent} tone="amber" />
          <SummaryCard label="Discounted Orders" value={s.totalOrders || 0} icon={ShoppingCart} tone="blue" />
          <SummaryCard label="Avg Discount / Order" value={formatPKR(s.avgDiscount || 0)} icon={Wallet} tone="purple" />
          <SummaryCard label="Discount Rate" value={`${(s.discountRate || 0).toFixed(1)}%`} icon={TrendingDown} tone="green" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Discount by Payment Method</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMethod}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `PKR ${v}`} />
                  <Tooltip formatter={(v: any) => formatPKR(v)} />
                  <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderProductTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const byProduct = d.byProduct || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Products" value={s.totalProducts || 0} icon={Package} tone="blue" />
          <SummaryCard label="Total Revenue" value={formatPKR(s.totalRevenue || 0)} icon={DollarSign} tone="green" />
          <SummaryCard label="Avg Revenue / Product" value={formatPKR(s.avgRevenue || 0)} icon={BarChart3} tone="purple" />
          <SummaryCard label="Top Product" value={s.topProduct || "—"} icon={TrendingUp} tone="amber" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Product Performance</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Quantity Sold</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
              <TableBody>
                {byProduct.map((p: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{p.productName}</TableCell>
                    <TableCell className="text-right">{p.quantity}</TableCell>
                    <TableCell className="text-right">{p.orders}</TableCell>
                    <TableCell className="text-right">{formatPKR(p.revenue || 0)}</TableCell>
                  </TableRow>
                ))}
                {byProduct.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-400 py-8">No product sales data found</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderTurnoverTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const byProduct = d.byProduct || [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Products Tracked" value={s.totalProducts || 0} icon={Package} tone="blue" />
          <SummaryCard label="Inventory Value" value={formatPKR(s.inventoryValue || 0)} icon={DollarSign} tone="purple" />
          <SummaryCard label="COGS Sold" value={formatPKR(s.totalCostOfGoods || 0)} icon={Truck} tone="green" />
          <SummaryCard label="Turnover Ratio" value={Number(s.turnoverRatio || 0).toFixed(2)} icon={PieChartIcon} tone="amber" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Inventory Turnover by Product</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Units Sold</TableHead><TableHead className="text-right">Avg Stock</TableHead><TableHead className="text-right">Inventory Value</TableHead><TableHead className="text-right">Turnover</TableHead></TableRow></TableHeader>
              <TableBody>
                {byProduct.map((p: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{p.productName}</TableCell>
                    <TableCell className="text-right">{p.unitsSold}</TableCell>
                    <TableCell className="text-right">{p.avgStock}</TableCell>
                    <TableCell className="text-right">{formatPKR(p.inventoryValue || 0)}</TableCell>
                    <TableCell className="text-right">{Number(p.turnover || 0).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {byProduct.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">No turnover data found</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };
  const renderDailyTab = () => {
    const d = currentData;
    if (!d) return <div className="p-8 text-center text-slate-400">No data available</div>;
    const s = d.summary || {};
    const byDay = d.byDay || [];
    const avgPerDay = byDay.length > 0 ? (s.totalRevenue || 0) / byDay.length : 0;
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Revenue" value={formatPKR(s.totalRevenue || 0)} icon={DollarSign} tone="green" />
          <SummaryCard label="Total Orders" value={s.totalOrders || 0} icon={ShoppingCart} tone="blue" />
          <SummaryCard label="Best Day" value={s.bestDay || "—"} icon={TrendingUp} tone="purple" />
          <SummaryCard label="Avg / Day" value={formatPKR(avgPerDay)} icon={Calendar} tone="amber" />
        </div>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-slate-700">Daily Sales Trend</CardTitle></CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `PKR ${v}`} />
                  <Tooltip formatter={(v: any) => formatPKR(v)} />
                  <Bar dataKey="total" name="Revenue" fill="#007bff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderActiveTab = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-96">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#007bff] border-t-transparent" />
            <p className="text-sm font-medium text-slate-600">Loading report data...</p>
          </div>
        </div>
      );
    }
    if (!currentData) {
      return (
        <div className="flex items-center justify-center h-96">
          <p className="text-slate-400">No data available for the selected period.</p>
        </div>
      );
    }
    switch (activeTab) {
      case "sales": return renderSalesTab();
      case "inventory": return renderInventoryTab();
      case "customers": return renderCustomersTab();
      case "staff": return renderStaffTab();
      case "financial": return renderFinancialTab();
      case "purchases": return renderPurchasesTab();
      case "refunds": return renderRefundsTab();
      case "expiry": return renderExpiryTab();
      case "category": return renderCategoryTab();
      case "branch": return renderBranchTab();
      case "tax": return renderTaxTab();
      case "payment": return renderPaymentTab();
      case "attendance": return renderAttendanceTab();
      case "stock": return renderStockTab();
      case "expense": return renderExpenseTab();
      case "shift": return renderShiftTab();
      case "supplier": return renderSupplierTab();
      case "retention": return renderRetentionTab();
      case "commission": return renderCommissionTab();
      case "profit": return renderProfitTab();
      case "cashflow": return renderCashflowTab();
      case "batch": return renderBatchTab();
      case "discount": return renderDiscountTab();
      case "product": return renderProductTab();
      case "turnover": return renderTurnoverTab();
      case "daily": return renderDailyTab();
      default: return <div className="p-8 text-center text-slate-400">Report coming soon</div>;
    }
  };

  return (
    <div className="font-[Montserrat] px-6 py-6 md:px-10 md:py-8">
      <div className="mx-auto w-full max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Advanced Reports</h1>
            <p className="text-sm text-slate-500 mt-1">In-depth analytics across all business areas.</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={period} onValueChange={(v) => setPeriod(v)}>
              <SelectTrigger className="w-[180px]">
                <Calendar className="w-4 h-4 mr-2 text-slate-400" />
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => fetchReport(activeTab)} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-slate-200">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    isActive
                      ? "border-[#007bff] text-[#007bff]"
                      : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        {renderActiveTab()}
      </div>
    </div>
  );
};

export default AdvancedReports;
