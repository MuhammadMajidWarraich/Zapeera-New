import { useState, useEffect } from "react";
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
  CheckCircle,
  Clock
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiService } from "@/services/api";

interface Commission {
  id: string;
  staffId: string;
  staff: {
    id: string;
    name: string;
    staffId: string;
    position: string;
  };
  period: string;
  periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  totalSales: number;
  totalTransactions: number;
  averageSale: number;
  baseRate: number;
  bonusRate: number;
  totalCommission: number;
  bonusAmount: number;
  totalAmount: number;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'CANCELLED';
  paidAt?: string;
  notes?: string;
  createdAt: string;
}

interface PerformanceData {
  sales: {
    totalSales: number;
    totalTransactions: number;
    averageSale: number;
  };
  commissions: {
    totalCommissions: number;
    totalAmount: number;
    totalCommission: number;
    totalBonus: number;
  };
  recentCommissions: Commission[];
}

const PerformanceTracking = () => {
  const { user } = useAuth();
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [isCalculateDialogOpen, setIsCalculateDialogOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState("");

  // Form states
  const [newCommission, setNewCommission] = useState({
    period: "",
    periodType: "MONTHLY",
    baseRate: "0.02",
    bonusRate: "0",
    notes: ""
  });

  // Load data on component mount
  useEffect(() => {
    if (user?.id) {
      loadPerformanceData();
      loadCommissions();
    }
  }, [user?.id]);

  const loadPerformanceData = async () => {
    if (!user?.id) return;

    try {
      setIsLoading(true);
      setError("");

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Mock performance data
      const mockPerformanceData = {
        staff: {
          id: user.id,
          name: user.name || "Unknown User",
          staffId: user.id,
          position: user.role || "Cashier"
        },
        period: selectedPeriod,
        sales: {
          totalSales: 125000,
          totalTransactions: 45,
          averageSale: 2777.78,
          targetSales: 100000,
          achievementPercentage: 125
        },
        customers: {
          newCustomers: 12,
          returningCustomers: 33,
          totalCustomers: 45,
          customerSatisfaction: 4.5
        },
        products: {
          totalProductsSold: 156,
          topSellingProduct: "Paracetamol 500mg",
          topSellingCategory: "Pain Relief"
        },
        commissions: {
          totalCommissions: 2,
          totalAmount: 3000,
          totalCommission: 2500,
          totalBonus: 500
        },
        goals: [
          {
            id: "goal_001",
            title: "Monthly Sales Target",
            target: 100000,
            current: 125000,
            unit: "PKR",
            deadline: "2024-01-31",
            status: "ACHIEVED"
          },
          {
            id: "goal_002",
            title: "Customer Acquisition",
            target: 10,
            current: 12,
            unit: "customers",
            deadline: "2024-01-31",
            status: "ACHIEVED"
          }
        ],
        achievements: [
          {
            id: "ach_001",
            title: "Sales Champion",
            description: "Exceeded monthly sales target by 25%",
            earnedAt: "2024-01-15T10:30:00Z",
            type: "SALES"
          },
          {
            id: "ach_002",
            title: "Customer Favorite",
            description: "Highest customer satisfaction rating",
            earnedAt: "2024-01-20T14:20:00Z",
            type: "CUSTOMER"
          }
        ],
        recentCommissions: [
          {
            id: "comm_001",
            staffId: user?.id || "",
            staff: {
              id: user?.id || "",
              name: user?.name || "Unknown User",
              staffId: user?.id || "",
              position: user?.role || "Cashier"
            },
            period: "2024-01",
            periodType: "MONTHLY" as const,
            totalSales: 125000,
            totalTransactions: 45,
            averageSale: 2777.78,
            baseRate: 0.02,
            bonusRate: 0,
            totalCommission: 2500,
            bonusAmount: 0,
            totalAmount: 2500,
            status: "PAID" as const,
            paidAt: "2024-02-01T10:00:00Z",
            createdAt: "2024-01-31T23:59:59Z"
          },
          {
            id: "comm_002",
            staffId: user?.id || "",
            staff: {
              id: user?.id || "",
              name: user?.name || "Unknown User",
              staffId: user?.id || "",
              position: user?.role || "Cashier"
            },
            period: "2024-01",
            periodType: "MONTHLY" as const,
            totalSales: 50000,
            totalTransactions: 20,
            averageSale: 2500,
            baseRate: 0.01,
            bonusRate: 0,
            totalCommission: 500,
            bonusAmount: 0,
            totalAmount: 500,
            status: "PENDING" as const,
            createdAt: "2024-01-31T23:59:59Z"
          }
        ]
      };

      setPerformanceData(mockPerformanceData);
    } catch (err) {
      console.error('Error loading performance data:', err);
      setError('Failed to load performance data');
    } finally {
      setIsLoading(false);
    }
  };

  const loadCommissions = async () => {
    if (!user?.id) return;

    try {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 500));

      // Mock commissions data
      const mockCommissions: Commission[] = [
        {
          id: "comm_001",
          staffId: user.id,
          staff: {
            id: user.id,
            name: user.name || "Unknown User",
            staffId: user.id,
            position: user.role || "Cashier"
          },
          period: "2024-01",
          periodType: "MONTHLY" as const,
          totalSales: 125000,
          totalTransactions: 45,
          averageSale: 2777.78,
          baseRate: 0.02,
          bonusRate: 0,
          totalCommission: 2500,
          bonusAmount: 0,
          totalAmount: 2500,
          status: "PAID" as const,
          paidAt: "2024-02-01T10:00:00Z",
          notes: "Monthly sales commission",
          createdAt: "2024-01-31T23:59:59Z"
        },
        {
          id: "comm_002",
          staffId: user.id,
          staff: {
            id: user.id,
            name: user.name || "Unknown User",
            staffId: user.id,
            position: user.role || "Cashier"
          },
          period: "2024-01",
          periodType: "MONTHLY" as const,
          totalSales: 50000,
          totalTransactions: 20,
          averageSale: 2500,
          baseRate: 0.01,
          bonusRate: 0,
          totalCommission: 500,
          bonusAmount: 0,
          totalAmount: 500,
          status: "PENDING" as const,
          notes: "Customer acquisition bonus",
          createdAt: "2024-01-31T23:59:59Z"
        }
      ];

      setCommissions(mockCommissions);
    } catch (err) {
      console.error('Error loading commissions:', err);
      setCommissions([]);
    }
  };

  const handleCalculateCommission = async () => {
    if (!user?.id) {
      setError("User information not found");
      return;
    }

    try {
      setIsProcessing(true);
      setError("");

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Mock commission calculation
      const baseRate = parseFloat(newCommission.baseRate) || 0.02;
      const bonusRate = parseFloat(newCommission.bonusRate) || 0;
      const mockSalesAmount = 125000; // Mock sales amount
      const calculatedAmount = (mockSalesAmount * baseRate) + (mockSalesAmount * bonusRate);

      const newCommissionData = {
        id: `comm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        staffId: user.id,
        staff: {
          id: user.id,
          name: user.name || "Unknown User",
          staffId: user.id,
          position: user.role || "Cashier"
        },
        period: newCommission.period,
        amount: calculatedAmount,
        status: "PENDING",
        calculatedAt: new Date().toISOString(),
        description: `Commission for ${newCommission.periodType.toLowerCase()} period`,
        notes: newCommission.notes.trim() || undefined
      };

      // Commission caching disabled

      setNewCommission({
        period: "",
        periodType: "MONTHLY",
        baseRate: "0.02",
        bonusRate: "0",
        notes: ""
      });
      setIsCalculateDialogOpen(false);
      await loadCommissions();
      await loadPerformanceData();
      toast.success("Commission Calculated", {
        description: `Commission calculated successfully! Amount: PKR ${calculatedAmount.toFixed(2)}`,
      });
    } catch (err) {
      console.error('Error calculating commission:', err);
      setError("Failed to calculate commission. Please try again.");
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
    return `PKR ${amount.toLocaleString()}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const generatePeriodOptions = () => {
    const options = [];
    const now = new Date();
    
    // Daily options (last 7 days)
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      options.push({
        value: date.toISOString().split('T')[0],
        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        type: 'DAILY'
      });
    }
    
    // Weekly options (last 4 weeks)
    for (let i = 0; i < 4; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - (i * 7));
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      options.push({
        value: weekStart.toISOString().split('T')[0],
        label: `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        type: 'WEEKLY'
      });
    }
    
    // Monthly options (last 12 months)
    for (let i = 0; i < 12; i++) {
      const date = new Date(now);
      date.setMonth(date.getMonth() - i);
      options.push({
        value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        label: date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' }),
        type: 'MONTHLY'
      });
    }
    
    return options;
  };

  return (
    <div className="p-6 space-y-6 bg-background min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Performance Tracking</h1>
          <p className="text-muted-foreground">Track your sales performance and commissions</p>
        </div>
        
        <div className="flex items-center space-x-2">
          <User className="w-5 h-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {user?.name || 'Unknown User'}
          </span>
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

      {/* Performance Overview */}
      {performanceData && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Sales</p>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(performanceData.sales.totalSales)}
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
                  <p className="text-sm font-medium text-muted-foreground">Transactions</p>
                  <p className="text-2xl font-bold text-foreground">
                    {performanceData.sales.totalTransactions}
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
                  <p className="text-sm font-medium text-muted-foreground">Average Sale</p>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(performanceData.sales.averageSale)}
                  </p>
                </div>
                <Target className="w-8 h-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Commissions</p>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(performanceData.commissions.totalAmount)}
                  </p>
                </div>
                <Award className="w-8 h-8 text-yellow-600" />
              </div>
            </CardContent>
          </Card>
        </div>
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
                <Button className="flex items-center space-x-2">
                  <Calculator className="w-4 h-4" />
                  <span>Calculate Commission</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Calculate Commission</DialogTitle>
                  <DialogDescription>
                    Calculate commission for a specific period.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="period">Period</Label>
                    <Select
                      value={selectedPeriod}
                      onValueChange={(value) => {
                        const option = generatePeriodOptions().find(opt => opt.value === value);
                        if (option) {
                          setSelectedPeriod(value);
                          setNewCommission({
                            ...newCommission,
                            period: value,
                            periodType: option.type
                          });
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select period" />
                      </SelectTrigger>
                      <SelectContent>
                        {generatePeriodOptions().map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label} ({option.type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="baseRate">Base Rate (%)</Label>
                      <Input
                        id="baseRate"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        placeholder="2.0"
                        value={newCommission.baseRate}
                        onChange={(e) => setNewCommission({...newCommission, baseRate: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bonusRate">Bonus Rate (%)</Label>
                      <Input
                        id="bonusRate"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        placeholder="0.0"
                        value={newCommission.bonusRate}
                        onChange={(e) => setNewCommission({...newCommission, bonusRate: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes (Optional)</Label>
                    <Textarea
                      id="notes"
                      placeholder="Add any notes about this commission calculation..."
                      value={newCommission.notes}
                      onChange={(e) => setNewCommission({...newCommission, notes: e.target.value})}
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCalculateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCalculateCommission} disabled={isProcessing || !selectedPeriod}>
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
              <span>Loading performance data...</span>
            </div>
          ) : commissions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Award className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p>No commission records found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {commissions.map((commission) => (
                <div
                  key={commission.id}
                  className="flex items-center justify-between p-4 border border-border rounded-lg"
                >
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        {commission.period}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {commission.periodType}
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-1">
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {formatCurrency(commission.totalSales)}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Target className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {commission.totalTransactions} transactions
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg font-bold">
                        {formatCurrency(commission.totalAmount)}
                      </span>
                      <Badge className={getStatusColor(commission.status)}>
                        {commission.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Base: {formatCurrency(commission.totalCommission)} + Bonus: {formatCurrency(commission.bonusAmount)}
                    </p>
                    {commission.paidAt && (
                      <p className="text-xs text-muted-foreground">
                        Paid: {formatDate(commission.paidAt)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Performance */}
      {performanceData?.recentCommissions && performanceData.recentCommissions.length > 0 && (
        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Clock className="w-5 h-5" />
              <span>Recent Commissions</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {performanceData.recentCommissions.map((commission) => (
                <div
                  key={commission.id}
                  className="flex items-center justify-between p-3 border border-border rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <div>
                      <p className="text-sm font-medium">{commission.period}</p>
                      <p className="text-xs text-muted-foreground">
                        {commission.periodType} • {formatDate(commission.createdAt)}
                      </p>
                    </div>
                    <Badge className={getStatusColor(commission.status)}>
                      {commission.status}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {formatCurrency(commission.totalAmount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(commission.totalSales)} sales
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end space-x-4">
        <Button
          onClick={() => {
            loadPerformanceData();
            loadCommissions();
          }}
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
