import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, FileStack, ChevronDown, ChevronRight } from 'lucide-react';
import { backofficeApi } from '../../../services/api';
import { BusinessType, Module } from '../../../types';
import { ModuleCheckboxGroup, HierarchyModule } from '../../../components/ModuleCheckboxGroup';

export function BusinessTypesPage() {
  const [types, setTypes] = useState<BusinessType[]>([]);
  const [hierarchy, setHierarchy] = useState<HierarchyModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BusinessType | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [moduleStates, setModuleStates] = useState<Record<string, Record<string, boolean>>>({});
  const [subModuleStates, setSubModuleStates] = useState<Record<string, Record<string, boolean>>>({});
  const [savingType, setSavingType] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [typesRes, hierarchyRes] = await Promise.all([
        backofficeApi.getBusinessTypes(),
        backofficeApi.getModuleHierarchy(),
      ]);
      const typesData = typesRes.data || [];
      const hierarchyData = hierarchyRes.data || [];
      setTypes(typesData);
      setHierarchy(hierarchyData);

      const modStates: Record<string, Record<string, boolean>> = {};
      const subStates: Record<string, Record<string, boolean>> = {};

      for (const t of typesData) {
        modStates[t.id] = {};
        subStates[t.id] = {};

        for (const h of hierarchyData) {
          // Parent module enabled state from the type's modules array
          const btMod = t.modules?.find(m => m.name === h.module || m.key === h.module);
          modStates[t.id][h.module] = btMod ? btMod.enabled : false;

          // Sub-module states: disabledSubModules is an array of composite keys like "sales::refunds"
          const disabledSubs = new Set((t as any).disabledSubModules || []);
          for (const sub of h.subModules) {
            if (sub.key === h.module) continue; // skip the "self" sub-module entry
            const compositeKey = `${h.module}::${sub.key}`;
            // Default: enabled (true). Disabled only if explicitly in disabledSubModules list.
            subStates[t.id][compositeKey] = !disabledSubs.has(compositeKey);
          }
        }
      }
      setModuleStates(modStates);
      setSubModuleStates(subStates);
    } catch {}
    setLoading(false);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        await backofficeApi.updateBusinessType(editing.id, form);
      } else {
        await backofficeApi.createBusinessType(form);
      }
      setShowModal(false);
      setEditing(null);
      setForm({ name: '', description: '' });
      fetchData();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this business type?')) return;
    try {
      await backofficeApi.deleteBusinessType(id);
      fetchData();
    } catch {}
  };

  const toggleModule = (typeId: string, moduleName: string) => {
    setModuleStates(prev => ({
      ...prev,
      [typeId]: { ...prev[typeId], [moduleName]: !prev[typeId]?.[moduleName] },
    }));
  };

  const toggleSubModule = (typeId: string, compositeKey: string) => {
    setSubModuleStates(prev => ({
      ...prev,
      [typeId]: { ...prev[typeId], [compositeKey]: !prev[typeId]?.[compositeKey] },
    }));
  };

  const toggleAllSubModules = (typeId: string, parentModule: string, enabled: boolean) => {
    const parent = hierarchy.find(h => h.module === parentModule);
    if (!parent) return;
    setSubModuleStates(prev => {
      const updated = { ...prev[typeId] || {} };
      for (const sub of parent.subModules) {
        if (sub.key === parentModule) continue;
        updated[`${parentModule}::${sub.key}`] = enabled;
      }
      return { ...prev, [typeId]: updated };
    });
  };

  const handleSaveModules = async (typeId: string) => {
    setSavingType(typeId);
    setSaveSuccess(null);
    setSaveError(null);
    try {
      const states = moduleStates[typeId] || {};
      const enabledKeys = Object.entries(states)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
      await backofficeApi.updateBusinessTypeModules(typeId, enabledKeys);

      // Save sub-module states
      const subs = subModuleStates[typeId] || {};
      await backofficeApi.updateBusinessTypeSubModules(typeId, subs);

      setSaveSuccess(typeId);
      setTimeout(() => setSaveSuccess(null), 3000);
      fetchData();
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save');
      setTimeout(() => setSaveError(null), 5000);
    }
    setSavingType(null);
  };

  const enabledCount = (typeId: string) => {
    const states = moduleStates[typeId] || {};
    return Object.values(states).filter(Boolean).length;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business Types</h1>
          <p className="text-sm text-gray-500 mt-1">Configure business types and the modules available to each</p>
        </div>
        <button
          onClick={() => { setEditing(null); setForm({ name: '', description: '' }); setShowModal(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New Business Type
        </button>
      </div>

      <div className="space-y-4">
        {types.map(t => {
          const isExpanded = expandedType === t.id;
          const states = moduleStates[t.id] || {};
          const subStates = subModuleStates[t.id] || {};
          const enabled = enabledCount(t.id);

          return (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between p-5">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <FileStack className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{t.name}</h3>
                    <p className="text-sm text-gray-500">{t.description || 'No description'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-500">
                    <span className="font-medium text-gray-900">{enabled}</span>/{hierarchy.length} modules
                    {t.businessCount !== undefined && <span className="ml-2 text-gray-400">&middot; {t.businessCount} businesses</span>}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setEditing(t); setForm({ name: t.name, description: t.description || '' }); setShowModal(true); }}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setExpandedType(isExpanded ? null : t.id)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg"
                    >
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {isExpanded && hierarchy.length > 0 && (
                <div className="border-t border-gray-100 px-5 py-4">
                  <ModuleCheckboxGroup
                    hierarchy={hierarchy}
                    moduleStates={states}
                    subModuleStates={subStates}
                    onToggleModule={(mod) => toggleModule(t.id, mod)}
                    onToggleSubModule={(key) => toggleSubModule(t.id, key)}
                    onToggleAllSubModules={(parent, enabled) => toggleAllSubModules(t.id, parent, enabled)}
                    saving={savingType === t.id}
                    saved={saveSuccess === t.id}
                    error={saveError}
                    onSave={() => handleSaveModules(t.id)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">{editing ? 'Edit' : 'New'} Business Type</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  disabled={!!editing}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50 disabled:bg-gray-50 disabled:text-gray-500"
                />
                {editing && <p className="text-xs text-gray-400 mt-1">Name cannot be changed after creation</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <button
                onClick={handleSave}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium"
              >
                <Save className="w-4 h-4" /> {editing ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
