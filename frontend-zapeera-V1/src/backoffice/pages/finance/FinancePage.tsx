import { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, CreditCard, Clock, AlertTriangle, CheckCircle, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { backofficeApi } from '../../services/api';

export function FinancePage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      backofficeApi.getDashboardStats(),
      backofficeApi.getBillingSummary().catch(() => ({ data: null })),
    ]).then(([dashRes, billRes]) => {
      setStats({ ...dashRes.data, billing: billRes.data });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="space-y-4"><div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" /><div className="grid grid-cols-1 md:grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}</div></div>;

  const kpis = [
    { label: 'Monthly Revenue', value: `PKR ${(stats?.totalRevenue || 0).toLocaleString()}`, icon: DollarSign, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Active Subscriptions', value: stats?.activeSubscriptions || 0, icon: CreditCard, color: 'bg-blue-50 text-blue-600' },
    { label: 'Trial Subscriptions', value: stats?.trialSubscriptions || 0, icon: Clock, color: 'bg-amber-50 text-amber-600' },
    { label: 'Pending Proofs', value: stats?.pendingPaymentProofs || 0, icon: AlertTriangle, color: 'bg-orange-50 text-orange-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Finance Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Revenue overview and subscription billing</p>
        </div>
        <button onClick={() => navigate('/backoffice/payment-proofs')} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium">
          View Payment Proofs <ArrowUpRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-500">{kpi.label}</span>
              <div className={`p-2 rounded-lg ${kpi.color}`}><kpi.icon className="w-4 h-4" /></div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Revenue Trend</h3>
          {stats?.growthChart?.length > 0 ? (
            <div className="space-y-2">
              {stats.growthChart.slice(-7).map((d: any) => (
                <div key={d.date} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-16">{d.date.slice(5)}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-full rounded-full" style={{ width: `${Math.min((d.new / (Math.max(...stats.growthChart.map((g: any) => g.new)) || 1)) * 100, 100)}%` }} />
                  </div>
                  <span className="text-xs font-medium text-gray-600 w-8">{d.new}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No growth data available</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Subscription Status Breakdown</h3>
          <div className="space-y-3">
            {[
              { label: 'Active', count: stats?.activeSubscriptions || 0, color: 'bg-emerald-500', total: stats?.totalSubscriptions || 1 },
              { label: 'Trial', count: stats?.trialSubscriptions || 0, color: 'bg-amber-500', total: stats?.totalSubscriptions || 1 },
              { label: 'Expired', count: stats?.expiredSubscriptions || 0, color: 'bg-red-500', total: stats?.totalSubscriptions || 1 },
              { label: 'Suspended', count: stats?.suspendedSubscriptions || 0, color: 'bg-gray-500', total: stats?.totalSubscriptions || 1 },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="text-sm text-gray-600 w-20">{item.label}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className={`${item.color} h-full rounded-full transition-all`} style={{ width: `${(item.count / (item.total || 1)) * 100}%` }} />
                </div>
                <span className="text-sm font-medium text-gray-900 w-8">{item.count}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400">Total: {stats?.totalSubscriptions || 0} subscriptions &middot; Revenue growth: {stats?.revenueGrowthPercent !== null ? `${stats?.revenueGrowthPercent}%` : 'N/A'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
