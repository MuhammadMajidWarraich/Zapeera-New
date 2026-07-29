import { useState, useEffect } from 'react';
import { Users, Building2, Search, CheckCircle, Clock, XCircle } from 'lucide-react';
import { backofficeApi } from '../../../services/api';

export function MembershipsPage() {
  const [memberships, setMemberships] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([backofficeApi.getBusinesses()]).then(([bizRes]) => {
      const members: any[] = [];
      (bizRes.data || []).forEach((b: any) => {
        if (b._count?.memberships) {
          members.push({ businessId: b.id, businessName: b.name, count: b._count.memberships, status: b.isActive ? 'active' : 'inactive' });
        }
      });
      setMemberships(members);
    }).finally(() => setLoading(false));
  }, []);

  const filtered = memberships.filter(m => !search || m.businessName.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div className="space-y-4"><div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" /><div className="h-96 bg-gray-100 rounded-xl animate-pulse" /></div>;

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">Memberships</h1><p className="text-sm text-gray-500 mt-1">Business members across the platform</p></div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="flex items-center gap-3"><div className="p-2 bg-blue-50 rounded-lg"><Users className="w-5 h-5 text-blue-600" /></div><div><p className="text-2xl font-bold text-gray-900">{memberships.reduce((s, m) => s + m.count, 0)}</p><p className="text-xs text-gray-500">Total Memberships</p></div></div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="flex items-center gap-3"><div className="p-2 bg-emerald-50 rounded-lg"><CheckCircle className="w-5 h-5 text-emerald-600" /></div><div><p className="text-2xl font-bold text-gray-900">{memberships.filter(m => m.status === 'active').length}</p><p className="text-xs text-gray-500">Active Businesses</p></div></div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="flex items-center gap-3"><div className="p-2 bg-red-50 rounded-lg"><XCircle className="w-5 h-5 text-red-600" /></div><div><p className="text-2xl font-bold text-gray-900">{memberships.filter(m => m.status === 'inactive').length}</p><p className="text-xs text-gray-500">Inactive Businesses</p></div></div></div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by business name..." className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full max-w-md outline-none focus:ring-2 focus:ring-blue-500/50" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-gray-100 bg-gray-50/50"><th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Business</th><th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Members</th><th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(m => (
              <tr key={m.businessId} className="hover:bg-blue-50/30">
                <td className="px-4 py-3.5 text-sm font-medium text-gray-900">{m.businessName}</td>
                <td className="px-4 py-3.5 text-sm text-gray-600">{m.count}</td>
                <td className="px-4 py-3.5"><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${m.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{m.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
