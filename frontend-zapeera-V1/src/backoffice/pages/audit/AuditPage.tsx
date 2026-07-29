import { useState, useEffect } from 'react';
import { ScrollText, Search, Filter, Clock, User, Shield, Building2, Activity } from 'lucide-react';
import { backofficeApi } from '../../services/api';

export function AuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loginLogs, setLoginLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'actions' | 'logins'>('actions');
  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => { fetchLogs(); }, [activeTab]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      if (activeTab === 'actions') {
        const res = await backofficeApi.getAuditLogs('limit=100');
        setLogs(res.data || []);
      } else {
        const res = await backofficeApi.getLoginLogs();
        setLoginLogs(res.data || []);
      }
    } catch {}
    setLoading(false);
  };

  const actionTypes = [...new Set(logs.map(l => l.action))];

  const filteredLogs = logs.filter(l => {
    if (actionFilter !== 'all' && l.action !== actionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!l.admin?.email?.toLowerCase().includes(q) && !l.entityType?.toLowerCase().includes(q) && !l.action?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1><p className="text-sm text-gray-500 mt-1">Track all administrative actions on the platform</p></div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        <button onClick={() => setActiveTab('actions')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'actions' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Activity className="w-4 h-4" /> System Logs
        </button>
        <button onClick={() => setActiveTab('logins')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'logins' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Shield className="w-4 h-4" /> Auth Logs
        </button>
      </div>

      {activeTab === 'actions' && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search logs..." className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full outline-none focus:ring-2 focus:ring-blue-500/50" />
            </div>
            <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="all">All Actions</option>
              {actionTypes.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}</div>
          ) : filteredLogs.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center"><ScrollText className="w-12 h-12 text-gray-300 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-600">No audit logs found</h3></div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Admin</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Action</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Entity</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Entity ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Time</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredLogs.slice(0, 50).map(log => (
                    <tr key={log.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-sm"><div className="flex items-center gap-2"><div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-500">{(log.admin?.email || '?').charAt(0).toUpperCase()}</div><span className="text-gray-700">{log.admin?.email || 'Unknown'}</span></div></td>
                      <td className="px-4 py-3"><span className="px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded">{log.action}</span></td>
                      <td className="px-4 py-3 text-sm text-gray-600">{log.entityType}</td>
                      <td className="px-4 py-3 text-sm text-gray-400 font-mono text-xs max-w-[120px] truncate">{log.entityId || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-400">{new Date(log.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === 'logins' && (
        loading ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}</div>
        ) : loginLogs.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center"><Shield className="w-12 h-12 text-gray-300 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-600">No login logs found</h3></div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Admin</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">IP Address</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">User Agent</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Time</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {loginLogs.slice(0, 50).map(log => (
                  <tr key={log.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-sm text-gray-700">{log.admin?.email || 'Unknown'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">{log.ip || 'Unknown'}</td>
                    <td className="px-4 py-3 text-sm text-gray-400 max-w-[200px] truncate">{log.userAgent || 'Unknown'}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">{new Date(log.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
