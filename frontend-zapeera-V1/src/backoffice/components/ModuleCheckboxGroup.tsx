import { useState } from 'react';
import { Check, AlertCircle, Loader2, Save, ChevronDown, ChevronRight } from 'lucide-react';

const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  sales: 'Sales',
  inventory: 'Inventory',
  purchases: 'Purchases',
  reports: 'Reports & Analytics',
  prescriptions: 'Prescriptions',
  business_management: 'Business Management',
  expenses: 'Expenses',
  subscription: 'Subscription',
};

export function formatModuleName(name: string) {
  return MODULE_LABELS[name] || name.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export interface HierarchyModule {
  module: string;
  label: string;
  icon: string;
  subModules: { key: string; label: string; module: string; icon: string }[];
}

interface ModuleCheckboxGroupProps {
  hierarchy: HierarchyModule[];
  moduleStates: Record<string, boolean>;
  subModuleStates: Record<string, boolean>;
  onToggleModule: (moduleName: string) => void;
  onToggleSubModule: (compositeKey: string) => void;
  onToggleAllSubModules: (moduleName: string, enabled: boolean) => void;
  saving?: boolean;
  saved?: boolean;
  error?: string | null;
  onSave: () => void;
}

export function ModuleCheckboxGroup({
  hierarchy,
  moduleStates,
  subModuleStates,
  onToggleModule,
  onToggleSubModule,
  onToggleAllSubModules,
  saving = false,
  saved = false,
  error = null,
  onSave,
}: ModuleCheckboxGroupProps) {
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

  const toggleExpand = (mod: string) => {
    setExpandedModules(prev => ({ ...prev, [mod]: !prev[mod] }));
  };

  const countEnabledSubs = (parentModule: string) => {
    const subs = hierarchy.find(h => h.module === parentModule)?.subModules || [];
    return subs.filter(s => subModuleStates[`${parentModule}::${s.key}`] !== false).length;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-700">Module Access</h4>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-sm text-green-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Saved</span>
          )}
          {error && (
            <span className="text-sm text-red-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> {error}</span>
          )}
          <button
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-xs font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save Changes
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {hierarchy.filter(h => h.module !== 'dashboard').map(parent => {
          const isEnabled = moduleStates[parent.module] || false;
          const isExpanded = expandedModules[parent.module] || false;
          const hasSubs = parent.subModules.length > 1 || (parent.subModules.length === 1 && parent.subModules[0].key !== parent.module);
          const enabledSubCount = countEnabledSubs(parent.module);
          const totalSubs = parent.subModules.filter(s => s.key !== parent.module).length;

          return (
            <div
              key={parent.module}
              className={`rounded-lg border transition ${
                isEnabled
                  ? 'border-green-200 bg-green-50/30'
                  : 'border-gray-200 bg-gray-50/30'
              }`}
            >
              {/* Parent module row */}
              <div className="flex items-center gap-3 px-3 py-2.5">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => onToggleModule(parent.module)}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                    isEnabled ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
                  }`}>
                    {isEnabled && <Check className="w-3 h-3 text-white" />}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900">{formatModuleName(parent.module)}</div>
                  {hasSubs && totalSubs > 0 && isEnabled && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      {enabledSubCount}/{totalSubs} sub-modules enabled
                    </div>
                  )}
                </div>
                {hasSubs && totalSubs > 0 && isEnabled && (
                  <button
                    onClick={() => toggleExpand(parent.module)}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                )}
              </div>

              {/* Sub-modules */}
              {isExpanded && hasSubs && totalSubs > 0 && isEnabled && (
                <div className="border-t border-gray-100 px-3 py-2 ml-4 space-y-1">
                  {/* Enable/Disable all sub-modules */}
                  <div className="flex items-center gap-2 pb-1.5 mb-1.5 border-b border-gray-100">
                    <button
                      onClick={() => onToggleAllSubModules(parent.module, true)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Enable All
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => onToggleAllSubModules(parent.module, false)}
                      className="text-xs text-gray-500 hover:text-gray-700 font-medium"
                    >
                      Disable All
                    </button>
                  </div>

                  {parent.subModules.filter(s => s.key !== parent.module).map(sub => {
                    const compositeKey = `${parent.module}::${sub.key}`;
                    const subEnabled = subModuleStates[compositeKey] !== false;

                    return (
                      <label
                        key={sub.key}
                        className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer transition ${
                          subEnabled
                            ? 'bg-blue-50/50 hover:bg-blue-50'
                            : 'bg-gray-50/50 hover:bg-gray-50'
                        }`}
                      >
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={subEnabled}
                            onChange={() => onToggleSubModule(compositeKey)}
                            className="sr-only"
                          />
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition ${
                            subEnabled ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
                          }`}>
                            {subEnabled && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                        </div>
                        <span className="text-xs text-gray-700">{sub.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
