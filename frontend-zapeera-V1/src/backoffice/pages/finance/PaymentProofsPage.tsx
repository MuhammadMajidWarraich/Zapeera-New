import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, Eye, Search, X, AlertCircle, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { backofficeApi } from '../../services/api';
import { PaymentProof } from '../../../types';

const METHOD_LABELS: Record<string, string> = { BANK_TRANSFER: 'Bank Transfer', EASYPAISA: 'EasyPaisa', JAZZCASH: 'JazzCash' };

export function PaymentProofsPage() {
  const [proofs, setProofs] = useState<PaymentProof[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'PENDING' | 'APPROVED' | 'REJECTED'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PaymentProof | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => { fetchProofs(); }, []);

  const fetchProofs = async () => {
    setLoading(true);
    try {
      const res = await backofficeApi.getPaymentProofs();
      setProofs(res.data || []);
    } catch {}
    setLoading(false);
  };

  const handleApprove = async (id: string) => {
    setActionLoading(true);
    try { await backofficeApi.approvePaymentProof(id); toast.success('Payment proof approved'); setSelected(null); fetchProofs(); } catch { toast.error('Failed to approve'); }
    setActionLoading(false);
  };

  const handleReject = async (id: string) => {
    setActionLoading(true);
    try { await backofficeApi.rejectPaymentProof(id, rejectReason); toast.success('Payment proof rejected'); setSelected(null); setRejectReason(''); fetchProofs(); } catch { toast.error('Failed to reject'); }
    setActionLoading(false);
  };

  const filtered = proofs.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (search && !p.businessName?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = { total: proofs.length, pending: proofs.filter(p => p.status === 'PENDING').length, approved: proofs.filter(p => p.status === 'APPROVED').length, rejected: proofs.filter(p => p.status === 'REJECTED').length };

  if (loading) return <div className="space-y-4"><div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" /><div className="h-96 bg-gray-100 rounded-xl animate-pulse" /></div>;

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">Payment Proofs</h1><p className="text-sm text-gray-500 mt-1">Review and approve payment submissions</p></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', count: counts.total, icon: FileText, color: 'bg-gray-50 text-gray-600' },
          { label: 'Pending', count: counts.pending, icon: Clock, color: 'bg-amber-50 text-amber-600' },
          { label: 'Approved', count: counts.approved, icon: CheckCircle, color: 'bg-emerald-50 text-emerald-600' },
          { label: 'Rejected', count: counts.rejected, icon: XCircle, color: 'bg-red-50 text-red-600' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-3"><div className={`p-2 rounded-lg ${k.color}`}><k.icon className="w-4 h-4" /></div><div><p className="text-2xl font-bold text-gray-900">{k.count}</p><p className="text-xs text-gray-500">{k.label}</p></div></div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by business..." className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full outline-none focus:ring-2 focus:ring-blue-500/50" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="all">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center"><FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-600">No payment proofs found</h3></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Business</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Plan</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Amount</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Method</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(proof => (
                <tr key={proof.id} className="hover:bg-blue-50/30">
                  <td className="px-4 py-3.5 text-sm font-medium text-gray-900">{proof.businessName}</td>
                  <td className="px-4 py-3.5 text-sm text-gray-600">{proof.planName}</td>
                  <td className="px-4 py-3.5 text-sm font-medium text-gray-900">PKR {proof.amount.toLocaleString()}</td>
                  <td className="px-4 py-3.5 text-sm text-gray-600">{METHOD_LABELS[proof.method] || proof.method}</td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      proof.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : proof.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {proof.status === 'APPROVED' && <CheckCircle className="w-3 h-3" />}
                      {proof.status === 'REJECTED' && <XCircle className="w-3 h-3" />}
                      {proof.status === 'PENDING' && <Clock className="w-3 h-3" />}
                      {proof.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-gray-400">{new Date(proof.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3.5 text-right">
                    <button onClick={() => setSelected(proof)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"><Eye className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Payment Proof</h2>
              <button onClick={() => setSelected(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Business</span><span className="font-medium">{selected.businessName}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Plan</span><span className="font-medium">{selected.planName}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Amount</span><span className="font-medium">PKR {selected.amount.toLocaleString()}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Method</span><span className="font-medium">{METHOD_LABELS[selected.method] || selected.method}</span></div>
              {selected.referenceNote && <div className="flex justify-between text-sm"><span className="text-gray-500">Reference</span><span className="font-medium">{selected.referenceNote}</span></div>}
              <div className="flex justify-between text-sm"><span className="text-gray-500">Status</span><span className={`font-medium ${selected.status === 'APPROVED' ? 'text-emerald-600' : selected.status === 'REJECTED' ? 'text-red-600' : 'text-amber-600'}`}>{selected.status}</span></div>
            </div>
            {selected.screenshotUrl && (
              <div className="mb-4"><img src={selected.screenshotUrl} alt="Payment proof" className="w-full rounded-lg border border-gray-200" /></div>
            )}
            {selected.status === 'PENDING' && (
              <div className="flex gap-3">
                <button onClick={() => handleApprove(selected.id)} disabled={actionLoading} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition text-sm font-medium disabled:opacity-50">Approve</button>
                <div className="flex-1 space-y-2">
                  <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason (optional)" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none" />
                  <button onClick={() => handleReject(selected.id)} disabled={actionLoading} className="w-full px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition text-sm font-medium disabled:opacity-50">Reject</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
