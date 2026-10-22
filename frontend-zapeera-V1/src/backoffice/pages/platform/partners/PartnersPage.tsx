import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Ban, CheckCircle2, ArrowLeftRight, X } from 'lucide-react';
import { toast } from 'sonner';
import { backofficeApi } from '../../../services/api';
import { BackofficePartner, Business } from '../../../types';

// ─── White-label partners (Feature 3) ─────────────────────────────────
// Platform-admin management of reseller partners: create + designate
// the admin by email (the account must already exist), suspend /
// reactivate, and reassign a business's partner attribution — the only
// way attribution changes after a business is created.

export function PartnersPage() {
  const [partners, setPartners] = useState<BackofficePartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', adminEmail: '', slug: '', supportEmail: '', tagline: '', primaryColor: '' });

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [reassign, setReassign] = useState<{ businessId: string; partnerId: string } | null>(null);
  const [reassigning, setReassigning] = useState(false);

  const fetchPartners = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backofficeApi.getPartners();
      setPartners(res.data || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load partners');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPartners();
  }, [fetchPartners]);

  const create = async () => {
    if (!form.name.trim() || !form.adminEmail.trim()) {
      toast.error('Partner name and admin email are required');
      return;
    }
    setCreating(true);
    try {
      await backofficeApi.createPartner({
        name: form.name.trim(),
        adminEmail: form.adminEmail.trim(),
        slug: form.slug.trim() || undefined,
        supportEmail: form.supportEmail.trim() || undefined,
        tagline: form.tagline.trim() || undefined,
        primaryColor: form.primaryColor.trim() || undefined,
      });
      toast.success('Partner created');
      setShowCreate(false);
      setForm({ name: '', adminEmail: '', slug: '', supportEmail: '', tagline: '', primaryColor: '' });
      fetchPartners();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create partner');
    } finally {
      setCreating(false);
    }
  };

  const toggleStatus = async (p: BackofficePartner) => {
    const next = p.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await backofficeApi.updatePartner(p.id, { status: next });
      toast.success(`Partner ${next === 'ACTIVE' ? 'reactivated' : 'suspended'}`);
      fetchPartners();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update partner');
    }
  };

  const openReassign = async () => {
    try {
      const res = await backofficeApi.getBusinesses();
      setBusinesses(res.data || []);
      setReassign({ businessId: '', partnerId: '' });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load businesses');
    }
  };

  const saveReassign = async () => {
    if (!reassign?.businessId) {
      toast.error('Pick a business first');
      return;
    }
    setReassigning(true);
    try {
      await backofficeApi.reassignBusinessPartner(
        reassign.businessId,
        reassign.partnerId ? reassign.partnerId : null,
      );
      toast.success('Business partner updated');
      setReassign(null);
      fetchPartners();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to reassign business');
    } finally {
      setReassigning(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">White-Label Partners</h1>
          <p className="text-sm text-gray-500">
            Resellers who sell Zapeera under their own branding. Attribution is set at signup and
            only changes here.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openReassign}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium hover:bg-gray-50"
          >
            <ArrowLeftRight className="h-4 w-4" /> Reassign business
          </button>
          <button
            onClick={fetchPartners}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> New partner
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Partner</th>
              <th className="px-4 py-3">Slug / join link</th>
              <th className="px-4 py-3">Admin</th>
              <th className="px-4 py-3">Businesses</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">Loading…</td>
              </tr>
            ) : partners.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  No partners yet. Create the first one — the admin email must belong to an existing
                  Zapeera user account.
                </td>
              </tr>
            ) : (
              partners.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {p.logoUrl ? (
                        <img src={p.logoUrl} alt={p.name} className="h-8 w-8 rounded-lg object-contain bg-white border" />
                      ) : (
                        <span
                          className="grid h-8 w-8 place-items-center rounded-lg text-sm font-bold text-white"
                          style={{ background: p.primaryColor || '#1a52c5' }}
                        >
                          {p.name.charAt(0)}
                        </span>
                      )}
                      <span className="font-medium text-gray-900">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">/join/{p.slug}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900">{p.admin?.name || '—'}</div>
                    <div className="text-xs text-gray-500">{p.admin?.email || ''}</div>
                  </td>
                  <td className="px-4 py-3">{p.businessCount ?? 0}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        p.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleStatus(p)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                        p.status === 'ACTIVE'
                          ? 'border-red-200 text-red-600 hover:bg-red-50'
                          : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                      }`}
                    >
                      {p.status === 'ACTIVE' ? (
                        <>
                          <Ban className="h-3.5 w-3.5" /> Suspend
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Activate
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create partner modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">New partner</h2>
              <button onClick={() => setShowCreate(false)} className="rounded-lg p-1 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Partner / brand name *</span>
                <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme POS" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Admin user email * (must already have a Zapeera account)</span>
                <input className={inputCls} value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} placeholder="admin@acme.com" type="email" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Slug (optional — derived from the name)</span>
                <input className={inputCls} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="acme-pos" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-gray-500">Support email</span>
                  <input className={inputCls} value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} placeholder="support@acme.com" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-500">Primary color</span>
                  <input className={inputCls} value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} placeholder="#1F7C47" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Tagline</span>
                <input className={inputCls} value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="Shown on the sign-in page" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={create}
                disabled={creating}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {creating ? 'Creating…' : 'Create partner'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reassign business modal */}
      {reassign && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Reassign a business's partner</h2>
              <button onClick={() => setReassign(null)} className="rounded-lg p-1 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Business</span>
                <select
                  className={inputCls}
                  value={reassign.businessId}
                  onChange={(e) => setReassign({ ...reassign, businessId: e.target.value })}
                >
                  <option value="">Select a business…</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Partner</span>
                <select
                  className={inputCls}
                  value={reassign.partnerId}
                  onChange={(e) => setReassign({ ...reassign, partnerId: e.target.value })}
                >
                  <option value="">No partner (direct Zapeera)</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.slug})
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-gray-500">
                This is the only way attribution changes after a business is created.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setReassign(null)} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={saveReassign}
                disabled={reassigning}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {reassigning ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
