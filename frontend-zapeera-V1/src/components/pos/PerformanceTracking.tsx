import { useState, useEffect, useCallback, Fragment } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Target,
  Award,
  Calendar,
  User,
  AlertCircle,
  Loader2,
  Calculator,
  Clock,
  CheckCircle,
  Ban,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { apiService } from "@/services/api";

/**
 * Performance Tracking — wired to the real commission backend
 * (/api/commissions: list, stats, performance, calculate, update).
 * Every number on this page comes from those endpoints; sales figures are
 * the totals recorded on the staff member's commission records.
 */

interface StaffMember {
  id: string;
  employeeId?: string;
  designation?: string;
  isActive: boolean;
  membership: {
    id: string;
    user: {
      id: string;
      name: string;
      email: string;
    };
    branches?: Array<{ id: string; name: string }>;
  };
}

interface Commission {
  id: string;
  staffProfileId: string;
  branchId: string;
  period: string;
  periodType: string;
  totalSales: number;
  totalTransactions: number;
  averageSale: number;
  baseRate: number;
  bonusRate: number;
  totalCommission: number;
  bonusAmount: number;
  totalAmount: number;
  status: "PENDING" | "APPROVED" | "PAID" | "CANCELLED";
  paidAt?: string;
  notes?: string;
  createdAt: string;
  staffProfile?: {
    id: string;
    membership?: {
      user?: { id: string; name: string; email?: string };
    };
  };
  branch?: { id: string; name: string };
}

interface CommissionStats {
  totalCommissions: number;
  pendingCommissions: number;
  approvedCommissions: number;
  paidCommissions: number;
  cancelledCommissions: number;
  totalAmount: number;
  totalPaidAmount: number;
}

interface StaffPerformance {
  commissions: {
    totalCommissions: number;
    totalAmount: number;
    totalCommission: number;
    totalBonus: number;
  };
  topProducts: Array<{
    productName: string;
    quantity: number;
    totalAmount: number;
  }>;
  recentCommissions: Commission[];
}

// Salesman performance (gap item 7): one row per designated salesman
// from /api/salesmen/performance — sales attributed via salespersonId
// (else cashier), plus the commission rows calculated for them.
interface SalesmanRow {
  staffProfileId: string;
  employeeId: string;
  userId: string;
  name: string;
  email: string;
  designation?: string | null;
  totalSales: number;
  transactions: number;
  averageSale: number;
  commissions: { periods: number; totalAmount: number; totalCommission: number; totalBonus: number };
}

interface SalesmanDetail {
  staffProfileId: string;
  name: string;
  totalSales: number;
  totalPaid: number;
  transactions: number;
  averageSale: number;
  recentSales: Array<{
    id: string;
    invoiceNumber?: string | null;
    totalAmount: number;
    paidAmount: number;
    paymentStatus: string;
    createdAt: string;
    customer?: { id: string; name: string } | null;
    branch?: { id: string; name: string } | null;
  }>;
}

const PAGE_SIZE = 10;

const PerformanceTracking = () => {
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch } = useAdmin();

  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [stats, setStats] = useState<CommissionStats | null>(null);
  const [performance, setPerformance] = useState<StaffPerformance | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [isCalculateDialogOpen, setIsCalculateDialogOpen] = useState(false);

  // Salesmen leaderboard (gap item 7): designated salesmen only.
  const [salesmenPerf, setSalesmenPerf] = useState<{
    salesmen: SalesmanRow[];
    totals: { totalSales: number; transactions: number; totalCommission: number };
  } | null>(null);
  const [salesmenLoading, setSalesmenLoading] = useState(false);
  const [expandedSalesmanId, setExpandedSalesmanId] = useState<string | null>(null);
  const [salesmanDetail, setSalesmanDetail] = useState<SalesmanDetail | null>(null);

  // Performance date range (defaults to the current month)
  const now = new Date();
  const [startDate, setStartDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState(now.toISOString().split("T")[0]);

  // Calculate-commission form
  const [calcStaffId, setCalcStaffId] = useState("");
  const [calcBranchId, setCalcBranchId] = useState("");
  const [calcForm, setCalcForm] = useState({
    period: now.toISOString().split("T")[0],
    periodType: "MONTHLY" as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY",
    baseRate: "2",
    bonusRate: "0",
    notes: "",
  });

  const selectedStaff = staffMembers.find((s) => s.id === selectedStaffId);

  const loadStaff = useCallback(async () => {
    try {
      const response = await apiService.getStaff({
        branchId: selectedBranchId || undefined,
        limit: 100,
      });
      if (response.success && response.data) {
        const staff = (response.data.staff || []) as unknown as StaffMember[];
        setStaffMembers(staff);
        setSelectedStaffId((prev) => {
          if (prev && staff.some((s) => s.id === prev)) return prev;
          const mine = staff.find((s) => s.membership?.user?.id === user?.id);
          return mine?.id || staff[0]?.id || "";
        });
      } else {
        setStaffMembers([]);
      }
    } catch (err) {
      console.error("Error loading staff:", err);
      setStaffMembers([]);
    }
  }, [selectedBranchId, user?.id]);

  const loadStats = useCallback(async () => {
    try {
      const response = await apiService.getCommissionStats({
        branchId: selectedBranchId || undefined,
      });
      if (response.success && response.data) {
        setStats(response.data as CommissionStats);
      }
    } catch (err) {
      console.error("Error loading commission stats:", err);
    }
  }, [selectedBranchId]);

  const loadPerformance = useCallback(async () => {
    if (!selectedStaffId) {
      setPerformance(null);
      return;
    }
    try {
      const response = await apiService.getStaffPerformance(selectedStaffId, {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      if (response.success && response.data) {
        setPerformance(response.data as unknown as StaffPerformance);
      } else {
        setPerformance(null);
      }
    } catch (err) {
      console.error("Error loading staff performance:", err);
      setPerformance(null);
    }
  }, [selectedStaffId, startDate, endDate]);

  const loadCommissions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError("");
      const response = await apiService.getCommissions({
        page,
        limit: PAGE_SIZE,
        staffProfileId: selectedStaffId || undefined,
        branchId: selectedBranchId || undefined,
      });
      if (response.success && response.data) {
        setCommissions((response.data.commissions || []) as unknown as Commission[]);
        setTotalPages(response.data.pagination?.pages || 1);
      } else {
        setCommissions([]);
        setError(response.message || "Failed to load commissions");
      }
    } catch (err) {
      console.error("Error loading commissions:", err);
      setCommissions([]);
      setError("Failed to load commissions");
    } finally {
      setIsLoading(false);
    }
  }, [page, selectedStaffId, selectedBranchId]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  // Salesmen leaderboard (gap item 7): the same date range + branch
  // as the rest of this page; sales attributed via salespersonId.
  const loadSalesmenPerformance = useCallback(async () => {
    try {
      setSalesmenLoading(true);
      const response = await apiService.getSalesmenPerformance({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        branchId: selectedBranchId || undefined,
      });
      if (response.success && response.data) {
        setSalesmenPerf(response.data as unknown as {
          salesmen: SalesmanRow[];
          totals: { totalSales: number; transactions: number; totalCommission: number };
        });
      } else {
        setSalesmenPerf(null);
      }
    } catch (err) {
      console.error("Error loading salesmen performance:", err);
      setSalesmenPerf(null);
    } finally {
      setSalesmenLoading(false);
    }
  }, [startDate, endDate, selectedBranchId]);

  const toggleSalesmanDetail = async (row: SalesmanRow) => {
    if (expandedSalesmanId === row.staffProfileId) {
      setExpandedSalesmanId(null);
      setSalesmanDetail(null);
      return;
    }
    setExpandedSalesmanId(row.staffProfileId);
    try {
      const response = await apiService.getSalesmanPerformance(row.staffProfileId, {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        branchId: selectedBranchId || undefined,
      });
      if (response.success && response.data) {
        setSalesmanDetail(response.data as unknown as SalesmanDetail);
      } else {
        setSalesmanDetail(null);
      }
    } catch (err) {
      console.error("Error loading salesman detail:", err);
      setSalesmanDetail(null);
    }
  };

  useEffect(() => {
    loadStats();
    loadPerformance();
    loadSalesmenPerformance();
    setPage(1);
    loadCommissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStaffId, selectedBranchId]);

  useEffect(() => {
    loadPerformance();
    loadSalesmenPerformance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  useEffect(() => {
    loadCommissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const refreshAll = () => {
    loadStaff();
    loadStats();
    loadPerformance();
    loadSalesmenPerformance();
    loadCommissions();
  };

  const openCalculateDialog = () => {
    const staffId = selectedStaffId || staffMembers[0]?.id || "";
    setCalcStaffId(staffId);
    const staff = staffMembers.find((s) => s.id === staffId);
    const staffBranches = staff?.membership?.branches || [];
    const preferred =
      staffBranches.find((b) => b.id === selectedBranchId)?.id ||
      staffBranches[0]?.id ||
      selectedBranchId ||
      "";
    setCalcBranchId(preferred);
    setIsCalculateDialogOpen(true);
  };

  const handleCalculateCommission = async () => {
    if (!calcStaffId || !calcBranchId || !calcForm.period) {
      setError("Select a staff member, branch and period to calculate a commission.");
      return;
    }
    try {
      setIsProcessing(true);
      setError("");
      const response = await apiService.calculateCommission({
        staffProfileId: calcStaffId,
        branchId: calcBranchId,
        period: calcForm.period,
        periodType: calcForm.periodType,
        baseRate: (parseFloat(calcForm.baseRate) || 0) / 100,
        bonusRate: (parseFloat(calcForm.bonusRate) || 0) / 100,
        notes: calcForm.notes.trim() || undefined,
      });
      if (response.success && response.data) {
        toast.success("Commission Calculated", {
          description: `Commission of ${formatCurrency(response.data.totalAmount)} was recorded for sales of ${formatCurrency(response.data.totalSales)}.`,
        });
        setIsCalculateDialogOpen(false);
        refreshAll();
      } else {
        setError(response.message || "Failed to calculate commission");
        toast.error(response.message || "Failed to calculate commission");
      }
    } catch (err: any) {
      console.error("Error calculating commission:", err);
      setError(err?.message || "Failed to calculate commission. Please try again.");
      toast.error(err?.message || "Failed to calculate commission");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStatusChange = async (
    commission: Commission,
    status: "APPROVED" | "PAID" | "CANCELLED"
  ) => {
    try {
      setIsProcessing(true);
      const response = await apiService.updateCommission(commission.id, { status });
      if (response.success) {
        toast.success(`Commission ${status.toLowerCase()}`);
        refreshAll();
      } else {
        toast.error(response.message || "Failed to update commission");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to update commission");
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PAID":
        return "bg-green-100 text-green-800";
      case "APPROVED":
        return "bg-blue-100 text-blue-800";
      case "PENDING":
        return "bg-yellow-100 text-yellow-800";
      case "CANCELLED":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatCurrency = (amount: number) => {
    return `PKR ${Number(amount || 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const renderCommissionRow = (commission: Commission, compact = false) => (
    <div
      key={commission.id}
      className="flex flex-wrap items-center justify-between gap-3 p-4 border border-border rounded-lg"
    >
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{commission.period}</span>
          <Badge variant="outline" className="text-xs">
            {commission.periodType}
          </Badge>
        </div>
        {!compact && commission.staffProfile?.membership?.user?.name && (
          <span className="text-sm text-muted-foreground">
            {commission.staffProfile.membership.user.name}
          </span>
        )}
        {commission.branch?.name && (
          <span className="text-sm text-muted-foreground">{commission.branch.name}</span>
        )}
        <div className="flex items-center space-x-1">
          <DollarSign className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {formatCurrency(commission.totalSales)} sales
          </span>
        </div>
        <div className="flex items-center space-x-1">
          <Target className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {commission.totalTransactions} transactions
          </span>
        </div>
      </div>
      <div className="flex items-center space-x-3">
        <div className="text-right">
          <div className="flex items-center space-x-2">
            <span className="text-lg font-bold">{formatCurrency(commission.totalAmount)}</span>
            <Badge className={getStatusColor(commission.status)}>{commission.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Base: {formatCurrency(commission.totalCommission)} + Bonus:{" "}
            {formatCurrency(commission.bonusAmount)}
          </p>
          {commission.paidAt && (
            <p className="text-xs text-muted-foreground">Paid: {formatDate(commission.paidAt)}</p>
          )}
        </div>
        {!compact && commission.status !== "PAID" && commission.status !== "CANCELLED" && (
          <div className="flex flex-col space-y-1">
            {commission.status === "PENDING" && (
              <Button
                size="sm"
                variant="outline"
                disabled={isProcessing}
                onClick={() => handleStatusChange(commission, "APPROVED")}
              >
                <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={isProcessing}
              onClick={() => handleStatusChange(commission, "PAID")}
            >
              <DollarSign className="w-3.5 h-3.5 mr-1" /> Mark Paid
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isProcessing}
              onClick={() => handleStatusChange(commission, "CANCELLED")}
            >
              <Ban className="w-3.5 h-3.5 mr-1" /> Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  const calcStaffBranches =
    staffMembers.find((s) => s.id === calcStaffId)?.membership?.branches || [];

  return (
    <div className="p-6 space-y-6 bg-background min-h-screen">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Performance Tracking</h1>
          <p className="text-muted-foreground">
            Staff sales performance and commissions
            {selectedBranch ? ` — ${selectedBranch.name}` : ""}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <User className="w-5 h-5 text-muted-foreground" />
          <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select staff member" />
            </SelectTrigger>
            <SelectContent>
              {staffMembers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.membership?.user?.name || "Unknown"}
                  {s.designation ? ` (${s.designation})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="w-5 h-5 text-red-600 mr-2" />
            <p className="text-red-800 font-medium">Error: {error}</p>
          </div>
        </div>
      )}

      {staffMembers.length === 0 && !isLoading ? (
        <Card className="shadow-soft border-0">
          <CardContent className="py-12 text-center text-muted-foreground">
            <User className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p>No staff profiles found for this branch yet.</p>
            <p className="text-sm mt-1">
              Commissions are calculated per staff member once staff profiles exist.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Commission totals for the selected branch/business */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="shadow-soft border-0">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Commission Records
                      </p>
                      <p className="text-2xl font-bold text-foreground">
                        {stats.totalCommissions}
                      </p>
                    </div>
                    <BarChart3 className="w-8 h-8 text-blue-600" />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-soft border-0">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Total Commission Amount
                      </p>
                      <p className="text-2xl font-bold text-foreground">
                        {formatCurrency(stats.totalAmount)}
                      </p>
                    </div>
                    <TrendingUp className="w-8 h-8 text-green-600" />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-soft border-0">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Paid Out</p>
                      <p className="text-2xl font-bold text-foreground">
                        {formatCurrency(stats.totalPaidAmount)}
                      </p>
                    </div>
                    <DollarSign className="w-8 h-8 text-emerald-600" />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-soft border-0">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Pending Approval
                      </p>
                      <p className="text-2xl font-bold text-foreground">
                        {stats.pendingCommissions}
                      </p>
                    </div>
                    <Clock className="w-8 h-8 text-yellow-600" />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Salesmen leaderboard (gap item 7): designated salesmen
              only, over the same date range + branch as this page.
              Sales are attributed via salespersonId (else cashier) —
              the same rule commissions use, so the rows never
              double-count a sale. Click a row for recent sales. */}
          <Card className="shadow-soft border-0">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center space-x-2">
                  <Target className="w-5 h-5" />
                  <span>Salesmen — Sales Performance</span>
                </span>
                <span className="text-sm font-normal text-muted-foreground">
                  {salesmenPerf
                    ? `${formatCurrency(salesmenPerf.totals.totalSales)} across ${salesmenPerf.totals.transactions} sales`
                    : "Designated salesmen only"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {salesmenLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading salesmen…</p>
              ) : !salesmenPerf || salesmenPerf.salesmen.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No salesmen designated yet. Mark staff as salesmen in Staff — they will appear here and in the POS picker.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Salesman</th>
                        <th className="py-2 pr-3 font-medium text-right">Sales</th>
                        <th className="py-2 pr-3 font-medium text-right">Transactions</th>
                        <th className="py-2 pr-3 font-medium text-right">Avg sale</th>
                        <th className="py-2 font-medium text-right">Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesmenPerf.salesmen.map((row) => (
                        <Fragment key={row.staffProfileId}>
                          <tr
                            onClick={() => void toggleSalesmanDetail(row)}
                            className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                          >
                            <td className="py-2.5 pr-3">
                              <span className="font-semibold text-foreground">{row.name}</span>
                              {row.designation ? (
                                <span className="text-muted-foreground"> ({row.designation})</span>
                              ) : null}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-semibold">{formatCurrency(row.totalSales)}</td>
                            <td className="py-2.5 pr-3 text-right">{row.transactions}</td>
                            <td className="py-2.5 pr-3 text-right">{formatCurrency(row.averageSale)}</td>
                            <td className="py-2.5 text-right">{formatCurrency(row.commissions.totalCommission)}</td>
                          </tr>
                          {expandedSalesmanId === row.staffProfileId && (
                            <tr className="border-b bg-muted/30">
                              <td colSpan={5} className="px-3 py-3">
                                {!salesmanDetail || salesmanDetail.staffProfileId !== row.staffProfileId ? (
                                  <p className="text-sm text-muted-foreground">Loading recent sales…</p>
                                ) : salesmanDetail.recentSales.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">No sales in this range.</p>
                                ) : (
                                  <ul className="space-y-1.5">
                                    {salesmanDetail.recentSales.map((sale) => (
                                      <li key={sale.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                        <span>
                                          {sale.invoiceNumber || "Sale"} • {sale.customer?.name || "Walk-in"} •{" "}
                                          {formatDate(sale.createdAt)}
                                        </span>
                                        <span className="font-semibold">
                                          {formatCurrency(sale.totalAmount)}
                                          {sale.paymentStatus !== "COMPLETED" && (
                                            <span className="ml-2 text-xs font-normal text-amber-600">
                                              {formatCurrency(sale.paidAmount)} paid
                                            </span>
                                          )}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Selected staff performance */}
          {selectedStaff && (
            <Card className="shadow-soft border-0">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center space-x-2">
                    <Award className="w-5 h-5" />
                    <span>
                      {selectedStaff.membership?.user?.name || "Staff"} — Performance
                    </span>
                  </span>
                  <span className="flex items-center space-x-2 text-sm font-normal">
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-[150px]"
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-[150px]"
                    />
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {performance ? (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Commission Records</p>
                        <p className="text-xl font-bold">
                          {performance.commissions.totalCommissions}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Total Earned</p>
                        <p className="text-xl font-bold">
                          {formatCurrency(performance.commissions.totalAmount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Base Commission</p>
                        <p className="text-xl font-bold">
                          {formatCurrency(performance.commissions.totalCommission)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Bonus</p>
                        <p className="text-xl font-bold">
                          {formatCurrency(performance.commissions.totalBonus)}
                        </p>
                      </div>
                    </div>

                    {performance.topProducts.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Top Products Sold (period)</p>
                        <div className="space-y-2">
                          {performance.topProducts.map((p) => (
                            <div
                              key={p.productName}
                              className="flex items-center justify-between text-sm border-b border-border/50 pb-1"
                            >
                              <span>{p.productName}</span>
                              <span className="text-muted-foreground">
                                {p.quantity} sold · {formatCurrency(p.totalAmount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {performance.commissions.totalCommissions === 0 &&
                      performance.topProducts.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No commissions or sales recorded for this staff member in the
                          selected period.
                        </p>
                      )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Performance data is not available for this staff member.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Commission Management */}
          <Card className="shadow-soft border-0">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center space-x-2">
                  <Award className="w-5 h-5" />
                  <span>Commission Management</span>
                </span>
                <Dialog open={isCalculateDialogOpen} onOpenChange={setIsCalculateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      className="flex items-center space-x-2"
                      onClick={openCalculateDialog}
                    >
                      <Calculator className="w-4 h-4" />
                      <span>Calculate Commission</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Calculate Commission</DialogTitle>
                      <DialogDescription>
                        Calculates commission from the staff member&apos;s completed sales
                        in the selected period and branch.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Staff Member</Label>
                        <Select
                          value={calcStaffId}
                          onValueChange={(value) => {
                            setCalcStaffId(value);
                            const staff = staffMembers.find((s) => s.id === value);
                            const branches = staff?.membership?.branches || [];
                            setCalcBranchId(
                              branches.find((b) => b.id === selectedBranchId)?.id ||
                                branches[0]?.id ||
                                selectedBranchId ||
                                ""
                            );
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select staff member" />
                          </SelectTrigger>
                          <SelectContent>
                            {staffMembers.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.membership?.user?.name || "Unknown"}
                                {s.designation ? ` (${s.designation})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Branch</Label>
                        <Select value={calcBranchId} onValueChange={setCalcBranchId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select branch" />
                          </SelectTrigger>
                          <SelectContent>
                            {calcStaffBranches.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.name}
                              </SelectItem>
                            ))}
                            {calcStaffBranches.length === 0 && selectedBranch && (
                              <SelectItem value={selectedBranch.id}>
                                {selectedBranch.name}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Period Type</Label>
                          <Select
                            value={calcForm.periodType}
                            onValueChange={(value) =>
                              setCalcForm({
                                ...calcForm,
                                periodType: value as typeof calcForm.periodType,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="DAILY">Daily</SelectItem>
                              <SelectItem value="WEEKLY">Weekly</SelectItem>
                              <SelectItem value="MONTHLY">Monthly</SelectItem>
                              <SelectItem value="YEARLY">Yearly</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Period Date</Label>
                          <Input
                            type="date"
                            value={calcForm.period}
                            onChange={(e) =>
                              setCalcForm({ ...calcForm, period: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="baseRate">Base Rate (%)</Label>
                          <Input
                            id="baseRate"
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            placeholder="2"
                            value={calcForm.baseRate}
                            onChange={(e) =>
                              setCalcForm({ ...calcForm, baseRate: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bonusRate">Bonus Rate (%)</Label>
                          <Input
                            id="bonusRate"
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            placeholder="0"
                            value={calcForm.bonusRate}
                            onChange={(e) =>
                              setCalcForm({ ...calcForm, bonusRate: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="notes">Notes (Optional)</Label>
                        <Textarea
                          id="notes"
                          placeholder="Add any notes about this commission calculation..."
                          value={calcForm.notes}
                          onChange={(e) =>
                            setCalcForm({ ...calcForm, notes: e.target.value })
                          }
                          rows={3}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setIsCalculateDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleCalculateCommission}
                        disabled={isProcessing || !calcStaffId || !calcBranchId}
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Calculating...
                          </>
                        ) : (
                          "Calculate Commission"
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin mr-2" />
                  <span>Loading commissions...</span>
                </div>
              ) : commissions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Award className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>No commission records found</p>
                  <p className="text-sm mt-1">
                    Use “Calculate Commission” to generate one from completed sales.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {commissions.map((commission) => renderCommissionRow(commission))}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1 || isLoading}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages || isLoading}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Commissions (from the performance endpoint) */}
          {performance?.recentCommissions && performance.recentCommissions.length > 0 && (
            <Card className="shadow-soft border-0">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Clock className="w-5 h-5" />
                  <span>Recent Commissions — {selectedStaff?.membership?.user?.name}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {performance.recentCommissions.map((commission) =>
                    renderCommissionRow(commission, true)
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end space-x-4">
        <Button
          onClick={refreshAll}
          disabled={isLoading || isProcessing}
          variant="outline"
          className="flex items-center space-x-2"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <BarChart3 className="w-4 h-4" />
          )}
          <span>Refresh Data</span>
        </Button>
      </div>
    </div>
  );
};

export default PerformanceTracking;
