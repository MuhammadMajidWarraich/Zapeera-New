import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Clock,
  CheckCircle,
  XCircle,
  User,
  Calendar,
  Timer,
  LogIn,
  LogOut,
  AlertCircle,
  Loader2,
  DollarSign,
  TrendingUp,
  Users,
  ShoppingCart
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiService } from "@/services/api";

interface AttendanceRecord {
  id: string;
  checkIn: string;
  checkOut?: string;
  totalHours?: number;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'LEAVE';
  notes?: string;
  createdAt: string;
  employee?: {
    id: string;
    name: string;
    employeeId: string;
    position: string;
  };
  branch?: {
    id: string;
    name: string;
  };
}

interface SalesData {
  totalSales: number;
  totalTransactions: number;
  averageSale: number;
  topProducts: Array<{
    productName: string;
    quantity: number;
    totalAmount: number;
  }>;
}

interface Employee {
  id: string;
  name: string;
  employeeId: string;
  position: string;
  email: string;
  phone?: string;
  status: string;
  branchId: string;
}

const EmployeeCheckIn = () => {
  const { user } = useAuth();
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [currentAttendance, setCurrentAttendance] = useState<AttendanceRecord | null>(null);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");

  // Employee management states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showEmployeeTable, setShowEmployeeTable] = useState(false);

  // Sales tracking states
  const [currentShiftSales, setCurrentShiftSales] = useState<SalesData | null>(null);
  const [previousShiftSales, setPreviousShiftSales] = useState<SalesData | null>(null);
  const [showSalesSummary, setShowSalesSummary] = useState(false);

  // Load today's attendance on component mount
  useEffect(() => {
    if (user?.id) {
      loadTodayAttendance();
      loadEmployees();
    }
  }, [user?.id, user?.branchId]);

  // Load employees
  const loadEmployees = async () => {
    try {
      console.log('Loading employees for branch:', user?.branchId);
      const response = await apiService.getEmployees({
        branchId: user?.membership?.branchIds?.[0] || user?.branchId || undefined,
        limit: 100
      });

      console.log('Employees response:', response);
      if (response.success && response.data) {
        setEmployees(response.data.employees || []);
        console.log('Loaded employees:', response.data.employees?.length || 0);
      } else {
        console.error('Failed to load employees:', response.message);
        setEmployees([]);
      }
    } catch (err) {
      console.error('Error loading employees:', err);
      setEmployees([]);
    }
  };

  // Load sales data for current shift
  const loadCurrentShiftSales = async (employeeId: string) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const response = await apiService.getEmployeePerformance(employeeId, {
        startDate: today,
        endDate: today
      });

      if (response.success && response.data) {
        setCurrentShiftSales(response.data as any);
      }
    } catch (err) {
      console.error('Error loading current shift sales:', err);
    }
  };

  // Load sales data for previous shift
  const loadPreviousShiftSales = async (employeeId: string) => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const response = await apiService.getEmployeePerformance(employeeId, {
        startDate: yesterdayStr,
        endDate: yesterdayStr
      });

      if (response.success && response.data) {
        setPreviousShiftSales(response.data as any);
      }
    } catch (err) {
      console.error('Error loading previous shift sales:', err);
    }
  };

  const loadTodayAttendance = async () => {
    try {
      setIsLoading(true);
      setError("");

      if (!user?.id) {
        setError("User not found");
        return;
      }

      const response = await apiService.getTodayAttendance(user.id);

      if (response.success && response.data) {
        setTodayAttendance([response.data as any]);
        setIsCheckedIn(true);
        setCurrentAttendance(response.data as any);
      } else {
        setTodayAttendance([]);
        setIsCheckedIn(false);
        setCurrentAttendance(null);
      }
    } catch (err) {
      console.error('Error loading today\'s attendance:', err);
      setError('Failed to load attendance data');
      setTodayAttendance([]);
      setIsCheckedIn(false);
      setCurrentAttendance(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckIn = async (employeeId?: string) => {
    const targetEmployeeId = employeeId || user?.id;
    if (!targetEmployeeId || !user?.branchId) {
      setError("Employee or branch information not found");
      return;
    }

    try {
      setIsProcessing(true);
      setError("");

      const response = await apiService.checkIn({
        employeeId: targetEmployeeId,
        branchId: user?.membership?.branchIds?.[0] || user?.branchId || undefined,
        notes: notes.trim() || undefined
      });

      if (response.success && response.data) {
        setTodayAttendance([response.data as any]);
        setIsCheckedIn(true);
        setCurrentAttendance(response.data as any);
        setNotes("");

        // Load previous shift sales when checking in
        await loadPreviousShiftSales(targetEmployeeId);

        toast.success("Check-in Successful", {
          description: "Check-in successful!",
        });
      } else {
        setError(response.message || "Failed to check in");
      }
    } catch (err) {
      console.error('Error checking in:', err);
      setError("Failed to check in. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCheckOut = async () => {
    if (!currentAttendance?.id) {
      setError("No active attendance record found");
      return;
    }

    try {
      setIsProcessing(true);
      setError("");

      // Load current shift sales before checkout
      if (currentAttendance.employee?.id) {
        await loadCurrentShiftSales(currentAttendance.employee.id);
        setShowSalesSummary(true);
      }

      const response = await apiService.checkOut({
        attendanceId: currentAttendance.id,
        notes: notes.trim() || undefined
      });

      if (response.success && response.data) {
        setTodayAttendance([response.data as any]);
        setIsCheckedIn(false);
        setCurrentAttendance(null);
        setNotes("");
        toast.success("Check-out Successful", {
          description: "Check-out successful! Sales summary displayed below.",
        });
      } else {
        setError(response.message || "Failed to check out");
      }
    } catch (err) {
      console.error('Error checking out:', err);
      setError("Failed to check out. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PRESENT":
        return "bg-green-100 text-green-800";
      case "LATE":
        return "bg-yellow-100 text-yellow-800";
      case "HALF_DAY":
        return "bg-blue-100 text-blue-800";
      case "ABSENT":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const calculateHours = (checkIn: string, checkOut?: string) => {
    if (!checkOut) return null;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diffMs = end.getTime() - start.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    return Math.round(diffHours * 100) / 100;
  };

  return (
    <div className="p-6 space-y-6 bg-background min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Employee Check-in</h1>
          <p className="text-muted-foreground">Check in and out for your shifts</p>
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

      {/* Current Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Clock className="w-5 h-5" />
              <span>Current Status</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {isCheckedIn ? "Currently Checked In" : "Not Checked In"}
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {isCheckedIn ? "Active" : "Inactive"}
                </p>
                {currentAttendance && (
                  <p className="text-sm text-muted-foreground">
                    Since {formatTime(currentAttendance.checkIn)}
                  </p>
                )}
              </div>
              {isCheckedIn ? (
                <CheckCircle className="w-8 h-8 text-green-600" />
              ) : (
                <XCircle className="w-8 h-8 text-gray-400" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-0">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Today's Date</p>
                <p className="text-2xl font-bold text-foreground">
                  {formatDate(new Date().toISOString())}
                </p>
              </div>
              <Calendar className="w-8 h-8 text-accent" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Check In/Out Actions */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Timer className="w-5 h-5" />
            <span>Attendance Actions</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any notes about your shift..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex space-x-4">
            {!isCheckedIn ? (
              <Button
                onClick={() => handleCheckIn()}
                disabled={isProcessing || isLoading}
                className="flex items-center space-x-2 bg-green-600 hover:bg-green-700"
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>{isProcessing ? "Checking In..." : "Check In"}</span>
              </Button>
            ) : (
              <Button
                onClick={handleCheckOut}
                disabled={isProcessing || isLoading}
                className="flex items-center space-x-2 bg-red-600 hover:bg-red-700"
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4" />
                )}
                <span>{isProcessing ? "Checking Out..." : "Check Out"}</span>
              </Button>
            )}

            <Button
              onClick={loadTodayAttendance}
              disabled={isLoading || isProcessing}
              variant="outline"
              className="flex items-center space-x-2"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Clock className="w-4 h-4" />
              )}
              <span>Refresh</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Today's Attendance Records */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Calendar className="w-5 h-5" />
            <span>Today's Attendance</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              <span>Loading attendance...</span>
            </div>
          ) : todayAttendance.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p>No attendance records for today</p>
            </div>
          ) : (
            <div className="space-y-4">
              {todayAttendance.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between p-4 border border-border rounded-lg"
                >
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        {formatTime(record.checkIn)}
                      </span>
                      {record.checkOut && (
                        <>
                          <span className="text-muted-foreground">-</span>
                          <span className="text-sm font-medium">
                            {formatTime(record.checkOut)}
                          </span>
                        </>
                      )}
                    </div>
                    <Badge className={getStatusColor(record.status)}>
                      {record.status}
                    </Badge>
                    {record.totalHours && (
                      <div className="flex items-center space-x-1">
                        <Timer className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {record.totalHours}h
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">
                      {record.notes || "No notes"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-soft border-0">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                <p className="text-2xl font-bold text-foreground">
                  {isCheckedIn ? "Active" : "Inactive"}
                </p>
              </div>
              {isCheckedIn ? (
                <CheckCircle className="w-8 h-8 text-green-600" />
              ) : (
                <XCircle className="w-8 h-8 text-gray-400" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-0">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Records Today</p>
                <p className="text-2xl font-bold text-foreground">{todayAttendance.length}</p>
              </div>
              <Calendar className="w-8 h-8 text-accent" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-0">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Hours</p>
                <p className="text-2xl font-bold text-foreground">
                  {currentAttendance?.totalHours ? `${currentAttendance.totalHours}h` : 'N/A'}
                </p>
              </div>
              <Timer className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Employee Management Section */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center space-x-2">
              <Users className="w-5 h-5" />
              <span>Employee Management</span>
            </CardTitle>
            <div className="flex space-x-2">
              <Button
                onClick={() => {
                  setShowEmployeeTable(!showEmployeeTable);
                  if (!showEmployeeTable) {
                    loadEmployees();
                  }
                }}
                variant="outline"
                className="flex items-center space-x-2"
              >
                <Users className="w-4 h-4" />
                <span>{showEmployeeTable ? "Hide" : "Show"} Employee Table</span>
              </Button>
              <Button
                onClick={loadEmployees}
                variant="outline"
                className="flex items-center space-x-2"
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Users className="w-4 h-4" />
                )}
                <span>Refresh</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        {showEmployeeTable && (
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Select an employee to manage their check-in/check-out
                </div>
                <div className="text-sm font-medium text-foreground">
                  Total Employees: {employees.length}
                </div>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin mr-2" />
                  <span>Loading employees...</span>
                </div>
              ) : employees.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>No employees found</p>
                  <p className="text-sm">Make sure employees are created and assigned to this branch</p>
                </div>
              ) : (
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((employee) => (
                    <TableRow key={employee.id}>
                      <TableCell className="font-medium">{employee.employeeId}</TableCell>
                      <TableCell>{employee.name}</TableCell>
                      <TableCell>{employee.position}</TableCell>
                      <TableCell>{employee.email}</TableCell>
                      <TableCell>
                        <Badge className={employee.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                          {employee.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedEmployee(employee);
                              handleCheckIn(employee.id);
                            }}
                            disabled={isProcessing}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <LogIn className="w-3 h-3 mr-1" />
                            Check In
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedEmployee(employee);
                              loadPreviousShiftSales(employee.id);
                            }}
                          >
                            <TrendingUp className="w-3 h-3 mr-1" />
                            View Sales
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Sales Summary Section */}
      {(showSalesSummary || previousShiftSales) && (
        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <DollarSign className="w-5 h-5" />
              <span>Sales Summary</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Current Shift Sales */}
              {currentShiftSales && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-green-600">Current Shift Sales</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-green-50 p-4 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <DollarSign className="w-5 h-5 text-green-600" />
                        <span className="text-sm font-medium text-green-800">Total Sales</span>
                      </div>
                      <p className="text-2xl font-bold text-green-900">
                        Rs. {currentShiftSales.totalSales.toLocaleString()}
                      </p>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <ShoppingCart className="w-5 h-5 text-blue-600" />
                        <span className="text-sm font-medium text-blue-800">Transactions</span>
                      </div>
                      <p className="text-2xl font-bold text-blue-900">
                        {currentShiftSales.totalTransactions}
                      </p>
                    </div>
                    <div className="bg-purple-50 p-4 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <TrendingUp className="w-5 h-5 text-purple-600" />
                        <span className="text-sm font-medium text-purple-800">Average Sale</span>
                      </div>
                      <p className="text-2xl font-bold text-purple-900">
                        Rs. {currentShiftSales.averageSale.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {currentShiftSales.topProducts.length > 0 && (
                    <div className="mt-4">
                      <h4 className="font-semibold mb-2">Top Products Sold</h4>
                      <div className="space-y-2">
                        {currentShiftSales.topProducts.slice(0, 3).map((product, index) => (
                          <div key={index} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                            <span className="text-sm">{product.productName}</span>
                            <div className="text-right">
                              <span className="text-sm font-medium">{product.quantity} units</span>
                              <br />
                              <span className="text-xs text-muted-foreground">
                                Rs. {product.totalAmount.toLocaleString()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Previous Shift Sales */}
              {previousShiftSales && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-blue-600">Previous Shift Sales</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <DollarSign className="w-5 h-5 text-blue-600" />
                        <span className="text-sm font-medium text-blue-800">Total Sales</span>
                      </div>
                      <p className="text-2xl font-bold text-blue-900">
                        Rs. {previousShiftSales.totalSales.toLocaleString()}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <ShoppingCart className="w-5 h-5 text-gray-600" />
                        <span className="text-sm font-medium text-gray-800">Transactions</span>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">
                        {previousShiftSales.totalTransactions}
                      </p>
                    </div>
                    <div className="bg-orange-50 p-4 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <TrendingUp className="w-5 h-5 text-orange-600" />
                        <span className="text-sm font-medium text-orange-800">Average Sale</span>
                      </div>
                      <p className="text-2xl font-bold text-orange-900">
                        Rs. {previousShiftSales.averageSale.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {previousShiftSales.topProducts.length > 0 && (
                    <div className="mt-4">
                      <h4 className="font-semibold mb-2">Top Products Sold</h4>
                      <div className="space-y-2">
                        {previousShiftSales.topProducts.slice(0, 3).map((product, index) => (
                          <div key={index} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                            <span className="text-sm">{product.productName}</span>
                            <div className="text-right">
                              <span className="text-sm font-medium">{product.quantity} units</span>
                              <br />
                              <span className="text-xs text-muted-foreground">
                                Rs. {product.totalAmount.toLocaleString()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {!currentShiftSales && !previousShiftSales && (
              <div className="text-center py-8 text-muted-foreground">
                <DollarSign className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>No sales data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default EmployeeCheckIn;