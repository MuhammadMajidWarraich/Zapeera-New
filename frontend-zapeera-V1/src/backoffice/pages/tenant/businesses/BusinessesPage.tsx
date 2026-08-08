import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Building2, Plus, Filter, ChevronDown, MoreHorizontal, Eye, ToggleLeft, Trash2 } from 'lucide-react';
import { backofficeApi } from '../../../services/api';
import { Business, BackofficeRole } from '../../../types';
import { useBackofficeAuth } from '../../../auth/BackofficeAuthContext';
import ConfirmationModal from '@/components/ui/ConfirmationModal';

export function BusinessesPage() {
  const navigate = useNavigate();
  const { hasPermission } = useBackofficeAuth();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [deletingBusiness, setDeletingBusiness] = useState<Business | null>(null);

  useEffect(() => {
    fetchBusinesses();
  }, []);

  const fetchBusinesses = async () => {
    setLoading(true);
    try {
      const res = await backofficeApi.getBusinesses();
      setBusinesses(res.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleToggleStatus = async (id: string) => {
    try {
      await backofficeApi.toggleBusinessStatus(id);
      fetchBusinesses();
    } catch { /* ignore */ }
  };

  const handleDelete = async (business: Business) => {
    setDeletingBusiness(business);
  };

  const handleConfirmDelete = async () => {
    if (!deletingBusiness) return;
    try {
      await backofficeApi.deleteBusiness(deletingBusiness.id);
      fetchBusinesses();
    } catch { /* ignore */ }
    setDeletingBusiness(null);
  };

  const filtered = businesses.filter(b => {
    if (search && !b.name.toLowerCase().includes(search.toLowerCase()) && !b.email?.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter === 'active' && !b.isActive) return false;
    if (statusFilter === 'inactive' && b.isActive) return false;
    if (typeFilter !== 'all' && b.businessType !== typeFilter) return false;
    return true;
  });

  const types = [...new Set(businesses.map(b => b.businessType).filter(Boolean))];

  if (loading) return (
    <div className="space-y-4">
      <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
      <div className="h-96 bg-gray-100 rounded-xl animate-pulse" />
    </div>
  );

  return (
    <>
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Businesses</h1>
          <p className="text-sm text-gray-500 mt-1">{businesses.length} total businesses</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search businesses..." className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none w-64" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="all">All Types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-1">No businesses found</h3>
          <p className="text-sm text-gray-400">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Business</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Branches</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Members</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(biz => (
                <tr key={biz.id} className="hover:bg-blue-50/30 transition-colors cursor-pointer" onClick={() => navigate(`/backoffice/businesses/${biz.id}`)}>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                        {biz.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{biz.name}</p>
                        <p className="text-xs text-gray-400">{biz.email || 'No email'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-sm text-gray-600">{biz.businessType || '-'}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${biz.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {biz.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-gray-600">{biz._count?.branches || 0}</td>
                  <td className="px-4 py-3.5 text-sm text-gray-600">{biz._count?.memberships || 0}</td>
                  <td className="px-4 py-3.5 text-sm text-gray-400">{new Date(biz.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={e => { e.stopPropagation(); navigate(`/backoffice/businesses/${biz.id}`); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="View Details"><Eye className="w-4 h-4" /></button>
                      {hasPermission('business.update') && (
                        <button onClick={e => { e.stopPropagation(); handleToggleStatus(biz.id); }} className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition" title="Toggle Status"><ToggleLeft className="w-4 h-4" /></button>
                      )}
                      {hasPermission('business.delete') && (
                        <button onClick={e => { e.stopPropagation(); handleDelete(biz); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
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

  {/* Delete Confirmation Modal */}
  <ConfirmationModal
    isOpen={!!deletingBusiness}
    onClose={() => setDeletingBusiness(null)}
    onConfirm={handleConfirmDelete}
    title="Delete Business"
    description="Are you sure you want to delete this business? This action cannot be undone."
    confirmText="Delete Business"
    cancelText="Cancel"
    variant="danger"
    itemName={deletingBusiness ? `Business: ${deletingBusiness.name}` : undefined}
    itemDetails="This will permanently remove the business and all associated data."
    icon={<Trash2 className="w-4 h-4" />}
  />
    </>
  );
}
