import { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, Edit2, Trash2, X, Save, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { backofficeApi } from '../../services/api';
import type { ContentPage as ContentPageItem } from '../../types';

// Minimal CMS over the backend ContentPage model. Pages are served publicly
// at GET /api/content/:slug only while PUBLISHED; drafts stay invisible.
const STATUS_BADGES: Record<string, string> = {
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  DRAFT: 'bg-gray-100 text-gray-600',
};

const emptyForm = { slug: '', title: '', body: '', status: 'DRAFT' as ContentPageItem['status'] };

export function ContentPage() {
  const [items, setItems] = useState<ContentPageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ContentPageItem | null>(null);
  const [deleting, setDeleting] = useState<ContentPageItem | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'all' ? `status=${statusFilter}` : undefined;
      const res = await backofficeApi.getContentPages(params);
      setItems(res.data || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load content pages');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (item: ContentPageItem) => {
    setEditing(item);
    setForm({ slug: item.slug, title: item.title, body: item.body, status: item.status });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.slug.trim()) { toast.error('Slug is required'); return; }
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.body.trim()) { toast.error('Body is required'); return; }
    setSaving(true);
    try {
      if (editing) {
        const res = await backofficeApi.updateContentPage(editing.id, form);
        setItems(prev => prev.map(p => p.id === editing.id ? res.data : p));
        toast.success('Content page updated');
      } else {
        const res = await backofficeApi.createContentPage(form);
        setItems(prev => [res.data, ...prev]);
        toast.success('Content page created');
      }
      setShowModal(false);
      setEditing(null);
      setForm(emptyForm);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save content page');
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (item: ContentPageItem) => {
    const next = item.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    try {
      const res = await backofficeApi.updateContentPage(item.id, { status: next });
      setItems(prev => prev.map(p => p.id === item.id ? res.data : p));
      toast.success(next === 'PUBLISHED' ? `Published — live at /api/content/${item.slug}` : 'Moved back to draft');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update status');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleting) return;
    try {
      await backofficeApi.deleteContentPage(deleting.id);
      setItems(prev => prev.filter(p => p.id !== deleting.id));
      toast.success('Content page deleted');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete content page');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Content Management</h1><p className="text-sm text-gray-500 mt-1">Manage platform pages (legal, help, landing copy) served at /api/content/:slug</p></div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium"><Plus className="w-4 h-4" /> New Page</button>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[
          { id: 'all', label: 'All Pages' },
          { id: 'PUBLISHED', label: 'Published' },
          { id: 'DRAFT', label: 'Drafts' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setStatusFilter(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${statusFilter === tab.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-gray-300" /> Loading pages…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-1">No content pages yet</h3>
          <p className="text-sm text-gray-400">Create a page and publish it to serve it publicly at /api/content/:slug</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
                  /{item.slug} · Updated {new Date(item.updatedAt).toLocaleString()}
                  {item.status === 'PUBLISHED' && <ExternalLink className="w-3.5 h-3.5" />}
                </p>
              </div>
              <button
                onClick={() => togglePublish(item)}
                title={item.status === 'PUBLISHED' ? 'Click to unpublish' : 'Click to publish'}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold hover:opacity-80 ${STATUS_BADGES[item.status]}`}
              >
                {item.status}
              </button>
              <button onClick={() => openEdit(item)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Edit">
                <Edit2 className="w-4 h-4" />
              </button>
              <button onClick={() => setDeleting(item)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">{editing ? 'Edit Page' : 'New Page'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Title</label>
                  <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Privacy Policy" className="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as ContentPageItem['status'] })} className="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/50">
                    <option value="DRAFT">Draft</option>
                    <option value="PUBLISHED">Published</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Slug</label>
                <input type="text" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="privacy-policy" className="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50" />
                <p className="mt-1 text-xs text-gray-400">Lowercase letters, numbers and hyphens. Published pages are served at /api/content/&lt;slug&gt;.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Body</label>
                <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={10} placeholder="Page content (plain text or HTML)…" className="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setShowModal(false)} className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <ConfirmationModal
          isOpen={!!deleting}
          onClose={() => setDeleting(null)}
          onConfirm={handleConfirmDelete}
          title="Delete content page"
          description={`Delete "${deleting.title}" (/${deleting.slug})? If it is published, its public URL will stop working immediately.`}
          confirmText="Delete"
          variant="danger"
        />
      )}
    </div>
  );
}
