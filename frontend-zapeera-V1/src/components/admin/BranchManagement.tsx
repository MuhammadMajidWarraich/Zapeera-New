import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Building2,
  Plus,
  Search,
  Edit,
  Trash2,
  User,
  MapPin,
  Phone,
  Mail,
  AlertTriangle,
  ScanLine,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAdmin } from '@/contexts/useAdmin';
import { toast } from '@/hooks/use-toast';
import { getMissingRequiredFields } from '@/lib/required-fields';

const branchModalField = cn(
  'h-11 w-full rounded-lg border-[1.5px] border-black/[0.08] bg-[#f4f5f7] px-4 text-[15px] text-[#0a1128] transition-colors',
  'placeholder:text-[#8c95b0]',
  'focus-visible:border-[#1b8a5a] focus-visible:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1b8a5a]/12',
);

interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  managerId?: string;
  companyId: string;
  isActive: boolean;
  createdAt: string;
  company?: {
    id: string;
    name: string;
  };
  manager?: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
  _count?: {
    users: number;
    products: number;
    customers: number;
    sales?: number;
  };
}

interface Company {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

const BranchManagement = () => {
  const { user } = useAuth();
  const { refreshBranches: refreshGlobalBranches, refreshCompanies: refreshGlobalCompanies, selectedCompanyId: globalSelectedCompanyId } = useAdmin();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false); // Don't show loading initially
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Branch ID tracking disabled

  const [recentlyCreatedBranchIds, setRecentlyCreatedBranchIds] = useState<Set<string>>(new Set());

  // Save recently created branch IDs to localStorage whenever it changes
    // Branch ID saving disabled

  // Dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [createDialogError, setCreateDialogError] = useState("");
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [deletingBranch, setDeletingBranch] = useState<Branch | null>(null);

  // Form states
  const [newBranch, setNewBranch] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    companyId: ""
  });

  const [editBranch, setEditBranch] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    managerId: "",
    isActive: true
  });

  // CRITICAL FIX: Sync local selectedCompanyId with global selectedCompanyId from AdminContext
  useEffect(() => {
    if (globalSelectedCompanyId) {
      setSelectedCompanyId(globalSelectedCompanyId);
    } else {
      setSelectedCompanyId("all");
    }
  }, [globalSelectedCompanyId]);

  // Load branches on mount
  useEffect(() => {
    // Load fresh data
    setTimeout(() => {
      loadBranches();
    }, 100);

    setTimeout(() => {
      loadUsers();
    }, 300);

    setTimeout(() => {
      loadCompanies();
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // CRITICAL FIX: Reload branches instantly when global company selection changes
  useEffect(() => {
    const timer = setTimeout(() => {
      loadBranches();
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSelectedCompanyId]);

  // Also listen to custom event for immediate reload
  useEffect(() => {
    const handleReload = () => {
      loadBranches();
    };
    window.addEventListener('branchOrCompanyChanged', handleReload);
    return () => window.removeEventListener('branchOrCompanyChanged', handleReload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBranches = useCallback(async () => {
    try {
      const response = await apiService.getBranches();
      if (response.success && response.data) {
        const branchesData = Array.isArray(response.data) ? response.data : response.data.branches;
        branchesData.forEach((branch: any) => {
        });

        setBranches(prevBranches => {
          const prevRecentlyCreatedBranches = prevBranches.filter(b =>
            recentlyCreatedBranchIds.has(b.id) &&
            !branchesData.find((apiBranch: any) => apiBranch.id === b.id)
          );

          const combinedBranches = [...branchesData as Branch[], ...prevRecentlyCreatedBranches];

          const uniqueBranches = combinedBranches.reduce((acc, branch) => {
            const existing = acc.find(b => b.id === branch.id);
            if (!existing) {
              acc.push(branch);
            } else {
              const index = acc.indexOf(existing);
              acc[index] = branch;
            }
            return acc;
          }, [] as Branch[]);
          return uniqueBranches;
        });
      } else {
        setError('Failed to load branches');
      }
    } catch (error) {
      setError('Failed to load branches');
    }
  }, [recentlyCreatedBranchIds]);

  const loadUsers = async () => {
    try {
      const response = await apiService.getUsers({ page: 1, limit: 1000 });
      if (response.success && response.data) {
        const usersData = Array.isArray(response.data) ? response.data : response.data.users;
        setUsers(usersData);
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

  const filteredBranches = branches.filter(branch => {
    // CRITICAL FIX: Always show recently created branches regardless of filters
    if (recentlyCreatedBranchIds.has(branch.id)) {
      return true;
    }

    const matchesSearch = branch.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      branch.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      branch.email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCompany = selectedCompanyId === "all" || !selectedCompanyId || branch.companyId === selectedCompanyId;

    return matchesSearch && matchesCompany;
  });

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCompanyId, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredBranches.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedBranches = filteredBranches.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleCreateBranch = async () => {
    const missing = getMissingRequiredFields(newBranch, {
      companyId: 'Business',
      name: 'Branch Name',
      address: 'Address',
      phone: 'Phone',
      email: 'Email',
    });
    if (missing.length > 0) {
      const errorMessage = `Please fill in all required fields: ${missing.join(', ')}`;
      setError(errorMessage);
      setCreateDialogError(errorMessage);
      toast({
        title: 'Required fields missing',
        description: errorMessage,
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsLoading(true);
      const response = await apiService.createBranch({
        name: newBranch.name,
        address: newBranch.address,
        phone: newBranch.phone,
        email: newBranch.email,
        companyId: newBranch.companyId
      });

      if (response.success && response.data) {
        // CRITICAL FIX: Add newly created branch to recentlyCreatedBranchIds immediately
        const createdBranch = response.data;
        const branchIdWithTime = `${createdBranch.id}|${Date.now()}`;
        setRecentlyCreatedBranchIds(prev => new Set([...prev, createdBranch.id]));

        // CRITICAL FIX: Add the newly created branch directly to the list FIRST (before loadBranches)
        const newBranchData: Branch = {
          id: createdBranch.id,
          name: createdBranch.name,
          address: createdBranch.address || '',
          phone: createdBranch.phone || '',
          email: createdBranch.email || '',
          companyId: createdBranch.companyId,
          managerId: createdBranch.managerId,
          isActive: createdBranch.isActive !== undefined ? createdBranch.isActive : true,
          createdAt: createdBranch.createdAt || new Date().toISOString(),
          company: (createdBranch as any).company
        };

        // Add to branches state immediately (optimistic update)
        setBranches(prevBranches => {
          // Check if branch already exists
          const exists = prevBranches.find(b => b.id === createdBranch.id);
          if (exists) {
            // Update existing
            return prevBranches.map(b => b.id === createdBranch.id ? newBranchData : b);
          } else {
            // Add new
            return [newBranchData, ...prevBranches];
          }
        });

        setNewBranch({ name: "", address: "", phone: "", email: "", companyId: "" });
        setCreateDialogError("");
        setIsCreateDialogOpen(false);

        // CRITICAL FIX: Wait 500ms before calling loadBranches to give backend time to sync
        setTimeout(async () => {
          await loadBranches();
          // Refresh global branches to update dropdown instantly
          await refreshGlobalBranches();
        }, 500);

        setError("");
      } else {
        const errorMessage = response.message || 'Failed to create branch';
        setError(errorMessage);
        setCreateDialogError(errorMessage);
        toast({
          title: 'Unable to create branch',
          description: errorMessage,
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.response?.message || error?.message || 'Failed to create branch';
      setError(errorMessage);
      setCreateDialogError(errorMessage);
      toast({
        title: 'Unable to create branch',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditBranch = async () => {
    if (!editingBranch) {
      toast({
        title: "Error",
        description: "No branch selected for editing",
        variant: "destructive",
      });
      return;
    }

    if (!editBranch.name || !editBranch.address || !editBranch.phone || !editBranch.email) {
      const errorMessage = "Please fill in all required fields!";
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      const updateData = {
        name: editBranch.name,
        address: editBranch.address,
        phone: editBranch.phone,
        email: editBranch.email,
        managerId: editBranch.managerId || undefined,
        isActive: editBranch.isActive
      };
      const response = await apiService.updateBranch(editingBranch.id, updateData);
      if (response && response.success) {
        // Update branch in local state
        if (response.data) {
          setBranches(prevBranches => {
            const updatedBranches = prevBranches.map(branch =>
              branch.id === editingBranch.id
                ? { ...branch, ...response.data }
                : branch
            );

            return updatedBranches;
          });
        }

        toast({
          title: "Success",
          description: "Branch updated successfully",
        });
        setEditingBranch(null);
        setIsEditDialogOpen(false);

        // CRITICAL FIX: Refresh global branches to update dropdown instantly
        // Don't call loadBranches() here - it might overwrite our updated cache with stale server data
        // The optimistic update + cache update is sufficient for instant UI update
        // Fresh data will load automatically when component remounts or user navigates
        await refreshGlobalBranches();
        // OPTIONAL: Load fresh data in background after a delay (to allow server to process)
        // This ensures eventual consistency without blocking the UI
        setTimeout(async () => {
          await loadBranches();
        }, 2000); // 2 second delay to ensure server has processed the update
        setError("");
      } else {
        const errorMessage = response?.message || 'Failed to update branch';
        setError(errorMessage);
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.response?.message || error?.message || 'Failed to update branch';
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

  const handleDeleteBranch = async () => {
    if (!deletingBranch) {
      toast({
        title: "Error",
        description: "No branch selected for deletion",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsLoading(true);
      setError("");
      const response = await apiService.deleteBranch(deletingBranch.id);
      if (response && response.success) {
        toast({
          title: "Success",
          description: "Branch deleted successfully",
        });
        setDeletingBranch(null);
        setIsDeleteDialogOpen(false);
        await loadBranches();
        // Refresh global branches to update dropdown instantly
        await refreshGlobalBranches();
        setError("");
      } else {
        const errorMessage = response?.message || 'Failed to delete branch';
        setError(errorMessage);
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.response?.message || error?.message || 'Failed to delete branch';
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

  const openEditDialog = (branch: Branch) => {
    setEditingBranch(branch);
    setEditBranch({
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
      email: branch.email,
      managerId: branch.managerId || "",
      isActive: branch.isActive
    });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (branch: Branch) => {
    setDeletingBranch(branch);
    setIsDeleteDialogOpen(true);
  };

  // Open create dialog with pre-selected business from header dropdown
  const openCreateDialog = () => {
    // Pre-select the currently active business from the header dropdown
    setNewBranch({
      name: "",
      address: "",
      phone: "",
      email: "",
      companyId: globalSelectedCompanyId || (companies.length > 0 ? companies[0].id : "")
    });
    setIsCreateDialogOpen(true);
  };

  const getManagerName = (branch: Branch) => {
    // CRITICAL FIX: Check manager object first (from API)
    if (branch.manager && branch.manager.name) {
      return branch.manager.name;
    }
    // Fallback: Check managerId and lookup in users array
    if (branch.managerId) {
    const manager = users.find(user => user.id === branch.managerId);
      if (manager) {
        return manager.name;
      }
      // If managerId exists but user not found, show "Manager (ID: ...)"
      return `Manager (ID: ${branch.managerId.substring(0, 8)}...)`;
    }
    return "No Manager";
  };

  const getManagerRole = (branch: Branch) => {
    // CRITICAL FIX: Check manager object first (from API)
    if (branch.manager && branch.manager.role) {
      return branch.manager.role;
    }
    // Fallback: Check managerId and lookup in users array
    if (branch.managerId) {
    const manager = users.find(user => user.id === branch.managerId);
      if (manager) {
        return manager.role;
      }
      return "MANAGER"; // Default if managerId exists
    }
    return "";
  };

  const formatManagerRoleLabel = (role: string) => {
    if (!role) return "";
    const t = role.replace(/_/g, " ").toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

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

      <div className="relative z-[1] px-6 pb-14 pt-9 sm:px-11">
        <div className="zv3-animate-fadeUp mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">
              Branch Management
            </h1>
            <p className="text-sm text-[#8c95b0]">
              Manage your branches and their details •{' '}
              <b className="font-semibold text-[#4a5578]">{filteredBranches.length} branches total</b>
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateDialog}
            className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(26,82,197,0.35)]"
          >
            <Plus className="h-[18px] w-[18px] stroke-[2.5]" strokeLinecap="round" />
            Add Branch
          </button>
        </div>

        {error && (
          <div className="zv3-animate-fadeUp zv3-delay-1 mb-5">
            <Alert
              variant="destructive"
              className="rounded-2xl border border-red-200/60 bg-red-50/90 shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
            >
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        <div className="relative zv3-animate-fadeUp zv3-delay-1 mb-5">
          <Search
            className="pointer-events-none absolute left-[18px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8c95b0]"
            strokeWidth={2}
          />
          <Input
            placeholder="Search branches by name, address, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-[50px] rounded-2xl border-[1.5px] border-[rgba(15,23,60,0.06)] bg-white pl-12 pr-5 text-[15px] text-[#0a1128] shadow-none transition-all placeholder:text-[#8c95b0] placeholder:font-normal focus-visible:border-[#1a52c5] focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.06)]"
          />
        </div>

        <div
          className="zv3-animate-fadeUp zv3-delay-2 overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]"
        >
          {filteredBranches.length === 0 && !isLoading ? (
            <div className="px-8 py-16 text-center">
              <div className="mx-auto mb-6 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[rgba(26,82,197,0.06)]">
                <Building2 className="h-6 w-6 text-[#8c95b0]" />
              </div>
              <h3 className="mb-2 text-sm font-bold text-[#0a1128]">
                {searchTerm ? 'No branches found' : 'No branches yet'}
              </h3>
              <p className="mx-auto mb-6 max-w-md text-sm text-[#8c95b0]">
                {searchTerm
                  ? 'No branches match your search criteria. Try adjusting your search terms.'
                  : 'Get started by creating your first branch to manage your business operations.'}
              </p>
              {!searchTerm && (
                <Button
                  onClick={openCreateDialog}
                  className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create First Branch
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                      <th className="px-6 py-4 pl-8 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Branch Details
                      </th>
                      <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Contact Info
                      </th>
                      <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Manager
                      </th>
                      <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Statistics
                      </th>
                      <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Status
                      </th>
                      <th className="px-6 py-4 pr-8 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedBranches.map((branch) => (
                      <tr
                        key={branch.id}
                        className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                      >
                        <td className="px-6 py-[22px] pl-8 align-middle text-sm text-[#4a5578]">
                          <div className="flex items-center gap-3.5">
                            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[rgba(26,82,197,0.08)] to-[rgba(40,194,206,0.06)]">
                              <Building2 className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[15px] font-bold text-[#0a1128]">{branch.name}</div>
                              <div className="text-xs text-[#8c95b0]">
                                {branch.company?.name || 'Unknown Business'} • Created{' '}
                                {new Date(branch.createdAt).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-[22px] align-middle">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                              <MapPin className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                              <span className="max-w-[220px] truncate" title={branch.address}>
                                {branch.address}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                              <Phone className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                              <span>{branch.phone}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                              <Mail className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                              <span className="max-w-[220px] truncate" title={branch.email}>
                                {branch.email}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-[22px] align-middle">
                          <div className="flex items-center gap-2.5">
                            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[rgba(26,82,197,0.1)] to-[rgba(40,194,206,0.08)]">
                              <User className="h-4 w-4 text-[#1a52c5]" strokeWidth={2} />
                            </div>
                            <div className="min-w-0">
                              <div
                                className={cn(
                                  'text-sm font-semibold text-[#0a1128]',
                                  getManagerName(branch) === 'No Manager' && 'text-[#8c95b0]',
                                )}
                              >
                                {getManagerName(branch)}
                              </div>
                              {getManagerRole(branch) ? (
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#1a52c5]">
                                  {formatManagerRoleLabel(getManagerRole(branch))}
                                </div>
                              ) : (
                                <div className="text-[11px] font-medium text-[#8c95b0]">Unassigned</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-[22px] align-middle">
                          <div className="flex gap-4">
                            <div className="text-center">
                              <div className="text-lg font-extrabold tracking-tight text-[#1a52c5]">
                                {branch._count?.users ?? 0}
                              </div>
                              <div className="mt-0.5 text-[11px] font-medium text-[#8c95b0]">Staff</div>
                            </div>
                            <div className="text-center">
                              <div className="text-lg font-extrabold tracking-tight text-[#1aa8b3]">
                                {branch._count?.products ?? 0}
                              </div>
                              <div className="mt-0.5 text-[11px] font-medium text-[#8c95b0]">Products</div>
                            </div>
                            <div className="text-center">
                              <div className="text-lg font-extrabold tracking-tight text-[#1f8ac8]">
                                {branch._count?.customers ?? 0}
                              </div>
                              <div className="mt-0.5 text-[11px] font-medium text-[#8c95b0]">Customers</div>
                            </div>
                            {branch._count?.sales !== undefined && (
                              <div className="text-center">
                                <div className="text-lg font-extrabold tracking-tight text-[#1a52c5]">
                                  {branch._count.sales ?? 0}
                                </div>
                                <div className="mt-0.5 text-[11px] font-medium text-[#8c95b0]">Sales</div>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-[22px] align-middle">
                          <span
                            className={cn(
                              'inline-flex rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wide',
                              branch.isActive
                                ? 'border border-green-600/12 bg-[rgba(22,163,74,0.08)] text-green-600'
                                : 'border border-[rgba(15,23,60,0.08)] bg-black/[0.03] text-[#8c95b0]',
                            )}
                          >
                            {branch.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-[22px] pr-8 text-right align-middle">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              title="Edit"
                              onClick={() => openEditDialog(branch)}
                              className="grid h-9 w-9 place-items-center rounded-[9px] border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                            >
                              <Edit className="h-4 w-4" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              title="Delete"
                              onClick={() => openDeleteDialog(branch)}
                              className="grid h-9 w-9 place-items-center rounded-[9px] border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-red-600/15 hover:bg-red-600/[0.05] hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={2} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4 border-t border-[rgba(15,23,60,0.06)]">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-[#8c95b0]">
                    Showing {((safePage - 1) * pageSize) + 1} to {Math.min(safePage * pageSize, filteredBranches.length)} of {filteredBranches.length} branches
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
            </>
          )}
        </div>
      </div>

      {/* Create Branch Dialog */}
      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          setIsCreateDialogOpen(open);
          if (!open) setCreateDialogError("");
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="text-xl font-semibold tracking-tight text-[#0a1128]">
              Create New Branch
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-[#8c95b0]">
              Add a new branch to the system. You can assign a manager later after creating users.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5 py-6">
            {createDialogError && (
              <Alert className="border-red-200 bg-red-50 text-red-700">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{createDialogError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="company" className="text-sm font-semibold text-[#0a1128]">
                Business <span className="text-[#dc2626]">*</span>
              </Label>
              <Select value={newBranch.companyId} onValueChange={(value) => setNewBranch({ ...newBranch, companyId: value })}>
                <SelectTrigger id="company" className={cn(branchModalField, 'flex justify-between')}>
                  <SelectValue placeholder="Select a business" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id} className="cursor-pointer">
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-semibold text-[#0a1128]">
                Branch Name <span className="text-[#dc2626]">*</span>
              </Label>
              <Input
                id="name"
                value={newBranch.name}
                onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })}
                placeholder="Enter branch name"
                className={branchModalField}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address" className="text-sm font-semibold text-[#0a1128]">
                Address <span className="text-[#dc2626]">*</span>
              </Label>
              <Input
                id="address"
                value={newBranch.address}
                onChange={(e) => setNewBranch({ ...newBranch, address: e.target.value })}
                placeholder="Enter branch address"
                className={branchModalField}
              />
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-semibold text-[#0a1128]">
                  Phone <span className="text-[#dc2626]">*</span>
                </Label>
                <Input
                  id="phone"
                  value={newBranch.phone}
                  onChange={(e) => setNewBranch({ ...newBranch, phone: e.target.value })}
                  placeholder="Enter phone number"
                  className={branchModalField}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-semibold text-[#0a1128]">
                  Email <span className="text-[#dc2626]">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="email"
                    type="email"
                    value={newBranch.email}
                    onChange={(e) => setNewBranch({ ...newBranch, email: e.target.value })}
                    placeholder="Enter email address"
                    className={cn(branchModalField, 'pr-11')}
                  />
                  <ScanLine className="pointer-events-none absolute right-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8c95b0]" aria-hidden />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-3 border-t border-[rgba(15,23,60,0.06)] pt-6 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              className="h-11 rounded-lg border-[rgba(15,23,60,0.12)] bg-white px-7 text-sm font-semibold text-[#0a1128] hover:bg-[#f4f5f7]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateBranch}
              disabled={isLoading}
              className="h-11 rounded-lg border-0 bg-[#1b8a5a] px-7 text-sm font-semibold text-white shadow-sm hover:bg-[#167a50] disabled:opacity-60"
            >
              {isLoading ? 'Creating...' : 'Create Branch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Branch Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="text-xl font-semibold tracking-tight text-[#0a1128]">
              Edit Branch
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-[#8c95b0]">
              Update branch information and settings.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5 py-6">
            <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-sm font-semibold text-[#0a1128]">
                Branch Name <span className="text-[#dc2626]">*</span>
              </Label>
              <Input
                id="edit-name"
                value={editBranch.name}
                onChange={(e) => setEditBranch({ ...editBranch, name: e.target.value })}
                placeholder="Enter branch name"
                className={branchModalField}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-address" className="text-sm font-semibold text-[#0a1128]">
                Address <span className="text-[#dc2626]">*</span>
              </Label>
              <Input
                id="edit-address"
                value={editBranch.address}
                onChange={(e) => setEditBranch({ ...editBranch, address: e.target.value })}
                placeholder="Enter branch address"
                className={branchModalField}
              />
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-phone" className="text-sm font-semibold text-[#0a1128]">
                  Phone <span className="text-[#dc2626]">*</span>
                </Label>
                <Input
                  id="edit-phone"
                  value={editBranch.phone}
                  onChange={(e) => setEditBranch({ ...editBranch, phone: e.target.value })}
                  placeholder="Enter phone number"
                  className={branchModalField}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email" className="text-sm font-semibold text-[#0a1128]">
                  Email <span className="text-[#dc2626]">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="edit-email"
                    type="email"
                    value={editBranch.email}
                    onChange={(e) => setEditBranch({ ...editBranch, email: e.target.value })}
                    placeholder="Enter email address"
                    className={cn(branchModalField, 'pr-11')}
                  />
                  <ScanLine className="pointer-events-none absolute right-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8c95b0]" aria-hidden />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-3 border-t border-[rgba(15,23,60,0.06)] pt-6 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
              className="h-11 rounded-lg border-[rgba(15,23,60,0.12)] bg-white px-7 text-sm font-semibold text-[#0a1128] hover:bg-[#f4f5f7]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleEditBranch}
              disabled={isLoading}
              className="h-11 rounded-lg border-0 bg-[#1b8a5a] px-7 text-sm font-semibold text-white shadow-sm hover:bg-[#167a50] disabled:opacity-60"
            >
              {isLoading ? 'Updating...' : 'Update Branch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Branch Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="text-xl font-semibold tracking-tight text-[#0a1128]">
              Delete Branch
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-[#8c95b0]">
              Are you sure you want to delete &quot;{deletingBranch?.name}&quot;? This action will deactivate the
              branch and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3 border-t border-[rgba(15,23,60,0.06)] pt-6 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              className="h-11 rounded-lg border-[rgba(15,23,60,0.12)] bg-white px-7 text-sm font-semibold text-[#0a1128] hover:bg-[#f4f5f7]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteBranch}
              disabled={isLoading}
              className="h-11 rounded-lg border-0 bg-[#dc2626] px-7 text-sm font-semibold text-white shadow-sm hover:bg-[#b91c1c] disabled:opacity-60"
            >
              {isLoading ? 'Deleting...' : 'Delete Branch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(BranchManagement);