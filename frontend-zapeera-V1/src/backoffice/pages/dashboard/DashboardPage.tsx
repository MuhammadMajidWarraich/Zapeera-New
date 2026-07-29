import { useState, useEffect } from 'react';
import { RefreshCw, Building2, CreditCard, Users, TrendingUp, AlertTriangle, CheckCircle, Activity, DollarSign, Clock, Zap, ArrowUpRight } from 'lucide-react';
import { backofficeApi } from '../../services/api';
import { DashboardStats } from '../../types';

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backofficeApi.getDashboardStats();
      setStats(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded-lg" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
        <p className="text-gray-600 font-medium mb-2">Failed to load dashboard</p>
        <p className="text-sm text-gray-400 mb-4">{error}</p>
        <button onClick={fetchStats} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  if (!stats) return null;

  const kpiCards = [
    { label: 'Total Businesses', value: stats.totalBusinesses, icon: Building2, color: 'from-blue-500 to-blue-600', bg: 'bg-blue-50 text-blue-600' },
    { label: 'Active Businesses', value: stats.activeBusinesses, icon: CheckCircle, color: 'from-emerald-500 to-emerald-600', bg: 'bg-emerald-50 text-emerald-600' },
    { label: 'Total Users', value: stats.totalUsers, icon: Users, color: 'from-violet-500 to-violet-600', bg: 'bg-violet-50 text-violet-600' },
    { label: 'Active Subscriptions', value: stats.activeSubscriptions, icon: CreditCard, color: 'from-cyan-500 to-cyan-600', bg: 'bg-cyan-50 text-cyan-600' },
    { label: 'Monthly Revenue', value: `PKR ${stats.totalRevenue.toLocaleString()}`, icon: DollarSign, color: 'from-emerald-500 to-emerald-600', bg: 'bg-emerald-50 text-emerald-600' },
    { label: 'Trial Subs', value: stats.trialSubscriptions, icon: Clock, color: 'from-amber-500 to-amber-600', bg: 'bg-amber-50 text-amber-600' },
    { label: 'New This Month', value: stats.newSubscriptionsThisMonth, icon: TrendingUp, color: 'from-rose-500 to-rose-600', bg: 'bg-rose-50 text-rose-600' },
    { label: 'Pending Proofs', value: stats.pendingPaymentProofs, icon: Activity, color: 'from-orange-500 to-orange-600', bg: 'bg-orange-50 text-orange-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time overview of your Zapeera platform</p>
        </div>
        <button onClick={fetchStats} className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-500">{kpi.label}</span>
              <div className={`p-2 rounded-lg ${kpi.bg}`}>
                <kpi.icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {stats.recentActivity.slice(0, 6).map((activity: any) => (
              <div key={activity.id} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0">
                <div className={`p-1.5 rounded-lg mt-0.5 ${activity.type === 'business_created' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {activity.type === 'business_created' ? <Building2 className="w-3.5 h-3.5" /> : <CreditCard className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700">{activity.message}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(activity.timestamp).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Subscription Alerts</h3>
          <div className="space-y-3">
            {stats.subscriptionAlerts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No alerts</p>
            ) : (
              stats.subscriptionAlerts.slice(0, 6).map((alert: any) => (
                <div key={alert.id} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0">
                  <div className={`p-1.5 rounded-lg ${alert.severity === 'danger' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                    <AlertTriangle className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700">{alert.businessName}</p>
                    <p className="text-xs text-gray-400">{alert.planName} - {alert.daysLeft !== null ? `${alert.daysLeft} days left` : 'Expired'}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${alert.severity === 'danger' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                    {alert.type}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Recent Signups</h3>
          <div className="space-y-3">
            {stats.recentUsers.map((user: any) => (
              <div key={user.id} className="flex items-center gap-3 pb-3 border-b border-gray-100 last:border-0">
                <div className="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
                  {user.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{user.name}</p>
                  <p className="text-xs text-gray-400">{user.email} &middot; {user.businessesCount} businesses</p>
                </div>
                <span className="text-xs text-gray-400">{new Date(user.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Recent Businesses</h3>
          <div className="space-y-3">
            {stats.recentBusinesses.map((biz: any) => (
              <div key={biz.id} className="flex items-center gap-3 pb-3 border-b border-gray-100 last:border-0">
                <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                  <Building2 className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{biz.name}</p>
                  <p className="text-xs text-gray-400">{biz.ownerName || biz.ownerEmail} &middot; {biz.planName || 'No plan'}</p>
                </div>
                <span className="text-xs text-gray-400">{new Date(biz.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
