/**
 * RoleBasedSidebar — driven by 3 layers:
 *
 * 1. MODULE_HIERARCHY (static config)  — defines every group and page
 * 2. enabledModules  (from DB via API) — business-type + plan gate
 * 3. effectiveRole   (from auth)       — OWNER / MANAGER / CASHIER gate
 *
 * Rendering: hierarchy → filter by module → filter by role
 */
import React, { useMemo, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, ChevronLeft, ChevronRight, ChevronDown, Globe, Zap, Lock, Circle, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useAdmin } from '@/contexts/useAdmin';
import { useSidebarContext } from '@/components/layout/sidebar-context';
import { cn } from '@/lib/utils';
import { normalizeAppRole, type AppUserRole } from '@/utils/app-role';
import { withBusinessSlug } from '@/utils/business-routes';
import { useBusinessModules, type ModuleConfig, type SubModuleConfig } from '@/hooks/useBusinessModules';
import { filterHierarchy, type ModuleGroup } from '@/config/module-hierarchy';

// ─── Icon helper for dynamic hierarchy ───────────────────────────────────────

import { 
  ShoppingCart, Package, Truck, TrendingUp, Building2, CreditCard,
  FileText, Receipt, Users, Layers, Factory, LayoutGrid, Boxes,
  ShoppingBag, ClipboardList, BarChart3, Stethoscope, Shield, Clock,
  UserCheck, Building, LayoutDashboard
} from 'lucide-react';

const getIconComponent = (iconName?: string): React.ComponentType<any> | null => {
  if (!iconName) return null;
  // Map of icon names to components
  const iconMap: Record<string, React.ComponentType<any>> = {
    'ShoppingCart': ShoppingCart,
    'Package': Package,
    'Truck': Truck,
    'TrendingUp': TrendingUp,
    'Building2': Building2,
    'CreditCard': CreditCard,
    'FileText': FileText,
    'Receipt': Receipt,
    'Users': Users,
    'Layers': Layers,
    'Factory': Factory,
    'LayoutGrid': LayoutGrid,
    'Boxes': Boxes,
    'ShoppingBag': ShoppingBag,
    'ClipboardList': ClipboardList,
    'BarChart3': BarChart3,
    'Stethoscope': Stethoscope,
    'Shield': Shield,
    'Clock': Clock,
    'UserCheck': UserCheck,
    'Building': Building,
    'LayoutDashboard': LayoutDashboard,
    'Circle': Circle,
  };
  return iconMap[iconName] || Circle;
};

// ─── Active indicator ─────────────────────────────────────────────────────────

function ActiveIndicator({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      className="pointer-events-none absolute left-0 top-1/2 h-[22px] w-[3px] -translate-y-1/2 rounded-r bg-gradient-to-b from-[#1a52c5] to-[#28c2ce] shadow-[0_0_12px_rgba(40,194,206,0.5)]"
      aria-hidden
    />
  );
}

// ─── Group (collapsible dropdown) ─────────────────────────────────────────────

const GroupItem: React.FC<{ group: ModuleGroup; slug: string; isCollapsed: boolean; isModuleLocked: (name: string) => boolean; isSubModuleLocked: (mod: string, sub: string) => boolean }> = React.memo(
  ({ group, slug, isCollapsed, isModuleLocked, isSubModuleLocked }) => {
    const location = useLocation();

    const resolvedPages = useMemo(
      () => group.pages.map((p) => ({ ...p, href: withBusinessSlug(slug, p.href) })),
      [group.pages, slug],
    );

    const isChildActive = resolvedPages.some((p) => location.pathname === p.href);
    const [isOpen, setIsOpen] = useState(isChildActive);
    const [isHovered, setIsHovered] = useState(false);
    const hoverRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => { setIsOpen(isChildActive); }, [isChildActive]);
    React.useEffect(() => () => { if (hoverRef.current) clearTimeout(hoverRef.current); }, []);

    // Check if this group/module is locked - memoize to prevent flickering
    const isLocked = useMemo(() => {
      return group.module ? isModuleLocked(group.module) : false;
    }, [group.module, isModuleLocked]);

    const handleModuleClick = (e: React.MouseEvent, moduleName?: string, subModuleKey?: string) => {
      if (moduleName && isModuleLocked(moduleName)) {
        e.preventDefault();
        toast.error('Feature Not Available', {
          description: `${group.label} isn't available in your current plan. Upgrade your subscription to access this feature.`,
          action: {
            label: 'Upgrade',
            onClick: () => { window.location.href = `/business/${encodeURIComponent(slug)}/subscription`; },
          },
          duration: 6000,
        });
        return;
      }
      if (moduleName && subModuleKey && isSubModuleLocked(moduleName, subModuleKey)) {
        e.preventDefault();
        toast.error('Feature Not Available', {
          description: `${group.pages.find((p) => p.key === subModuleKey)?.label || subModuleKey} isn't included in your current plan. Upgrade your subscription to access this feature.`,
          action: {
            label: 'Upgrade',
            onClick: () => { window.location.href = `/business/${encodeURIComponent(slug)}/subscription`; },
          },
          duration: 6000,
        });
        return;
      }
    };

    // Single-page group: render as a plain link, not a dropdown
    if (resolvedPages.length === 1) {
      const page = resolvedPages[0];
      const isActive = location.pathname === page.href;
      return (
        <Link
          to={isLocked ? '#' : page.href}
          title={isCollapsed ? group.label : undefined}
          onClick={(e) => {
            e.stopPropagation();
            handleModuleClick(e, group.module);
          }}
          className={cn(
            'relative mb-0.5 flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-sm font-medium transition-all duration-200',
            isActive
              ? 'bg-gradient-to-br from-[#1a52c5]/20 to-[#28c2ce]/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
              : 'text-white/85 hover:bg-white/[0.04] hover:text-white',
            isLocked && 'opacity-60 cursor-not-allowed hover:bg-transparent',
            isCollapsed && 'justify-center px-2',
          )}
        >
          <ActiveIndicator active={isActive} />
          <group.icon className={cn('h-5 w-5 shrink-0 stroke-[1.8]', isActive ? 'text-white' : 'text-white/85')} />
          {!isCollapsed && (
            <span className="truncate flex items-center gap-2">
              {group.label}
              {isLocked && <Lock className="h-3.5 w-3.5 text-orange-400" />}
            </span>
          )}
          {isCollapsed && isLocked && <Lock className="h-3.5 w-3.5 text-orange-400 absolute right-2" />}
        </Link>
      );
    }

    // Multi-page group: dropdown
    const btnClass = cn(
      'relative mb-0.5 flex w-full items-center justify-between rounded-[10px] px-3.5 py-2.5 text-left text-sm font-medium transition-all duration-200',
      isChildActive
        ? 'bg-gradient-to-br from-[#1a52c5]/20 to-[#28c2ce]/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
        : 'text-white/85 hover:bg-white/[0.04] hover:text-white',
      isLocked && 'opacity-60 cursor-not-allowed hover:bg-transparent',
    );

    return (
      <div
        className="relative"
        onMouseEnter={() => { if (isCollapsed) { if (hoverRef.current) clearTimeout(hoverRef.current); setIsHovered(true); } }}
        onMouseLeave={() => { if (isCollapsed) { hoverRef.current = setTimeout(() => setIsHovered(false), 150); } }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleModuleClick(e, group.module);
            if (!isLocked && !isCollapsed) setIsOpen(!isOpen);
          }}
          className={btnClass}
          title={isCollapsed ? group.label : undefined}
        >
          <ActiveIndicator active={isChildActive} />
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <group.icon className={cn('h-5 w-5 shrink-0 stroke-[1.8]', isChildActive ? 'text-white' : 'text-white/85')} />
            {!isCollapsed && (
              <span className="truncate flex items-center gap-2">
                {group.label}
                {isLocked && <Lock className="h-3.5 w-3.5 text-orange-400" />}
              </span>
            )}
          </div>
          {!isCollapsed && !isLocked && (
            <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 text-white transition-transform duration-200', isOpen && 'rotate-180')} />
          )}
          {isCollapsed && isLocked && <Lock className="h-3.5 w-3.5 text-orange-400 absolute right-2" />}
        </button>

        {/* Collapsed flyout */}
        {isCollapsed && isHovered && (
          <div
            className="absolute left-full top-0 z-[9999] ml-2 min-w-[208px] rounded-xl border border-white/10 bg-[#0c1528] py-2 shadow-xl"
            onMouseEnter={() => { if (hoverRef.current) clearTimeout(hoverRef.current); setIsHovered(true); }}
            onMouseLeave={() => { hoverRef.current = setTimeout(() => setIsHovered(false), 150); }}
          >
            <div className="border-b border-white/10 px-4 py-2">
              <span className="text-sm font-semibold text-white/90">{group.label}</span>
            </div>
            <div className="py-1">
              {resolvedPages.map((page) => {
                const isPageLocked = page.module ? isModuleLocked(page.module) || isSubModuleLocked(page.module, page.key) : false;
                return (
                  <Link
                    key={page.key}
                    to={isPageLocked ? '#' : page.href}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                      location.pathname === page.href
                        ? 'bg-white/10 font-medium text-white'
                        : 'text-white/70 hover:bg-white/5 hover:text-white',
                      isPageLocked && 'opacity-60 cursor-not-allowed hover:bg-transparent',
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleModuleClick(e, page.module, page.key);
                      if (!isPageLocked) setIsHovered(false);
                    }}
                  >
                    <page.icon className="h-4 w-4 shrink-0 opacity-80" />
                    <span className="flex items-center gap-2">
                      {page.label}
                      {isPageLocked && <Lock className="h-3 w-3 text-orange-400" />}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Expanded sub-items */}
        {!isCollapsed && (
          <div
            className={cn(
              'ml-3 mt-0.5 space-y-0.5 overflow-hidden border-l border-white/[0.06] pl-3 transition-all duration-300',
              isOpen ? 'max-h-[480px] opacity-100' : 'max-h-0 opacity-0',
            )}
          >
            {resolvedPages.map((page, index) => {
              const isPageLocked = page.module ? isModuleLocked(page.module) || isSubModuleLocked(page.module, page.key) : false;
              return (
                <Link
                  key={page.key}
                  to={isPageLocked ? '#' : page.href}
                  className={cn(
                    'relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-all',
                    location.pathname === page.href
                      ? 'bg-white/[0.08] text-white'
                      : 'text-white/65 hover:bg-white/[0.04] hover:text-white/90',
                    isPageLocked && 'opacity-60 cursor-not-allowed hover:bg-transparent',
                    isOpen ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0',
                  )}
                  style={{ transitionDelay: `${index * 40}ms` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleModuleClick(e, page.module, page.key);
                  }}
                >
                  <page.icon className="h-4 w-4 shrink-0 opacity-90" />
                  <span className="flex items-center gap-2">
                    {page.label}
                    {isPageLocked && <Lock className="h-3 w-3 text-orange-400" />}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

// ─── Section wrapper ───────────────────────────────────────────────────────────

function SidebarSection({
  label,
  groups,
  slug,
  isCollapsed,
  isModuleLocked,
  isSubModuleLocked,
}: {
  label: string;
  groups: ModuleGroup[];
  slug: string;
  isCollapsed: boolean;
  isModuleLocked: (name: string) => boolean;
  isSubModuleLocked: (mod: string, sub: string) => boolean;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="mb-1">
      {!isCollapsed && (
        <div className="px-3.5 pb-2.5 pt-[18px] text-[10px] font-bold uppercase tracking-[1.8px] text-white">
          {label}
        </div>
      )}
      {groups.map((group) => (
        <GroupItem key={group.module || group.label} group={group} slug={slug} isCollapsed={isCollapsed} isModuleLocked={isModuleLocked} isSubModuleLocked={isSubModuleLocked} />
      ))}
    </div>
  );
}

// ─── Root sidebar ──────────────────────────────────────────────────────────────

export const RoleBasedSidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { selectedCompanyId, selectedCompany, allCompanies } = useAdmin();
  const { isCollapsed, setIsCollapsed } = useSidebarContext();

  if (!user) return null;

  const normalizedUserRole = normalizeAppRole(user.role);
  const resolvedSelectedCompany =
    selectedCompany || allCompanies.find((company: any) => company.id === selectedCompanyId) || null;

  // Detect businessSlug from URL pathname (e.g., /business/my-business/dashboard)
  const businessSlugFromUrl = useMemo(() => {
    const match = location.pathname.match(/\/business\/([^\/]+)/);
    return match ? match[1] : '';
  }, [location.pathname]);

  // Find company by URL slug
  const companyByUrlSlug = useMemo(() => {
    if (!businessSlugFromUrl) return null;
    return allCompanies.find((c: any) => c.slug === businessSlugFromUrl) || null;
  }, [businessSlugFromUrl, allCompanies]);

  // Use company from URL slug if available, otherwise fall back to selectedCompany
  const displayCompany = companyByUrlSlug || resolvedSelectedCompany;
  const displayCompanyId = displayCompany?.id || selectedCompanyId;

  const { modules, moduleOrder, disabledSubModules, subModuleStateMap, hierarchy, hasDynamicHierarchy, isModuleLocked, isSubModuleLocked, isSubModuleHidden, loading: modulesLoading } = useBusinessModules(displayCompanyId);

  const ownsAnyBusiness = Boolean(
    user.id && allCompanies.some((company: any) => String(company?.createdBy || '') === String(user.id)),
  );

  const contextRole = (() => {
    if (!displayCompany) return normalizedUserRole;
    if (displayCompany.createdBy && String(displayCompany.createdBy) === String(user.id)) {
      return 'OWNER';
    }
    const memberRole = displayCompany?.memberRole;
    if (memberRole) return normalizeAppRole(String(memberRole));
    return normalizedUserRole;
  })();

  const effectiveRole = displayCompany
    ? contextRole
    : ownsAnyBusiness
      ? 'OWNER'
      : normalizedUserRole;

  const businessSlug = String(businessSlugFromUrl || (displayCompany as { slug?: string | null })?.slug || '').trim();

  // ── Dynamic Module Hierarchy from Backend ─────────────────────────────────
  // Convert dynamic hierarchy from backend to ModuleGroup format
  const visibleGroups = useMemo(() => {
    // Ensure Dashboard is always present as the first entry
    const ensureDashboard = (groups: ModuleGroup[]): ModuleGroup[] => {
      // Deduplicate: keep only the first occurrence of any group with module='dashboard'
      const seen = new Set<string>();
      const deduped = groups.filter((g) => {
        const key = (g.module || '').toLowerCase();
        if (key === 'dashboard') {
          if (seen.has(key)) return false;
          seen.add(key);
        }
        return true;
      });

      const hasDashboard = deduped.some((g) => (g.module || '').toLowerCase() === 'dashboard');
      if (hasDashboard) {
        const idx = deduped.findIndex((g) => (g.module || '').toLowerCase() === 'dashboard');
        if (idx > 0) {
          const [dash, ...rest] = deduped.splice(idx, 1);
          return [dash, ...deduped];
        }
        return deduped;
      }
      const dashboardGroup: ModuleGroup = {
        label: 'Dashboard',
        icon: getIconComponent('LayoutDashboard') || Circle,
        module: 'dashboard',
        section: 'main',
        pages: [
          {
            key: 'dashboard',
            label: 'Dashboard',
            href: '/',
            icon: getIconComponent('LayoutDashboard') || Circle,
            module: 'dashboard',
            roles: ['OWNER', 'MANAGER', 'CASHIER'],
          },
        ],
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      };
      return [dashboardGroup, ...deduped];
    };

    // If we have dynamic hierarchy from backend, use it
    if (hasDynamicHierarchy && hierarchy.length > 0) {
      const groups: ModuleGroup[] = hierarchy.map((module: ModuleConfig) => {
        // Convert subModules to pages
        const pages = module.subModules.map((sub: SubModuleConfig) => {
          // Get the icon component
          const IconComponent = getIconComponent(sub.icon) || getIconComponent(module.icon) || Circle;
          return {
            key: sub.key,
            label: sub.label,
            href: sub.href,
            icon: IconComponent as LucideIcon,
            module: sub.module,
            roles: sub.roles as AppUserRole[],
          };
        });

        // Get the module icon component
        const ModuleIcon = (getIconComponent(module.icon) || Circle) as LucideIcon;

        return {
          label: module.displayName || module.label,
          icon: ModuleIcon,
          module: module.module,
          section: module.section,
          pages,
          roles: module.defaultRoles as AppUserRole[],
        };
      });

      // After constructing groups, ensure they respect the enabled `modules` map and disabled reasons
      const normalizedModuleStateMap: Record<string, { enabled: boolean; disabledReason?: 'BUSINESS_TYPE' | 'SUBSCRIPTION_PLAN' | 'ROLE' | 'PARENT_MODULE' | null }> = {};
      Object.keys(modules).forEach((k) => {
        normalizedModuleStateMap[k.toLowerCase()] = {
          enabled: Boolean(modules[k].enabled),
          disabledReason: modules[k].disabledReason || null,
        };
      });

      const filteredByLocal = groups.filter((g) => {
        if (!g.module) return true;
        const raw = String(g.module || '').trim().toLowerCase();
        const key = raw.replace(/\s|-/g, '_');
        const moduleState = normalizedModuleStateMap[key];

        // Hide modules that are disabled due to business type, role, or parent module restrictions
        if (moduleState && (moduleState.disabledReason === 'BUSINESS_TYPE' || moduleState.disabledReason === 'ROLE' || moduleState.disabledReason === 'PARENT_MODULE')) {
          return false;
        }

        // Keep plan-locked modules visible so user sees upgrade/locked state
        return true;
      });

      const filteredByDisabledSubModules = filteredByLocal.map((g) => {
        const filteredPages = g.pages.filter((p) => {
          if (!p.module) return true;
          const compositeKey = `${p.module.toLowerCase()}::${p.key.toLowerCase()}`;
          const state = subModuleStateMap.get(compositeKey);
          if (state) {
            // Hide business-type and role denied sub-modules entirely
            if (!state.enabled && (state.disabledReason === 'BUSINESS_TYPE' || state.disabledReason === 'ROLE' || state.disabledReason === 'PARENT_MODULE')) {
              return false;
            }
            // Show plan-locked sub-modules (they'll render with lock icon)
            return true;
          }
          // Fallback: use flat disabledSubModules set
          if (disabledSubModules.has(compositeKey)) {
            return false;
          }
          return true;
        });
        return { ...g, pages: filteredPages };
      }).filter((g) => g.pages.length > 0);

      if (Object.keys(moduleOrder).length === 0) {
        return ensureDashboard(filteredByDisabledSubModules);
      }

      const pinned = filteredByDisabledSubModules.filter((g) => !g.module);
      const sortable = filteredByDisabledSubModules.filter((g) => !!g.module);

      sortable.sort((a, b) => {
        const aKey = a.module!.toLowerCase();
        const bKey = b.module!.toLowerCase();
        const aOrder = moduleOrder[aKey] !== undefined ? moduleOrder[aKey] : 9999;
        const bOrder = moduleOrder[bKey] !== undefined ? moduleOrder[bKey] : 9999;
        return aOrder - bOrder;
      });

      return ensureDashboard([...pinned, ...sortable]);
    }

    // Fallback: use hardcoded filterHierarchy if backend data not available
    const enabledModules = { dashboard: { enabled: true, label: 'Dashboard' }, ...modules };
    const groups = filterHierarchy(enabledModules, effectiveRole, disabledSubModules, subModuleStateMap);
    
    if (Object.keys(moduleOrder).length === 0) return ensureDashboard(groups);

    const pinned = groups.filter((g) => !g.module);
    const sortable = groups.filter((g) => !!g.module);

    sortable.sort((a, b) => {
      const aKey = a.module!.toLowerCase();
      const bKey = b.module!.toLowerCase();
      const aOrder = moduleOrder[aKey] !== undefined ? moduleOrder[aKey] : 9999;
      const bOrder = moduleOrder[bKey] !== undefined ? moduleOrder[bKey] : 9999;
      return aOrder - bOrder;
    });

    return ensureDashboard([...pinned, ...sortable]);
  }, [hierarchy, hasDynamicHierarchy, modules, effectiveRole, disabledSubModules, subModuleStateMap, moduleOrder]);

  const mainGroups = useMemo(() => visibleGroups.filter((g) => g.section === 'main'), [visibleGroups]);
  const managementGroups = useMemo(() => visibleGroups.filter((g) => g.section === 'management'), [visibleGroups]);

  return (
    <div
      className={cn(
        'fixed left-0 top-0 z-50 flex h-screen flex-col overflow-hidden bg-[#060d1f] transition-all duration-300',
        "after:pointer-events-none after:absolute after:right-0 after:top-0 after:h-full after:w-px after:content-[''] after:bg-gradient-to-b after:from-[#1a52c5] after:via-[#28c2ce]/40 after:to-transparent after:opacity-[0.35]",
        isCollapsed ? 'w-[72px]' : 'w-[272px]',
      )}
    >
      <div
        className="pointer-events-none absolute -bottom-[100px] -left-[60px] h-[260px] w-[260px] rounded-full bg-[radial-gradient(circle,rgba(26,82,197,0.12)_0%,transparent_70%)] blur-[40px]"
        aria-hidden
      />

      {/* Logo + collapse toggle */}
      <div
        className={cn(
          'relative z-[2] flex items-center px-6 pb-6 pt-[30px]',
          isCollapsed ? 'flex-col gap-3 px-3' : 'justify-between',
        )}
      >
        <div className={cn('flex min-w-0 items-center gap-3.5', isCollapsed && 'justify-center')}>
          <div className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[13px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] shadow-[0_0_24px_rgba(26,82,197,0.4)]">
            <Zap className="h-[22px] w-[22px] fill-white text-white" />
          </div>
          {!isCollapsed && (
            <span className="truncate text-[22px] font-extrabold tracking-tight text-white">
              Zap
              <span className="bg-gradient-to-br from-[#7eb3ff] to-[#28c2ce] bg-clip-text text-transparent">eera</span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="shrink-0 rounded-lg p-1 text-white transition-colors hover:bg-white/5"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>

      {/* Navigation */}
      <nav
        className={cn(
          'relative z-[2] flex-1 space-y-0 overflow-y-auto px-3.5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20',
          isCollapsed && 'overflow-x-visible px-2',
        )}
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255, 255, 255, 0.25) transparent',
        }}
      >
        <style>{`
          nav::-webkit-scrollbar {
            width: 8px;
          }
          nav::-webkit-scrollbar-track {
            background: transparent;
          }
          nav::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.25);
            border-radius: 4px;
            transition: background 0.2s ease;
          }
          nav::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.4);
          }
          nav::-webkit-scrollbar-thumb:active {
            background: linear-gradient(to bottom, #1a52c5, #28c2ce);
          }
        `}</style>
        <SidebarSection label="Main" groups={mainGroups} slug={businessSlug} isCollapsed={isCollapsed} isModuleLocked={isModuleLocked} isSubModuleLocked={isSubModuleLocked} />
        <SidebarSection label="Management" groups={managementGroups} slug={businessSlug} isCollapsed={isCollapsed} isModuleLocked={isModuleLocked} isSubModuleLocked={isSubModuleLocked} />
      </nav>

      {/* Footer */}
      <div className="relative z-[2] mt-auto space-y-0.5 px-3.5 pb-6 pt-2">
        <Link
          to="/zapeera"
          className={cn(
            'flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-sm font-medium text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white/85',
            isCollapsed && 'justify-center px-2',
          )}
          title={isCollapsed ? 'Zapeera' : undefined}
        >
          <Globe className="h-5 w-5 shrink-0 stroke-[1.8]" />
          {!isCollapsed && <span>Zapeera</span>}
        </Link>
        <button
          type="button"
          onClick={logout}
          className={cn(
            'flex w-full items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-left text-sm font-medium text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white/85',
            isCollapsed && 'justify-center px-2',
          )}
          title={isCollapsed ? 'Log Out' : undefined}
        >
          <LogOut className="h-5 w-5 shrink-0 stroke-[1.8]" />
          {!isCollapsed && <span>Log Out</span>}
        </button>
      </div>
    </div>
  );
};
