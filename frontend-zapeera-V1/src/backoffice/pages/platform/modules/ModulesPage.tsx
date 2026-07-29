import { useState, useEffect } from 'react';
import { Puzzle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { backofficeApi } from '../../../services/api';
import { Module } from '../../../types';

export function ModulesPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchModules(); }, []);

  const fetchModules = async () => {
    setLoading(true);
    try {
      const [modRes, permRes] = await Promise.all([
        backofficeApi.getModules(),
        backofficeApi.getPermissionMatrix(),
      ]);
      setModules(modRes.data || []);
    } catch {}
    setLoading(false);
  };

  if (loading) return <div className="space-y-4"><div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" /><div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[...Array(6)].map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />)}</div></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Modules</h1><p className="text-sm text-gray-500 mt-1">{modules.length} platform modules configured</p></div>
        <button onClick={fetchModules} className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map(mod => (
          <div key={mod.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div className="p-2 bg-indigo-50 rounded-lg"><Puzzle className="w-5 h-5 text-indigo-600" /></div>
              {mod.isCore && <span className="px-2 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700 rounded-full">Core</span>}
            </div>
            <h3 className="font-semibold text-gray-900 mb-1">{mod.name}</h3>
            <p className="text-xs text-gray-400 mb-2">Key: {mod.key}</p>
            <p className="text-sm text-gray-500 mb-3">{mod.description || 'No description'}</p>
            <div className="flex items-center gap-3 text-xs">
              <span className={`flex items-center gap-1 ${mod.isActive ? 'text-emerald-600' : 'text-red-600'}`}>
                {mod.isActive ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {mod.isActive ? 'Active' : 'Inactive'}
              </span>
              <span className="text-gray-400">Sort: {mod.sortOrder}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
