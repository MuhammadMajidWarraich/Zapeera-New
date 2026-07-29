import React, { useState, useEffect } from 'react';
import { config } from "@/lib/config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Clock, User, Package } from "lucide-react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

interface RecentSale {
  id: string;
  totalAmount: number;
  createdAt: string;
  customer: {
    name: string;
    phone: string;
  } | null;
  items: Array<{
    product: {
      name: string;
    };
    quantity: number;
    totalPrice: number;
  }>;
}

const RealTimeSalesUpdates = () => {
  const { user } = useAuth();
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecentSales();
  }, []);

  const loadRecentSales = async () => {
    try {
      setLoading(true);
      console.log('🔍 DEBUG - Loading recent sales...');

      // Use dashboard API directly to get recent sales
      const response = await fetch(`${config.api.baseUrl}/reports/dashboard`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('🔍 DEBUG - Dashboard response:', result);

      if (result.success) {
        const data = result.data;
        console.log('🔍 DEBUG - Recent sales data:', data.recentSales);

        // Transform recent sales data to match our interface
        const transformedSales = data.recentSales?.map((sale: any) => ({
          id: sale.id,
          totalAmount: sale.totalAmount,
          createdAt: sale.createdAt,
          customer: sale.customer,
          items: sale.items?.map((item: any) => ({
            product: {
              name: item.product?.name || 'Unknown Product'
            },
            quantity: item.quantity,
            totalPrice: item.totalPrice
          })) || []
        })) || [];

        console.log('🔍 DEBUG - Transformed sales:', transformedSales);
        setRecentSales(transformedSales);
      } else {
        console.error('Dashboard API failed:', result);
      }
    } catch (error) {
      console.error('🔍 DEBUG - Error loading recent sales:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <ShoppingCart className="w-5 h-5 text-primary" />
            <span>Recent Sales</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg animate-pulse">
                <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
                <div className="h-4 bg-gray-200 rounded w-16"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-soft border-0">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <ShoppingCart className="w-5 h-5 text-primary" />
          <span>Recent Sales</span>
          <Badge variant="secondary" className="ml-auto">
            Live
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {recentSales.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ShoppingCart className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No recent sales found</p>
            </div>
          ) : (
            recentSales.map((sale) => (
              <div key={sale.id} className="flex items-center space-x-3 p-3 bg-gradient-surface rounded-lg hover:bg-gray-50 transition-colors">
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <ShoppingCart className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <p className="font-medium text-foreground truncate">
                      {sale.customer?.name || 'Walk-in Customer'}
                    </p>
                    <Badge variant="outline" className="text-xs">
                      PKR {sale.totalAmount.toLocaleString()}
                    </Badge>
                  </div>
                  <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{formatTime(sale.createdAt)}</span>
                    <span>•</span>
                    <Package className="w-3 h-3" />
                    <span>{sale.items.length} item{sale.items.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {sale.items.slice(0, 2).map((item, index) => (
                      <span key={index}>
                        {item.product.name} ({item.quantity}x)
                        {index < Math.min(sale.items.length, 2) - 1 && ', '}
                      </span>
                    ))}
                    {sale.items.length > 2 && ` +${sale.items.length - 2} more`}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default React.memo(RealTimeSalesUpdates);
