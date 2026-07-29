import React, { useState, useEffect } from 'react';
import { config } from "@/lib/config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, DollarSign, ShoppingCart, RefreshCw } from "lucide-react";

const SimpleReports = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('🔍 DEBUG - Loading simple reports data...');

      const response = await fetch(`${config.api.baseUrl}/reports/dashboard`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
      });

      console.log('🔍 DEBUG - Response status:', response.status);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('🔍 DEBUG - API response:', result);

      if (result.success) {
        setData(result.data);
      } else {
        throw new Error(result.message || 'API returned error');
      }

    } catch (err) {
      console.error('🔍 DEBUG - Error loading data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
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
      <div className="mb-8">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-6">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-red-800 mb-2">Error Loading Reports</h3>
              <p className="text-red-600 mb-4">{error}</p>
              <Button onClick={loadData} variant="outline" className="text-red-600 border-red-600">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mb-8">
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="p-6">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-yellow-800 mb-2">No Data Available</h3>
              <p className="text-yellow-600 mb-4">No sales data found in the database.</p>
              <Button onClick={loadData} variant="outline" className="text-yellow-600 border-yellow-600">
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Sales & Profit Overview</h2>
        <Button onClick={loadData} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
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
                PKR {data.today.revenue.toLocaleString()}
              </div>
              <div className={`flex items-center text-xs mt-1 ${data.today.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {data.today.growth >= 0 ? (
                  <TrendingUp className="h-3 w-3 mr-1" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-1" />
                )}
                {data.today.growth >= 0 ? '+' : ''}{data.today.growth.toFixed(1)}% vs yesterday
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
                PKR {data.today.profit.toLocaleString()}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {((data.today.profit / data.today.revenue) * 100).toFixed(1)}% margin
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
                {data.today.transactions}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {data.today.transactions > 0 ? `PKR ${(data.today.revenue / data.today.transactions).toFixed(0)} avg` : 'No orders'}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0 bg-gradient-to-r from-orange-50 to-orange-100">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Growth Rate
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${data.today.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {data.today.growth >= 0 ? '+' : ''}{data.today.growth.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                vs previous day
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* This Month's Performance */}
      <div>
        <h3 className="text-md font-medium text-gray-700 mb-3">This Month's Performance</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="shadow-soft border-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Monthly Sales
              </CardTitle>
              <DollarSign className="h-4 w-4 text-gray-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                PKR {data.month.revenue.toLocaleString()}
              </div>
              <div className={`flex items-center text-xs mt-1 ${data.month.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {data.month.growth >= 0 ? (
                  <TrendingUp className="h-3 w-3 mr-1" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-1" />
                )}
                {data.month.growth >= 0 ? '+' : ''}{data.month.growth.toFixed(1)}% vs last month
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Monthly Profit
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-gray-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                PKR {data.month.profit.toLocaleString()}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {((data.month.profit / data.month.revenue) * 100).toFixed(1)}% margin
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Monthly Orders
              </CardTitle>
              <ShoppingCart className="h-4 w-4 text-gray-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                {data.month.transactions}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {data.month.transactions > 0 ? `PKR ${(data.month.revenue / data.month.transactions).toFixed(0)} avg` : 'No orders'}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft border-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Monthly Growth
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-gray-600" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${data.month.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {data.month.growth >= 0 ? '+' : ''}{data.month.growth.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                vs last month
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SimpleReports;
