import { useState, useEffect, useCallback } from 'react';
import { Flag, ToggleLeft, ToggleRight, RefreshCw, Plus, Trash2, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { backofficeApi } from '../../../services/api';
import type { FeatureFlag } from '../../../types';

export function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingFlag, setDeletingFlag] = useState<FeatureFlag | null>(null);
  const [form, setForm] = useState({ key: '', name: '', description: '', enabled: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backofficeApi.getFeatureFlags();
      setFlags(res.data || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load feature flags');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleFlag = async (flag: FeatureFlag) => {
    setTogglingId(flag.id);
    try {
      const res = await backofficeApi.updateFeatureFlag(flag.id, { enabled: !flag.enabled });
      setFlags(prev => prev.map(f => f.id === flag.id ? res.data : f));
      toast.success(`Feature "${flag.name}" ${res.data.enabled ? 'enabled' : 'disabled'}`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update feature flag');
    } finally {
      setTogglingId(null);
    }
  };

  const handleCreate = async () => {
    if (!form.key.trim() || !form.name.trim()) { toast.error('Key and name are required'); return; }
    setCreating(true);
    try {
      const res = await backofficeApi.createFeatureFlag({
        key: form.key.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        enabled: form.enabled,
      });
      setFlags(prev => [res.data, ...prev]);
      setShowCreate(false);
      setForm({ key: '', name: '', description: '', enabled: false });
      toast.success('Feature flag created');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create feature flag');
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingFlag) return;
    try {
      await backofficeApi.deleteFeatureFlag(deletingFlag.id);
      setFlags(prev => prev.filter(f => f.id !== deletingFlag.id));
      toast.success('Feature flag deleted');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete feature flag');
    } finally {
      setDeletingFlag(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Feature Flags</h1>
          <p className="text-sm text-gray-500 mt-1">Toggle platform features on and off. Changes are saved to the server immediately.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition text-sm font-medium disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium"><Plus className="w-4 h-4" /> New Flag</button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center"><p className="text-sm text-gray-400">Loading feature flags…</p></div>
      ) : flags.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center"><Flag className="w-12 h-12 text-gray-300 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-600 mb-1">No feature flags yet</h3><p className="text-sm text-gray-400">Create your first feature flag to control a platform feature</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {flags.map(flag => (
            <div key={flag.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`p-2 rounded-lg ${flag.enabled ? 'bg-emerald-50' : 'bg-gray-100'}`}>
                    <Flag className={`w-5 h-5 ${flag.enabled ? 'text-emerald-600' : 'text-gray-400'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 text-sm">{flag.name}</h3>
                    {flag.description && <p className="text-xs text-gray-500 mt-1">{flag.description}</p>}
                    <code className="inline-block mt-2 px-2 py-0.5 bg-gray-50 text-gray-500 text-[10px] font-mono rounded">{flag.key}</code>
                  </div>
                </div>
                <button
                  onClick={() => toggleFlag(flag)}
                  disabled={togglingId === flag.id}
                  className={`ml-4 p-0.5 rounded-lg transition-colors disabled:opacity-50 ${flag.enabled ? 'bg-emerald-100' : 'bg-gray-200'}`}
                >
                  {flag.enabled
                    ? <ToggleRight className="w-10 h-6 text-emerald-600" />
                    : <ToggleLeft className="w-10 h-6 text-gray-400" />}
                </button>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${flag.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {flag.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <button onClick={() => setDeletingFlag(flag)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">New Feature Flag</h2><button onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button></div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Key</label><input value={form.key} onChange={e => setForm(p => ({ ...p, key: e.target.value }))} placeholder="e.g. new_checkout" className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Name</label><input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. New Checkout Flow" className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.enabled} onChange={e => setForm(p => ({ ...p, enabled: e.target.checked }))} className="rounded" /> Enabled immediately</label>
              <button onClick={handleCreate} disabled={creating} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50"><Save className="w-4 h-4" /> {creating ? 'Creating…' : 'Create Flag'}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deletingFlag}
        onClose={() => setDeletingFlag(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Feature Flag"
        description="Are you sure you want to delete this feature flag? This action cannot be undone."
        confirmText="Delete Flag"
        cancelText="Cancel"
        variant="danger"
        itemName={deletingFlag ? `Flag: ${deletingFlag.key}` : undefined}
        icon={<Trash2 className="w-4 h-4" />}
      />
    </div>
  );
}
