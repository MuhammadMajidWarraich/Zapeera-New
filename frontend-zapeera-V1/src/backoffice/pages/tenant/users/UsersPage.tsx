import { useState, useEffect } from 'react';
import { Search, Users, ToggleLeft, ToggleRight, CheckCircle, Mail, MailX } from 'lucide-react';
import { backofficeApi } from '../../../services/api';
import { User } from '../../../types';

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    backofficeApi.getUsers().then(res => setUsers(res.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleToggleStatus = async (userId: string, currentStatus: boolean) => {
    setActionId(userId);
    try {
      const res = await backofficeApi.toggleUserStatus(userId, !currentStatus);
      if (res.success && res.data) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, isActive: !currentStatus } : u));
      }
    } catch (err) {
      console.error('Failed to toggle user status:', err);
    } finally {
      setActionId(null);
    }
  };

  const handleVerifyEmail = async (userId: string) => {
    setActionId(userId);
    try {
      await backofficeApi.verifyUserEmail(userId);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, emailVerified: true } : u));
    } catch (err) {
      console.error('Failed to verify email:', err);
    } finally {
      setActionId(null);
    }
  };

  const handleResendVerification = async (userId: string) => {
    setActionId(userId);
    try {
      await backofficeApi.resendUserVerification(userId);
    } catch (err) {
      console.error('Failed to resend verification:', err);
    } finally {
      setActionId(null);
    }
  };

  const filtered = users.filter(u => {
    if (search && !u.name?.toLowerCase().includes(search.toLowerCase()) && !u.email?.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter === 'active' && !u.isActive) return false;
    if (statusFilter === 'inactive' && u.isActive) return false;
    return true;
  });

  if (loading) return <div className="space-y-4"><div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" /><div className="h-96 bg-gray-100 rounded-xl animate-pulse" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500 mt-1">{users.length} total users</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..." className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/50 outline-none w-64" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-1">No users found</h3>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">User</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Businesses</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Created</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(user => (
                <tr key={user.id} className="hover:bg-blue-50/30 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-gradient-to-br from-gray-500 to-gray-600 rounded-full flex items-center justify-center text-white text-xs font-bold">{user.name?.charAt(0) || '?'}</div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{user.name || user.username}</p>
                        <p className="text-xs text-gray-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-gray-600">{user.businessesCount || 0}</td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${user.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{user.isActive ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${user.emailVerified ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                      {user.emailVerified ? <CheckCircle className="w-3 h-3" /> : <MailX className="w-3 h-3" />}
                      {user.emailVerified ? 'Verified' : 'Unverified'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-gray-400">{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {!user.emailVerified && (
                        <>
                          <button
                            onClick={() => handleVerifyEmail(user.id)}
                            disabled={actionId === user.id}
                            title="Mark email as verified"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleResendVerification(user.id)}
                            disabled={actionId === user.id}
                            title="Resend verification email"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors disabled:opacity-50"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleToggleStatus(user.id, !!user.isActive)}
                        disabled={actionId === user.id}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          actionId === user.id
                            ? 'opacity-50 cursor-not-allowed bg-gray-100 text-gray-400'
                            : user.isActive
                              ? 'bg-red-50 text-red-600 hover:bg-red-100'
                              : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                        }`}
                      >
                        {user.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
