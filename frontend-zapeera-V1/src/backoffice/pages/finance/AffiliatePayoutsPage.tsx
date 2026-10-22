import { useState, useEffect, useCallback } from 'react';
import { HandCoins, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { backofficeApi } from '../../services/api';
import { BackofficeAffiliatePayout } from '../../types';

/**
 * Backoffice — Affiliate Payouts.
 * Affiliates request payouts from their dashboard once their available
 * balance reaches the program minimum. Marking PAID settles the
 * affiliate's outstanding commissions (oldest first) up to the payout
 * amount; REJECTED releases the reserved balance back to the affiliate.
 */

const STATUS_STYLES: Record<string, string> = {
  REQUESTED: 'bg-amber-50 text-amber-700 border-amber-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

const PAGE_SIZE = 20;

export function AffiliatePayoutsPage() {
  const [payouts, setPayouts] = useState<BackofficeAffiliatePayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backofficeApi.getAffiliatePayouts({
        page,
        limit: PAGE_SIZE,
        status: statusFilter || undefined,
      });
      setPayouts(res.data?.payouts || []);
      setTotalPages(res.data?.pagination?.pages || 1);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      setPayouts([]);
    }
    setLoading(false);
  }, [page, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const formatRs = (n: number) =>
    `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const process = async (payout: BackofficeAffiliatePayout, decision: 'PAID' | 'REJECTED') => {
    setBusyId(payout.id);
    try {
      await backofficeApi.processAffiliatePayout(payout.id, { decision, note: notes[payout.id] || undefined });
      toast.success(decision === 'PAID' ? 'Payout marked paid' : 'Payout rejected');
      fetchData();
    } catch {
      toast.error('Failed to process payout');
    }
    setBusyId(null);
  };

  const methodLabel = (p?: BackofficeAffiliatePayout) => {
    const d = p?.payoutDetails;
    if (!d) return '—';
    const method = d.method === 'BANK_TRANSFER' ? `Bank${d.bankName ? ` (${d.bankName})` : ''}` : d.method === 'JAZZCASH' ? 'JazzCash' : d.method === 'EASYPAISA' ? 'Easypaisa' : d.method;
    return `${method} · ${d.accountTitle} · ${d.accountNumber}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Affiliate Payouts</h1>
        <p className="text-sm text-gray-500 mt-1">
          Payout requests from affiliate partners. Send the money to the shown account, then mark PAID.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All Status</option>
          <option value="REQUESTED">Requested</option>
          <option value="PAID">Paid</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <span className="ml-auto text-sm text-gray-500">{total} payouts</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading && payouts.length === 0 ? (
          <div className="py-16 text-center text-gray-500 text-sm">Loading…</div>
        ) : payouts.length === 0 ? (
          <div className="py-16 text-center text-gray-500">
            <HandCoins className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">No payout requests found for the selected filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 font-medium">Affiliate</th>
                  <th className="px-4 py-3 font-medium">Pay to</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Requested</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{p.affiliateUser?.name || '—'}</p>
                      <p className="text-xs text-gray-500">{p.affiliateCode} · {p.affiliateUser?.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-[260px]">
                      <span className="break-words">{methodLabel(p)}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatRs(p.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_STYLES[p.status] || ''}`}>{p.status}</span>
                      {p.processedAt && <p className="text-xs text-gray-400 mt-1">{formatDate(p.processedAt)}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(p.createdAt)}</td>
                    <td className="px-4 py-3">
                      {p.status === 'REQUESTED' ? (
                        <input
                          value={notes[p.id] || ''}
                          onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })}
                          placeholder="Optional note"
                          className="w-36 px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
                        />
                      ) : (
                        <span className="text-gray-500">{p.note || '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.status === 'REQUESTED' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => process(p, 'PAID')}
                            disabled={busyId === p.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" /> Mark paid
                          </button>
                          <button
                            onClick={() => process(p, 'REJECTED')}
                            disabled={busyId === p.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                          >
                            <X className="w-3.5 h-3.5" /> Reject
                          </button>
                        </div>
                      )}
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
