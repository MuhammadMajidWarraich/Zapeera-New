import { useState, useEffect, useCallback } from 'react';
import { Percent, Check, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { backofficeApi } from '../../services/api';
import { BackofficeAffiliateCommission } from '../../types';

/**
 * Backoffice — Affiliate Commissions (partner referral commissions).
 * Accrued automatically when a referred business pays (payment-proof
 * approval / paid plan assignment). Approve moves PENDING → APPROVED;
 * void kills a commission that should never pay out. Settlement into
 * PAID happens when a payout is marked paid.
 */

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-blue-50 text-blue-700 border-blue-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  VOID: 'bg-red-50 text-red-700 border-red-200',
};

const PAGE_SIZE = 20;

export function AffiliateCommissionsPage() {
  const [commissions, setCommissions] = useState<BackofficeAffiliateCommission[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backofficeApi.getAffiliateCommissions({
        page,
        limit: PAGE_SIZE,
        status: statusFilter || undefined,
      });
      setCommissions(res.data?.commissions || []);
      setTotalPages(res.data?.pagination?.pages || 1);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      setCommissions([]);
    }
    setLoading(false);
  }, [page, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const formatRs = (n: number) =>
    `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const act = async (id: string, action: 'approve' | 'void') => {
    setBusyId(id);
    try {
      if (action === 'approve') {
        await backofficeApi.approveAffiliateCommission(id);
        toast.success('Commission approved');
      } else {
        await backofficeApi.voidAffiliateCommission(id);
        toast.success('Commission voided');
      }
      fetchData();
    } catch {
      toast.error(`Failed to ${action} commission`);
    }
    setBusyId(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Affiliate Commissions</h1>
        <p className="text-sm text-gray-500 mt-1">
          Commissions earned by affiliate partners on referred businesses' subscription payments.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="PAID">Paid</option>
          <option value="VOID">Void</option>
        </select>
        <span className="ml-auto text-sm text-gray-500">{total} commissions</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading && commissions.length === 0 ? (
          <div className="py-16 text-center text-gray-500 text-sm">Loading…</div>
        ) : commissions.length === 0 ? (
          <div className="py-16 text-center text-gray-500">
            <Percent className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">No affiliate commissions found for the selected filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 font-medium">Affiliate</th>
                  <th className="px-4 py-3 font-medium">Business</th>
                  <th className="px-4 py-3 font-medium text-right">Payment</th>
                  <th className="px-4 py-3 font-medium text-right">Rate</th>
                  <th className="px-4 py-3 font-medium text-right">Commission</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Accrued</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{c.affiliateUser?.name || '—'}</p>
                      <p className="text-xs text-gray-500">{c.affiliateCode} · {c.affiliateUser?.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{c.businessName || '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatRs(c.basisAmount)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{c.rateApplied}%</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatRs(c.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_STYLES[c.status] || ''}`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(c.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {c.status === 'PENDING' && (
                          <button
                            onClick={() => act(c.id, 'approve')}
                            disabled={busyId === c.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" /> Approve
                          </button>
                        )}
                        {(c.status === 'PENDING' || c.status === 'APPROVED') && (
                          <button
                            onClick={() => act(c.id, 'void')}
                            disabled={busyId === c.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                          >
                            <Ban className="w-3.5 h-3.5" /> Void
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
