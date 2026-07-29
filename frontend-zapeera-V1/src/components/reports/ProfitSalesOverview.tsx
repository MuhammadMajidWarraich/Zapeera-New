import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, DollarSign, ShoppingCart, RefreshCw, Activity } from "lucide-react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";

const ProfitSalesOverview = () => {
  const { user } = useAuth();
  const { selectedCompanyId } = useAdmin();
  const [overviewData, setOverviewData] = useState({
    totalSales: 0,
    totalProfit: 0,
    salesGrowth: 0,
    profitGrowth: 0,
    totalOrders: 0,
    averageOrderValue: 0,
    todaySales: 0,
    todayProfit: 0,
    todayOrders: 0,
    todayGrowth: 0
  });
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    loadOverviewData();
  }, [selectedCompanyId]);

  const loadOverviewData = async () => {
    try {
      setLoading(true);
      console.log('🔍 DEBUG - Starting to load overview data...');
      console.log('🔍 DEBUG - User:', user);

      // Get branch ID
      let branchId = user?.membership?.branchIds?.[0] || user?.branchId;
      console.log('🔍 DEBUG - User branch ID:', branchId);

      if (!branchId) {
        console.log('🔍 DEBUG - No branch ID, fetching branches...');
        const branchesResponse = await apiService.getBranches();
        console.log('🔍 DEBUG - Branches response:', branchesResponse);

        if (branchesResponse.success && branchesResponse.data?.branches?.length > 0) {
          branchId = branchesResponse.data.branches[0].id;
          console.log('🔍 DEBUG - Using first branch:', branchId);
        }
      }

      // If still no branchId, don't pass it (will get all branches data)
      if (!branchId) {
        console.warn('No branch ID available, fetching data for all branches');
      }

      console.log('🔍 DEBUG - Calling getDashboardData with branchId:', branchId || '');

      // Get dashboard data (includes today and month data)
      const dashboardResponse = await apiService.getDashboardData(branchId || "", selectedCompanyId || "");

      console.log('🔍 DEBUG - Dashboard response:', dashboardResponse);

      if (dashboardResponse.success) {
        const data = dashboardResponse.data;
        console.log('🔍 DEBUG - Dashboard data loaded:', data);
        console.log('🔍 DEBUG - Today data:', data.today);
        console.log('🔍 DEBUG - Month data:', data.month);

        const newOverviewData = {
          totalSales: data.month.revenue,
          totalProfit: data.month.profit,
          salesGrowth: data.month.growth,
          profitGrowth: data.month.growth, // Same growth for profit
          totalOrders: data.month.transactions,
          averageOrderValue: data.month.transactions > 0 ? data.month.revenue / data.month.transactions : 0,
          todaySales: data.today.revenue,
          todayProfit: data.today.profit,
          todayOrders: data.today.transactions,
          todayGrowth: data.today.growth
        };

        console.log('🔍 DEBUG - Setting overview data:', newOverviewData);
        setOverviewData(newOverviewData);
        setLastUpdated(new Date());
      } else {
        console.error('🔍 DEBUG - Dashboard API failed:', dashboardResponse);
        // Set some default data to show something
        setOverviewData({
          totalSales: 0,
          totalProfit: 0,
          salesGrowth: 0,
          profitGrowth: 0,
          totalOrders: 0,
          averageOrderValue: 0,
          todaySales: 0,
          todayProfit: 0,
          todayOrders: 0,
          todayGrowth: 0
        });
      }
    } catch (error) {
      console.error('🔍 DEBUG - Error loading overview data:', error);
      // Set some default data to show something
      setOverviewData({
        totalSales: 0,
        totalProfit: 0,
        salesGrowth: 0,
        profitGrowth: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        todaySales: 0,
        todayProfit: 0,
        todayOrders: 0,
        todayGrowth: 0
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="shadow-soft border-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 bg-gray-200 rounded animate-pulse w-20"></div>
              <div className="h-4 w-4 bg-gray-200 rounded animate-pulse"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-gray-200 rounded animate-pulse w-24 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded animate-pulse w-16"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Real-time Sales & Profit Overview</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center text-xs text-green-600">
            <Activity className="w-3 h-3 mr-1 animate-pulse" />
            Live Data
          </div>
          {lastUpdated && (
            <div className="text-xs text-gray-500">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={loadOverviewData}
            disabled={loading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Today's Performance */}
      <div className="mb-6">
        <h3 className="text-md font-medium text-gray-700 mb-3">Today's Performance</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="shadow-soft border-0 bg-gradient-to-r from-green-50 to-green-100">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Today's Sales
              </CardTitle>
              <DollarSign className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                PKR {overviewData.todaySales.toLocaleString()}
              </div>
              <div className={`flex items-center text-xs mt-1 ${overviewData.todayGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {overviewData.todayGrowth >= 0 ? (
                  <TrendingUp className="h-3 w-3 mr-1" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-1" />
                )}
                {overviewData.todayGrowth >= 0 ? '+' : ''}{overviewData.todayGrowth.toFixed(1)}% vs yesterday
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0 bg-gradient-to-r from-blue-50 to-blue-100">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Today's Profit
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                PKR {overviewData.todayProfit.toLocaleString()}
              </div>
              <div className="flex items-center text-xs text-gray-500 mt-1">
                30% margin
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0 bg-gradient-to-r from-purple-50 to-purple-100">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Today's Orders
              </CardTitle>
              <ShoppingCart className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                {overviewData.todayOrders.toLocaleString()}
              </div>
              <div className="flex items-center text-xs text-gray-500 mt-1">
                Transactions
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0 bg-gradient-to-r from-orange-50 to-orange-100">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Avg Order Value
              </CardTitle>
              <DollarSign className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                PKR {overviewData.todayOrders > 0 ? (overviewData.todaySales / overviewData.todayOrders).toLocaleString() : '0'}
              </div>
              <div className="flex items-center text-xs text-gray-500 mt-1">
                Per order today
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Monthly Performance */}
      <div>
        <h3 className="text-md font-medium text-gray-700 mb-3">This Month's Performance</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="shadow-soft border-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Monthly Sales
              </CardTitle>
              <DollarSign className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                PKR {overviewData.totalSales.toLocaleString()}
              </div>
              <div className={`flex items-center text-xs mt-1 ${overviewData.salesGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {overviewData.salesGrowth >= 0 ? (
                  <TrendingUp className="h-3 w-3 mr-1" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-1" />
                )}
                {overviewData.salesGrowth >= 0 ? '+' : ''}{overviewData.salesGrowth.toFixed(1)}% vs last month
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Monthly Profit
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                PKR {overviewData.totalProfit.toLocaleString()}
              </div>
              <div className={`flex items-center text-xs mt-1 ${overviewData.profitGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {overviewData.profitGrowth >= 0 ? (
                  <TrendingUp className="h-3 w-3 mr-1" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-1" />
                )}
                {overviewData.profitGrowth >= 0 ? '+' : ''}{overviewData.profitGrowth.toFixed(1)}% vs last month
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Monthly Orders
              </CardTitle>
              <ShoppingCart className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                {overviewData.totalOrders.toLocaleString()}
              </div>
              <div className="flex items-center text-xs text-gray-500 mt-1">
                This month
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Avg Order Value
              </CardTitle>
              <DollarSign className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                PKR {overviewData.averageOrderValue.toLocaleString()}
              </div>
              <div className="flex items-center text-xs text-gray-500 mt-1">
                Per order
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(ProfitSalesOverview);