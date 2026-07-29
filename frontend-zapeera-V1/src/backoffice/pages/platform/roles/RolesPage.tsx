import { useState, useEffect } from 'react';
import { Shield, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { backofficeApi } from '../../../services/api';
import { RoleModulePermission, Module } from '../../../types';
import { ModuleCheckboxGroup, HierarchyModule } from '../../../components/ModuleCheckboxGroup';

const ROLE_META: Record<string, { color: string; desc: string }> = {
  OWNER: { color: 'from-purple-500 to-purple-600', desc: 'Full business access — created the business' },
  MANAGER: { color: 'from-blue-500 to-blue-600', desc: 'Branch-scoped management' },
  CASHIER: { color: 'from-emerald-500 to-emerald-600', desc: 'POS and sales only' },
};

export function RolesPage() {
  const [rolePermissions, setRolePermissions] = useState<RoleModulePermission[]>([]);
  const [hierarchy, setHierarchy] = useState<HierarchyModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  const [moduleStates, setModuleStates] = useState<Record<string, Record<string, boolean>>>({});
  const [subModuleStates, setSubModuleStates] = useState<Record<string, Record<string, boolean>>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rolesRes, hierarchyRes] = await Promise.all([
        backofficeApi.getRoleModulePermissions(),
        backofficeApi.getModuleHierarchy(),
      ]);
      const rolesData = rolesRes.data || [];
      const hierarchyData = hierarchyRes.data || [];

      setRolePermissions(rolesData);
      setHierarchy(hierarchyData);

      const modStates: Record<string, Record<string, boolean>> = {};
      const subStates: Record<string, Record<string, boolean>> = {};

      for (const rp of rolesData) {
        modStates[rp.roleName] = {};
        subStates[rp.roleName] = {};

        for (const h of hierarchyData) {
          modStates[rp.roleName][h.module] = rp.modules.includes(h.module);

          const disabledSubs = new Set(rp.disabledSubModules || []);
          for (const sub of h.subModules) {
            if (sub.key === h.module) continue;
            const compositeKey = `${h.module}::${sub.key}`;
            subStates[rp.roleName][compositeKey] = !disabledSubs.has(compositeKey);
          }
        }
      }
      setModuleStates(modStates);
      setSubModuleStates(subStates);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const toggleModule = (roleName: string, moduleName: string) => {
    setModuleStates(prev => ({
      ...prev,
      [roleName]: { ...prev[roleName], [moduleName]: !prev[roleName]?.[moduleName] },
    }));
  };

  const toggleSubModule = (roleName: string, compositeKey: string) => {
    setSubModuleStates(prev => ({
      ...prev,
      [roleName]: { ...prev[roleName], [compositeKey]: !prev[roleName]?.[compositeKey] },
    }));
  };

  const toggleAllSubModules = (roleName: string, parentModule: string, enabled: boolean) => {
    const parent = hierarchy.find(h => h.module === parentModule);
    if (!parent) return;
    setSubModuleStates(prev => {
      const updated = { ...prev[roleName] || {} };
      for (const sub of parent.subModules) {
        if (sub.key === parentModule) continue;
        updated[`${parentModule}::${sub.key}`] = enabled;
      }
      return { ...prev, [roleName]: updated };
    });
  };

  const handleSaveModules = async (roleName: string) => {
    setSavingRole(roleName);
    setSaveSuccess(null);
    setSaveError(null);
    try {
      const states = moduleStates[roleName] || {};
      const enabledModules = Object.entries(states)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
      await backofficeApi.updateRoleModulePermissions(roleName, enabledModules);

      const subs = subModuleStates[roleName] || {};
      await backofficeApi.updateRoleSubModules(roleName, subs);

      setSaveSuccess(roleName);
      setTimeout(() => setSaveSuccess(null), 3000);
      fetchData();
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save');
      setTimeout(() => setSaveError(null), 5000);
    }
    setSavingRole(null);
  };

  const enabledCount = (roleName: string) => {
    const states = moduleStates[roleName] || {};
    return Object.values(states).filter(Boolean).length;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Role Management</h1>
          <p className="text-sm text-gray-500 mt-1">Configure role-based module access for business workspaces</p>
        </div>
        <button onClick={fetchData} className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="space-y-4">
        {Object.entries(ROLE_META).map(([role, meta]) => {
          const isExpanded = expandedRole === role;
          const states = moduleStates[role] || {};
          const subStates = subModuleStates[role] || {};
          const enabled = enabledCount(role);

          return (
            <div key={role} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between p-5">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 bg-gradient-to-br ${meta.color} rounded-xl flex items-center justify-center`}>
                    <Shield className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{role}</h3>
                    <p className="text-xs text-gray-400">{meta.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-500">
                    <span className="font-medium text-gray-900">{enabled}</span>/{hierarchy.length} modules
                  </div>
                  <button
                    onClick={() => setExpandedRole(isExpanded ? null : role)}
                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg"
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {isExpanded && hierarchy.length > 0 && (
                <div className="border-t border-gray-100 px-5 py-4">
                  <ModuleCheckboxGroup
                    hierarchy={hierarchy}
                    moduleStates={states}
                    subModuleStates={subStates}
                    onToggleModule={(mod) => toggleModule(role, mod)}
                    onToggleSubModule={(key) => toggleSubModule(role, key)}
                    onToggleAllSubModules={(parent, enabled) => toggleAllSubModules(role, parent, enabled)}
                    saving={savingRole === role}
                    saved={saveSuccess === role}
                    error={saveError}
                    onSave={() => handleSaveModules(role)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
