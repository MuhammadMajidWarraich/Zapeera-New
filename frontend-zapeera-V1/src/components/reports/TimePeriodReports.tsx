import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  BarChart3,
  Star,
  RefreshCw
} from "lucide-react";

interface TimePeriodReportsProps {
  selectedPeriod: string;
  selectedReport: string;
  reportData?: any;
  previousPeriodData?: any;
  loading?: boolean;
  error?: string | null;
}

const TimePeriodReports: React.FC<TimePeriodReportsProps> = ({
  selectedPeriod,
  selectedReport,
  reportData,
  previousPeriodData,
  loading = false,
  error = null
}) => {

  // Calculate growth percentage
  const calculateGrowth = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
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

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-6">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-red-800 mb-2">Error Loading Data</h3>
            <p className="text-red-600 mb-4">{error}</p>
            <Button onClick={() => window.location.reload()} variant="outline" className="text-red-600 border-red-600">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!reportData) {
    return (
      <Card className="border-yellow-200 bg-yellow-50">
        <CardContent className="p-6">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-yellow-800 mb-2">No Data Available</h3>
            <p className="text-yellow-600 mb-4">No data found for the selected period.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Get current data based on report type
  const getCurrentData = useCallback(() => {
    if (!reportData) {
      return null;
    }

    console.log('🔍 TimePeriodReports - reportData:', reportData);
    console.log('🔍 TimePeriodReports - previousPeriodData:', previousPeriodData);

    switch (selectedReport) {
      case 'sales':
        const currentRevenue = reportData.summary?.totalRevenue || 0;
        const currentTransactions = reportData.summary?.totalSales || 0;
        const previousRevenue = previousPeriodData?.summary?.totalRevenue || 0;
        const previousTransactions = previousPeriodData?.summary?.totalSales || 0;

        // Calculate profit as revenue - cost (approximate using subtotal as cost)
        const currentProfit = currentRevenue - (reportData.summary?.totalSubtotal || 0);
        const previousProfit = previousRevenue - (previousPeriodData?.summary?.totalSubtotal || 0);

        console.log('🔍 Sales calculations:', {
          currentRevenue,
          currentTransactions,
          currentProfit,
          avgTransaction: currentTransactions > 0 ? currentRevenue / currentTransactions : 0,
          revenueGrowth: calculateGrowth(currentRevenue, previousRevenue),
          transactionGrowth: calculateGrowth(currentTransactions, previousTransactions)
        });

        return {
          revenue: currentRevenue,
          transactions: currentTransactions,
          customers: 0, // This would need to be calculated separately
          avgTransaction: currentTransactions > 0 ? currentRevenue / currentTransactions : 0,
          revenueGrowth: calculateGrowth(currentRevenue, previousRevenue),
          transactionGrowth: calculateGrowth(currentTransactions, previousTransactions),
          profit: currentProfit,
          profitGrowth: calculateGrowth(currentProfit, previousProfit)
        };
      case 'inventory':
        return {
          totalProducts: reportData.summary?.totalProducts || 0,
          totalStock: reportData.summary?.totalStock || 0,
          lowStockCount: reportData.summary?.lowStockCount || 0,
          totalValue: reportData.summary?.totalValue || 0
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
          topProducts: reportData.topProducts || [],
          totalSales: reportData.summary?.totalSales || 0,
          averageRating: reportData.summary?.averageRating || 0
        };
      default:
        return null;
    }
  }, [reportData, previousPeriodData, selectedReport]);

  const currentData = useMemo(() => getCurrentData(), [getCurrentData]);

  // Removed console.log to prevent repeated logging on every render

  if (!currentData) {
    return (
      <Card className="border-gray-200 bg-gray-50">
        <CardContent className="p-6">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">No Data Available</h3>
            <p className="text-gray-600">No data found for the selected report type.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

      {selectedReport === 'inventory' && (
        <>
          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Products</p>
                  <p className="text-2xl font-bold text-foreground">{currentData.totalProducts.toLocaleString()}</p>
                </div>
                <Package className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Stock</p>
                  <p className="text-2xl font-bold text-foreground">{currentData.totalStock.toLocaleString()}</p>
                </div>
                <Package className="w-8 h-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Low Stock Items</p>
                  <p className="text-2xl font-bold text-orange-600">{currentData.lowStockCount}</p>
                </div>
                <TrendingDown className="w-8 h-8 text-orange-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Value</p>
                  <p className="text-2xl font-bold text-foreground">PKR {currentData.totalValue.toLocaleString()}</p>
                </div>
                <DollarSign className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {selectedReport === 'customers' && (
        <>
          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Customers</p>
                  <p className="text-2xl font-bold text-foreground">{currentData.totalCustomers.toLocaleString()}</p>
                  <div className="flex items-center mt-2">
                    {currentData.customerGrowth >= 0 ? (
                      <TrendingUp className="w-4 h-4 text-green-600 mr-1" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-600 mr-1" />
                    )}
                    <span className={`text-sm font-medium ${currentData.customerGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {currentData.customerGrowth >= 0 ? '+' : ''}{currentData.customerGrowth}%
                    </span>
                  </div>
                </div>
                <Users className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Spent</p>
                  <p className="text-2xl font-bold text-foreground">PKR {currentData.totalSpent.toLocaleString()}</p>
                  <div className="flex items-center mt-2">
                    {currentData.spendingGrowth >= 0 ? (
                      <TrendingUp className="w-4 h-4 text-green-600 mr-1" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-600 mr-1" />
                    )}
                    <span className={`text-sm font-medium ${currentData.spendingGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {currentData.spendingGrowth >= 0 ? '+' : ''}{currentData.spendingGrowth}%
                    </span>
                  </div>
                </div>
                <DollarSign className="w-8 h-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Avg Spent</p>
                  <p className="text-2xl font-bold text-foreground">PKR {Math.round(currentData.averageSpent)}</p>
                </div>
                <BarChart3 className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Loyalty Points</p>
                  <p className="text-2xl font-bold text-foreground">{currentData.loyaltyPoints.toLocaleString()}</p>
                </div>
                <Star className="w-8 h-8 text-yellow-600" />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {selectedReport === 'products' && (
        <>
          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Products</p>
                  <p className="text-2xl font-bold text-foreground">{currentData.totalProducts.toLocaleString()}</p>
                </div>
                <Package className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Sales</p>
                  <p className="text-2xl font-bold text-foreground">{currentData.totalSales.toLocaleString()}</p>
                </div>
                <ShoppingCart className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Avg Rating</p>
                  <p className="text-2xl font-bold text-foreground">{currentData.averageRating.toFixed(1)}</p>
                </div>
                <Star className="w-8 h-8 text-yellow-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Top Products</p>
                  <p className="text-2xl font-bold text-foreground">{currentData.topProducts.length}</p>
                </div>
                <BarChart3 className="w-8 h-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default TimePeriodReports;
