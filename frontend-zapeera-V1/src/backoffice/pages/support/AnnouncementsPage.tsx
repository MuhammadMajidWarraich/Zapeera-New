import { useState, useEffect, useCallback } from 'react';
import { Megaphone, Plus, Edit2, Trash2, X, Save, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { backofficeApi } from '../../services/api';
import type { Announcement } from '../../types';

// Status vocabulary follows the backend Announcement model:
// ACTIVE = visible to users, INACTIVE = hidden (draft), ARCHIVED = retired.
const STATUS_OPTIONS: Array<{ value: Announcement['status']; label: string }> = [
  { value: 'ACTIVE', label: 'Active (published)' },
  { value: 'INACTIVE', label: 'Inactive (draft)' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const TYPE_BADGES: Record<string, string> = { INFO: 'bg-blue-100 text-blue-700', WARNING: 'bg-amber-100 text-amber-700', MAINTENANCE: 'bg-purple-100 text-purple-700', UPDATE: 'bg-emerald-100 text-emerald-700' };
const STATUS_BADGES: Record<string, string> = { ACTIVE: 'bg-emerald-100 text-emerald-700', INACTIVE: 'bg-gray-100 text-gray-600', ARCHIVED: 'bg-slate-100 text-slate-500' };
const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Active', INACTIVE: 'Inactive', ARCHIVED: 'Archived' };

const emptyForm = { title: '', content: '', type: 'INFO' as Announcement['type'], status: 'INACTIVE' as Announcement['status'] };

export function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [deletingAnnouncement, setDeletingAnnouncement] = useState<Announcement | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backofficeApi.getAnnouncements();
      setItems(res.data || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load announcements');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.content.trim()) { toast.error('Content is required'); return; }
    setSaving(true);
    try {
      if (editing) {
        const res = await backofficeApi.updateAnnouncement(editing.id, form);
        setItems(prev => prev.map(a => a.id === editing.id ? res.data : a));
        toast.success('Announcement updated');
      } else {
        const res = await backofficeApi.createAnnouncement(form);
        setItems(prev => [res.data, ...prev]);
        toast.success('Announcement created');
      }
      setShowModal(false); setEditing(null); setForm(emptyForm);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save announcement');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingAnnouncement) return;
    try {
      await backofficeApi.deleteAnnouncement(deletingAnnouncement.id);
      setItems(prev => prev.filter(a => a.id !== deletingAnnouncement.id));
      toast.success('Announcement deleted');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete announcement');
    } finally {
      setDeletingAnnouncement(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Announcements</h1><p className="text-sm text-gray-500 mt-1">Create and manage platform announcements</p></div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition text-sm font-medium disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
          <button onClick={() => { setEditing(null); setForm(emptyForm); setShowModal(true); }} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium"><Plus className="w-4 h-4" /> New Announcement</button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center"><p className="text-sm text-gray-400">Loading announcements…</p></div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center"><Megaphone className="w-12 h-12 text-gray-300 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-600 mb-1">No announcements yet</h3><p className="text-sm text-gray-400">Create your first announcement to notify platform users</p></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Title</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Created</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {items.map(a => (
                <tr key={a.id} className="hover:bg-blue-50/30">
                  <td className="px-4 py-3.5 text-sm font-medium text-gray-900">{a.title}</td>
                  <td className="px-4 py-3.5"><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGES[a.type] || TYPE_BADGES.INFO}`}>{a.type}</span></td>
                  <td className="px-4 py-3.5"><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGES[a.status] || STATUS_BADGES.INACTIVE}`}>{STATUS_LABELS[a.status] || a.status}</span></td>
                  <td className="px-4 py-3.5 text-sm text-gray-400">{new Date(a.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => { setEditing(a); setForm({ title: a.title, content: a.content, type: a.type, status: a.status }); setShowModal(true); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => setDeletingAnnouncement(a)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">{editing ? 'Edit' : 'New'} Announcement</h2><button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button></div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Title</label><input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Content</label><textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} rows={4} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label><select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value as Announcement['type'] }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"><option value="INFO">Info</option><option value="WARNING">Warning</option><option value="MAINTENANCE">Maintenance</option><option value="UPDATE">Update</option></select></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Status</label><select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as Announcement['status'] }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm">{STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              </div>
              <button onClick={handleSave} disabled={saving} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50"><Save className="w-4 h-4" /> {saving ? 'Saving…' : editing ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!deletingAnnouncement}
        onClose={() => setDeletingAnnouncement(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Announcement"
        description="Are you sure you want to delete this announcement? This action cannot be undone."
        confirmText="Delete Announcement"
        cancelText="Cancel"
        variant="danger"
        itemName={deletingAnnouncement ? `Announcement: ${deletingAnnouncement.title}` : undefined}
        itemDetails="This will permanently remove the announcement."
        icon={<Trash2 className="w-4 h-4" />}
      />
    </div>
  );
}
