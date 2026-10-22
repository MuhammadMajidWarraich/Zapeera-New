import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Ban, CheckCircle2, ArrowLeftRight, X, Inbox, Check } from 'lucide-react';
import { toast } from 'sonner';
import { backofficeApi } from '../../../services/api';
import { BackofficePartner, BackofficePartnerApplication, Business } from '../../../types';

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

  // Partner applications queue (2026-10-22): public marketing form +
  // in-app applications land here as PENDING; approve creates the
  // partner, reject records a reason the applicant sees in-app.
  const [applications, setApplications] = useState<BackofficePartnerApplication[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appFilter, setAppFilter] = useState<string>('PENDING');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<BackofficePartnerApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchApplications = useCallback(async (filter: string) => {
    setAppsLoading(true);
    try {
      const res = await backofficeApi.getPartnerApplications(filter || undefined);
      setApplications(res.data?.applications || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load partner applications');
    } finally {
      setAppsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApplications(appFilter);
  }, [fetchApplications, appFilter]);

  const approveApplication = async (a: BackofficePartnerApplication) => {
    setReviewingId(a.id);
    try {
      const res = await backofficeApi.approvePartnerApplication(a.id);
      if (res.data?.adminClaimPending) {
        toast.success(
          `Partner "${res.data.partner.name}" created — ${a.email} has no Zapeera account yet; they'll be claimed as admin when they sign up.`
        );
      } else {
        toast.success(`Partner "${res.data?.partner?.name || a.companyName}" created — portal is live for ${a.email}`);
      }
      fetchApplications(appFilter);
      fetchPartners();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to approve application');
    } finally {
      setReviewingId(null);
    }
  };

  const rejectApplication = async () => {
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 3) {
      toast.error('Give a short reason — the applicant sees it');
      return;
    }
    setReviewingId(rejectTarget.id);
    try {
      await backofficeApi.rejectPartnerApplication(rejectTarget.id, rejectReason.trim());
      toast.success('Application rejected');
      setRejectTarget(null);
      setRejectReason('');
      fetchApplications(appFilter);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to reject application');
    } finally {
      setReviewingId(null);
    }
  };

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
        <div className="flex flex-wrap gap-2">
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
        <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
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
                    {!p.admin && p.pendingAdminEmail && (
                      <div className="text-xs text-amber-600">
                        {p.pendingAdminEmail} — awaiting signup (claimed automatically)
                      </div>
                    )}
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
      </div>

      {/* Partner applications queue */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
              <Inbox className="h-5 w-5 text-blue-600" /> Partner Applications
              {appFilter === 'PENDING' && applications.length > 0 && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700">
                  {applications.length} pending
                </span>
              )}
            </h2>
            <p className="text-sm text-gray-500">
              Applications from the marketing site's Become-a-Partner form and from inside the app.
              Approving creates the partner; the applicant's account becomes its admin.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['PENDING', '', 'APPROVED', 'REJECTED'].map((f) => (
              <button
                key={f || 'ALL'}
                onClick={() => setAppFilter(f)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  appFilter === f
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {f || 'All'}
              </button>
            ))}
            <button
              onClick={() => fetchApplications(appFilter)}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Applied</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {appsLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">Loading…</td>
                  </tr>
                ) : applications.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                      No applications{appFilter ? ` with status ${appFilter}` : ''} yet. Applications
                      from the marketing site and the app will appear here.
                    </td>
                  </tr>
                ) : (
                  applications.map((a) => (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{a.companyName}</div>
                        {a.website && <div className="text-xs text-gray-500">{a.website}</div>}
                        {a.message && (
                          <div className="mt-0.5 max-w-[280px] truncate text-xs text-gray-400" title={a.message}>
                            “{a.message}”
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900">{a.contactName}</div>
                        <div className="text-xs text-gray-500">{a.email}</div>
                        <div className="text-xs text-gray-500">{a.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            a.source === 'APP' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'
                          }`}
                        >
                          {a.source === 'APP' ? 'In-app' : 'Website'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{new Date(a.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            a.status === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-700'
                              : a.status === 'REJECTED'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {a.status}
                        </span>
                        {a.status === 'APPROVED' && a.createdPartner && (
                          <div className="mt-0.5 font-mono text-xs text-gray-500">/join/{a.createdPartner.slug}</div>
                        )}
                        {a.status === 'REJECTED' && a.rejectionReason && (
                          <div className="mt-0.5 max-w-[200px] truncate text-xs text-gray-400" title={a.rejectionReason}>
                            {a.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {a.status === 'PENDING' && (
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => approveApplication(a)}
                              disabled={reviewingId === a.id}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                              <Check className="h-3.5 w-3.5" /> Approve
                            </button>
                            <button
                              onClick={() => {
                                setRejectTarget(a);
                                setRejectReason('');
                              }}
                              disabled={reviewingId === a.id}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                            >
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reject application modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Reject application</h2>
              <button onClick={() => setRejectTarget(null)} className="rounded-lg p-1 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-sm text-gray-600">
              <b>{rejectTarget.companyName}</b> ({rejectTarget.email}) will see this reason in the app
              and can apply again.
            </p>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Reason *</span>
              <textarea
                className={inputCls}
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. We are not onboarding partners in your region yet"
                maxLength={500}
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setRejectTarget(null)} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={rejectApplication}
                disabled={reviewingId === rejectTarget.id}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {reviewingId === rejectTarget.id ? 'Rejecting…' : 'Reject application'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
