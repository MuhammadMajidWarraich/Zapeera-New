import { useState } from "react";
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
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  Calendar,
  Download,
  Filter,
  BarChart3,
  PieChart,
  LineChart,
  Building2,
  Eye,
  FileText,
  Target,
  AlertTriangle
} from "lucide-react";

const AdminReports = () => {
  const [selectedPeriod, setSelectedPeriod] = useState("month");
  const [selectedBranch, setSelectedBranch] = useState("all");
  const [selectedReport, setSelectedReport] = useState("sales");

  const periods = [
    { id: "today", label: "Today" },
    { id: "week", label: "This Week" },
    { id: "month", label: "This Month" },
    { id: "quarter", label: "This Quarter" },
    { id: "year", label: "This Year" }
  ];

  const branches = [
    "All Branches",
    "Main Branch",
    "North Branch",
    "South Branch",
    "East Branch",
    "West Branch"
  ];

  const reportTypes = [
    { id: "sales", label: "Sales Report", icon: DollarSign },
    { id: "inventory", label: "Inventory Report", icon: Package },
    { id: "customers", label: "Customer Report", icon: Users },
    { id: "products", label: "Product Performance", icon: BarChart3 },
    { id: "branches", label: "Branch Comparison", icon: Building2 }
  ];

  // Mock data for different periods and branches
  const salesData = {
    today: {
      revenue: 45230,
      transactions: 127,
      customers: 98,
      avgTransaction: 356,
      growth: 12.5,
      branches: 5
    },
    week: {
      revenue: 312450,
      transactions: 875,
      customers: 456,
      avgTransaction: 357,
      growth: 8.3,
      branches: 5
    },
    month: {
      revenue: 1250000,
      transactions: 3420,
      customers: 1234,
      avgTransaction: 365,
      growth: 15.7,
      branches: 8
    },
    quarter: {
      revenue: 3800000,
      transactions: 10200,
      customers: 3200,
      avgTransaction: 372,
      growth: 22.1,
      branches: 8
    },
    year: {
      revenue: 14500000,
      transactions: 42350,
      customers: 5678,
      avgTransaction: 342,
      growth: 23.4,
      branches: 8
    }
  };

  const currentData = salesData[selectedPeriod as keyof typeof salesData];

  const branchPerformance = [
    { name: "Main Branch", sales: 1250000, transactions: 8500, customers: 1200, growth: 25.4, users: 45 },
    { name: "North Branch", sales: 890000, transactions: 6200, customers: 850, growth: 18.7, users: 32 },
    { name: "South Branch", sales: 720000, transactions: 5100, customers: 720, growth: 15.2, users: 28 },
    { name: "East Branch", sales: 680000, transactions: 4800, customers: 680, growth: 12.8, users: 25 },
    { name: "West Branch", sales: 590000, transactions: 4200, customers: 590, growth: 10.5, users: 22 }
  ];

  const topProducts = [
    { name: "Paracetamol 500mg", sales: 2450, revenue: 208250, growth: 15.2, branches: 8 },
    { name: "Amoxicillin 250mg", sales: 1890, revenue: 226800, growth: 8.7, branches: 7 },
    { name: "Vitamin D3 1000IU", sales: 1560, revenue: 234000, growth: 23.1, branches: 8 },
    { name: "Ibuprofen 400mg", sales: 1340, revenue: 127300, growth: -5.3, branches: 6 },
    { name: "Omeprazole 20mg", sales: 980, revenue: 176400, growth: 12.4, branches: 5 }
  ];

  const salesByCategory = [
    { category: "Analgesics", percentage: 35, amount: 437500, growth: 18.2 },
    { category: "Antibiotics", percentage: 28, amount: 350000, growth: 12.5 },
    { category: "Vitamins", percentage: 18, amount: 225000, growth: 25.8 },
    { category: "Gastric", percentage: 12, amount: 150000, growth: 8.9 },
    { category: "Others", percentage: 7, amount: 87500, growth: 15.3 }
  ];

  const customerAnalytics = [
    { segment: "New Customers", count: 234, percentage: 18.9, growth: 25.4 },
    { segment: "Returning Customers", count: 856, percentage: 69.4, growth: 12.8 },
    { segment: "VIP Customers", count: 89, percentage: 7.2, growth: 8.5 },
    { segment: "Inactive Customers", count: 55, percentage: 4.5, growth: -5.2 }
  ];

  const recentTransactions = [
    { id: "INV-2024-245", customer: "Ahmad Khan", amount: 850, branch: "Main Branch", time: "10:30 AM", items: 3 },
    { id: "INV-2024-246", customer: "Fatima Ali", amount: 1250, branch: "North Branch", time: "10:25 AM", items: 5 },
    { id: "INV-2024-247", customer: "Hassan Sheikh", amount: 420, branch: "South Branch", time: "10:15 AM", items: 2 },
    { id: "INV-2024-248", customer: "Ayesha Ahmed", amount: 2100, branch: "East Branch", time: "10:05 AM", items: 7 },
    { id: "INV-2024-249", customer: "Muhammad Usman", amount: 680, branch: "West Branch", time: "09:45 AM", items: 4 }
  ];

  return (
    <div className="p-6 space-y-6 bg-background min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Admin Reports & Analytics</h1>
          <p className="text-muted-foreground">Comprehensive insights across all business operations</p>
        </div>
        <div className="flex items-center space-x-3">
          <Button
            variant="outline"
            onClick={() => window.location.href = '/admin'}
          >
            ← Back to Admin Dashboard
          </Button>
          <Button variant="outline">
            <Filter className="w-4 h-4 mr-2" />
            Custom Range
          </Button>
          <Button className="text-white bg-[linear-gradient(135deg,#1C623C_0%,#247449_50%,#6EB469_100%)] hover:opacity-90">
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle>Time Period</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {periods.map((period) => (
                <Button
                  key={period.id}
                  variant={selectedPeriod === period.id ? "default" : "outline"}
                  className={`w-full text-xs ${
                    selectedPeriod === period.id
                      ? "text-white bg-[linear-gradient(135deg,#1C623C_0%,#247449_50%,#6EB469_100%)]"
                      : ""
                  }`}
                  size="sm"
                  onClick={() => setSelectedPeriod(period.id)}
                >
                  {period.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle>Branch</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger>
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle>Report Type</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedReport} onValueChange={setSelectedReport}>
              <SelectTrigger>
                <SelectValue placeholder="Select report" />
              </SelectTrigger>
              <SelectContent>
                {reportTypes.map((report) => {
                  const IconComponent = report.icon;
                  return (
                    <SelectItem key={report.id} value={report.id}>
                      <div className="flex items-center space-x-2">
                        <IconComponent className="w-4 h-4" />
                        <span>{report.label}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="shadow-soft border-0">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold text-foreground">PKR {currentData.revenue.toLocaleString()}</p>
                <div className="flex items-center mt-2">
                  <TrendingUp className="w-4 h-4 text-success mr-1" />
                  <span className="text-sm text-success font-medium">+{currentData.growth}%</span>
                </div>
              </div>
              <DollarSign className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-0">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Transactions</p>
                <p className="text-2xl font-bold text-foreground">{currentData.transactions.toLocaleString()}</p>
                <div className="flex items-center mt-2">
                  <TrendingUp className="w-4 h-4 text-success mr-1" />
                  <span className="text-sm text-success font-medium">+8.2%</span>
                </div>
              </div>
              <ShoppingCart className="w-8 h-8 text-accent" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-0">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Branches</p>
                <p className="text-2xl font-bold text-foreground">{currentData.branches}</p>
                <div className="flex items-center mt-2">
                  <TrendingUp className="w-4 h-4 text-success mr-1" />
                  <span className="text-sm text-success font-medium">+2</span>
                </div>
              </div>
              <Building2 className="w-8 h-8 text-warning" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-0">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Transaction</p>
                <p className="text-2xl font-bold text-foreground">PKR {currentData.avgTransaction}</p>
                <div className="flex items-center mt-2">
                  <TrendingUp className="w-4 h-4 text-success mr-1" />
                  <span className="text-sm text-success font-medium">+3.1%</span>
                </div>
              </div>
              <BarChart3 className="w-8 h-8 text-success" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Branch Performance */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Building2 className="w-5 h-5 text-primary" />
            <span>Branch Performance Comparison</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Branch</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Sales</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Transactions</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Customers</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Growth</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Staff</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {branchPerformance.map((branch, index) => (
                  <tr key={index} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 px-4 font-medium text-foreground">{branch.name}</td>
                    <td className="py-4 px-4 font-semibold text-foreground">PKR {branch.sales.toLocaleString()}</td>
                    <td className="py-4 px-4 text-muted-foreground">{branch.transactions.toLocaleString()}</td>
                    <td className="py-4 px-4 text-muted-foreground">{branch.customers.toLocaleString()}</td>
                    <td className="py-4 px-4">
                      <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                        +{branch.growth}%
                      </Badge>
                    </td>
                    <td className="py-4 px-4 text-muted-foreground">{branch.users}</td>
                    <td className="py-4 px-4">
                      <Button variant="ghost" size="sm">
                        <Eye className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Charts and Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              <span>Top Selling Products (All Branches)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topProducts.map((product, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gradient-surface rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                      <span className="text-sm font-bold text-primary">#{index + 1}</span>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{product.name}</p>
                      <p className="text-sm text-muted-foreground">{product.sales} units • {product.branches} branches</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-foreground">PKR {product.revenue.toLocaleString()}</p>
                    <div className="flex items-center">
                      {product.growth >= 0 ? (
                        <TrendingUp className="w-3 h-3 text-success mr-1" />
                      ) : (
                        <TrendingDown className="w-3 h-3 text-destructive mr-1" />
                      )}
                      <span className={`text-xs font-medium ${product.growth >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {product.growth >= 0 ? '+' : ''}{product.growth}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Customer Analytics */}
        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-primary" />
              <span>Customer Analytics</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {customerAnalytics.map((segment, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{segment.segment}</span>
                    <div className="text-right">
                      <span className="font-semibold text-foreground">{segment.count}</span>
                      <p className="text-xs text-muted-foreground">{segment.percentage}%</p>
                    </div>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${segment.percentage}%` }}
                    ></div>
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground">
                    {segment.growth >= 0 ? (
                      <TrendingUp className="w-3 h-3 text-success mr-1" />
                    ) : (
                      <TrendingDown className="w-3 h-3 text-destructive mr-1" />
                    )}
                    <span className={segment.growth >= 0 ? 'text-success' : 'text-destructive'}>
                      {segment.growth >= 0 ? '+' : ''}{segment.growth}% from last period
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-primary" />
            <span>Recent Transactions (All Branches)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Invoice ID</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Customer</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Branch</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Amount</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Items</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((transaction, index) => (
                  <tr key={index} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 px-4 font-medium text-primary">{transaction.id}</td>
                    <td className="py-4 px-4 text-foreground">{transaction.customer}</td>
                    <td className="py-4 px-4">
                      <Badge variant="outline" className="text-xs">
                        {transaction.branch}
                      </Badge>
                    </td>
                    <td className="py-4 px-4 font-semibold text-foreground">PKR {transaction.amount.toLocaleString()}</td>
                    <td className="py-4 px-4 text-muted-foreground">{transaction.items} items</td>
                    <td className="py-4 px-4 text-muted-foreground">{transaction.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>


    </div>
  );
};

export default AdminReports;
