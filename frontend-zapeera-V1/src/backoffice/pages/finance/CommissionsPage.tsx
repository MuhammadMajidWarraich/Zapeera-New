import { useState, useEffect, useCallback } from 'react';
import { Award, Clock, CheckCircle, DollarSign, TrendingUp } from 'lucide-react';
import { backofficeApi } from '../../services/api';
import { BackofficeCommission, BackofficeCommissionStats, Business } from '../../types';

/**
 * Backoffice Commissions — read-only platform view.
 * Commission records are created and managed inside each business
 * (Performance Tracking in the tenant app); this screen only reports
 * them across businesses via GET /api/backoffice/commissions.
 */

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-blue-50 text-blue-700 border-blue-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
};

const PAGE_SIZE = 20;

export function CommissionsPage() {
  const [commissions, setCommissions] = useState<BackofficeCommission[]>([]);
  const [stats, setStats] = useState<BackofficeCommissionStats | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [businessFilter, setBusinessFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [periodTypeFilter, setPeriodTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    backofficeApi
      .getBusinesses()
      .then((res) => setBusinesses(res.data || []))
      .catch(() => setBusinesses([]));
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        backofficeApi.getCommissions({
          page,
          limit: PAGE_SIZE,
          businessId: businessFilter || undefined,
          status: statusFilter || undefined,
          periodType: periodTypeFilter || undefined,
        }),
        backofficeApi.getCommissionStats(businessFilter || undefined),
      ]);
      setCommissions(listRes.data?.commissions || []);
      setTotalPages(listRes.data?.pagination?.pages || 1);
      setTotal(listRes.data?.pagination?.total || 0);
      setStats(statsRes.data || null);
    } catch {
      setCommissions([]);
      setStats(null);
    }
    setLoading(false);
  }, [page, businessFilter, statusFilter, periodTypeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatRs = (n: number) =>
    `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  if (loading && commissions.length === 0 && !stats) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="h-96 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Commissions</h1>
        <p className="text-sm text-gray-500 mt-1">
          Staff commission records across all businesses (read-only — records are created and
          managed inside each business)
        </p>
      </div>

      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: String(stats.totalCommissions), icon: Award, color: 'bg-gray-50 text-gray-600' },
            { label: 'Total Amount', value: formatRs(stats.totalAmount), icon: DollarSign, color: 'bg-blue-50 text-blue-600' },
            { label: 'Paid Out', value: formatRs(stats.totalPaidAmount), icon: CheckCircle, color: 'bg-emerald-50 text-emerald-600' },
            { label: 'Pending Approval', value: String(stats.pendingCommissions), icon: Clock, color: 'bg-amber-50 text-amber-600' },
          ].map((k) => (
            <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${k.color}`}>
                  <k.icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-gray-900 truncate">{k.value}</p>
                  <p className="text-xs text-gray-500">{k.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={businessFilter}
          onChange={(e) => {
            setBusinessFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All Businesses</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select
          value={periodTypeFilter}
          onChange={(e) => {
            setPeriodTypeFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All Period Types</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
        </select>
        {stats && (
          <span className="ml-auto flex items-center gap-1.5 text-sm text-gray-500">
            <TrendingUp className="w-4 h-4" />
            Sales covered: {formatRs(stats.totalSales)}
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {commissions.length === 0 ? (
          <div className="py-16 text-center text-gray-500">
            <Award className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">No commission records found for the selected filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 font-medium">Staff</th>
                  <th className="px-4 py-3 font-medium">Business</th>
                  <th className="px-4 py-3 font-medium">Branch</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium text-right">Sales</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {c.membership?.user?.name || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {c.staffProfile?.designation || c.staffProfile?.employeeId || ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.membership?.business?.name || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.branch?.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.period}
                      <span className="ml-1.5 text-xs text-gray-400">{c.periodType}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {formatRs(c.totalSales)}
                      <span className="block text-xs text-gray-400">
                        {c.totalTransactions} transactions
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {formatRs(c.totalAmount)}
                      <span className="block text-xs font-normal text-gray-400">
                        base {formatRs(c.totalCommission)} + bonus {formatRs(c.bonusAmount)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_STYLES[c.status] || STATUS_STYLES.PENDING}`}
                      >
                        {c.status}
                      </span>
                      {c.paidAt && (
                        <span className="block text-xs text-gray-400 mt-0.5">
                          Paid {formatDate(c.paidAt)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {total} records · Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
