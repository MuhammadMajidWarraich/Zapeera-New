import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  UserPlus,
  Building2,
  Shield,
  Settings,
  Stethoscope,
  Search,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  UserCheck,
  UserX,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { useDashboardData } from "@/contexts/DashboardDataContext";
import { toast } from "@/hooks/use-toast";
import { getMissingRequiredFields } from "@/lib/required-fields";
import { PaginationPills } from "@/components/ui/pagination-pills";
import AddStaffModal from "@/components/staff/AddStaffModal";

interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  /** Role in the selected company (from company_members + creator); use for staff table display */
  staffListRole?: string;
  branchId: string;
  companyId?: string;
  isOwner?: boolean;
  branch: {
    id: string;
    name: string;
  };
  createdBy?: string;
  isActive: boolean;
  businessAccessGranted?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Branch {
  id: string;
  name: string;
  companyId?: string;
}

const UserManagement = () => {
  const { user: currentUser } = useAuth();
  const { selectedCompanyId, selectedBranchId, getMembershipRole } = useAdmin();
  
  // Dashboard data cache
  const {
    getCachedData,
    setCachedData,
    isCacheValid,
    setLoading: setCacheLoading
  } = useDashboardData();
  
  // CRITICAL: Initialize state from cache IMMEDIATELY on mount
  const initializeFromCache = () => {
    // Calculate branchIdForCache - when "All Branch" is selected (null), use null for cache key
    const branchIdForCache = selectedBranchId !== null ? selectedBranchId : null;
    const cached = getCachedData(selectedCompanyId, branchIdForCache);
    if (cached && isCacheValid(cached) && cached.data.users) {
      return cached.data.users;
    }
    return null;
  };

  const cachedUsersOnMount = initializeFromCache();
  
  const [users, setUsers] = useState<User[]>(() => cachedUsersOnMount || []);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(() => !cachedUsersOnMount); // Don't show loading if cache exists
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  // CRITICAL: Track recently updated users to preserve them during reloads
  const recentlyUpdatedUsersRef = useRef<Map<string, { user: User; timestamp: number }>>(new Map());

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRole, setSelectedRole] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCompanyId, selectedBranchId, selectedRole, selectedStatus, searchTerm, pageSize]);

  // User ID tracking disabled

  const [recentlyCreatedUserIds, setRecentlyCreatedUserIds] = useState<Set<string>>(new Set());

  // Deleted user ID tracking disabled

  const [deletedUserIds, setDeletedUserIds] = useState<Set<string>>(new Set());

  // Save deleted user IDs to localStorage
  const saveDeletedUserIds = (ids: Set<string>) => {
    // Deleted user ID saving disabled
  };

  // Save recently created user IDs to localStorage whenever it changes
  const saveRecentlyCreatedUserIds = (ids: Set<string>) => {
    // Recently created user ID saving disabled
  };

  // Password visibility toggle
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [businessUserLimit, setBusinessUserLimit] = useState<number | null | undefined>(undefined);
  const [businessPlanName, setBusinessPlanName] = useState<string>("");
  const [showAddStaff, setShowAddStaff] = useState(false);

  // Password validation state
  const [passwordStrength, setPasswordStrength] = useState({
    minLength: false,
    hasNumber: false
  });

  // Define available roles based on current user's role (4 customer roles only)
  // Helper function to get effective role in current company context
  const getEffectiveRole = () => {
    const membershipRole = getMembershipRole();
    const effectiveRole = membershipRole || String(currentUser?.role || '').toUpperCase();
    return String(effectiveRole || '').toUpperCase();
  };

  // USER: Default for new registrations, cannot create other users
  // OWNER: Can create MANAGER and CASHIER (based on subscription limits)
  // MANAGER: Can create CASHIER only
  // CASHIER: Cannot create users
  const getAvailableRoles = () => {
    const role = getEffectiveRole();

    if (role === 'OWNER') {
      return [
        { id: "MANAGER", label: "Manager", icon: Stethoscope, description: "Branch management" },
        { id: "CASHIER", label: "Cashier", icon: Users, description: "Sales and billing" }
      ];
    } else if (role === 'MANAGER') {
      // Managers can only create cashiers
      return [
        { id: "CASHIER", label: "Cashier", icon: Users, description: "Sales and billing" }
      ];
    }
    // USER and CASHIER cannot create other users
    return [];
  };

  const roles = getAvailableRoles();

  const [formErrors, setFormErrors] = useState({
    name: '',
    email: '',
    username: '',
    password: '',
    phone: ''
  });

  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    username: "",
    branchId: "",
    role: "",
    password: "",
    isActive: true
  });
  const editRoleOptions = useMemo(() => {
    const base = [...roles];
    if (newUser.role && !base.some((r) => r.id === newUser.role)) {
      base.push({
        id: newUser.role,
        label:
          newUser.role.charAt(0) + newUser.role.slice(1).toLowerCase(),
        icon: Settings,
        description: "Current role",
      });
    }
    return base;
  }, [roles, newUser.role]);

  const [isCheckingUnique, setIsCheckingUnique] = useState(false);

  /** When email/username matches an existing Zapeera account (add staff → give access flow). */
  const [existingUserMatch, setExistingUserMatch] = useState<{
    id: string;
    name: string;
    email: string;
    username?: string;
  } | null>(null);

  const [isGiveAccessDialogOpen, setIsGiveAccessDialogOpen] = useState(false);
  const [giveAccessBranchId, setGiveAccessBranchId] = useState("");
  const [giveAccessRole, setGiveAccessRole] = useState<"MANAGER" | "CASHIER">("CASHIER");

  const checkUsernameOrEmailUniqueness = async (field: 'username' | 'email'): Promise<boolean> => {
    const value = newUser[field]?.trim();
    if (!value) {
      setExistingUserMatch(null);
      return true;
    }

    try {
      setIsCheckingUnique(true);
      const searchResponse = await apiService.checkUserExists({ [field]: value });
      if (searchResponse.success && searchResponse.data && searchResponse.data.exists) {
        const conflict = searchResponse.data.data;
        if (conflict) {
          if (selectedUser && conflict.id === selectedUser.id) {
            setExistingUserMatch(null);
            setFormErrors((prev) => ({ ...prev, [field]: '' }));
            return true;
          }

          setExistingUserMatch({
            id: conflict.id,
            name: conflict.name,
            email: conflict.email,
            username: conflict.username,
          });
          setFormErrors((prev) => ({
            ...prev,
            [field]:
              field === 'username'
                ? 'This username is already registered in Zapeera.'
                : 'This email is already registered in Zapeera.',
          }));
          return false;
        }
      }

      setExistingUserMatch(null);
      setFormErrors((prev) => ({ ...prev, [field]: '' }));
      return true;
    } catch (error) {
      return true;
    } finally {
      setIsCheckingUnique(false);
    }
  };

  // Password validation function
  const validatePassword = (password: string) => {
    const minLength = password.length >= 6;
    const hasNumber = /\d/.test(password);

    setPasswordStrength({
      minLength,
      hasNumber
    });

    return minLength;
  };

  // Check if password is valid
  const isPasswordValid = () => {
    return passwordStrength.minLength;
  };

  const ensureOwnerInStaffList = useCallback((list: User[]): User[] => {
    if (!selectedCompanyId || !currentUser) {
      return list;
    }

    const companyRec = companies.find((c: any) => c.id === selectedCompanyId);
    const creatorId =
      companyRec?.createdBy != null && String(companyRec.createdBy).trim() !== ''
        ? String(companyRec.createdBy)
        : String(currentUser.id);

    // Only the real business creator counts as "owner already listed" — not other users with global OWNER role
    const creatorAlreadyListed = list.some((entry) => String(entry.id) === creatorId);
    if (creatorAlreadyListed) {
      return list;
    }

    // Synthetic row only for the logged-in business creator viewing their own business
    if (String(currentUser.id) !== creatorId) {
      return list;
    }

    const ownerBranch =
      branches.find((branch) => branch.id === selectedBranchId) ||
      branches.find((branch) => branch.companyId === selectedCompanyId) ||
      null;

    const ownerStaffRow: User = {
      id: currentUser.id,
      username: (currentUser as any).username || currentUser.email || 'owner',
      name: currentUser.name || 'Business Owner',
      email: currentUser.email || 'owner@business.local',
      role: 'OWNER',
      staffListRole: 'OWNER',
      branchId: ownerBranch?.id || '',
      companyId: selectedCompanyId,
      isOwner: true,
      branch: {
        id: ownerBranch?.id || 'owner-access',
        name: ownerBranch?.name || 'Owner Access',
      },
      createdBy: currentUser.id,
      isActive: true,
      createdAt: (currentUser as any).createdAt || new Date().toISOString(),
      updatedAt: (currentUser as any).updatedAt || new Date().toISOString(),
    };

    return [ownerStaffRow, ...list];
  }, [branches, companies, currentUser, selectedBranchId, selectedCompanyId]);

  // Load companies/branches on mount; staff load is driven by selectedCompanyId effect below
  useEffect(() => {
    void loadCompanies();
    void loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CRITICAL: Restore from cache IMMEDIATELY on mount or when context changes (BEFORE render)
  // useLayoutEffect runs synchronously before browser paint, so data shows instantly with UI
  useLayoutEffect(() => {
    // Calculate branchIdForCache - when "All Branch" is selected (null), use null for cache key
    const branchIdForCache = selectedBranchId !== null ? selectedBranchId : null;
    const cached = getCachedData(selectedCompanyId, branchIdForCache);
    
    if (cached && cached.data && cached.data.users && cached.data.users.length > 0) {
      // CRITICAL: Skip cached data if any user has an invalid ID (prevents corruption from old cache)
      const hasInvalidIds = cached.data.users.some((u: User) => !u.id || typeof u.id !== 'string' || u.id.trim() === '');
      if (hasInvalidIds) {
        setIsLoading(true);
      } else {
        // Filter out deleted users from cache
        const filteredCachedUsers = cached.data.users.filter((u: User) => !deletedUserIds.has(u.id));
        if (filteredCachedUsers.length > 0) {
          setUsers(filteredCachedUsers);
          setIsLoading(false);
          setCacheLoading(selectedCompanyId, branchIdForCache, false);
        }
      }
    } else {
      // No cache - set loading state immediately
      setIsLoading(true);
    }
  }, [selectedCompanyId, selectedBranchId, deletedUserIds, getCachedData]);

  // CRITICAL FIX: Reload users when selectedCompanyId or selectedBranchId changes
  useEffect(() => {
    // DON'T clear users - useLayoutEffect will show cached data immediately
    // Then refresh in background
    void loadBranches();
    loadUsers(false); // Don't force refresh - use cache first, then update in background
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId, selectedBranchId]);

  // CRITICAL FIX: Also listen for branchChanged custom event for immediate reload
  useEffect(() => {
    const handleBranchChanged = (event: CustomEvent) => {
      // Reload users immediately when branch changes
      void loadBranches();
      loadUsers();
    };

    window.addEventListener('branchChanged', handleBranchChanged as EventListener);
    return () => {
      window.removeEventListener('branchChanged', handleBranchChanged as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const loadBusinessEntitlements = async () => {
      if (!selectedCompanyId) {
        setBusinessUserLimit(undefined);
        setBusinessPlanName("");
        return;
      }

      try {
        const response = await apiService.getBusinessEntitlements(selectedCompanyId);
        if (response.success && response.data) {
          const maxUsers = response.data.effectiveLimits?.maxConcurrentUsers ?? response.data.limits?.maxConcurrentUsers ?? null;
          setBusinessUserLimit(maxUsers);
          setBusinessPlanName(response.data.plan?.name || "");
        } else {
          setBusinessUserLimit(undefined);
          setBusinessPlanName("");
        }
      } catch (error) {
        setBusinessUserLimit(undefined);
        setBusinessPlanName("");
      }
    };

    void loadBusinessEntitlements();
  }, [selectedCompanyId]);

  const loadUsers = useCallback(async (forceRefresh: boolean = false) => {
    // Calculate branchIdForCache - when "All Branch" is selected (null), use null for cache key
    const branchIdForCache = selectedBranchId !== null ? selectedBranchId : null;
    
    try {
      setError("");

      // Get current user's data from AuthContext
      if (!currentUser) {
        setError('User not authenticated');
        return;
      }

      const currentUserId = currentUser?.id;
      const currentUserRole = currentUser?.role;

      // CRITICAL: If we have cache, data is already shown by useLayoutEffect
      // Just refresh in background without blocking UI
      if (!forceRefresh) {
        const cached = getCachedData(selectedCompanyId, branchIdForCache);
        
        if (cached && cached.data && cached.data.users && cached.data.users.length > 0) {
          // Check if cache is fresh - if yes, skip API call
          const cacheAge = Date.now() - cached.timestamp;
          const cacheValid = isCacheValid(cached);
          
          if (cacheValid && cacheAge < 2 * 60 * 1000) {
            // CRITICAL: Skip cache if any user has an invalid ID (prevents corruption from old cache)
            const hasInvalidIds = cached.data.users.some((u: User) => !u.id || typeof u.id !== 'string' || u.id.trim() === '');
            if (hasInvalidIds) {
            } else {
              setIsLoading(false);
              setCacheLoading(selectedCompanyId, branchIdForCache, false);
              return; // Cache is fresh, no need to fetch
            }
          } else {
            // Continue to fetch fresh data in background (don't show loading)
            setIsLoading(false); // Don't show loading since we have cache
          }
        } else {
          // No cache - show loading
          setIsLoading(true);
        }
      } else {
        // Force refresh - show loading
        setIsLoading(true);
      }
      setCacheLoading(selectedCompanyId, branchIdForCache, true);

      // CRITICAL: Load fresh data from API (in background if we have cache)
      // API service automatically includes X-Business-ID and X-Branch-ID headers
      // When selectedBranchId is null (All Branch), X-Branch-ID header won't be sent
      // When selectedBranchId is set, X-Branch-ID header will be sent

      // When a specific branch is selected from the global branch switcher, we must load staff
      // via /users?branchId=... (backend resolves branch assignment via memberships->branches).
      // The legacy /companies/:id/members endpoint does not provide branch assignment details.
      
      // Determine branch ID for managers/cashiers
      let branchIdForApi = selectedBranchId;
      if (!branchIdForApi && currentUser?.role !== 'OWNER' && currentUser?.role !== 'ADMIN') {
        // For non-owner users, check membership.branchIds
        if (Array.isArray(currentUser?.membership?.branchIds) && currentUser.membership.branchIds.length > 0) {
          branchIdForApi = String(currentUser.membership.branchIds[0]);
        } else if (currentUser?.branchId) {
          branchIdForApi = currentUser.branchId;
        }
      }
      
      const response = selectedCompanyId
        ? (branchIdForApi
            ? await apiService.getUsers({
                page: 1,
                limit: 500,
                search: searchTerm,
                role: selectedRole !== 'all' ? selectedRole : undefined,
                branchId: branchIdForApi,
              })
            : await apiService.getCompanyMembers(selectedCompanyId, {
                page: 1,
                limit: 500,
                search: searchTerm,
                role: selectedRole !== 'all' ? selectedRole : undefined,
              }))
        : await apiService.getUsers({
            page: 1,
            limit: 500,
            search: searchTerm,
            role: selectedRole !== 'all' ? selectedRole : undefined,
          });

      const isMembershipList = Boolean(selectedCompanyId) && !selectedBranchId && Array.isArray(response.data);
      const usersSource = isMembershipList ? response.data : (response.data as any)?.users;

      
      // Check if we have cache - if yes, update silently without changing UI
      const hasCache = !forceRefresh && getCachedData(selectedCompanyId, branchIdForCache)?.data?.users;
      
      if (response.success && usersSource) {
        // Get current user ID early for use in filters

        // Map and transform API users to frontend User shape
        const usersData = (usersSource || [])
          .filter((source: any) => {
            // Exclude backoffice/platform admin users from business staff view
            const globalRole = String(source.role || source.user?.role || '').toUpperCase();
            return globalRole !== 'ADMIN' && globalRole !== 'SUPER_ADMIN';
          })
          .map((source: any) => {
            const userBranchId = source.branchId || source.user?.branchId || '';
            const branchObj = userBranchId ? (branches.find((b: any) => b.id === userBranchId) || null) : null;

            // Derive username from email prefix if backend username is empty
            const rawUsername = source.user?.username || source.username || '';
            const derivedUsername = rawUsername || (source.email || source.user?.email || '').split('@')[0] || '';

            // Prefer staffListRole (business-scoped) over global role
            const displayRole = source.staffListRole || source.role || source.user?.role || 'CASHIER';

            // Safe createdAt fallback
            const rawCreatedAt = source.createdAt || source.user?.createdAt;
            const safeCreatedAt = rawCreatedAt && rawCreatedAt !== 'Invalid Date' ? rawCreatedAt : new Date().toISOString();

            return {
              id: String(source.userId || source.id || ''),
              username: derivedUsername,
              name: source.user?.name || source.name || '',
              email: source.user?.email || source.email || '',
              role: displayRole,
              staffListRole: source.staffListRole || displayRole,
              branchId: userBranchId,
              companyId: selectedCompanyId,
              branch: source.branch || source.user?.branch || branchObj,
              createdBy: source.createdBy || null,
              isActive: source.user?.isActive ?? source.isActive ?? true,
              businessAccessGranted: true,
              createdAt: safeCreatedAt,
              updatedAt: source.updatedAt || source.user?.updatedAt || new Date().toISOString(),
            } as User;
          });

        // Backend scopes users by X-Business-ID when a business is selected; do not re-filter by
        // user.companyId here — members linked only via company_members were incorrectly hidden.
        const companyFilteredUsers = usersData;

        const filteredUsers = companyFilteredUsers.filter((user: User) => {
          // CRITICAL: If user was recently created, always include them (bypass all filters)
          if (recentlyCreatedUserIds.has(user.id)) {
            return true;
          }

          // For OWNER users, show all users returned by backend (backend already scoped by company)
          if (currentUserRole === 'OWNER') {
            if (currentUserId && user.createdBy === currentUserId) {
              return true;
            }
            // Show all users returned by backend for this company
            return true;
          }

          // Show all customer-facing roles: OWNER, MANAGER, CASHIER
          // No backoffice roles on customer end
          const dr = user.staffListRole || user.role;
          return ['OWNER', 'MANAGER', 'CASHIER'].includes(dr);
        });

        // CRITICAL FIX: Merge filtered users from backend + recently created users
        // This ensures newly created staff are ALWAYS visible even if backend hasn't synced yet
        setUsers(prevUsers => {
          // CRITICAL: Get ALL recently created users from previous state (preserve them at ALL costs)
          const prevRecentlyCreatedUsers = prevUsers.filter(u => recentlyCreatedUserIds.has(u.id));
          
          // CRITICAL: Get ALL recently updated users from ref (preserve them at ALL costs)
          const recentlyUpdatedUsers = Array.from(recentlyUpdatedUsersRef.current.values())
            .filter(({ timestamp }) => Date.now() - timestamp < 60000) // Only preserve updates from last 60 seconds
            .map(({ user }) => user);

          // Start with filtered users from backend
          const mergedUsers = [...filteredUsers];

          // CRITICAL: Create a Set of user IDs already in merged list for fast lookup
          const mergedUserIds = new Set(mergedUsers.map(u => u.id));

          // CRITICAL: Preserve recently updated users - use the updated version instead of backend version
          recentlyUpdatedUsers.forEach(updatedUser => {
            const existingIndex = mergedUsers.findIndex(u => u.id === updatedUser.id);
            if (existingIndex !== -1) {
              // Replace with the updated version (preserve the immediate update)
              mergedUsers[existingIndex] = {
                ...updatedUser,
                companyId: updatedUser.companyId || undefined,
              } as any;
            } else if (!mergedUserIds.has(updatedUser.id)) {
              // Add if not in backend response
              mergedUsers.unshift({
                ...updatedUser,
                companyId: updatedUser.companyId || undefined,
              } as any);
              mergedUserIds.add(updatedUser.id);
            }
          });

          // CRITICAL: Add ALL recently created users that aren't in the backend response
          // This handles cases where backend hasn't synced yet or filters them out
          prevRecentlyCreatedUsers.forEach(recentUser => {
            if (!mergedUserIds.has(recentUser.id)) {
              // Add at the beginning to make them visible
              const userToAdd: User = {
                ...recentUser,
                companyId: recentUser.companyId || undefined,
              };
              mergedUsers.unshift(userToAdd as any);
              mergedUserIds.add(recentUser.id); // Update the set
            } else {
              // Update existing user with latest data from backend if available
              // BUT: Don't overwrite if it's a recently updated user (handled above)
              if (!recentlyUpdatedUsersRef.current.has(recentUser.id)) {
                const backendUser = filteredUsers.find(u => u.id === recentUser.id);
                if (backendUser) {
                  const index = mergedUsers.findIndex(u => u.id === recentUser.id);
                  if (index !== -1) {
                    mergedUsers[index] = {
                      ...backendUser,
                      companyId: backendUser.companyId || undefined,
                    } as any;
                  }
                }
              }
            }
          });

          // CRITICAL: Also check prevUsers for any recently created users we might have missed
          // This is a safety net in case the filter above missed some
          prevUsers.forEach(prevUser => {
            if (recentlyCreatedUserIds.has(prevUser.id) && !mergedUserIds.has(prevUser.id)) {
              const userToAdd: User = {
                ...prevUser,
                companyId: prevUser.companyId || undefined,
              };
              mergedUsers.unshift(userToAdd as any);
              mergedUserIds.add(prevUser.id); // Update the set
            }
          });

          // FINAL CHECK: Verify all recently created users are in the final list
          const finalRecentlyCreatedCount = mergedUsers.filter(u => recentlyCreatedUserIds.has(u.id)).length;
          if (finalRecentlyCreatedCount < recentlyCreatedUserIds.size) {
            const missingIds = Array.from(recentlyCreatedUserIds).filter(id => !mergedUsers.some(u => u.id === id));
          }
          
          // CRITICAL: Cache the final merged users using DashboardDataContext
          // Cache AFTER all filtering and merging is done, so we cache the correct branch-specific data
          const finalUsers = ensureOwnerInStaffList(mergedUsers);
          const dataToCache = {
            users: finalUsers
          };
          setCachedData(selectedCompanyId, branchIdForCache, dataToCache);
          return finalUsers;
        });

        if (filteredUsers.length === 0) {
          setError(`Found ${usersData.length} Staff but none are MANAGER or CASHIER roles. Only ${usersData.map((u: User) => u.role).join(', ')} roles found.`);
        }
      } else {
        setError(response.message || "Failed to load staff");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load staff. Please try again.");
    } finally {
      setIsLoading(false);
      setCacheLoading(selectedCompanyId, branchIdForCache, false);
    }
  }, [currentUser, selectedCompanyId, selectedBranchId, branches, companies, recentlyCreatedUserIds, getCachedData, setCachedData, isCacheValid, setCacheLoading, ensureOwnerInStaffList]);

  const loadBranches = async () => {
    try {
      const response = await apiService.getBranches();
      if (response.success && response.data) {
        const branchesData = Array.isArray(response.data) ? response.data : response.data.branches;
        setBranches(branchesData.map((branch: any) => ({
          id: branch.id,
          name: branch.name,
          companyId: branch.companyId || branch.company?.id
        })));
      }
    } catch (error) {
    }
  };

  const loadCompanies = async () => {
    try {
      const response = await apiService.getCompanies();
      if (response.success && response.data) {
        setCompanies(response.data);
      }
    } catch (error) {
    }
  };

  /** Role shown in staff table: per-company staffListRole from API when present, else global User.role */
  const staffDisplayRole = (u: User): string =>
    u.staffListRole && String(u.staffListRole).trim() !== '' ? String(u.staffListRole) : u.role;

  const selectedCompanyRecordForCreator = companies.find((c: any) => c.id === selectedCompanyId);
  const companyCreatorId =
    selectedCompanyRecordForCreator?.createdBy != null &&
    String(selectedCompanyRecordForCreator.createdBy).trim() !== ''
      ? String(selectedCompanyRecordForCreator.createdBy)
      : null;

  const filteredUsers = users.filter(user => {
    // Business creator row always visible (not: every user with global role OWNER)
    if ((user as any).isOwner || (companyCreatorId && user.id === companyCreatorId)) {
      const matchesStatus = selectedStatus === "all" || 
                           (selectedStatus === "active" && user.businessAccessGranted !== false) ||
                           (selectedStatus === "inactive" && user.businessAccessGranted === false);
      if (!searchTerm && matchesStatus) {
        return true; // Show owner if no search and status matches
      }
      const matchesSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           user.username.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch && matchesStatus;
    }
    // CRITICAL: Always show recently created users (within the last 10 minutes) regardless of ALL filters
    const isRecentlyCreated = recentlyCreatedUserIds.has(user.id);
    // Branch filter from global branch switcher
    const branchFilter = selectedBranchId || null;

    // CRITICAL: If branchFilter is set, user MUST match that branch
    const matchesBranch = !branchFilter ||
                         user.branchId === branchFilter ||
                         user.branch?.id === branchFilter ||
                         (user.branchId && branches.find(b => b.id === user.branchId)?.id === branchFilter);

    if (isRecentlyCreated) {
      // For recently created users, only bypass filters when no branch is selected
      if (branchFilter && !matchesBranch) {
        return false;
      }
      const matchesStatus = selectedStatus === "all" || 
                           (selectedStatus === "active" && user.businessAccessGranted !== false) ||
                           (selectedStatus === "inactive" && user.businessAccessGranted === false);
      if (!searchTerm && matchesStatus) {
        return true; // Show all recently created users if no search and status matches
      }
      const matchesSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           user.username.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch && matchesStatus;
    }

    // CRITICAL FIX: For MANAGER users, show staff from their assigned branches
    if (getEffectiveRole() === 'MANAGER') {
      // Managers can see staff from their assigned branches
      const managerBranchIds: string[] = [];
      
      // Get branch from branchId
      if (currentUser?.branchId) {
        managerBranchIds.push(String(currentUser.branchId));
      }
      
      // Get branches from membership.branchIds
      if (Array.isArray(currentUser?.membership?.branchIds) && currentUser.membership.branchIds.length > 0) {
        currentUser.membership.branchIds.forEach((id: any) => {
          const branchIdStr = String(id);
          if (!managerBranchIds.includes(branchIdStr)) {
            managerBranchIds.push(branchIdStr);
          }
        });
      }
      
      // If manager has assigned branches, check if user belongs to any of them
      if (managerBranchIds.length > 0) {
        const userInManagerBranch = managerBranchIds.includes(String(user.branchId));
        if (!userInManagerBranch) {
          return false;
        }
      }
      
      const matchesSearch = !searchTerm || user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           user.username.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRole = selectedRole === "all" || staffDisplayRole(user) === selectedRole;
      const matchesStatus = selectedStatus === "all" || 
                           (selectedStatus === "active" && user.businessAccessGranted !== false) ||
                           (selectedStatus === "inactive" && user.businessAccessGranted === false);
      return matchesSearch && matchesRole && matchesStatus;
    }

    // CRITICAL FIX: For business creators, show users they created, but respect branch filter when selected
    if (getEffectiveRole() === 'OWNER' && user.createdBy === currentUser?.id) {
      const matchesSearch = !searchTerm || user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           user.username.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRole = selectedRole === "all" || staffDisplayRole(user) === selectedRole;
      const matchesStatus = selectedStatus === "all" || 
                           (selectedStatus === "active" && user.businessAccessGranted !== false) ||
                           (selectedStatus === "inactive" && user.businessAccessGranted === false);
      return matchesSearch && matchesRole && matchesStatus && (!branchFilter || matchesBranch);
    }

    const matchesSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         user.username.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesRole = selectedRole === "all" || staffDisplayRole(user) === selectedRole;
    const matchesStatus = selectedStatus === "all" || 
                         (selectedStatus === "active" && user.businessAccessGranted !== false) ||
                         (selectedStatus === "inactive" && user.businessAccessGranted === false);

    // CRITICAL FIX: Filter by global context - company and branch from header dropdown
    // STRICT: Only show users from the selected company's branches (prevent data leakage)
    // If selectedCompanyId is set, ONLY show users from that company
    let matchesGlobalCompany = true;
    if (selectedCompanyId) {
      // List is loaded with X-Business-ID; includes company_members-only staff (no reliable client-side signal).
      matchesGlobalCompany = true;
    } else {
      // No company selected - for ADMIN, show only users from their own company
      const currentUserCompanyId = (currentUser as any)?.companyId as string | undefined;
      if (getEffectiveRole() === 'OWNER' && currentUserCompanyId) {
        const userBranch = branches.find(b => b.id === user.branchId);
        matchesGlobalCompany =
          (user.companyId === currentUserCompanyId) ||
          (userBranch && userBranch.companyId === currentUserCompanyId);
      }
    }

    // CRITICAL FIX: Apply branch filter strictly
    // Only bypass branch filter for recently created users (handled above)
    // For all other users, they MUST match the selected branch
    return matchesSearch && matchesBranch && matchesRole && matchesStatus && matchesGlobalCompany;
  });

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedUsers = filteredUsers.slice((safePage - 1) * pageSize, safePage * pageSize);

  const validateStaffForm = () => {
    const errors = {
      name: '',
      email: '',
      username: '',
      password: '',
      phone: ''
    };

    // Name - Required
    if (!newUser.name.trim()) {
      errors.name = 'Name is required';
    } else if (newUser.name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters';
    }

    // Email - Required and valid format
    if (!newUser.email.trim()) {
      errors.email = 'Email is required';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newUser.email.trim())) {
        errors.email = 'Please enter a valid email address';
      }
    }

    // Username - Required
    if (!newUser.username.trim()) {
      errors.username = 'Username is required';
    } else if (newUser.username.trim().length < 3) {
      errors.username = 'Username must be at least 3 characters';
    }

    // Password - Required and valid
    if (!newUser.password.trim()) {
      errors.password = 'Password is required';
    } else if (newUser.password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }

    setFormErrors(errors);
    
    // Check if there are any errors
    const hasErrors = Object.values(errors).some(error => error !== '');
    
    if (hasErrors) {
      toast({
        title: "Validation Error",
        description: "Please fill all required fields correctly (Name, Email, Username, Password are required)",
        variant: "destructive",
      });
    }
    
    return !hasErrors;
  };

  const branchesForSelectedBusiness = selectedCompanyId
    ? branches.filter((b) => b.companyId === selectedCompanyId)
    : branches;

  const openGiveAccessDialog = () => {
    if (!existingUserMatch || !selectedCompanyId) {
      toast({
        title: "Select a business",
        description: "Choose a business in the header, then try Give access again.",
        variant: "destructive",
      });
      return;
    }
    const list = branchesForSelectedBusiness;
    const defaultBranch =
      newUser.branchId && list.some((b) => b.id === newUser.branchId)
        ? newUser.branchId
        : selectedBranchId && list.some((b) => b.id === selectedBranchId)
          ? selectedBranchId
          : list[0]?.id || "";
    setGiveAccessBranchId(defaultBranch);
    setGiveAccessRole(
      getEffectiveRole() === 'MANAGER'
        ? "CASHIER"
        : newUser.role === "MANAGER" || newUser.role === "CASHIER"
          ? newUser.role
          : "CASHIER",
    );
    setIsCreateDialogOpen(false);
    setIsGiveAccessDialogOpen(true);
  };

  const handleGiveAccessSubmit = async () => {
    if (!selectedCompanyId || !existingUserMatch) return;
    if (!giveAccessBranchId) {
      toast({
        title: "Branch required",
        description: "Select a branch for this staff member.",
        variant: "destructive",
      });
      return;
    }
    const roleToSend: "MANAGER" | "CASHIER" =
      getEffectiveRole() === 'MANAGER' ? "CASHIER" : giveAccessRole;

    if (roleToSend === "MANAGER") {
      const existingManager = users.find(
        (u) =>
          u.id !== existingUserMatch.id &&
          (u.staffListRole || u.role) === "MANAGER" &&
          u.branchId === giveAccessBranchId,
      );
      if (existingManager) {
        const branchName =
          branches.find((b) => b.id === giveAccessBranchId)?.name || "this branch";
        toast({
          title: "Manager already assigned",
          description: `Branch "${branchName}" already has a manager.`,
          variant: "destructive",
        });
        return;
      }
    }

    setIsLoading(true);
    try {
      const res = await apiService.addCompanyMember(selectedCompanyId, {
        userId: existingUserMatch.id,
        role: roleToSend,
        branchId: giveAccessBranchId,
      });
      if (res && (res as { success?: boolean }).success !== false) {
        toast({
          title: "Access shared",
          description: `${existingUserMatch.name} is now staff on this business as ${roleToSend.toLowerCase()}.`,
        });
        setIsGiveAccessDialogOpen(false);
        setExistingUserMatch(null);
        setFormErrors({ name: "", email: "", username: "", password: "", phone: "" });
        await loadUsers();
      } else {
        toast({
          title: "Error",
          description: (res as { message?: string })?.message || "Could not grant access",
          variant: "destructive",
        });
      }
    } catch (e: unknown) {
      const err = e as { response?: { message?: string; data?: { message?: string } }; message?: string };
      const msg =
        (typeof err?.response === "object" && err?.response && "message" in err.response
          ? (err.response as { message?: string }).message
          : undefined) ||
        (err as { message?: string })?.message ||
        "Could not grant access";
      toast({
        title: "Error",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (isAddStaffDisabled) {
      const limitMessage = businessUserLimit === null
        ? "Unable to add staff at the moment."
        : `Staff limit reached for ${businessPlanName || "your current plan"} (${staffUsageSummary}). Upgrade plan to add more staff.`;
      setError(limitMessage);
      toast({
        title: "Staff limit reached",
        description: limitMessage,
        variant: "destructive",
      });
      return;
    }

    // For OWNER creating users, branchId is not required (can be null for business-level access)
    const isOwnerCreatingUser = getEffectiveRole() === 'OWNER' && ['MANAGER', 'CASHIER'].includes(newUser.role);

    // For managers, auto-set branchId to their own branch
    if (getEffectiveRole() === 'MANAGER' && currentUser?.branchId) {
      newUser.branchId = currentUser.branchId;
    }

    // Validate that managers can only create cashiers
    if (getEffectiveRole() === 'MANAGER' && newUser.role !== 'CASHIER') {
      setError("Managers can only create cashiers!");
      toast({
        title: "Error",
        description: "Managers can only create cashiers.",
        variant: "destructive",
      });
      return;
    }

    // Comprehensive validation first
    if (!validateStaffForm()) {
      return;
    }

    // Check branch is required (unless OWNER creating business-level users)
    if (!isOwnerCreatingUser && !newUser.branchId) {
      setError("Branch is required");
      toast({
        title: "Error",
        description: "Please select a branch",
        variant: "destructive",
      });
      return;
    }

    // Validate uniqueness before submit
    const usernameUnique = await checkUsernameOrEmailUniqueness('username');
    const emailUnique = await checkUsernameOrEmailUniqueness('email');
    if (!usernameUnique || !emailUnique) {
      setError(
        "This email or username is already registered in Zapeera. Use “Give access” to share this business with that account.",
      );
      toast({
        title: "Account already exists in Zapeera",
        description:
          "You cannot create a second login with the same email or username. Use “Give access” to add this existing user as staff for your business.",
        variant: "destructive",
      });
      return;
    }

    // CRITICAL FIX: Validate only one manager per branch
    // If creating a MANAGER, check if the selected branch already has ANY manager (active or inactive)
    if (newUser.role === 'MANAGER' && newUser.branchId) {
      const existingManager = users.find(u => 
        u.role === 'MANAGER' && 
        u.branchId === newUser.branchId
        // Check ALL managers (active and inactive) - only one manager per branch allowed
      );
      
      if (existingManager) {
        const branchName = branches.find(b => b.id === newUser.branchId)?.name || 'this branch';
        setError(`Only one manager can be assigned to one branch. Branch "${branchName}" already has a manager.`);
        toast({
          title: "Error",
          description: `Only one manager can be assigned to one branch. Branch "${branchName}" already has a manager.`,
          variant: "destructive",
          duration: 5000,
        });
        return;
      }
    }

    // Validate password
    if (!validatePassword(newUser.password)) {
      const errorMessage = "Password must be at least 6 characters long!";
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
      return;
    }

    // Store form data for optimistic update
    const userFormData = { ...newUser };
    const tempId = `temp-${Date.now()}`;
    
    // Use the selected branch ID from the form, or null for OWNER creating business-level users
    // Convert empty string to null to match backend expectations
    const branchId: string | null = isOwnerCreatingUser ? null : (newUser.branchId && newUser.branchId.trim() !== '' ? newUser.branchId : null);

    // OPTIMISTIC UPDATE: Create temporary user object and add to list IMMEDIATELY
    const optimisticUser: User = {
      id: tempId,
      username: userFormData.username,
      name: userFormData.name,
      email: userFormData.email,
      role: userFormData.role as 'OWNER' | 'MANAGER' | 'CASHIER',
      branchId: branchId || "",
      companyId: (currentUser as any)?.companyId || "",
      branch: branches.find(b => b.id === branchId) || { id: branchId || "", name: "Unknown Branch" },
      createdBy: currentUser?.id || null,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Add to list IMMEDIATELY
    setUsers(prev => [optimisticUser, ...prev]);
    
    // Close dialog IMMEDIATELY
    setIsCreateDialogOpen(false);
    
    // Reset form IMMEDIATELY
    setFormErrors({ name: '', email: '', username: '', password: '', phone: '' });
    setNewUser({ name: "", email: "", username: "", branchId: "", role: "", password: "", isActive: true });
    setPasswordStrength({ minLength: false, hasNumber: false });
    setShowPassword(false);

    // Show success toast IMMEDIATELY
    toast({
      title: "✅ Staff Created Successfully!",
      description: `Staff "${userFormData.username}" has been created and can now login.`,
      variant: "success",
      duration: 5000,
    });

    // Call API in background (non-blocking)
    apiService.createUser({
      username: userFormData.username,
      email: userFormData.email,
      password: userFormData.password,
      name: userFormData.name,
      role: userFormData.role as 'OWNER' | 'MANAGER' | 'CASHIER',
      branchId: branchId
    })
      .then((response) => {
        if (response.success && response.data) {
          // Replace temporary user with real one
          const createdUser = response.data;
          const newUserData: User = {
            id: createdUser.id,
            username: createdUser.username,
            name: createdUser.name,
            email: createdUser.email,
            role: createdUser.role,
            branchId: createdUser.branchId || "",
            companyId: (createdUser as any).companyId,
            branch: createdUser.branch || { id: createdUser.branchId || "", name: "Unknown Branch" },
            createdBy: (createdUser as any).createdBy,
            isActive: createdUser.isActive !== undefined ? createdUser.isActive : false,
            createdAt: (createdUser as any).createdAt || new Date().toISOString(),
            updatedAt: (createdUser as any).updatedAt || new Date().toISOString()
          };

          // Replace temporary user with real one
          setUsers(prev => prev.map(u => u.id === tempId ? newUserData : u));

          // Mark as recently created
          setRecentlyCreatedUserIds(prev => {
            const newSet = new Set([...prev, newUserData.id]);
            saveRecentlyCreatedUserIds(newSet);
            return newSet;
          });

          // Remove from recently created set after 15 minutes
          setTimeout(() => {
            setRecentlyCreatedUserIds(prev => {
              const newSet = new Set(prev);
              newSet.delete(newUserData.id);
              saveRecentlyCreatedUserIds(newSet);
              return newSet;
            });
          }, 15 * 60 * 1000);

          // Reload in background to ensure consistency
          setTimeout(() => {
          }, 500);
        } else {
          // If API call failed, remove the optimistic user
          setUsers(prev => prev.filter(u => u.id !== tempId));
          
          const errorMessage = response?.message || (response as any)?.error || 'Failed to create staff';
          
          // Check if it's a manager assignment error
          if (errorMessage.toLowerCase().includes('only one manager') || errorMessage.toLowerCase().includes('already has a manager')) {
            const branchName = branches.find(b => b.id === userFormData.branchId)?.name || 'this branch';
            const finalErrorMessage = `Only one manager can be assigned to one branch. Branch "${branchName}" already has a manager.`;
            toast({
              title: "Error",
              description: finalErrorMessage,
              variant: "destructive",
              duration: 5000,
            });
          } else {
            toast({
              title: "Error",
              description: errorMessage,
              variant: "destructive",
              duration: 5000,
            });
          }
        }
      })
      .catch((error: any) => {
        // If API call failed, remove the optimistic user
        setUsers(prev => prev.filter(u => u.id !== tempId));
        const errBody = error?.response;
        const errorMessage =
          (errBody && typeof errBody === "object" && "message" in errBody
            ? (errBody as { message?: string }).message
            : undefined) ||
          error?.message ||
          "Failed to create staff";
        const nested = errBody && typeof errBody === "object" && "data" in errBody ? (errBody as { data?: { existingUserId?: string; existingUserName?: string } }).data : undefined;
        const existingId = nested?.existingUserId;
        const existingName = nested?.existingUserName;

        const isDuplicate =
          existingId ||
          /already exists/i.test(errorMessage) ||
          /already registered/i.test(errorMessage);

        if (isDuplicate && existingId) {
          setExistingUserMatch({
            id: existingId,
            name: existingName || userFormData.name,
            email: userFormData.email,
            username: userFormData.username,
          });
          const list = selectedCompanyId
            ? branches.filter((b) => b.companyId === selectedCompanyId)
            : branches;
          const defaultBranch =
            userFormData.branchId && list.some((b) => b.id === userFormData.branchId)
              ? userFormData.branchId
              : list[0]?.id || "";
          setGiveAccessBranchId(defaultBranch);
          setGiveAccessRole(
            getEffectiveRole() === 'MANAGER'
              ? "CASHIER"
              : userFormData.role === "MANAGER" || userFormData.role === "CASHIER"
                ? userFormData.role
                : "CASHIER",
          );
          setIsGiveAccessDialogOpen(true);
          toast({
            title: "This person already has a Zapeera account",
            description:
              "We opened “Give access” so you can share this business with their existing login—no duplicate account.",
            variant: "default",
            duration: 8000,
          });
          return;
        }

        // Check if it's a "one manager per branch" error
        if (errorMessage.toLowerCase().includes('only one manager') || errorMessage.toLowerCase().includes('already has a manager')) {
          const branchName = branches.find(b => b.id === userFormData.branchId)?.name || 'this branch';
          const finalErrorMessage = `Only one manager can be assigned to one branch. Branch "${branchName}" already has a manager.`;
          toast({
            title: "Error",
            description: finalErrorMessage,
            variant: "destructive",
            duration: 5000,
          });
        } else {
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
            duration: 5000,
          });
        }
      });
  };

  const getRoleIcon = (role: string, iconClassName = "w-4 h-4") => {
    const roleData = roles.find(r => r.id === role);
    if (roleData) {
      const IconComponent = roleData.icon;
      return <IconComponent className={iconClassName} />;
    }
    return <Users className={iconClassName} />;
  };

  const staffRoleBadgeClass = (role: string) => {
    const base =
      "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wide";
    if (role === "CASHIER") {
      return cn(
        base,
        "border border-amber-500/15 bg-amber-500/[0.08] text-[#b45309]",
      );
    }
    if (role === "MANAGER") {
      return cn(
        base,
        "border border-[#1a52c5]/12 bg-gradient-to-br from-[rgba(26,82,197,0.08)] to-[rgba(40,194,206,0.06)] text-[#1a52c5]",
      );
    }
    if (role === "OWNER") {
      return cn(
        base,
        "border border-[#1a52c5]/12 bg-[#1a52c5]/10 text-[#1a52c5]",
      );
    }
    return cn(
      base,
      "border border-[rgba(15,23,60,0.08)] bg-black/[0.03] text-[#4a5578]",
    );
  };

  const formatRoleLabel = (role: string) => {
    if (!role) return "";
    return role.charAt(0) + role.slice(1).toLowerCase();
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "OWNER": return "destructive";
      case "MANAGER": return "default";
      case "CASHIER": return "secondary";
      default: return "outline";
    }
  };

  // Handler functions for user actions
  const handleViewUser = (user: User) => {
    setSelectedUser(user);
    setIsViewDialogOpen(true);
  };

  const handleEditUser = (user: User) => {
    const currentBusinessRole = staffDisplayRole(user);
    if (currentBusinessRole === 'OWNER') {
      toast({
        title: "Owner role is protected",
        description: "Business owner role cannot be edited from staff screen.",
        variant: "destructive",
      });
      return;
    }
    setSelectedUser(user);
    setNewUser({
      name: user.name,
      email: user.email,
      username: user.username,
      branchId: user.branchId,
      role: currentBusinessRole,
      password: "", // Don't pre-fill password for security
      isActive: user.isActive !== undefined ? user.isActive : true
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdateUser = async () => {
    if (!selectedUser) return;

    // Validate required fields
    if (!newUser.name || !newUser.email || !newUser.username || !newUser.role || !newUser.branchId) {
      const errorMessage = "Please fill in all required fields!";
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
      return;
    }

    // Validate user ID before update
    const userId = selectedUser.id;
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      toast({
        title: "Error",
        description: "Cannot update user: invalid user ID. Please refresh the page and try again.",
        variant: "destructive",
      });
      return;
    }

    // CRITICAL FIX: Validate username uniqueness (check if changed and if it conflicts) - case-insensitive
    if (newUser.username.trim() !== selectedUser.username) {
      const normalizedNewUsername = newUser.username.trim().toLowerCase();
      const usernameExists = users.some(u =>
        u.id !== selectedUser.id &&
        u.username &&
        u.username.toLowerCase() === normalizedNewUsername
      );
      if (usernameExists) {
        const errorMessage = "Username already exists! Please choose a different username.";
        setError(errorMessage);
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
        return;
      }
    }

    // CRITICAL FIX: Validate only one manager per branch
    // Only check when the user will BE a manager in the target branch.
    // Skip this check entirely when changing FROM manager TO cashier or any non-manager role.
    const targetRole = newUser.role;
    const targetBranchId = newUser.branchId;

    if (targetRole === 'MANAGER' && targetBranchId) {
      const existingManager = users.find(u =>
        u.id !== selectedUser.id &&
        u.role === 'MANAGER' &&
        u.branchId === targetBranchId
      );

      if (existingManager) {
        const branchName = branches.find(b => b.id === targetBranchId)?.name || 'this branch';
        setError(`Only one manager can be assigned to one branch. Branch "${branchName}" already has a manager.`);
        toast({
          title: "Error",
          description: `Only one manager can be assigned to one branch. Branch "${branchName}" already has a manager.`,
          variant: "destructive",
          duration: 5000,
        });
        return;
      }
    }

    // Store original user data for revert if needed
    const originalUser = { ...selectedUser };

    // OPTIMISTIC UPDATE: Update user in list IMMEDIATELY (before API call)
    const updatedUserOptimistic: User = {
      ...selectedUser,
      name: newUser.name,
      email: newUser.email,
      username: newUser.username.trim(),
      role: newUser.role as 'OWNER' | 'MANAGER' | 'CASHIER',
      branchId: newUser.branchId,
      branch: branches.find(b => b.id === newUser.branchId) || selectedUser.branch,
      updatedAt: new Date().toISOString()
    };

    setUsers(prev => prev.map(u => u.id === userId ? updatedUserOptimistic : u));
    
    // Close dialog IMMEDIATELY
    setIsEditDialogOpen(false);
    setSelectedUser(null);
    
    // Reset form IMMEDIATELY
    setNewUser({
      name: "",
      email: "",
      username: "",
      branchId: "",
      role: "",
      password: "",
      isActive: true
    });

    // Show success toast IMMEDIATELY
    toast({
      title: "Success",
      description: `User ${newUser.name} updated successfully!`,
    });

    // Prepare update data
    const updateData: any = {
      name: newUser.name,
      email: newUser.email,
      username: newUser.username.trim(),
      role: newUser.role as 'OWNER' | 'MANAGER' | 'CASHIER',
      branchId: newUser.branchId,
    };

    // Only include password if it's provided
    if (newUser.password && newUser.password.trim() !== '') {
      updateData.password = newUser.password;
    }

    // Call API in background (non-blocking)
    apiService.updateUser(userId, updateData)
      .then((response) => {
        if (response && response.success && response.data) {
          // Replace optimistic user with real one
          const updatedUser = response.data;
          setUsers(prev => prev.map(u => 
            u.id === userId ? {
              ...u,
              ...updatedUser,
              branch: updatedUser.branch || u.branch
            } : u
          ));
          
          // Update cache
          const branchIdForCache = selectedBranchId !== null ? selectedBranchId : null;
          const dataToCache = { users: users.map(u => u.id === userId ? {
            ...u,
            ...updatedUser,
            branch: updatedUser.branch || u.branch
          } : u) };
          setCachedData(selectedCompanyId, branchIdForCache, dataToCache);
          
          // Reload in background to ensure consistency
          setTimeout(() => {
          }, 500);
        } else {
          // If API call failed, revert the optimistic update
          setUsers(prev => prev.map(u => u.id === userId ? originalUser : u));
          
          const errorMessage = response?.message || 'Failed to update staff';
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }
      })
      .catch((error: any) => {
        // If API call failed, revert the optimistic update
        setUsers(prev => prev.map(u => u.id === userId ? originalUser : u));
        const errorMessage = error?.response?.data?.message || error?.response?.message || error?.message || 'Failed to update staff';
        
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      });
  };

  const handleDeleteUser = (user: User) => {
    setSelectedUser(user);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteUser = async () => {
    if (!selectedUser) {
      toast({
        title: "Error",
        description: "No user selected for deletion",
        variant: "destructive",
      });
      return;
    }

    const userId = selectedUser.id;
    const userName = selectedUser.name;
    const userCopy = { ...selectedUser };

    /** Removing staff from the selected business only — never hard-delete the platform account. */
    if (selectedCompanyId) {
      setIsLoading(true);
      try {
        const response = await apiService.removeCompanyMember(selectedCompanyId, userId);
        if (response && (response as { success?: boolean }).success !== false) {
          setUsers((prev) => prev.filter((u) => u.id !== userId));
          setIsDeleteDialogOpen(false);
          setSelectedUser(null);
          toast({
            title: "Removed from business",
            description: `${userName} no longer has access to this business. Their login account is unchanged.`,
          });
          await loadUsers();
        } else {
          toast({
            title: "Error",
            description: (response as any)?.message || "Failed to remove staff from this business",
            variant: "destructive",
          });
        }
      } catch (error: any) {
        toast({
          title: "Error",
          description: error?.response?.data?.message || error?.message || "Failed to remove staff from this business",
          variant: "destructive",
        });
      } finally {
        setIsDeleteDialogOpen(false);
        setSelectedUser(null);
      }
      return;
    }

    // Hard-delete is not available on customer end
    toast({
      title: "Not Available",
      description: "Permanent user deletion is only available from backoffice. Select a business to remove user from that business.",
      variant: "destructive"
    });
    setIsDeleteDialogOpen(false);
    setSelectedUser(null);
  };

  const handleToggleBusinessAccess = async (user: User) => {
    try {
      setIsLoading(true);
      setError("");
      setSuccess("");

      const currentlyGranted = user.businessAccessGranted !== false;
      const nextGranted = !currentlyGranted;

      if (selectedCompanyId) {
        if (!nextGranted) {
          const response = await apiService.removeCompanyMember(selectedCompanyId, user.id);
          if (response && (response as { success?: boolean }).success !== false) {
            setUsers((prev) => prev.filter((u) => u.id !== user.id));
            toast({
              title: "Access updated",
              description: `${user.name} no longer has access to this business. Their account remains on the platform.`,
            });
            await loadUsers();
          } else {
            toast({
              title: "Error",
              description: response.message || "Failed to remove access for this business",
              variant: "destructive",
            });
          }
        } else {
          const r = String(staffDisplayRole(user) || user.role || "").toUpperCase();
          const role: "MANAGER" | "CASHIER" = r === "MANAGER" ? "MANAGER" : "CASHIER";
          const response = await apiService.addCompanyMember(selectedCompanyId, {
            userId: user.id,
            role,
            branchId: user.branchId || undefined,
          });
          if (response && (response as { success?: boolean }).success !== false) {
            toast({
              title: "Access updated",
              description: `${user.name} has been granted access to this business again.`,
            });
            await loadUsers();
          } else {
            toast({
              title: "Error",
              description: (response as any).message || "Failed to restore access",
              variant: "destructive",
            });
          }
        }
        return;
      }

      const response = await apiService.updateUserBusinessAccess(user.id, nextGranted);

      if (response && (response as { success?: boolean }).success !== false) {
        const successMessage = `Business access for ${user.name} ${nextGranted ? "granted" : "revoked"} successfully!`;
        setSuccess(successMessage);
        toast({
          title: "Success",
          description: successMessage,
        });

        setUsers((prevUsers) =>
          prevUsers.map((u) =>
            u.id === user.id ? { ...u, businessAccessGranted: nextGranted } : u
          )
        );

        await loadUsers();
      } else {
        const errorMessage = response.message || "Failed to update business access";
        setError(errorMessage);
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.message || error?.message || "Failed to update business access";
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Duplicate handleUpdateUser removed - using the one defined earlier at line 839

  // Removed loading screen - show content immediately, data loads in background

  // Get the selected branch name from AdminContext
  const selectedBranchFromContext = selectedBranchId
    ? branches.find(b => b.id === selectedBranchId)?.name
    : null;
  const companyScopedStaff = users.filter((entry) => {
    const dr = staffDisplayRole(entry);
    const isStaffMember =
      (entry.isOwner || dr === 'OWNER' || dr === 'MANAGER' || dr === 'CASHIER') &&
      entry.businessAccessGranted !== false;
    if (!isStaffMember) return false;
    if (!selectedCompanyId) return true;
    
    // Check if user is directly associated with the company
    if (entry.companyId === selectedCompanyId) return true;
    
    // Check if user's branch belongs to the selected company
    const entryBranch = branches.find((branch) => branch.id === entry.branchId);
    if (entryBranch && entryBranch.companyId === selectedCompanyId) return true;
    
    // Check if user is a member of the company (through membership)
    if (entry.companyId && entry.companyId === selectedCompanyId) return true;
    
    // For owners, include all users who have any business access
    if (currentUser?.role === 'OWNER' || currentUser?.role === 'ADMIN') {
      return true;
    }
    
    return false;
  });
  const currentStaffSeatsUsed = new Set(companyScopedStaff.map((entry) => entry.id)).size;
  const isStaffLimitReached =
    businessUserLimit !== undefined &&
    businessUserLimit !== null &&
    currentStaffSeatsUsed >= businessUserLimit;
  const isAddStaffDisabled = Boolean(isStaffLimitReached);
  const staffUsageSummary =
    businessUserLimit === null
      ? `${currentStaffSeatsUsed} / Unlimited`
      : businessUserLimit === undefined
        ? `${currentStaffSeatsUsed}`
        : `${currentStaffSeatsUsed} / ${businessUserLimit}`;

  return (
    <div className="relative min-h-full">
      <div
        className="pointer-events-none fixed right-[-100px] top-[-100px] z-0 h-[500px] w-[500px] rounded-full bg-[rgba(40,194,206,0.06)] blur-[100px]"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed bottom-[100px] left-[350px] z-0 h-[400px] w-[400px] rounded-full bg-[rgba(26,82,197,0.04)] blur-[100px]"
        aria-hidden
      />

      <div className="relative z-[1] space-y-5 px-6 pb-14 pt-9 sm:px-11">
        <div className="zv3-animate-fadeUp flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">
              Staff Management
            </h1>
            <p className="text-sm text-[#8c95b0]">Manage branch staff and their permissions</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={isAddStaffDisabled}
            onClick={() => setShowAddStaff(true)}
            className="inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(26,82,197,0.35)]"
          >
            <UserPlus className="h-[18px] w-[18px] stroke-[2]" strokeLinecap="round" />
            Add New Staff
          </button>

            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Add New Staff</DialogTitle>
                <DialogDescription>
                  Add a new Staff to your business. They will receive login credentials via email.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">Name *</Label>
                  <div className="col-span-3">
                    <Input
                      id="name"
                      value={newUser.name}
                      onChange={(e) => {
                        setNewUser({...newUser, name: e.target.value});
                        if (formErrors.name) setFormErrors(prev => ({...prev, name: ''}));
                      }}
                      className={formErrors.name ? 'border-red-500' : ''}
                      placeholder="Enter full name"
                      required
                    />
                    {formErrors.name && (
                      <p className="text-sm text-red-600 mt-1">{formErrors.name}</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="email" className="text-right">Email *</Label>
                  <div className="col-span-3">
                    <Input
                      id="email"
                      type="email"
                      value={newUser.email}
                      onChange={(e) => {
                        setNewUser({...newUser, email: e.target.value});
                        setExistingUserMatch(null);
                        if (formErrors.email) setFormErrors(prev => ({...prev, email: ''}));
                      }}
                      onBlur={() => {
                        if (newUser.email.trim()) {
                          void checkUsernameOrEmailUniqueness('email');
                        }
                      }}
                      className={formErrors.email ? 'border-red-500' : ''}
                      placeholder="Enter email address"
                      required
                    />
                    {formErrors.email && (
                      <p className="text-sm text-red-600 mt-1">{formErrors.email}</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="username" className="text-right">Username *</Label>
                  <div className="col-span-3">
                    <Input
                      id="username"
                      type="text"
                      value={newUser.username}
                      onChange={(e) => {
                        setNewUser({...newUser, username: e.target.value});
                        setExistingUserMatch(null);
                        if (formErrors.username) setFormErrors(prev => ({...prev, username: ''}));
                      }}
                      onBlur={() => {
                        if (newUser.username.trim()) {
                          void checkUsernameOrEmailUniqueness('username');
                        }
                      }}
                      className={formErrors.username ? 'border-red-500' : ''}
                      placeholder="Enter username"
                      required
                    />
                    {formErrors.username && (
                      <p className="text-sm text-red-600 mt-1">{formErrors.username}</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="role" className="text-right">Role</Label>
                  {getEffectiveRole() === 'MANAGER' ? (
                    // For managers, show role as read-only (always Cashier)
                    <div className="col-span-3 p-2 bg-muted rounded-md text-sm">
                      Cashier
                    </div>
                  ) : (
                  <Select value={newUser.role} onValueChange={(value) => setNewUser({...newUser, role: value})}>
                    <SelectTrigger className="col-span-3">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          <div className="flex items-center space-x-2">
                            {getRoleIcon(role.id)}
                            <span>{role.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  )}
                </div>
                {/* Only show branch selection if not OWNER creating business-level users and not MANAGER */}
                {!(getEffectiveRole() === 'OWNER' && ['MANAGER', 'CASHIER'].includes(newUser.role)) && getEffectiveRole() !== 'MANAGER' && (
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="branch" className="text-right">Branch</Label>
                    <Select value={newUser.branchId} onValueChange={(value) => setNewUser({...newUser, branchId: value})}>
                      <SelectTrigger className="col-span-3">
                        <SelectValue placeholder="Select branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            <div className="flex items-center space-x-2">
                              <Building2 className="h-4 w-4" />
                              <span>{branch.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {/* For managers, show their branch as read-only */}
                {getEffectiveRole() === 'MANAGER' && currentUser?.branchId && (
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="branch" className="text-right">Branch</Label>
                    <div className="col-span-3 p-2 bg-muted rounded-md text-sm">
                      {branches.find(b => b.id === currentUser.branchId)?.name || 'Your Branch'}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="password" className="text-right">Password *</Label>
                  <div className="col-span-3 space-y-2">
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={newUser.password}
                        onChange={(e) => {
                          setNewUser({...newUser, password: e.target.value});
                          validatePassword(e.target.value);
                          if (formErrors.password) setFormErrors(prev => ({...prev, password: ''}));
                        }}
                        className={`pr-10 ${formErrors.password ? 'border-red-500' : ''}`}
                        placeholder="Enter temporary password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {/* Password Strength Indicator */}
                    {newUser.password && (
                      <div className="space-y-1">
                        <div className={`flex items-center text-xs ${passwordStrength.minLength ? 'text-green-600' : 'text-gray-500'}`}>
                          <div className={`w-2 h-2 rounded-full mr-2 ${passwordStrength.minLength ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                          At least 6 characters
                        </div>
                        <div className={`flex items-center text-xs ${passwordStrength.hasNumber ? 'text-green-600' : 'text-gray-500'}`}>
                          <div className={`w-2 h-2 rounded-full mr-2 ${passwordStrength.hasNumber ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                          Contains a number (recommended)
                        </div>
                      </div>
                    )}
                    {formErrors.password && (
                      <p className="text-sm text-red-600 mt-1">{formErrors.password}</p>
                    )}
                  </div>
                </div>
              </div>

              {existingUserMatch && (
                <Alert className="mx-1 border-[#1a52c5]/25 bg-[rgba(26,82,197,0.06)]">
                  <AlertDescription className="text-sm text-[#0a1128]">
                    <span className="font-semibold">This person already exists in Zapeera</span>
                    <span className="mt-1 block text-[#4a5578]">
                      {existingUserMatch.name} ({existingUserMatch.email}) already has a platform account. New staff
                      must use a new email/username, or you can share access to{' '}
                      <strong>this business only</strong> using their existing login.
                    </span>
                    {selectedCompanyId ? (
                      <Button
                        type="button"
                        className="mt-3 bg-[#1a52c5] hover:bg-[#1a52c5]/90"
                        onClick={openGiveAccessDialog}
                      >
                        Give access
                      </Button>
                    ) : (
                      <p className="mt-2 text-xs text-amber-800">
                        Select a business in the header first—then you can use Give access.
                      </p>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)} className="h-11 rounded-[10px] border-[rgba(15,23,60,0.06)] px-7 font-semibold text-[#4a5578] hover:bg-[#f0f2f7]">
                  Cancel
                </Button>
                <Button
                  className="h-11 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                  onClick={handleCreateUser}
                  disabled={isAddStaffDisabled}
                >
                  Create Staff
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isGiveAccessDialogOpen} onOpenChange={setIsGiveAccessDialogOpen}>
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader>
                <DialogTitle>Give access to this business</DialogTitle>
                <DialogDescription>
                  Link an existing Zapeera account to your business. No new login is created.
                </DialogDescription>
              </DialogHeader>
              {existingUserMatch && (
                <div className="grid gap-4 py-2">
                  <div className="rounded-lg border border-[rgba(15,23,60,0.08)] bg-[#f8f9fc] px-3 py-2 text-sm">
                    <p className="text-[#8c95b0]">User</p>
                    <p className="font-semibold text-[#0a1128]">{existingUserMatch.name}</p>
                    <p className="text-xs text-[#4a5578]">{existingUserMatch.email}</p>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-2">
                    <Label className="text-right text-sm">Business</Label>
                    <div className="col-span-3 rounded-md border border-[rgba(15,23,60,0.08)] bg-muted/40 px-3 py-2 text-sm font-medium">
                      {companies.find((c) => c.id === selectedCompanyId)?.name || "Current business"}
                    </div>
                  </div>
                  {currentUser?.role !== "MANAGER" && (
                    <div className="grid grid-cols-4 items-center gap-2">
                      <Label className="text-right text-sm">Role</Label>
                      <Select
                        value={giveAccessRole}
                        onValueChange={(v) => setGiveAccessRole(v as "MANAGER" | "CASHIER")}
                      >
                        <SelectTrigger className="col-span-3">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MANAGER">Manager</SelectItem>
                          <SelectItem value="CASHIER">Cashier</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {getEffectiveRole() === 'MANAGER' && (
                    <div className="grid grid-cols-4 items-center gap-2">
                      <Label className="text-right text-sm">Role</Label>
                      <div className="col-span-3 rounded-md border px-3 py-2 text-sm">Cashier</div>
                    </div>
                  )}
                  <div className="grid grid-cols-4 items-center gap-2">
                    <Label className="text-right text-sm">Branch</Label>
                    <div className="col-span-3 space-y-1">
                      <Select
                        value={giveAccessBranchId}
                        onValueChange={setGiveAccessBranchId}
                        disabled={branchesForSelectedBusiness.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select branch" />
                        </SelectTrigger>
                        <SelectContent>
                          {branchesForSelectedBusiness.map((branch) => (
                            <SelectItem key={branch.id} value={branch.id}>
                              {branch.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {branchesForSelectedBusiness.length === 0 && (
                        <p className="text-xs text-amber-800">No branches for this business. Create a branch first.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsGiveAccessDialogOpen(false)} className="h-11 rounded-[10px] border-[rgba(15,23,60,0.06)] px-7 font-semibold text-[#4a5578] hover:bg-[#f0f2f7]">
                  Cancel
                </Button>
                <Button
                  className="h-11 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                  onClick={() => void handleGiveAccessSubmit()}
                  disabled={isLoading || !giveAccessBranchId || !existingUserMatch}
                >
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Add as staff
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <button
            type="button"
            disabled={isAddStaffDisabled}
            onClick={() => {
              let autoBranchId = "";
              if (selectedBranchId) {
                autoBranchId = selectedBranchId;
              } else if (getEffectiveRole() === 'MANAGER' && currentUser?.branchId) {
                autoBranchId = currentUser.branchId;
              }

              setNewUser({
                name: "",
                email: "",
                username: "",
                branchId: autoBranchId,
                role: "CASHIER",
                password: "",
                isActive: true,
              });
              setIsCreateDialogOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-[10px] border border-[rgba(15,23,60,0.06)] bg-white px-[22px] py-3 text-sm font-semibold text-[#4a5578] shadow-sm transition-all hover:border-black/10 hover:text-[#0a1128] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
          >
            <UserPlus className="h-[18px] w-[18px] stroke-[2]" strokeLinecap="round" />
            Quick Create Cashier
          </button>
        </div>
      </div>
      <div className="zv3-animate-fadeUp rounded-xl border border-[rgba(15,23,60,0.06)] bg-white/80 px-4 py-2 text-sm text-[#4a5578]">
        Staff seats used: <span className="font-semibold text-[#0a1128]">{staffUsageSummary}</span>
        {businessPlanName ? ` on ${businessPlanName}` : ''}
        {isStaffLimitReached ? '. Staff limit reached. Upgrade your plan to add more team members.' : ''}
      </div>
      {success && (
        <div className="zv3-animate-fadeUp zv3-delay-1 rounded-2xl border border-green-600/15 bg-green-50/90 px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <p className="text-sm font-medium text-green-800">{success}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSuccess('')}
            className="mt-2 border-green-600/20 text-green-800 hover:bg-green-100/50"
          >
            Dismiss
          </Button>
        </div>
      )}

      {error && (
        <div className="zv3-animate-fadeUp zv3-delay-1">
          <Alert
            variant="destructive"
            className="rounded-2xl border border-red-200/60 bg-red-50/90 shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
          >
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className="zv3-animate-fadeUp zv3-delay-1 flex flex-col flex-wrap items-stretch gap-4 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-5 py-5 sm:flex-row sm:items-end sm:px-7 xl:flex-nowrap">
        <div className="min-w-0 flex-[2.5]">
          <Label
            htmlFor="search"
            className="mb-2 block text-xs font-semibold tracking-wide text-[#8c95b0]"
          >
            Search Users
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]"
              strokeWidth={2}
            />
            <Input
              id="search"
              placeholder="Search by name, email, or username..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-11 rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] pl-10 pr-3.5 text-sm text-[#0a1128] transition-all placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.06)]"
            />
          </div>
        </div>
        <div className="min-w-[160px] flex-1">
          <Label
            htmlFor="role-filter"
            className="mb-2 block text-xs font-semibold tracking-wide text-[#8c95b0]"
          >
            Filter by Role
          </Label>
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger
              id="role-filter"
              className="h-11 rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] text-sm font-normal text-[#0a1128] focus:ring-4 focus:ring-[rgba(26,82,197,0.06)]"
            >
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="CASHIER">Cashier</SelectItem>
              <SelectItem value="MANAGER">Manager</SelectItem>
              {/* OWNER filter only shown to owners */}
              {getEffectiveRole() === 'OWNER' && (
                <SelectItem value="OWNER">Owner</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px] flex-1">
          <Label
            htmlFor="status-filter"
            className="mb-2 block text-xs font-semibold tracking-wide text-[#8c95b0]"
          >
            Filter by Access
          </Label>
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger
              id="status-filter"
              className="h-11 rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] text-sm font-normal text-[#0a1128] focus:ring-4 focus:ring-[rgba(26,82,197,0.06)]"
            >
              <SelectValue placeholder="All access levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Access</SelectItem>
              <SelectItem value="active">Access Granted</SelectItem>
              <SelectItem value="inactive">Access Removed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="zv3-animate-fadeUp zv3-delay-2 overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2.5 border-b border-[rgba(15,23,60,0.06)] px-8 py-[22px]">
          <Users className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
          <span className="text-[17px] font-bold text-[#0a1128]">Staff</span>
          <span className="text-sm font-medium text-[#8c95b0]">({filteredUsers.length})</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                <th className="px-5 py-3.5 pl-8 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                  Staff
                </th>
                <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                  Username
                </th>
                <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                  Role
                </th>
                <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                  Branch
                </th>
                <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                  Access
                </th>
                <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                  Created
                </th>
                <th className="px-5 py-3.5 pr-8 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr key="empty-state">
                  <td colSpan={7} className="px-8 py-14 text-center text-sm text-[#8c95b0]">
                    {users.length === 0
                      ? 'No staff found in this branch'
                      : 'No staff match your search criteria'}
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((user) => {
                  const initial =
                    user.name?.trim()?.charAt(0)?.toUpperCase() ||
                    user.username?.charAt(0)?.toUpperCase() ||
                    '?';
                  const isOwnerRow =
                    user.isOwner ||
                    (!!companyCreatorId && String(user.id) === String(companyCreatorId));
                  return (
                    <tr
                      key={user.id}
                      className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                    >
                      <td className="px-5 py-[18px] pl-8 align-middle">
                        <div className="flex items-center gap-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-[15px] font-bold text-white">
                            {initial}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#0a1128]">{user.name}</p>
                            <p className="mt-0.5 text-xs text-[#8c95b0]">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-[18px] align-middle">
                        <span className="text-sm font-medium text-[#4a5578]">{user.username}</span>
                      </td>
                      <td className="px-5 py-[18px] align-middle">
                        <span className={staffRoleBadgeClass(staffDisplayRole(user))}>
                          {getRoleIcon(staffDisplayRole(user), 'h-3 w-3 shrink-0')}
                          {formatRoleLabel(staffDisplayRole(user))}
                        </span>
                      </td>
                      <td className="px-5 py-[18px] align-middle">
                        <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                          <span>{branches.find(b => b.id === user.branchId)?.name || user.branch?.name || 'Unknown Branch'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-[18px] align-middle">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wide',
                            user.businessAccessGranted !== false
                              ? 'border border-green-600/12 bg-[rgba(22,163,74,0.08)] text-green-600'
                              : 'border border-[rgba(15,23,60,0.06)] bg-black/[0.03] text-[#8c95b0]',
                          )}
                        >
                          {user.businessAccessGranted !== false ? 'Access Granted' : 'Access Removed'}
                        </span>
                      </td>
                      <td className="px-5 py-[18px] align-middle text-[13px] text-[#4a5578]">
                        {user.createdAt && !isNaN(new Date(user.createdAt).getTime())
                          ? new Date(user.createdAt).toLocaleDateString()
                          : 'N/A'}
                      </td>
                      <td className="px-5 py-[18px] pr-8 text-right align-middle">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleViewUser(user)}
                            title="View Staff Details"
                            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                          >
                            <Eye className="h-[15px] w-[15px]" strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditUser(user)}
                            title="Edit Staff"
                            disabled={isOwnerRow}
                            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                          >
                            <Edit className="h-[15px] w-[15px]" strokeWidth={2} />
                          </button>
                          {!isOwnerRow && ((getEffectiveRole() === 'OWNER' ||
                            (selectedCompanyId &&
                              companies.find((c) => c.id === selectedCompanyId)?.createdBy ===
                                currentUser?.id) ||
                            user.createdBy === currentUser?.id) ||
                            (getEffectiveRole() === 'MANAGER' &&
                              staffDisplayRole(user) === 'CASHIER' &&
                              user.branchId === currentUser?.branchId)) && (
                            <button
                              type="button"
                              onClick={() => handleToggleBusinessAccess(user)}
                              title={user.businessAccessGranted !== false ? 'Remove Business Access' : 'Allow Business Access'}
                              className={cn(
                                'grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent transition-colors hover:border-black/10 hover:bg-[#f0f2f7]',
                                user.businessAccessGranted !== false
                                  ? 'text-amber-600 hover:text-amber-700'
                                  : 'text-green-600 hover:text-green-700',
                              )}
                            >
                              {user.businessAccessGranted !== false ? (
                                <UserX className="h-[15px] w-[15px]" strokeWidth={2} />
                              ) : (
                                <UserCheck className="h-[15px] w-[15px]" strokeWidth={2} />
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(user)}
                            title={
                              selectedCompanyId
                                ? "Remove from this business"
                                : "Delete platform account (Super Admin only)"
                            }
                            disabled={isOwnerRow}
                            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-red-600/15 hover:bg-red-600/[0.05] hover:text-red-600"
                          >
                            <Trash2 className="h-[15px] w-[15px]" strokeWidth={2} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4 border-t border-[rgba(15,23,60,0.06)]">
          <div className="flex items-center gap-3">
            <div className="text-sm text-[#8c95b0]">
              Showing {((safePage - 1) * pageSize) + 1} to {Math.min(safePage * pageSize, filteredUsers.length)} of {filteredUsers.length} staff
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-[#8c95b0]">Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="h-[32px] rounded-lg border border-[rgba(15,23,60,0.06)] bg-white px-2 text-sm font-semibold text-[#0a1128] outline-none focus:ring-2 focus:ring-[rgba(26,82,197,0.15)]"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={safePage === 1}
                className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
              >
                Previous
              </button>
              <span className="text-sm font-semibold text-[#0a1128]">
                Page {safePage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={safePage === totalPages}
                className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="zv3-animate-fadeUp zv3-delay-3 mt-6">
        <h2 className="mb-4 text-lg font-bold tracking-tight text-[#0a1128]">Role Permissions</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {roles.map((role) => {
            const IconComponent = role.icon;
            const isCashier = role.id === 'CASHIER';
            return (
              <div
                key={role.id}
                className="rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white p-6 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(0,0,0,0.06)]"
              >
                <div className="mb-3.5 flex items-center gap-3.5">
                  <div
                    className={cn(
                      'grid h-11 w-11 shrink-0 place-items-center rounded-xl',
                      isCashier
                        ? 'bg-amber-500/[0.08]'
                        : 'bg-gradient-to-br from-[rgba(26,82,197,0.1)] to-[rgba(40,194,206,0.06)]',
                    )}
                  >
                    <IconComponent
                      className={cn(
                        'h-5 w-5',
                        isCashier ? 'text-[#b45309]' : 'text-[#1a52c5]',
                      )}
                      strokeWidth={2}
                    />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#0a1128]">{role.label}</h3>
                    <p className="mt-0.5 text-[13px] text-[#8c95b0]">{role.description}</p>
                  </div>
                </div>
                <p className="text-[13px] leading-relaxed text-[#4a5578]">
                  {role.id === 'OWNER' && 'Full business access, can allow or remove staff access'}
                  {role.id === 'OWNER' && 'Company-wide administration, branches, and staff management'}
                  {role.id === 'MANAGER' &&
                    'Branch management, inventory, sales reports, can allow or remove cashier access'}
                  {role.id === 'CASHIER' && 'Sales, billing, customer management'}
                </p>
              </div>
            );
          })}
        </div>
      </div>
      </div>

      {/* Add Staff Modal */}
      <AddStaffModal
        open={showAddStaff}
        onClose={() => setShowAddStaff(false)}
        onSuccess={() => { setShowAddStaff(false); loadUsers(); }}
        businessId={selectedCompanyId || ''}
        branches={branches}
      />

      {/* View User Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
            <DialogDescription>
              View detailed information about this user.
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4 py-4">
              <div className="flex items-center space-x-4">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                  <span className="text-xl font-medium text-primary">
                    {selectedUser.name.split(' ').map((n, index) => n[0]).join('')}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold">{selectedUser.name}</h3>
                  <p className="text-muted-foreground">{selectedUser.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Username</Label>
                  <p className="text-sm text-muted-foreground">{selectedUser.username}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Role</Label>
                  <div className="mt-1">
                    <Badge variant={getRoleBadgeVariant(selectedUser.role)} className="flex items-center space-x-1 w-fit">
                      {getRoleIcon(selectedUser.role)}
                      <span>{selectedUser.role}</span>
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Branch</Label>
                  <p className="text-sm text-muted-foreground">{selectedUser.branch?.name || 'Unknown Branch'}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Business Access</Label>
                  <div className="mt-1">
                    <Badge
                      variant={selectedUser.businessAccessGranted !== false ? 'default' : 'secondary'}
                      className={selectedUser.businessAccessGranted !== false ? 'bg-green-100 text-green-800 border-green-200' : 'bg-gray-100 text-gray-800 border-gray-200'}
                    >
                      {selectedUser.businessAccessGranted !== false ? 'Access Granted' : 'Access Removed'}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Created</Label>
                  <p className="text-sm text-muted-foreground">{new Date(selectedUser.createdAt).toLocaleDateString()}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Last Updated</Label>
                  <p className="text-sm text-muted-foreground">{new Date(selectedUser.updatedAt).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Staff Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Staff</DialogTitle>
            <DialogDescription>
              Update user information. Leave password empty to keep current password.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-name" className="text-right">
                Name
              </Label>
              <Input
                id="edit-name"
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                className="col-span-3"
                placeholder="Enter full name"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-email" className="text-right">
                Email
              </Label>
              <Input
                id="edit-email"
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="col-span-3"
                placeholder="Enter email address"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-username" className="text-right">
                Username
              </Label>
              <Input
                id="edit-username"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                className="col-span-3"
                placeholder="Enter username"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-password" className="text-right">
                Password
              </Label>
              <div className="col-span-3 relative">
                <Input
                  id="edit-password"
                  type={showEditPassword ? "text" : "password"}
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="pr-10"
                  placeholder="Enter new password (optional)"
                />
                <button
                  type="button"
                  onClick={() => setShowEditPassword(!showEditPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showEditPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-role" className="text-right">
                Role
              </Label>
              <Select
                value={newUser.role}
                onValueChange={(value) => setNewUser({ ...newUser, role: value })}
                disabled={newUser.role === 'OWNER'}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {editRoleOptions.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      <div className="flex items-center space-x-2">
                        {getRoleIcon(role.id)}
                        <span>{role.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-branch" className="text-right">
                Branch
              </Label>
              <Select value={newUser.branchId} onValueChange={(value) => setNewUser({ ...newUser, branchId: value })}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} className="h-11 rounded-[10px] border-[rgba(15,23,60,0.06)] px-7 font-semibold text-[#4a5578] hover:bg-[#f0f2f7]">
              Cancel
            </Button>
            <Button
              className="h-11 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
              onClick={handleUpdateUser}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Update Staff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Staff Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {selectedCompanyId ? "Remove from this business" : "Delete platform account"}
            </DialogTitle>
            <DialogDescription>
              {selectedCompanyId
                ? "This removes the person from the current business only. Their Zapeera login and other businesses are not deleted."
                : "Select a business in the header to remove someone from that business without deleting their account."}
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="py-4">
              <div className="flex items-center space-x-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                  <span className="text-lg font-medium text-red-600">
                    {selectedUser.name.split(' ').map((n, index) => n[0]).join('')}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold text-red-900">{selectedUser.name}</h3>
                  <p className="text-sm text-red-700">{selectedUser.email}</p>
                  <p className="text-sm text-red-600">Role: {selectedUser.role}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)} className="h-11 rounded-[10px] border-[rgba(15,23,60,0.06)] px-7 font-semibold text-[#4a5578] hover:bg-[#f0f2f7]">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteUser}
              disabled={isLoading || !selectedCompanyId}
              className="h-11 rounded-[10px] px-7 font-semibold shadow-[0_4px_16px_rgba(220,38,38,0.25)]"
            >
              {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {selectedCompanyId ? "Remove from business" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(UserManagement);
