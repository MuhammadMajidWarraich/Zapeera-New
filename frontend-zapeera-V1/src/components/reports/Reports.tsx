import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  Calendar,
  BarChart3,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
  Star,
  RefreshCw,
  Activity,
  Building2,
  Eye,
  EyeOff,
  Clock,
  Target,
  Gauge
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import ProfitSalesOverview from "./ProfitSalesOverview";
import SimpleReports from "./SimpleReports";
import TimePeriodReports from "./TimePeriodReports";
import RealTimeSalesUpdates from "./RealTimeSalesUpdates";

// Helper function to get week number
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

const Reports = () => {
  const { user, logout } = useAuth();
  const { selectedBranchId, selectedBranch, selectedCompanyId, getMembershipRole } = useAdmin();
  const [selectedPeriod, setSelectedPeriod] = useState("today");
  const [selectedReport, setSelectedReport] = useState("sales");
  const [loading, setLoading] = useState(false); // Don't show loading initially
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [previousPeriodData, setPreviousPeriodData] = useState<any>(null);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [salesByPaymentMethod, setSalesByPaymentMethod] = useState<any[]>([]);

  // Multi-branch functionality
  const [allBranches, setAllBranches] = useState<any[]>([]);
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [realSalesData, setRealSalesData] = useState<any[]>([]);
  const [realProductsData, setRealProductsData] = useState<any[]>([]);
  const [realUsersData, setRealUsersData] = useState<any[]>([]);
  const [realExpensesData, setRealExpensesData] = useState<any[]>([]);
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const [chartData, setChartData] = useState<any[]>([]);
  const [topProductsData, setTopProductsData] = useState<any[]>([]);
  const [categoryData, setCategoryData] = useState<any[]>([]);
  const [customerGrowthData, setCustomerGrowthData] = useState<any[]>([]);
  const [profitExpenseData, setProfitExpenseData] = useState<any[]>([]);
  const [profitMargin, setProfitMargin] = useState(0);
  const [nearExpiryBatches, setNearExpiryBatches] = useState<any[]>([]);
  const [expiredBatches, setExpiredBatches] = useState<any[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [hasInitialLoad, setHasInitialLoad] = useState(false);
  const prevSelectedBranchIdRef = useRef<string | null | undefined>(undefined);

  // Export functionality for managers
  const exportReports = async () => {
    try {
      const activeSales = realSalesData.filter((sale: any) => sale.status !== 'REFUNDED');
      const csvData = [
        ['Report Type', 'Period', 'Revenue', 'Sales Count', 'Products', 'Staff'],
        ['Sales Report', selectedPeriod, formatCurrency(activeSales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0)), activeSales.length.toString(), realProductsData.length.toString(), realUsersData.length.toString()],
        ['Branch Performance', 'All Branches', formatCurrency(allBranches.reduce((sum, branch) => sum + (branch.revenue || 0), 0)), allBranches.reduce((sum, branch) => sum + (branch.salesCount || 0), 0).toString(), allBranches.reduce((sum, branch) => sum + (branch.productsCount || 0), 0).toString(), allBranches.reduce((sum, branch) => sum + (branch.usersCount || 0), 0).toString()]
      ];

      const csvContent = csvData.map(row => row.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `reports_export_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
    }
  };

  // Refresh all data functionality
  const refreshAllData = async () => {
    setLoading(true);
    try {
      await loadBranchesAndRealData();
      await loadReportData();
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const periods = [
    { id: "today", label: "Today" },
    { id: "week", label: "This Week" },
    { id: "month", label: "This Month" },
    { id: "year", label: "This Year" }
  ];

  const formatLocalYmd = useCallback((d: Date) => {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // Helper function to get date range based on selected period
  const getDateRange = useCallback((period: string) => {
    const now = new Date();
    let start: Date, end: Date;

    switch (period) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        break;
      case 'week':
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday
        startOfWeek.setHours(0, 0, 0, 0);
        start = startOfWeek;
        end = new Date(startOfWeek);
        end.setDate(startOfWeek.getDate() + 6);
        end.setHours(23, 59, 59);
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        break;
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    }

    return {
      start: formatLocalYmd(start),
      end: formatLocalYmd(end)
    };
  }, [formatLocalYmd]);

  const reportTypes = [
    { id: "sales", label: "Sales Report", icon: DollarSign },
    { id: "inventory", label: "Inventory Report", icon: Package },
    { id: "customers", label: "Customer Report", icon: Users },
    { id: "products", label: "Product Performance", icon: BarChart3 }
  ];


  // Memoize event handlers
  const handleShowAllBranches = useCallback(() => {
    setShowAllBranches(!showAllBranches);
  }, [showAllBranches]);

  // Date/time formatting
  const formattedDateTime = useMemo(() => ({
    date: currentDateTime.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    time: currentDateTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })
  }), [currentDateTime]);

  // Currency formatting
  const formatCurrency = useCallback((amount: number) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }, []);

  const loadBranchesAndRealData = useCallback(async () => {
    try {
      // Determine which branch to load reports from
      let branchId: string | undefined;

      // Get the role in the context of the current selected company
      const membershipRole = getMembershipRole();
      const effectiveRole = membershipRole || String(user?.role || '').toUpperCase();
      const role = String(effectiveRole || '').toUpperCase();

      if (role === 'OWNER') {
        // Admin/Owner users can see reports from selected branch or all branches
        if (selectedBranchId) {
          branchId = selectedBranchId;
        } else {
        }
      } else if (role === 'MANAGER') {
        // Manager users can only see reports from their assigned branch
        branchId = user?.membership?.branchIds?.[0] || user?.branchId;
        
        // If no single branchId, check membership.branchIds array
        if (!branchId && Array.isArray(user?.membership?.branchIds) && user.membership.branchIds.length > 0) {
          // Use the first branch from membership if no specific branch selected
          branchId = String(user.membership.branchIds[0]);
        }
        
        // If still no branch, check if a branch is selected in the context
        if (!branchId && selectedBranchId) {
          branchId = selectedBranchId;
        }
        
        if (!branchId) {
          setError('No branch assigned to this manager');
          return;
        }
      } else {
        // Regular users see only their branch reports
        branchId = user?.membership?.branchIds?.[0] || user?.branchId;
        if (!branchId) {
          const branchesResponse = await apiService.getBranches();
          if (branchesResponse.success && branchesResponse.data?.branches?.length > 0) {
            branchId = branchesResponse.data.branches[0].id;
          }
        }
      }

      // CRITICAL: Determine the actual branchId to pass to API
      // If user selected a specific branch, use that. Otherwise, for OWNER/ADMIN, pass undefined to get ALL data
      // For other roles, use their role-based branchId
      let apiBranchId: string | undefined;
      if (user?.role === 'OWNER') {
        // For OWNER/ADMIN, if selectedBranchId is null/undefined, pass undefined to get ALL branches data
        apiBranchId = selectedBranchId || undefined;
      } else {
        // For other roles, use role-based branchId
        apiBranchId = branchId || undefined;
      }
      
      // CRITICAL: Log what we're loading
      
      // Load all branches, sales, products, and users data in parallel
      // CRITICAL: Use apiBranchId which respects user's branch selection (selectedBranchId takes priority)
      // IMPORTANT: For users API, we need to ensure branchId is passed correctly
      const usersApiParams: { page: number; limit: number; branchId?: string } = { 
        page: 1, 
        limit: 100 
      };
      if (apiBranchId) {
        usersApiParams.branchId = apiBranchId;
      }
      
      const [branchesResponse, salesResponse, productsResponse, usersResponse, expensesResponse] = await Promise.all([
        apiService.getBranches(),
        apiService.getSales({ page: 1, limit: 200, branchId: apiBranchId, companyId: selectedCompanyId || '' }), // Use apiBranchId which respects selectedBranchId
        apiService.getProducts({ page: 1, limit: 200, branchId: apiBranchId, companyId: selectedCompanyId || '' }), // Use apiBranchId which respects selectedBranchId
        apiService.getUsers(usersApiParams), // CRITICAL: Explicitly pass branchId only if apiBranchId exists
        apiService.getExpenses({ branchId: apiBranchId, companyId: selectedCompanyId || '' }) // Fetch expenses data
      ]);
      
      

      // Process branches data
      if (branchesResponse.success && branchesResponse.data) {
        const branchesData = Array.isArray(branchesResponse.data) ? branchesResponse.data : branchesResponse.data.branches;

        // For managers, only show their assigned branch
        if (user?.role === 'MANAGER' && user?.branchId) {
          const managerBranch = branchesData.find((branch: any) => branch.id === user.branchId);
          setAllBranches(managerBranch ? [managerBranch] : []);
        } else {
          setAllBranches(branchesData);
        }
      }

      // Process real sales data - CRITICAL: Filter by selectedBranchId (user's current selection)
      if (salesResponse.success && salesResponse.data) {
        let sales = salesResponse.data.sales || [];
        
        // CRITICAL: Always filter based on selectedBranchId (user's current selection)
        // This ensures data matches what user selected, not what API returned
        if (selectedBranchId) {
          // Specific branch selected - filter to show ONLY this branch's sales
          const beforeFilter = sales.length;
          sales = sales.filter((sale: any) => sale.branchId === selectedBranchId);
        } else {
          // "All Branches" selected - show all sales from all branches
          const uniqueBranches = new Set(sales.map((s: any) => s.branchId).filter(Boolean));
        }
        
        // CRITICAL: Always set the filtered data
        setRealSalesData(sales);
      } else {
        // If API call failed, clear data to prevent showing stale data
        setRealSalesData([]);
      }

      // Process real products data - CRITICAL: Filter by selectedBranchId (user's current selection)
      if (productsResponse.success && productsResponse.data) {
        let products = productsResponse.data.products || [];
        
        // CRITICAL: Always filter based on selectedBranchId (user's current selection)
        // This ensures data matches what user selected, not what API returned
        if (selectedBranchId) {
          // Specific branch selected - filter to show ONLY this branch's products
          const beforeFilter = products.length;
          products = products.filter((product: any) => product.branchId === selectedBranchId);
        } else {
          // "All Branches" selected - show all products from all branches
          const uniqueBranches = new Set(products.map((p: any) => p.branchId).filter(Boolean));
        }
        
        // CRITICAL: Always set the filtered data
        setRealProductsData(products);
      } else {
        setRealProductsData([]);
      }

      // Process real users data - CRITICAL: Filter by branch if selected
      if (usersResponse.success && usersResponse.data) {
        let users = usersResponse.data.users || [];
        
        
        // CRITICAL: Always filter based on selectedBranchId (user's current selection)
        // This ensures data matches what user selected, not what API returned
        if (selectedBranchId) {
          // Specific branch selected - filter to show ONLY this branch's users
          const beforeFilter = users.length;
          const usersWithBranch = users.filter((u: any) => u.branchId);
          const usersWithoutBranch = users.filter((u: any) => !u.branchId);
          // CRITICAL: Filter users by selectedBranchId - use strict string comparison to handle type mismatches
          users = users.filter((u: any) => {
            // Convert both to strings and trim to handle any type mismatches or whitespace
            const userBranchId = String(u.branchId || '').trim();
            const selectedBranchIdStr = String(selectedBranchId || '').trim();
            const matches = userBranchId === selectedBranchIdStr;
            return matches;
          });
          
          
          // Verify filtering worked
          const wrongBranchUsers = users.filter((u: any) => {
            const userBranchId = String(u.branchId || '').trim();
            const selectedBranchIdStr = String(selectedBranchId || '').trim();
            return userBranchId !== selectedBranchIdStr;
          });
          if (wrongBranchUsers.length > 0) {
          }
          
          // If no users found, log detailed info for debugging
          if (users.length === 0 && beforeFilter > 0) {
          }
        } else {
          // "All Branches" selected - show all users from all branches
          // Verify that we have users from multiple branches (not just one)
          const uniqueBranches = new Set(users.map((u: any) => u.branchId).filter(Boolean));
          
          // If we only have users from one branch, log a warning
          if (uniqueBranches.size === 1 && users.length > 0) {
          }
        }
        
        // CRITICAL: Always set the filtered data, even if empty
        setRealUsersData(users);
      } else {
        setRealUsersData([]);
      }

      // Process real expenses data
      if (expensesResponse.success && expensesResponse.data) {
        const expenses = expensesResponse.data.expenses || [];
        setRealExpensesData(expenses);
      } else {
        setRealExpensesData([]);
      }

    } catch (err) {
      setError('Failed to load branches and real data');
    }
  }, [user, selectedBranchId, selectedBranch, selectedCompanyId, selectedPeriod, selectedReport]);

  // Load branches and real data on component mount AND when branch changes
  useEffect(() => {
    // CRITICAL: Check if this is the same branch clicked again
    const prevBranch = prevSelectedBranchIdRef.current;
    const currentBranch = selectedBranchId;
    const isSameBranch = prevBranch === currentBranch && prevBranch !== undefined;

    // Update ref for next comparison
    prevSelectedBranchIdRef.current = currentBranch;

    // CRITICAL: ALWAYS clear old data FIRST to prevent showing wrong branch data
    // Clear all data immediately to prevent showing wrong branch data
    setRealSalesData([]);
    setRealProductsData([]);
    setRealUsersData([]);
    
    // Always load fresh data
    loadBranchesAndRealData();
  }, [loadBranchesAndRealData, selectedBranchId]);

  const loadReportData = useCallback(async () => {
    try {
      // Don't show loading - load in background
      setError(null);

      // Determine which branch to load reports from
      let branchId: string | undefined;

      // Get the role in the context of the current selected company
      const membershipRole = getMembershipRole();
      const effectiveRole = membershipRole || String(user?.role || '').toUpperCase();
      const role = String(effectiveRole || '').toUpperCase();

      if (role === 'OWNER') {
        // Admin/Owner users can see reports from selected branch or all branches
        if (selectedBranchId) {
          branchId = selectedBranchId;
        } else {
        }
      } else if (role === 'MANAGER') {
        // Manager users can only see reports from their assigned branch
        branchId = user?.membership?.branchIds?.[0] || user?.branchId;
        
        // If no single branchId, check membership.branchIds array
        if (!branchId && Array.isArray(user?.membership?.branchIds) && user.membership.branchIds.length > 0) {
          // Use the first branch from membership if no specific branch selected
          branchId = String(user.membership.branchIds[0]);
        }
        
        // If still no branch, check if a branch is selected in the context
        if (!branchId && selectedBranchId) {
          branchId = selectedBranchId;
        }
        
        if (!branchId) {
          setError('No branch assigned to this manager');
          return;
        }
      } else {
        // Regular users see only their branch reports
        branchId = user?.membership?.branchIds?.[0] || user?.branchId;
        if (!branchId) {
          const branchesResponse = await apiService.getBranches();
          if (branchesResponse.success && branchesResponse.data?.branches?.length > 0) {
            branchId = branchesResponse.data.branches[0].id;
          }
        }
      }

      // Calculate date range based on selected period
      const now = new Date();
      let startDate = '';
      let endDate = '';
      let previousStartDate = '';
      let previousEndDate = '';

      switch (selectedPeriod) {
        case 'today':
          // CRITICAL FIX: Show today's sales - use full date range for today
          // Start from beginning of today (00:00:00) to end of today (23:59:59)
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
          startDate = formatLocalYmd(todayStart);
          endDate = formatLocalYmd(todayEnd);
          
          // Previous period is yesterday
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0, 0);
          const yesterdayEnd = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
          previousStartDate = formatLocalYmd(yesterdayStart);
          previousEndDate = formatLocalYmd(yesterdayEnd);
          
          break;
        case 'week':
          // Show from beginning of current week to today
          const startOfWeek = new Date(now);
          const dayOfWeek = startOfWeek.getDay();
          const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0, Sunday = 6
          startOfWeek.setDate(startOfWeek.getDate() - daysToSubtract);
          startOfWeek.setHours(0, 0, 0, 0);
          startDate = formatLocalYmd(startOfWeek);
          endDate = formatLocalYmd(now);

          // Previous week (same days of previous week)
          const previousWeekStart = new Date(startOfWeek);
          previousWeekStart.setDate(previousWeekStart.getDate() - 7);
          const previousWeekEnd = new Date(previousWeekStart);
          previousWeekEnd.setDate(previousWeekEnd.getDate() + 6);
          previousStartDate = formatLocalYmd(previousWeekStart);
          previousEndDate = formatLocalYmd(previousWeekEnd);
          break;
        case 'month':
          // Show from beginning of current month to today
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
          endDate = formatLocalYmd(now);

          // Previous month (same period of previous month)
          const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
          const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
          previousStartDate = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
          const lastDayOfPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
          previousEndDate = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(lastDayOfPrevMonth).padStart(2, '0')}`;
          break;
        case 'year':
          // Show from beginning of current year to today
          startDate = `${now.getFullYear()}-01-01`;
          endDate = formatLocalYmd(now);

          // Previous year (same period of previous year)
          previousStartDate = `${now.getFullYear() - 1}-01-01`;
          previousEndDate = `${now.getFullYear() - 1}-12-31`;
          break;
      }
      });

      // Load current period data

      let response;
      switch (selectedReport) {
        case 'sales':
          const salesParams = {
            startDate,
            endDate,
            ...(branchId ? { branchId } : {}),
            companyId: selectedCompanyId || '',
            // CRITICAL FIX: Use 'hour' for today, otherwise use appropriate groupBy
            groupBy: (selectedPeriod === 'today' ? 'hour' : selectedPeriod === 'week' ? 'week' : selectedPeriod === 'month' ? 'month' : selectedPeriod === 'year' ? 'year' : 'day') as 'day' | 'week' | 'month' | 'year' | 'hour',
            period: selectedPeriod // Pass period to backend for proper handling
          };
          response = await apiService.getSalesReport(salesParams);
          break;
        case 'inventory':
          response = await apiService.getInventoryReport({
            ...(branchId ? { branchId } : {}),
            companyId: selectedCompanyId || '',
          });
          break;
        case 'customers':
          response = await apiService.getCustomerReport({
            startDate,
            endDate,
            ...(branchId ? { branchId } : {})
          });
          break;
        case 'products':
          response = await apiService.getProductPerformanceReport({
            startDate,
            endDate,
            ...(branchId ? { branchId } : {})
          });
          break;
        default:
          response = await apiService.getSalesReport({
            startDate,
            endDate,
            ...(branchId ? { branchId } : {}),
            companyId: selectedCompanyId || '',
          });
      }

      // Load previous period data for growth calculations (only for sales and customers)
      let previousResponse = null;
      if ((selectedReport === 'sales' || selectedReport === 'customers') && previousStartDate && previousEndDate) {
        try {
          if (selectedReport === 'sales') {
            previousResponse = await apiService.getSalesReport({
              startDate: previousStartDate,
              endDate: previousEndDate,
              ...(branchId ? { branchId } : {}),
              companyId: selectedCompanyId || '',
              groupBy: (selectedPeriod === 'week' ? 'week' : selectedPeriod === 'month' ? 'month' : selectedPeriod === 'year' ? 'year' : 'day') as 'day' | 'week' | 'month' | 'year'
            });
          } else if (selectedReport === 'customers') {
            previousResponse = await apiService.getCustomerReport({
              startDate: previousStartDate,
              endDate: previousEndDate,
              ...(branchId ? { branchId } : {})
            });
          }
        } catch (err) {
        }
      }

      if (response.success && response.data) {
        setReportData(response.data);
        if (previousResponse?.success && previousResponse.data) {
          setPreviousPeriodData(previousResponse.data);
        }

        // Load additional data for sales report
        if (selectedReport === 'sales') {
          // Load top selling products
          try {
            const topProductsResponse = await apiService.getTopSellingProducts(branchId || '', 10);
            if (topProductsResponse.success && topProductsResponse.data) {
              setTopProducts(topProductsResponse.data);
            }
          } catch (err) {
          }

          // Load sales by payment method
          try {
            const paymentMethodResponse = await apiService.getSalesByPaymentMethod(branchId || '', selectedCompanyId || '');
            if (paymentMethodResponse.success && paymentMethodResponse.data) {
              setSalesByPaymentMethod(paymentMethodResponse.data);
            }
          } catch (err) {
          }

          // Process all chart data from API response
          if (response.data?.salesTrend && response.data.salesTrend.length > 0) {
            // CRITICAL: Filter salesTrend by branch if branchId is specified
            const filteredSalesTrend = response.data.salesTrend;
            if (branchId) {
              // Note: salesTrend might already be filtered by backend, but ensure frontend filtering too
            }

            const processedSalesData = processSalesTrendData(filteredSalesTrend, selectedPeriod);
            setChartData(processedSalesData);
          } else {
            setChartData([]);
          }

          // Load top products data for product performance
          try {
            const topProductsResponse = await apiService.getTopSellingProducts(branchId || '', 10);
            if (topProductsResponse.success && topProductsResponse.data) {
              setTopProductsData(topProductsResponse.data);
            }
          } catch (err) {
          }
        }

        // Get product performance report for category data
        try {
          const productPerformanceResponse = await apiService.getProductPerformanceReport({
            startDate,
            endDate,
            ...(branchId ? { branchId } : {})
          });

          if (productPerformanceResponse.success && productPerformanceResponse.data?.categoryPerformance) {
            const processedCategory = processCategoryData(productPerformanceResponse.data.categoryPerformance);
            setCategoryData(processedCategory);
          }
        } catch (err) {
        }
      } else {
        setError('Failed to load report data: ' + (response.message || 'Unknown error'));
      }
    } catch (err) {
      setError('Failed to load report data');
      // Don't set loading - silent fail in background
    }
  // NOTE: Keep deps minimal to avoid TDZ issues with later-defined callbacks.
  }, [selectedPeriod, selectedReport, selectedBranchId, selectedBranch, user?.branchId, user?.role, formatLocalYmd]);

  // CRITICAL FIX: Load report data when period, report type, or selected branch changes
  // This ensures immediate update when branch is selected
  // OPTIMIZED: Check cache first, then load fresh data in background
  useEffect(() => {
    // CRITICAL: ALWAYS clear old report data FIRST when branch changes to prevent showing wrong branch data
    // Clear ALL report-specific data immediately to prevent showing wrong branch
    setReportData(null);
    setPreviousPeriodData(null);
    setChartData([]);
    setTopProducts([]);
    setTopProductsData([]);
    setCategoryData([]);
    setCustomerGrowthData([]);
    setProfitExpenseData([]);
    setProfitMargin(0);
    setSalesByPaymentMethod([]);
    
    // Load fresh data
    loadReportData();
  }, [selectedPeriod, selectedReport, selectedBranchId, loadReportData]);


  // Process sales trend data from API response
  const processSalesTrendData = useCallback((salesTrendData: any[], period: string) => {
    if (!salesTrendData || salesTrendData.length === 0) return [];

    let processedData: any[] = [];

    switch (period) {
      case 'today':
        // Group by hour
        const hourlyData: { [key: string]: { sales: number; revenue: number; hour: string } } = {};
        salesTrendData.forEach(item => {
          const saleDate = new Date(item.createdAt);
          const hour = saleDate.getHours();
          const hourKey = `${hour}:00`;

          if (!hourlyData[hourKey]) {
            hourlyData[hourKey] = { sales: 0, revenue: 0, hour: hourKey };
          }
          hourlyData[hourKey].sales += item._count?.id || 0;
          hourlyData[hourKey].revenue += item._sum?.totalAmount || 0;
        });
        processedData = Object.values(hourlyData).sort((a, b) => a.hour.localeCompare(b.hour));
        break;

      case 'week':
        // Group by day of week
        const weeklyData: { [key: string]: { sales: number; revenue: number; day: string } } = {};
        salesTrendData.forEach(item => {
          const saleDate = new Date(item.createdAt);
          const dayName = saleDate.toLocaleDateString('en-US', { weekday: 'short' });

          if (!weeklyData[dayName]) {
            weeklyData[dayName] = { sales: 0, revenue: 0, day: dayName };
          }
          weeklyData[dayName].sales += item._count?.id || 0;
          weeklyData[dayName].revenue += item._sum?.totalAmount || 0;
        });
        const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        processedData = dayOrder.map(day => weeklyData[day] || { sales: 0, revenue: 0, day });
        break;

      case 'month':
        // Group by day of month
        const monthlyData: { [key: string]: { sales: number; revenue: number; day: string } } = {};
        salesTrendData.forEach(item => {
          const saleDate = new Date(item.createdAt);
          const day = saleDate.getDate().toString();

          if (!monthlyData[day]) {
            monthlyData[day] = { sales: 0, revenue: 0, day };
          }
          monthlyData[day].sales += item._count?.id || 0;
          monthlyData[day].revenue += item._sum?.totalAmount || 0;
        });
        processedData = Object.values(monthlyData).sort((a, b) => parseInt(a.day) - parseInt(b.day));
        break;

      case 'year':
        // Group by month
        const yearlyData: { [key: string]: { sales: number; revenue: number; month: string } } = {};
        salesTrendData.forEach(item => {
          const saleDate = new Date(item.createdAt);
          const monthName = saleDate.toLocaleDateString('en-US', { month: 'short' });

          if (!yearlyData[monthName]) {
            yearlyData[monthName] = { sales: 0, revenue: 0, month: monthName };
          }
          yearlyData[monthName].sales += item._count?.id || 0;
          yearlyData[monthName].revenue += item._sum?.totalAmount || 0;
        });
        const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        processedData = monthOrder.map(month => yearlyData[month] || { sales: 0, revenue: 0, month });
        break;

      default:
        processedData = salesTrendData.map(item => ({
          sales: item._count?.id || 0,
          revenue: item._sum?.totalAmount || 0,
          date: new Date(item.createdAt).toLocaleDateString()
        }));
    }

    return processedData;
  }, []);

  // Process top selling products data from API response
  const processTopProductsData = useCallback((topProductsData: any[]) => {
    if (!topProductsData || topProductsData.length === 0) return [];

    // Sort by total quantity sold
    const sortedProducts = topProductsData
      .sort((a, b) => (b._sum?.quantity || 0) - (a._sum?.quantity || 0))
      .slice(0, 10)
      .map(item => ({
        name: item.product?.name || 'Unknown Product',
        sales: item._sum?.quantity || 0,
        revenue: item._sum?.totalPrice || 0
      }));

    return sortedProducts;
  }, []);

  // Process category sales data from API response
  const processCategoryData = useCallback((categoryPerformanceData: any[]) => {
    if (!categoryPerformanceData || categoryPerformanceData.length === 0) return [];

    const colors = ['#0c2c8a', '#3d6bb3', '#6d9eec', '#2c5aa0', '#4d7cc6', '#5d8dd9', '#7dafff', '#8bbfff'];

    const processedData = categoryPerformanceData.map((item, index) => ({
      name: item.category || 'Uncategorized',
      value: item.revenue || 0,
      color: colors[index % colors.length]
    }));

    return processedData.sort((a, b) => b.value - a.value);
  }, []);

  // Process customer growth data from sales trend
  const processCustomerGrowthData = useCallback((salesTrendData: any[]) => {
    if (!salesTrendData || salesTrendData.length === 0) return [];

    const monthlyData: { [key: string]: { customers: number; month: string } } = {};

    salesTrendData.forEach(item => {
      const saleDate = new Date(item.createdAt);
      const monthKey = saleDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { customers: 0, month: monthKey };
      }
      monthlyData[monthKey].customers += item._count?.id || 0;
    });

    return Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));
  }, []);

  // Process profit vs expense data from sales trend and real expenses
  const processProfitExpenseData = useCallback((salesTrendData: any[], expensesData: any[]) => {
    if (!salesTrendData || salesTrendData.length === 0) return [];

    const monthlyData: { [key: string]: { profit: number; expenses: number; month: string } } = {};

    // Initialize monthly data structure
    salesTrendData.forEach(item => {
      const saleDate = new Date(item.createdAt);
      const monthKey = saleDate.toLocaleDateString('en-US', { month: 'short' });

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { profit: 0, expenses: 0, month: monthKey };
      }

      const revenue = item._sum?.totalAmount || 0;
      monthlyData[monthKey].profit += revenue;
    });

    // Add real expenses data by month
    if (expensesData && expensesData.length > 0) {
      expensesData.forEach(expense => {
        const expenseDate = new Date(expense.date);
        const monthKey = expenseDate.toLocaleDateString('en-US', { month: 'short' });

        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { profit: 0, expenses: 0, month: monthKey };
        }

        monthlyData[monthKey].expenses += expense.amount || 0;
      });
    }

    // Calculate actual profit (revenue - expenses)
    Object.keys(monthlyData).forEach(monthKey => {
      monthlyData[monthKey].profit = monthlyData[monthKey].profit - monthlyData[monthKey].expenses;
    });

    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return monthOrder.map(month => monthlyData[month] || { profit: 0, expenses: 0, month });
  }, []);

  // Calculate overall profit margin from sales trend and real expenses
  const calculateProfitMargin = useCallback((salesTrendData: any[], expensesData: any[]) => {
    if (!salesTrendData || salesTrendData.length === 0) return 0;

    const totalRevenue = salesTrendData.reduce((sum, item) => sum + (item._sum?.totalAmount || 0), 0);
    const totalExpenses = expensesData.reduce((sum, expense) => sum + (expense.amount || 0), 0);
    const totalProfit = totalRevenue - totalExpenses;

    return totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;
  }, []);

  // Calculate growth percentage
  const calculateGrowth = useCallback((current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  }, []);

  // Get current data based on selected report type
  const getCurrentData = useCallback(() => {
    if (!reportData) {
      return null;
    }

    switch (selectedReport) {
      case 'sales':
        const currentRevenue = reportData.summary?.totalRevenue || 0;
        const currentTransactions = reportData.summary?.totalSales || 0;
        const previousRevenue = previousPeriodData?.summary?.totalRevenue || 0;
        const previousTransactions = previousPeriodData?.summary?.totalSales || 0;


        return {
          revenue: currentRevenue,
          transactions: currentTransactions,
          customers: 0, // This would need to be calculated separately
          avgTransaction: currentTransactions > 0 ? currentRevenue / currentTransactions : 0,
          revenueGrowth: calculateGrowth(currentRevenue, previousRevenue),
          transactionGrowth: calculateGrowth(currentTransactions, previousTransactions)
        };
      case 'inventory':
        return {
          totalProducts: reportData.summary?.totalProducts || 0,
          totalStock: reportData.summary?.totalStock || 0,
          lowStockCount: reportData.summary?.lowStockCount || 0
        };
      case 'customers':
        const currentCustomers = reportData.summary?.totalCustomers || 0;
        const currentSpent = reportData.summary?.totalSpent || 0;
        const currentAvgSpent = reportData.summary?.averageSpent || 0;
        const previousCustomers = previousPeriodData?.summary?.totalCustomers || 0;
        const previousSpent = previousPeriodData?.summary?.totalSpent || 0;

        return {
          totalCustomers: currentCustomers,
          totalSpent: currentSpent,
          averageSpent: currentAvgSpent,
          loyaltyPoints: reportData.summary?.totalLoyaltyPoints || 0,
          customerGrowth: calculateGrowth(currentCustomers, previousCustomers),
          spendingGrowth: calculateGrowth(currentSpent, previousSpent)
        };
      case 'products':
        return {
          totalProducts: reportData.summary?.totalProducts || 0,
          topProduct: reportData.topProduct || null,
          avgRevenue: reportData.summary?.averageRevenue || 0,
          totalRevenue: reportData.summary?.totalRevenue || 0
        };
      default:
        return null;
    }
  }, [reportData, previousPeriodData, selectedReport, calculateGrowth]);

  const currentData = useMemo(() => getCurrentData(), [getCurrentData]);

  // Filter realSalesData based on selected time period
  const getFilteredSalesData = useCallback((salesData: any[], period: string) => {
    if (!salesData || salesData.length === 0) return [];

    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        break;
      case 'week':
        const startOfWeek = new Date(now);
        const dayOfWeek = startOfWeek.getDay();
        const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startOfWeek.setDate(startOfWeek.getDate() - daysToSubtract);
        startOfWeek.setHours(0, 0, 0, 0);
        startDate = startOfWeek;
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        break;
      default:
        return salesData;
    }

    return salesData.filter((sale: any) => {
      const saleDate = new Date(sale.createdAt);
      return saleDate >= startDate;
    });
  }, []);

  const filteredSalesData = useMemo(() => getFilteredSalesData(realSalesData, selectedPeriod), [realSalesData, selectedPeriod, getFilteredSalesData]);

  // Calculate branch-specific statistics (excluding REFUNDED sales)
  const getBranchStats = useCallback((branchId: string) => {
    const branchSales = realSalesData.filter((sale: any) => sale.branchId === branchId && sale.status !== 'REFUNDED');
    const branchProducts = realProductsData.filter((product: any) => product.branchId === branchId);
    const branchUsers = realUsersData.filter((user: any) => user.branchId === branchId);

    const revenue = branchSales.reduce((sum: number, sale: any) => sum + (sale.totalAmount || 0), 0);
    const transactions = branchSales.length;
    const products = branchProducts.length;
    const users = branchUsers.length;

    return {
      revenue,
      transactions,
      products,
      users,
      branchSales,
      branchProducts,
      branchUsers
    };
  }, [realSalesData, realProductsData, realUsersData]);






  return (
    <div className="px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent">Reports & Analytics</h1>
            <div className="flex items-center text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
              <Activity className="w-3 h-3 mr-1 animate-pulse" />
              Live Data
            </div>
          </div>
          <p className="text-gray-500 text-sm mt-1">
            {user?.role === 'OWNER' || user?.role === 'MANAGER'
              ? 'Comprehensive insights across all your branches'
              : 'Real-time insights into your business performance'
            }
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Export and Refresh for Managers */}
          {(user?.role === 'OWNER' || user?.role === 'MANAGER') && (
            <>
              <button 
                onClick={() => exportReports()}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 font-medium rounded-xl border border-gray-200 hover:bg-gray-50 transition"
              >
                <BarChart3 className="w-4 h-4" />
                Export Data
              </button>
              <button 
                onClick={() => refreshAllData()}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 font-medium rounded-xl border border-gray-200 hover:bg-gray-50 transition"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh All
              </button>
            </>
          )}
          <div className="text-right">
            <p className="text-xs text-gray-500">{formattedDateTime.date}</p>
            <p className="text-sm font-semibold text-gray-900">{formattedDateTime.time}</p>
          </div>
        </div>
      </div>

      {/* All Branches Overview - Owner Only */}
      {user?.role === 'OWNER' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-lg transition-all">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/25">
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 text-sm">All Branches Overview</h3>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-lg">
              <span className="text-xs font-semibold text-blue-700">{allBranches.length} Branches</span>
            </div>
          </div>
          
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-50/30 rounded-2xl border border-blue-100/50 p-5 shadow-sm hover:shadow-lg hover:shadow-blue-100/30 transition-all">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-lg shadow-lg shadow-blue-500/25">
                  <DollarSign className="w-4 h-4 text-white" />
                </div>
                <p className="text-xs font-semibold text-blue-700">Total Revenue</p>
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(
                  filteredSalesData.filter((sale: any) => sale.status !== 'REFUNDED').reduce((sum: number, sale: any) => sum + (sale.totalAmount || 0), 0)
                )}
              </p>
            </div>

            <div className="bg-gradient-to-br from-green-50 to-green-50/30 rounded-2xl border border-green-100/50 p-5 shadow-sm hover:shadow-lg hover:shadow-green-100/30 transition-all">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg shadow-lg shadow-green-500/25">
                  <ShoppingCart className="w-4 h-4 text-white" />
                </div>
                <p className="text-xs font-semibold text-green-700">Total Sales</p>
              </div>
              <p className="text-2xl font-bold text-gray-900">{filteredSalesData.filter((sale: any) => sale.status !== 'REFUNDED').length}</p>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-purple-50/30 rounded-2xl border border-purple-100/50 p-5 shadow-sm hover:shadow-lg hover:shadow-purple-100/30 transition-all">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg shadow-lg shadow-purple-500/25">
                  <Package className="w-4 h-4 text-white" />
                </div>
                <p className="text-xs font-semibold text-purple-700">Total Products</p>
              </div>
              <p className="text-2xl font-bold text-gray-900">{realProductsData.length}</p>
            </div>

            <div className="bg-gradient-to-br from-orange-50 to-orange-50/30 rounded-2xl border border-orange-100/50 p-5 shadow-sm hover:shadow-lg hover:shadow-orange-100/30 transition-all">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg shadow-lg shadow-orange-500/25">
                  <Users className="w-4 h-4 text-white" />
                </div>
                <p className="text-xs font-semibold text-orange-700">Total Staff</p>
              </div>
              <p className="text-2xl font-bold text-gray-900">{realUsersData.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* Manager Branch Overview - Manager Only */}
      {user?.role === 'MANAGER' && allBranches.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-lg transition-all">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-teal-500/25">
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 text-sm">My Branch Overview</h3>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-50 rounded-lg">
              <span className="text-xs font-semibold text-teal-700">
                {(() => {
                  // Calculate the number of branches the manager has access to
                  const allowedBranchIds = Array.isArray(user?.membership?.branchIds)
                    ? user.membership.branchIds.map((id: any) => String(id))
                    : (user?.branchId ? [String(user.branchId)] : []);
                  
                  // Filter allBranches to only show branches the manager has access to
                  const accessibleBranches = allowedBranchIds.length > 0
                    ? allBranches.filter((branch: any) => allowedBranchIds.includes(String(branch.id)))
                    : allBranches;
                  
                  return `${accessibleBranches.length} Branch${accessibleBranches.length !== 1 ? 'es' : ''}`;
                })()}
              </span>
            </div>
          </div>
          
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-50/30 rounded-2xl border border-blue-100/50 p-5 shadow-sm hover:shadow-lg hover:shadow-blue-100/30 transition-all">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-lg shadow-lg shadow-blue-500/25">
                  <DollarSign className="w-4 h-4 text-white" />
              </div>
              <p className="text-xs font-semibold text-blue-700">Total Revenue</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {formatCurrency(
                filteredSalesData.filter((sale: any) => sale.status !== 'REFUNDED').reduce((sum: number, sale: any) => sum + (sale.totalAmount || 0), 0)
              )}
            </p>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-50/30 rounded-2xl border border-green-100/50 p-5 shadow-sm hover:shadow-lg hover:shadow-green-100/30 transition-all">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg shadow-lg shadow-green-500/25">
                <ShoppingCart className="w-4 h-4 text-white" />
              </div>
              <p className="text-xs font-semibold text-green-700">Total Sales</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{filteredSalesData.filter((sale: any) => sale.status !== 'REFUNDED').length}</p>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-50/30 rounded-2xl border border-purple-100/50 p-5 shadow-sm hover:shadow-lg hover:shadow-purple-100/30 transition-all">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg shadow-lg shadow-purple-500/25">
                <Package className="w-4 h-4 text-white" />
              </div>
              <p className="text-xs font-semibold text-purple-700">Total Products</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{realProductsData.length}</p>
          </div>

          <div className="bg-gradient-to-br from-orange-50 to-orange-50/30 rounded-2xl border border-orange-100/50 p-5 shadow-sm hover:shadow-lg hover:shadow-orange-100/30 transition-all">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg shadow-lg shadow-orange-500/25">
                <Users className="w-4 h-4 text-white" />
              </div>
              <p className="text-xs font-semibold text-orange-700">Total Staff</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{realUsersData.length}</p>
          </div>
        </div>
      </div>
    )}

      {/* Period Selection */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-lg transition-all">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Calendar className="w-4 h-4 text-white" />
          </div>
          <h3 className="font-semibold text-gray-900 text-sm">Select Time Period</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {periods.map((period) => (
            <button
              key={period.id}
              onClick={() => setSelectedPeriod(period.id)}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition ${
                selectedPeriod === period.id
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/25'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>

      {/* Charts Section */}
      <div className="space-y-6">
        {/* Row 1: Sales Trend & Profit vs Expenses */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sales Trend (Area Chart) */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-lg transition-all">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/25">
                <LineChartIcon className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 text-sm">Sales Trend - {periods.find(p => p.id === selectedPeriod)?.label}</h3>
            </div>
            <div className="overflow-hidden">
              {chartData.length > 0 ? (
                <ChartContainer
                  config={{
                    sales: {
                      label: "Sales Count",
                      color: "#0c2c8a",
                    },
                    revenue: {
                      label: "Revenue (PKR)",
                      color: "#153186",
                    },
                  }}
                  className="h-[300px]"
                >
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey={selectedPeriod === 'today' ? 'hour' : selectedPeriod === 'week' ? 'day' : selectedPeriod === 'month' ? 'day' : 'month'}
                  />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    stackId="1"
                    stroke="#0c2c8a"
                    fill="#0c2c8a"
                    fillOpacity={0.6}
                    name="Sales Count"
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stackId="2"
                    stroke="#153186"
                    fill="#153186"
                    fillOpacity={0.6}
                    name="Revenue (PKR)"
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-400">
                No sales data available for the selected period
              </div>
            )}
            </div>
          </div>

          {/* Profit vs Expenses (Bar Chart) */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-lg transition-all">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-green-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/25">
                <BarChart3 className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 text-sm">Profit vs Expenses</h3>
            </div>
            <div className="overflow-hidden">
              {profitExpenseData.length > 0 ? (
                <ChartContainer
                config={{
                  profit: {
                    label: "Profit (PKR)",
                    color: "#0c2c8a",
                  },
                  expenses: {
                    label: "Expenses (PKR)",
                    color: "#EF4444",
                  },
                }}
                className="h-[300px]"
              >
                <BarChart data={profitExpenseData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="profit" fill="#0c2c8a" name="Profit (PKR)" />
                  <Bar dataKey="expenses" fill="#EF4444" name="Expenses (PKR)" />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-400">
                No profit/expense data available
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Row 2: Top Selling Products & Customer Growth */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Selling Products (Horizontal Bar Chart) */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-lg transition-all">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/25">
                <Star className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 text-sm">Top Selling Products</h3>
            </div>
            <div className="overflow-hidden">
              {topProductsData.length > 0 ? (
                <ChartContainer
                config={{
                  sales: {
                    label: "Quantity Sold",
                    color: "#0c2c8a",
                  },
                }}
                className="h-[300px]"
              >
                <BarChart data={topProductsData} layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={120} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="sales" fill="#0c2c8a" name="Quantity Sold" />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-400">
                No product data available
              </div>
            )}
            </div>
          </div>

          {/* Customer Growth (Line Chart) */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-lg transition-all">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center shadow-lg shadow-purple-500/25">
                <Users className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 text-sm">Customer Growth Trend</h3>
            </div>
            <div className="overflow-hidden">
              {customerGrowthData.length > 0 ? (
                <ChartContainer
                config={{
                  customers: {
                    label: "Customers",
                    color: "#0c2c8a",
                  },
                }}
                className="h-[300px]"
              >
                <LineChart data={customerGrowthData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    type="monotone"
                    dataKey="customers"
                    stroke="#0c2c8a"
                    strokeWidth={3}
                    dot={{ fill: "#0c2c8a", strokeWidth: 2, r: 4 }}
                    name="Customers"
                  />
                </LineChart>
              </ChartContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-400">
                No customer growth data available
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Row 3: Sales by Category & Profit Margin */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sales by Category (Donut Chart) */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-lg transition-all">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <PieChartIcon className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 text-sm">Sales Distribution by Category</h3>
            </div>
            <div className="overflow-hidden">
              {categoryData.length > 0 ? (
                <ChartContainer
                config={{
                  value: {
                    label: "Revenue (PKR)",
                  },
                }}
                className="h-[300px]"
              >
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={120}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                </PieChart>
              </ChartContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-400">
                No category sales data available for the selected period
              </div>
            )}
            </div>
          </div>

          {/* Profit Margin (Gauge Chart) */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-lg transition-all">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-teal-500 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/25">
                <Gauge className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 text-sm">Overall Profit Margin</h3>
            </div>
            <div className="overflow-hidden">
              <div className="h-[300px] flex flex-col items-center justify-center">
              <div className="relative w-48 h-48">
                {/* Circular Progress */}
                <svg className="w-48 h-48 transform -rotate-90" viewBox="0 0 100 100">
                  {/* Background Circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="#E5E7EB"
                    strokeWidth="8"
                    fill="none"
                  />
                  {/* Progress Circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="#0c2c8a"
                    strokeWidth="8"
                    fill="none"
                    strokeDasharray={`${2 * Math.PI * 40}`}
                    strokeDashoffset={`${2 * Math.PI * 40 * (1 - profitMargin / 100)}`}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>

                {/* Center Text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-3xl font-bold text-gray-900">{profitMargin}%</div>
                  <div className="text-sm text-gray-500">Profit Margin</div>
                </div>
              </div>

              {/* Status Text */}
              <div className="mt-4 text-center">
                <div className={`text-lg font-semibold ${
                  profitMargin >= 20 ? 'text-emerald-600' :
                  profitMargin >= 10 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {profitMargin >= 20 ? 'Excellent' :
                   profitMargin >= 10 ? 'Good' : 'Needs Improvement'}
                </div>
                <div className="text-sm text-gray-500">
                  Target: 20% or higher
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>


      {/* Profit and Sales Overview */}
      {/* <SimpleReports /> */}


      {/* Error State */}
      {error && (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 shadow-sm hover:shadow-lg transition-all">
          <div className="text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <button 
              onClick={loadReportData}
              className="px-6 py-2.5 bg-white text-gray-700 font-medium rounded-xl border border-gray-200 hover:bg-gray-50 transition"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Time Period Reports */}
      <TimePeriodReports
        selectedPeriod={selectedPeriod}
        selectedReport={selectedReport}
        reportData={reportData}
        previousPeriodData={previousPeriodData}
        loading={loading}
        error={error}
      />

      {/* Branch-Specific Data Tabs */}
      {selectedBranchId && allBranches.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-lg transition-all">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-teal-500/25">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <h3 className="font-semibold text-gray-900 text-sm">
              {allBranches.find((b: any) => b.id === selectedBranchId)?.name || 'Selected Branch'} - Detailed Report
            </h3>
          </div>
          {(() => {
            if (!selectedBranchId) return null;
            
            const selectedBranchData = allBranches.find((b: any) => b.id === selectedBranchId);
            if (!selectedBranchData) return null;
            
            const branchStats = getBranchStats(selectedBranchId);

            return (
              <div className="space-y-6">
                {branchStats.branchSales.length > 0 ? (
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">Recent Sales ({branchStats.branchSales.length})</h4>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {branchStats.branchSales.slice(0, 10).map((sale: any, index: number) => (
                        <div key={sale.id || index} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
                          <div>
                            <span className="text-sm font-medium text-gray-900">Sale #{sale.id?.slice(-8) || index + 1}</span>
                            <span className="text-xs text-gray-500 ml-2">{new Date(sale.createdAt).toLocaleDateString()}</span>
                          </div>
                          <span className="font-medium text-gray-900">{formatCurrency(sale.totalAmount || 0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center p-8 text-gray-400">
                    <ShoppingCart className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium mb-2 text-gray-600">No Sales Available</h3>
                    <p className="text-sm">This branch doesn't have any sales yet.</p>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}


    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(Reports);