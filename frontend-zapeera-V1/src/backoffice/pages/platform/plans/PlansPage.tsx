import { useState, useEffect } from 'react';
import { Plus, Edit3, Trash2, CreditCard, Crown, Users, CheckCircle, X, RefreshCw, DollarSign, ChevronDown, ChevronRight, Package } from 'lucide-react';
import { toast } from 'sonner';
import { backofficeApi } from '../../../services/api';
import { Plan, Subscription, PlanModulePermission, Module } from '../../../types';
import { ModuleCheckboxGroup, HierarchyModule, formatModuleName } from '../../../components/ModuleCheckboxGroup';
import ConfirmationModal from '@/components/ui/ConfirmationModal';

export function PlansPage() {
  const [activeTab, setActiveTab] = useState<'plans' | 'subscriptions'>('plans');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [planPermissions, setPlanPermissions] = useState<PlanModulePermission[]>([]);
  const [hierarchy, setHierarchy] = useState<HierarchyModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [planForm, setPlanForm] = useState({ name: '', subtitle: '', price: 0, interval: 'monthly', badge: '', features: '', maxStaffMembers: 0, maxBranches: 0, isActive: true });
  const [deletingPlan, setDeletingPlan] = useState<Plan | null>(null);

  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [moduleStates, setModuleStates] = useState<Record<string, Record<string, boolean>>>({});
  const [subModuleStates, setSubModuleStates] = useState<Record<string, Record<string, boolean>>>({});
  const [savingPlan, setSavingPlan] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'plans') {
        const [plansRes, permsRes, hierarchyRes] = await Promise.all([
          backofficeApi.getPlans(),
          backofficeApi.getPlanModulePermissions(),
          backofficeApi.getModuleHierarchy(),
        ]);
        const plansData = plansRes.data || [];
        const permsData = permsRes.data || [];
        const hierarchyData = hierarchyRes.data || [];

        setPlans(plansData);
        setPlanPermissions(permsData);
        setHierarchy(hierarchyData);

        const modStates: Record<string, Record<string, boolean>> = {};
        const subStates: Record<string, Record<string, boolean>> = {};

        for (const perm of permsData) {
          modStates[perm.planId] = {};
          subStates[perm.planId] = {};

          for (const h of hierarchyData) {
            modStates[perm.planId][h.module] = perm.modules.includes(h.module);

            const disabledSubs = new Set(perm.disabledSubModules || []);
            for (const sub of h.subModules) {
              if (sub.key === h.module) continue;
              const compositeKey = `${h.module}::${sub.key}`;
              subStates[perm.planId][compositeKey] = !disabledSubs.has(compositeKey);
            }
          }
        }
        setModuleStates(modStates);
        setSubModuleStates(subStates);
      } else {
        const res = await backofficeApi.getSubscriptions();
        setSubscriptions(res.data || []);
      }
    } catch { toast.error('Failed to load data'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [activeTab]);

  const openCreateModal = () => {
    setEditingPlan(null);
    setPlanForm({ name: '', subtitle: '', price: 0, interval: 'monthly', badge: '', features: '', maxStaffMembers: 0, maxBranches: 0, isActive: true });
    setShowModal(true);
  };

  const openEditModal = (plan: Plan) => {
    setEditingPlan(plan);
    setPlanForm({
      name: plan.name,
      subtitle: plan.subtitle || '',
      price: plan.price,
      interval: plan.interval || 'monthly',
      badge: plan.badge || '',
      features: plan.features || '',
      maxStaffMembers: plan.maxStaffMembers || 0,
      maxBranches: plan.maxBranches || 0,
      isActive: plan.isActive,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    try {
      if (editingPlan) {
        await backofficeApi.updatePlan(editingPlan.id, planForm);
        toast.success('Plan updated');
      } else {
        await backofficeApi.createPlan(planForm);
        toast.success('Plan created');
      }
      setShowModal(false);
      fetchData();
    } catch { toast.error('Failed to save plan'); }
  };

  const handleDelete = (plan: Plan) => {
    setDeletingPlan(plan);
  };

  const handleConfirmDelete = async () => {
    if (!deletingPlan) return;
    try {
      await backofficeApi.deletePlan(deletingPlan.id);
      toast.success('Plan deleted');
      fetchData();
    } catch { toast.error('Failed to delete plan'); }
    setDeletingPlan(null);
  };

  const toggleModule = (planId: string, moduleName: string) => {
    setModuleStates(prev => ({
      ...prev,
      [planId]: { ...prev[planId], [moduleName]: !prev[planId]?.[moduleName] },
    }));
  };

  const toggleSubModule = (planId: string, compositeKey: string) => {
    setSubModuleStates(prev => ({
      ...prev,
      [planId]: { ...prev[planId], [compositeKey]: !prev[planId]?.[compositeKey] },
    }));
  };

  const toggleAllSubModules = (planId: string, parentModule: string, enabled: boolean) => {
    const parent = hierarchy.find(h => h.module === parentModule);
    if (!parent) return;
    setSubModuleStates(prev => {
      const updated = { ...prev[planId] || {} };
      for (const sub of parent.subModules) {
        if (sub.key === parentModule) continue;
        updated[`${parentModule}::${sub.key}`] = enabled;
      }
      return { ...prev, [planId]: updated };
    });
  };

  const handleSaveModules = async (planId: string) => {
    setSavingPlan(planId);
    setSaveSuccess(null);
    setSaveError(null);
    try {
      const states = moduleStates[planId] || {};
      const subs = subModuleStates[planId] || {};

      // Atomic plan policy: only enabled modules are entitled (absent = deny);
      // page entries override the module level (FULL/NONE).
      const modules = Object.entries(states)
        .filter(([, enabled]) => enabled)
        .map(([moduleName]) => ({
          key: moduleName,
          entitlementLevel: 'FULL' as const,
          pages: Object.entries(subs)
            .filter(([composite]) => composite.startsWith(`${moduleName}::`))
            .map(([composite, enabled]) => ({
              key: composite.split('::')[1],
              entitlementLevel: enabled ? 'FULL' as const : 'NONE' as const,
            })),
        }));

      await backofficeApi.publishPlanPolicy(planId, modules);

      setSaveSuccess(planId);
      setTimeout(() => setSaveSuccess(null), 3000);
      fetchData();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
      setTimeout(() => setSaveError(null), 5000);
    }
    setSavingPlan(null);
  };

  const enabledCount = (planId: string) => {
    const states = moduleStates[planId] || {};
    return Object.values(states).filter(Boolean).length;
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = { ACTIVE: 'bg-emerald-100 text-emerald-700', TRIAL: 'bg-blue-100 text-blue-700', GRACE: 'bg-amber-100 text-amber-700', EXPIRED: 'bg-red-100 text-red-700', CANCELLED: 'bg-gray-100 text-gray-700', SUSPENDED: 'bg-rose-100 text-rose-700' };
    return <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-52 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  const displayPlans = activeTab === 'plans' ? (plans.length > 0 ? plans : planPermissions.map(p => ({ id: p.planId, name: p.planName, price: p.price, isActive: true } as Plan))) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subscription Plans</h1>
          <p className="text-sm text-gray-500 mt-1">Manage plans, subscriptions, and module access per plan</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchData} className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
          {activeTab === 'plans' && (
            <button onClick={openCreateModal} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
              <Plus className="w-4 h-4" /> New Plan
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          <button onClick={() => setActiveTab('plans')} className={`pb-3 text-sm font-medium border-b-2 transition ${activeTab === 'plans' ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
            <Package className="w-4 h-4 inline mr-1.5" />Plans
          </button>
          <button onClick={() => setActiveTab('subscriptions')} className={`pb-3 text-sm font-medium border-b-2 transition ${activeTab === 'subscriptions' ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
            <CreditCard className="w-4 h-4 inline mr-1.5" />Subscriptions
          </button>
        </div>
      </div>

      {activeTab === 'plans' ? (
        <>
          {displayPlans.length === 0 ? (
            <div className="text-center py-20">
              <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 font-medium">No plans yet</p>
              <p className="text-sm text-gray-400 mt-1">Create your first subscription plan</p>
              <button onClick={openCreateModal} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"><Plus className="w-4 h-4" /> Create Plan</button>
            </div>
          ) : (
            <div className="space-y-4">
              {displayPlans.map(plan => {
                const isExpanded = expandedPlan === plan.id;
                const states = moduleStates[plan.id] || {};
                const subStates = subModuleStates[plan.id] || {};
                const enabled = enabledCount(plan.id);

                return (
                  <div key={plan.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
                    <div className="flex items-center justify-between p-5">
                      <div className="flex items-center gap-4">
                        <div className="p-2.5 bg-blue-50 rounded-xl">
                          <Crown className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-gray-900">{plan.name}</h3>
                            {plan.badge && <span className="px-2 py-0.5 text-xs font-semibold bg-gradient-to-r from-amber-400 to-amber-500 text-white rounded-full">{plan.badge}</span>}
                            {plan.isActive !== undefined && (
                              <span className={`inline-flex items-center gap-1 text-xs font-medium ${plan.isActive ? 'text-emerald-600' : 'text-red-500'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${plan.isActive ? 'bg-emerald-500' : 'bg-red-400'}`} />
                                {plan.isActive ? 'Active' : 'Inactive'}
                              </span>
                            )}
                          </div>
                          {plan.subtitle && <p className="text-sm text-gray-400">{plan.subtitle}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-lg font-bold text-gray-900">PKR {plan.price.toLocaleString()}</div>
                          <div className="text-xs text-gray-400">/{plan.interval || 'month'}</div>
                        </div>
                        <div className="text-sm text-gray-500 text-center min-w-[60px]">
                          <span className="font-medium text-gray-900">{enabled}</span>/{hierarchy.length}
                          <div className="text-xs text-gray-400">modules</div>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => openEditModal(plan)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(plan)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setExpandedPlan(isExpanded ? null : plan.id)}
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
                          onToggleModule={(mod) => toggleModule(plan.id, mod)}
                          onToggleSubModule={(key) => toggleSubModule(plan.id, key)}
                          onToggleAllSubModules={(parent, enabled) => toggleAllSubModules(plan.id, parent, enabled)}
                          saving={savingPlan === plan.id}
                          saved={saveSuccess === plan.id}
                          error={saveError}
                          onSave={() => handleSaveModules(plan.id)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          {subscriptions.length === 0 ? (
            <div className="text-center py-20">
              <CreditCard className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 font-medium">No subscriptions</p>
              <p className="text-sm text-gray-400 mt-1">No active subscriptions found</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Business</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Plan</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Period</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Trial</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {subscriptions.map(sub => (
                      <tr key={sub.id} className="hover:bg-gray-50 transition">
                        <td className="px-4 py-3 font-medium text-gray-900">{sub.businessName || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{sub.planName}</td>
                        <td className="px-4 py-3 text-gray-900">PKR {sub.amount.toLocaleString()}</td>
                        <td className="px-4 py-3">{statusBadge(sub.status)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {sub.currentPeriodStart ? `${new Date(sub.currentPeriodStart).toLocaleDateString()} - ${sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : ''}` : '-'}
                        </td>
                        <td className="px-4 py-3">{sub.isTrial ? <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Trial ends {sub.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString() : ''}</span> : <span className="text-xs text-gray-400">-</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">{editingPlan ? 'Edit Plan' : 'Create Plan'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Plan Name</label>
                  <input value={planForm.name} onChange={e => setPlanForm(p => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subtitle</label>
                  <input value={planForm.subtitle} onChange={e => setPlanForm(p => ({ ...p, subtitle: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price (PKR)</label>
                  <input type="number" value={planForm.price} onChange={e => setPlanForm(p => ({ ...p, price: Number(e.target.value) }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Interval</label>
                  <select value={planForm.interval} onChange={e => setPlanForm(p => ({ ...p, interval: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="weekly">Weekly</option>
                    <option value="one-time">One Time</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Badge</label>
                  <input value={planForm.badge} onChange={e => setPlanForm(p => ({ ...p, badge: e.target.value }))} placeholder="e.g. Popular" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Staff</label>
                  <input type="number" value={planForm.maxStaffMembers} onChange={e => setPlanForm(p => ({ ...p, maxStaffMembers: Number(e.target.value) }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Branches</label>
                  <input type="number" value={planForm.maxBranches} onChange={e => setPlanForm(p => ({ ...p, maxBranches: Number(e.target.value) }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Features (comma separated)</label>
                  <textarea value={planForm.features} onChange={e => setPlanForm(p => ({ ...p, features: e.target.value }))} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" checked={planForm.isActive} onChange={e => setPlanForm(p => ({ ...p, isActive: e.target.checked }))} id="planActive" className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <label htmlFor="planActive" className="text-sm text-gray-700">Active</label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">{editingPlan ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!deletingPlan}
        onClose={() => setDeletingPlan(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Plan"
        description="Are you sure you want to delete this plan? This action cannot be undone."
        confirmText="Delete Plan"
        cancelText="Cancel"
        variant="danger"
        itemName={deletingPlan ? `Plan: ${deletingPlan.name}` : undefined}
        itemDetails="This will permanently remove the subscription plan."
        icon={<Trash2 className="w-4 h-4" />}
      />
    </div>
  );
}
