import { useState, useEffect, useCallback } from 'react';
import { Share2, Search, Link2, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { backofficeApi } from '../../services/api';
import { BackofficeAffiliate, AffiliateProgramConfig } from '../../types';

/**
 * Backoffice — Affiliate Program partners.
 * Approve/suspend affiliates, set per-affiliate commission-rate
 * overrides, manually attribute a business, and edit the global
 * program config (default rate + minimum payout). Distinct from the
 * STAFF Commissions page (tenant-side employee commissions).
 */

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SUSPENDED: 'bg-red-50 text-red-700 border-red-200',
};

const PAGE_SIZE = 20;

export function AffiliatesPage() {
  const [affiliates, setAffiliates] = useState<BackofficeAffiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [rateEdits, setRateEdits] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // Manual attribution
  const [attrCode, setAttrCode] = useState('');
  const [attrBusinessId, setAttrBusinessId] = useState('');
  const [attrBusy, setAttrBusy] = useState(false);

  // Global config
  const [config, setConfig] = useState<AffiliateProgramConfig | null>(null);
  const [configBusy, setConfigBusy] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backofficeApi.getAffiliates({
        page,
        limit: PAGE_SIZE,
        status: statusFilter || undefined,
        search: search || undefined,
      });
      setAffiliates(res.data?.affiliates || []);
      setTotalPages(res.data?.pagination?.pages || 1);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      setAffiliates([]);
    }
    setLoading(false);
  }, [page, statusFilter, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    backofficeApi.getAffiliateConfig().then((res) => setConfig(res.data)).catch(() => setConfig(null));
  }, []);

  const formatRs = (n: number) =>
    `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const setStatus = async (affiliate: BackofficeAffiliate, status: string) => {
    setBusyId(affiliate.id);
    try {
      await backofficeApi.updateAffiliate(affiliate.id, { status });
      toast.success(`Affiliate ${status === 'ACTIVE' ? 'activated' : status === 'SUSPENDED' ? 'suspended' : 'updated'}`);
      fetchData();
    } catch {
      toast.error('Failed to update affiliate');
    }
    setBusyId(null);
  };

  const saveRate = async (affiliate: BackofficeAffiliate) => {
    const raw = rateEdits[affiliate.id];
    const value = raw === '' || raw === undefined ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
      toast.error('Rate must be between 0 and 100 (blank = global default)');
      return;
    }
    setBusyId(affiliate.id);
    try {
      await backofficeApi.updateAffiliate(affiliate.id, { commissionRate: value });
      toast.success(value === null ? 'Rate override cleared' : `Rate set to ${value}%`);
      fetchData();
    } catch {
      toast.error('Failed to update rate');
    }
    setBusyId(null);
  };

  const attribute = async () => {
    if (!attrCode.trim() || !attrBusinessId.trim()) {
      toast.error('Affiliate code and business ID are both required');
      return;
    }
    setAttrBusy(true);
    try {
      await backofficeApi.attributeBusinessToAffiliate({ code: attrCode.trim(), businessId: attrBusinessId.trim() });
      toast.success('Business attributed to affiliate');
      setAttrCode('');
      setAttrBusinessId('');
      fetchData();
    } catch (e: any) {
      toast.error(e?.message || 'Attribution failed — the business may already be attributed');
    }
    setAttrBusy(false);
  };

  const saveConfig = async () => {
    if (!config) return;
    setConfigBusy(true);
    try {
      const res = await backofficeApi.updateAffiliateConfig(config);
      setConfig((res as any).data || config);
      toast.success('Affiliate program config saved');
    } catch {
      toast.error('Failed to save config');
    }
    setConfigBusy(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Affiliates</h1>
        <p className="text-sm text-gray-500 mt-1">
          Partner referral program — approve affiliates, manage rates, and attribute businesses.
        </p>
      </div>

      {/* Global config */}
      {config && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Settings2 className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Program settings</h2>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-500">
              Default commission rate (%)
              <input
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={config.defaultRate}
                onChange={(e) => setConfig({ ...config, defaultRate: Number(e.target.value) })}
                className="mt-1 block w-36 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-900"
              />
            </label>
            <label className="text-xs text-gray-500">
              Minimum payout (PKR)
              <input
                type="number"
                min={0}
                step="100"
                value={config.minPayout}
                onChange={(e) => setConfig({ ...config, minPayout: Number(e.target.value) })}
                className="mt-1 block w-36 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-900"
              />
            </label>
            <button
              onClick={saveConfig}
              disabled={configBusy}
              className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              Save settings
            </button>
          </div>
        </div>
      )}

      {/* Manual attribution */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Link2 className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Manual attribution</h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-500 flex-1 min-w-[9rem] sm:flex-none">
            Affiliate code
            <input
              value={attrCode}
              onChange={(e) => setAttrCode(e.target.value)}
              placeholder="e.g. AB3F9K2Q"
              className="mt-1 block w-full sm:w-44 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-900"
            />
          </label>
          <label className="text-xs text-gray-500 flex-1 min-w-[11rem] sm:flex-none">
            Business ID
            <input
              value={attrBusinessId}
              onChange={(e) => setAttrBusinessId(e.target.value)}
              placeholder="Business ID"
              className="mt-1 block w-full sm:w-64 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-900"
            />
          </label>
          <button
            onClick={attribute}
            disabled={attrBusy}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            Attribute business
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">A business can be attributed to only one affiliate, ever.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-auto">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name, email, code…"
            className="pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white w-full sm:w-64"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
        <span className="ml-auto text-sm text-gray-500">{total} affiliates</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading && affiliates.length === 0 ? (
          <div className="py-16 text-center text-gray-500 text-sm">Loading…</div>
        ) : affiliates.length === 0 ? (
          <div className="py-16 text-center text-gray-500">
            <Share2 className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">No affiliates found for the selected filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 font-medium">Affiliate</th>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Referrals</th>
                  <th className="px-4 py-3 font-medium text-right">Earned</th>
                  <th className="px-4 py-3 font-medium">Rate % (blank = default)</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {affiliates.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{a.user?.name || '—'}</p>
                      <p className="text-xs text-gray-500">{a.user?.email}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">{a.code}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_STYLES[a.status] || ''}`}>{a.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{a.referralsCount}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatRs(a.totalEarned)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.5"
                          placeholder={String(config?.defaultRate ?? 20)}
                          value={rateEdits[a.id] ?? (a.commissionRate ?? '')}
                          onChange={(e) => setRateEdits({ ...rateEdits, [a.id]: e.target.value })}
                          className="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
                        />
                        <button
                          onClick={() => saveRate(a)}
                          disabled={busyId === a.id}
                          className="px-2.5 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
                        >
                          Set
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(a.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {a.status !== 'ACTIVE' && (
                          <button
                            onClick={() => setStatus(a, 'ACTIVE')}
                            disabled={busyId === a.id}
                            className="px-2.5 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Activate
                          </button>
                        )}
                        {a.status === 'ACTIVE' && (
                          <button
                            onClick={() => setStatus(a, 'SUSPENDED')}
                            disabled={busyId === a.id}
                            className="px-2.5 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                          >
                            Suspend
                          </button>
                        )}
                        {a.status === 'SUSPENDED' && (
                          <button
                            onClick={() => setStatus(a, 'PENDING')}
                            disabled={busyId === a.id}
                            className="px-2.5 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
                          >
                            To pending
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
