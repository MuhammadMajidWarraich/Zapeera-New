import React, { useState, useEffect, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Building2,
  Phone,
  Mail,
  MapPin,
  Package,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";
import { getMissingRequiredFields } from "@/lib/required-fields";
import { PaginationPills } from "@/components/ui/pagination-pills";
import { useDashboardData } from "@/contexts/DashboardDataContext";
import { cn } from "@/lib/utils";

interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email?: string;
  address?: string;
  manufacturerId?: string;
  branchId?: string;
  companyId?: string;
  manufacturer?: {
    id: string;
    name: string;
    country?: string;
  };
  createdAt: string;
  updatedAt: string;
  _count?: {
    products: number;
  };
}

interface Manufacturer {
  id: string;
  name: string;
  country?: string;
}

const supplierFormField = cn(
  "h-[46px] w-full rounded-[10px] border-[1.5px] border-black/[0.08] bg-white px-4 text-[15px] text-[#0a1128] transition-colors",
  "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.08)]",
);
const supplierTextarea = cn(
  "min-h-[90px] w-full resize-y rounded-[10px] border-[1.5px] border-black/[0.08] bg-white px-4 py-3.5 text-[15px] text-[#0a1128] transition-colors",
  "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.08)]",
);
const supplierSelectTrigger = cn(
  "h-[46px] w-full rounded-[10px] border-[1.5px] border-black/[0.08] bg-white text-[15px] text-[#0a1128] shadow-none",
  "focus:ring-4 focus:ring-[rgba(26,82,197,0.08)] focus:ring-offset-0",
);

const Suppliers = () => {
  const { user } = useAuth();
  const { selectedCompanyId, selectedBranchId, selectedBranch } = useAdmin();
  
  // Dashboard data cache (disabled - data caching removed)
  const {
    getCachedData,
    setCachedData,
    isCacheValid,
    setLoading: setCacheLoading
  } = useDashboardData();
  
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Form state for adding/editing suppliers
  const [formData, setFormData] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    manufacturerId: ''
  });

  // Load manufacturers
  const loadManufacturers = async () => {
    try {
      const response = await apiService.getManufacturers({
        page: 1,
        limit: 100,
        active: true
      });

      if (response.success) {
        setManufacturers(response.data.manufacturers || []);
      }
    } catch (error) {
      console.error('Error loading manufacturers:', error);
    }
  };

  // Load suppliers
  const loadSuppliers = async () => {
    try {
      // Check if branch selection is required for OWNER/ADMIN
      if (user?.role === 'OWNER' && !selectedBranchId && !selectedCompanyId) {
        console.log('⚠️ Branch or Company selection required for OWNER/ADMIN');
        setSuppliers([]);
        setError(null); // Clear error - this is expected behavior
        setLoading(false);
        return;
      }

      setLoading(true);
      
      console.log('🔍 Loading suppliers for branch:', selectedBranchId, 'company:', selectedCompanyId);
      const response = await apiService.getSuppliers({
        page: 1,
        limit: 1000,
        search: searchQuery,
      });
      console.log('🔍 Suppliers API response:', response);

      if (response.success && response.data) {
        // Handle both response.data.suppliers and response.data being an array
        const suppliersData = Array.isArray(response.data)
          ? response.data
          : (response.data.suppliers || []);
        console.log('✅ Suppliers loaded:', suppliersData.length);
        setSuppliers(suppliersData);
        setError(null); // Clear any previous errors
      } else {
        console.error('❌ Suppliers API returned error:', response.message || 'Unknown error');
        setError(response.message || 'Failed to load suppliers');
        setSuppliers([]); // Clear suppliers on error
      }
    } catch (err: any) {
      console.error('❌ Error loading suppliers:', err);
      console.error('Error details:', err.message, err.response?.data);
      setError(err.message || 'Failed to load suppliers');
      setSuppliers([]); // Clear suppliers on error
    } finally {
      setLoading(false);
    }
  };

  // Cache restoration removed - data caching disabled

  // Load data on mount and when search/page changes
  useEffect(() => {
    loadSuppliers();
    loadManufacturers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, currentPage]);

  // CRITICAL FIX: Reload suppliers when branch OR company changes
  useEffect(() => {
    console.log('🔄 Branch/Company changed in Suppliers - reloading suppliers:', { selectedBranchId, selectedCompanyId });
    setCurrentPage(1);
    loadSuppliers();
    loadManufacturers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId, selectedCompanyId]);

  // Also listen to custom event for immediate reload
  useEffect(() => {
    const handleReload = () => {
      console.log('🔄 Custom event: Branch/Company changed in Suppliers - reloading suppliers');
      loadSuppliers();
      loadManufacturers();
    };
    window.addEventListener('branchOrCompanyChanged', handleReload);
    return () => window.removeEventListener('branchOrCompanyChanged', handleReload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter suppliers based on search
  const filteredSuppliers = suppliers.filter((supplier) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      supplier.name.toLowerCase().includes(q) ||
      supplier.contactPerson.toLowerCase().includes(q) ||
      supplier.phone.includes(searchQuery) ||
      (supplier.email || "").toLowerCase().includes(q) ||
      (supplier.address || "").toLowerCase().includes(q);

    if (selectedBranchId) {
      return matchesSearch && supplier.branchId === selectedBranchId;
    }

    if (selectedCompanyId) {
      return matchesSearch && supplier.companyId === selectedCompanyId;
    }

    return matchesSearch;
  });

  // Reset pagination when filters/search change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedBranchId, selectedCompanyId, pageSize]);

  // Client-side pagination
  const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedSuppliers = filteredSuppliers.slice((safePage - 1) * pageSize, safePage * pageSize);



  const handleAddSupplier = async () => {
    try {
      setIsSubmitting(true);

      // Get branchId - use selectedBranchId for admin users, or user's branchId for others
      let branchId = user?.role === 'OWNER'
        ? selectedBranchId || user?.branchId || ''
        : user?.membership?.branchIds?.[0] || user?.branchId || '';
      
      // For managers/cashiers, check membership.branchIds if branchId is still empty
      if (!branchId && user?.role !== 'OWNER' && Array.isArray(user?.membership?.branchIds) && user.membership.branchIds.length > 0) {
        branchId = String(user.membership.branchIds[0]);
      }
      
      // If still no branch, check if a branch is selected in the context
      if (!branchId && selectedBranchId) {
        branchId = selectedBranchId;
      }

      if (!branchId) {
        toast({
          title: "Error",
          description: "Branch is required. Please select a branch first.",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      const missing = getMissingRequiredFields(formData as any, {
        name: "Supplier Name",
        contactPerson: "Contact Person",
        phone: "Phone",
      });
      if (missing.length > 0) {
        toast({
          title: "Required fields missing",
          description: `Please fill all required fields: ${missing.join(", ")}`,
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Clean up form data - convert empty strings to undefined for optional fields
      const cleanedFormData = {
        name: formData.name.trim(),
        contactPerson: formData.contactPerson.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim() || undefined,
        address: formData.address.trim() || undefined,
        manufacturerId: formData.manufacturerId || undefined,
        branchId: branchId
      };
      console.log('🔍 Form data being sent:', cleanedFormData);
      const response = await apiService.createSupplier(cleanedFormData);
      console.log('🔍 Create supplier response:', response);

      if (response.success) {
        toast({
          title: "Supplier Added",
          description: "Supplier has been added successfully.",
          variant: "success",
        });
        setShowAddDialog(false);
        setFormData({
          name: '',
          contactPerson: '',
          phone: '',
          email: '',
          address: '',
          manufacturerId: ''
        });
        // Reload suppliers immediately
        setTimeout(() => {
        loadSuppliers();
        }, 100);
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to add supplier",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      console.error('Error adding supplier:', err);
      const details =
        (Array.isArray(err?.errors) ? err.errors : null) ||
        (Array.isArray(err?.response?.errors) ? err.response.errors : null);
      const errorMessage =
        (details && details.length > 0 ? details.join(', ') : null) ||
        err?.response?.message ||
        err?.message ||
        "Failed to add supplier";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditSupplier = async () => {
    if (!editingSupplier) return;

    try {
      setIsSubmitting(true);

      // Clean up form data - convert empty strings to undefined for optional fields
      const cleanedFormData = {
        name: formData.name.trim(),
        contactPerson: formData.contactPerson.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim() || undefined,
        address: formData.address.trim() || undefined,
        manufacturerId: formData.manufacturerId || undefined
      };
      console.log('🔍 Editing supplier:', editingSupplier.id);
      console.log('🔍 Form data:', cleanedFormData);
      const response = await apiService.updateSupplier(editingSupplier.id, cleanedFormData);
      console.log('🔍 Update response:', response);

      if (response.success) {
        toast({
          title: "Supplier Updated",
          description: "Supplier has been updated successfully.",
          variant: "success",
        });
        setEditingSupplier(null);
        setFormData({
          name: '',
          contactPerson: '',
          phone: '',
          email: '',
          address: '',
          manufacturerId: ''
        });
        // Reload suppliers immediately
        setTimeout(() => {
        loadSuppliers();
        }, 100);
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to update supplier",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error('Error updating supplier:', err);
      toast({
        title: "Error",
        description: "Failed to update supplier",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSupplier = async () => {
    if (!deletingSupplier) return;

    try {
      setIsDeleting(true);
      console.log('🔍 Deleting supplier:', deletingSupplier.id);
      const response = await apiService.deleteSupplier(deletingSupplier.id);
      console.log('🔍 Delete response:', response);

      if (response.success) {
        toast({
          title: "Supplier Deleted",
          description: "Supplier has been deleted successfully.",
          variant: "success",
        });
        setDeletingSupplier(null);
        setShowDeleteDialog(false);
        loadSuppliers();
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to delete supplier",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error('Error deleting supplier:', err);
      toast({
        title: "Error",
        description: "Failed to delete supplier",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const openEditDialog = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name,
      contactPerson: supplier.contactPerson,
      phone: supplier.phone,
      email: supplier.email || '',
      address: supplier.address || '',
      manufacturerId: supplier.manufacturerId || ''
    });
  };

  const openDeleteDialog = (supplier: Supplier) => {
    setDeletingSupplier(supplier);
    setShowDeleteDialog(true);
  };

  const sfInput = cn(
    "h-11 w-full rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] pl-10 pr-3.5 text-sm text-[#0a1128] shadow-none transition-all",
    "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-[4px] focus-visible:ring-[rgba(26,82,197,0.06)]",
  );

  if (error) {
    return (
      <div className="relative min-h-full bg-[#f0f2f7]">
        <div
          className="pointer-events-none fixed right-[-100px] top-[-100px] z-0 h-[500px] w-[500px] rounded-full bg-[rgba(40,194,206,0.06)] blur-[100px]"
          aria-hidden
        />
        <div
          className="pointer-events-none fixed bottom-[100px] left-[350px] z-0 h-[400px] w-[400px] rounded-full bg-[rgba(26,82,197,0.04)] blur-[100px]"
          aria-hidden
        />
        <div className="relative z-[1] flex min-h-[50vh] flex-col items-center justify-center px-6 py-16">
          <AlertTriangle className="mb-4 h-12 w-12 text-red-500" />
          <p className="mb-4 text-sm font-medium text-red-600">{error}</p>
          <Button type="button" variant="outline" className="rounded-[10px]" onClick={() => void loadSuppliers()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-full bg-[#f0f2f7]">
      <div
        className="pointer-events-none fixed right-[-100px] top-[-100px] z-0 h-[500px] w-[500px] rounded-full bg-[rgba(40,194,206,0.06)] blur-[100px]"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed bottom-[100px] left-[350px] z-0 h-[400px] w-[400px] rounded-full bg-[rgba(26,82,197,0.04)] blur-[100px]"
        aria-hidden
      />
      <div className="relative z-[1] space-y-5 px-6 pb-14 pt-9 sm:px-11">
      <div className="zv3-animate-fadeUp flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">Suppliers</h1>
          <p className="text-sm text-[#8c95b0]">
            Manage your suppliers and vendor information
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddDialog(true)}
            className="inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(26,82,197,0.35)]"
          >
            <Plus className="h-[17px] w-[17px] stroke-[2.5]" strokeLinecap="round" />
            Add Supplier
          </button>
        </div>
      </div>

      <div className="zv3-animate-fadeUp zv3-delay-1 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-6 py-5">
        <p className="mb-2 text-xs font-semibold text-[#8c95b0]">Search suppliers</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]" strokeWidth={2} />
          <Input
            id="search"
            placeholder="Search by name, contact, phone, email, or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={sfInput}
          />
        </div>
      </div>

      <div className="zv3-animate-fadeUp zv3-delay-3">
        <div className="mb-4 flex items-center gap-2.5">
          <Building2 className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
          <span className="text-[17px] font-bold text-[#0a1128]">Suppliers</span>
          <span className="text-sm font-medium text-[#8c95b0]">({filteredSuppliers.length})</span>
        </div>

        {user?.role === "OWNER" && !selectedBranchId && !selectedCompanyId ? (
          <div className="rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white px-8 py-16 text-center shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
            <div className="mx-auto mb-6 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[rgba(26,82,197,0.06)]">
              <Building2 className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
            </div>
            <p className="mb-2 text-sm font-bold text-[#0a1128]">Select a branch or company</p>
            <p className="mx-auto max-w-md text-sm text-[#8c95b0]">
              Use the branch or company selectors in the header to load suppliers for that context.
            </p>
          </div>
        ) : suppliers.length === 0 ? (
          <div className="rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white px-8 py-16 text-center shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
            <div className="mx-auto mb-6 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[rgba(26,82,197,0.06)]">
              <Building2 className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
            </div>
            <p className="mb-2 text-sm font-bold text-[#0a1128]">No suppliers found</p>
            <p className="mx-auto mb-6 max-w-md text-sm text-[#8c95b0]">
              {searchQuery ? "Try adjusting your search." : "Get started by adding your first supplier."}
            </p>
            {!searchQuery && (
              <Button
                type="button"
                onClick={() => setShowAddDialog(true)}
                className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Supplier
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                    <th className="px-5 py-3.5 pl-8 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                      Supplier
                    </th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                      Phone
                    </th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                      Email
                    </th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                      Address
                    </th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                      Manufacturer
                    </th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                      Products
                    </th>
                    <th className="px-5 py-3.5 pr-8 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedSuppliers.map((supplier) => (
                    <tr
                      key={supplier.id}
                      className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                    >
                      <td className="px-5 py-4 pl-8 align-middle">
                        <div className="flex items-center gap-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[rgba(26,82,197,0.12)] to-[rgba(40,194,206,0.08)] text-[#1a52c5]">
                            <Building2 className="h-5 w-5" strokeWidth={2} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[15px] font-bold text-[#0a1128]">{supplier.name}</p>
                            <p className="text-sm text-[#8c95b0]">{supplier.contactPerson}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle text-[13px] text-[#4a5578]">
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                          {supplier.phone}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-middle text-[13px] text-[#4a5578]">
                        {supplier.email ? (
                          <span className="inline-flex max-w-[200px] items-center gap-1.5 truncate">
                            <Mail className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                            {supplier.email}
                          </span>
                        ) : (
                          <span className="text-[#8c95b0]">—</span>
                        )}
                      </td>
                      <td className="max-w-[200px] px-5 py-4 align-middle text-[13px] text-[#4a5578]">
                        {supplier.address ? (
                          <span className="inline-flex items-start gap-1.5" title={supplier.address}>
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                            <span className="line-clamp-2">{supplier.address}</span>
                          </span>
                        ) : (
                          <span className="text-[#8c95b0]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 align-middle text-[13px]">
                        {supplier.manufacturer ? (
                          <div>
                            <p className="font-semibold text-[#1a52c5]">{supplier.manufacturer.name}</p>
                            {supplier.manufacturer.country ? (
                              <p className="text-xs text-[#8c95b0]">{supplier.manufacturer.country}</p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-[#8c95b0]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <span className="text-sm font-bold text-[#0a1128]">{supplier._count?.products ?? 0}</span>
                      </td>
                      <td className="px-5 py-4 pr-8 text-right align-middle">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            title="Edit"
                            onClick={() => openEditDialog(supplier)}
                            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                          >
                            <Edit className="h-[15px] w-[15px]" strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            onClick={() => openDeleteDialog(supplier)}
                            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-red-600/15 hover:bg-red-600/[0.05] hover:text-red-600"
                          >
                            <Trash2 className="h-[15px] w-[15px]" strokeWidth={2} />
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
                  Showing {Math.min((safePage - 1) * pageSize + 1, filteredSuppliers.length)} to {Math.min(safePage * pageSize, filteredSuppliers.length)} of {filteredSuppliers.length} suppliers
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-[#8c95b0]">Per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="h-[32px] rounded-lg border border-[rgba(15,23,60,0.06)] bg-white px-2 text-sm font-semibold text-[#0a1128] outline-none focus:ring-2 focus:ring-[rgba(26,82,197,0.15)]"
                  >
                    <option value="10">10</option>
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage(safePage - 1)}
                  disabled={safePage === 1}
                  className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
                >
                  Previous
                </button>
                <span className="text-sm font-semibold text-[#0a1128]">Page {safePage} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(safePage + 1)}
                  disabled={safePage === totalPages}
                  className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Supplier Dialog */}
      <Dialog open={showAddDialog || !!editingSupplier} onOpenChange={(open) => {
        if (!open) {
          setShowAddDialog(false);
          setEditingSupplier(null);
          setFormData({
            name: '',
            contactPerson: '',
            phone: '',
            email: '',
            address: '',
            manufacturerId: ''
          });
        }
      }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">
              {editingSupplier ? "Edit supplier" : "Add new supplier"}
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
              {editingSupplier
                ? "Update vendor contact and manufacturer link."
                : "Enter supplier details to add them to your branch."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-semibold text-[#0a1128]">
                  Company name <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter supplier name"
                  className={supplierFormField}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactPerson" className="text-sm font-semibold text-[#0a1128]">
                  Contact person <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="contactPerson"
                  value={formData.contactPerson}
                  onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                  placeholder="Enter contact person name"
                  className={supplierFormField}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-semibold text-[#0a1128]">
                  Phone <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="Enter phone number"
                  className={supplierFormField}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-semibold text-[#0a1128]">
                  Email <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="Enter email address"
                  className={supplierFormField}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address" className="text-sm font-semibold text-[#0a1128]">
                Address <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
              </Label>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Enter supplier address"
                rows={3}
                className={supplierTextarea}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold text-[#0a1128]">
                Manufacturer <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
              </Label>
              <Select
                value={formData.manufacturerId || "none"}
                onValueChange={(v) => setFormData({ ...formData, manufacturerId: v === "none" ? "" : v })}
              >
                <SelectTrigger className={supplierSelectTrigger}>
                  <SelectValue placeholder="Select a manufacturer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {manufacturers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                      {m.country ? ` (${m.country})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t-0 pt-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-7 py-3 text-sm font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
              onClick={() => {
                setShowAddDialog(false);
                setEditingSupplier(null);
                setFormData({
                  name: "",
                  contactPerson: "",
                  phone: "",
                  email: "",
                  address: "",
                  manufacturerId: "",
                });
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={editingSupplier ? handleEditSupplier : handleAddSupplier}
              className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
              disabled={!formData.name || !formData.contactPerson || !formData.phone || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                `${editingSupplier ? "Update" : "Add"} supplier`
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-[#0a1128]">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Confirm delete
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
              This action cannot be undone. The supplier will be removed from your system.
            </DialogDescription>
          </DialogHeader>

          {deletingSupplier && (
            <div className="space-y-4 py-4">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-600/[0.08]">
                  <Trash2 className="h-5 w-5 text-red-600" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold tracking-tight text-[#0a1128]">Delete supplier</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-[#8c95b0]">
                    Are you sure? This removes the supplier from your branch.
                  </p>
                  <div className="mt-4 rounded-[14px] border border-[rgba(15,23,60,0.06)] bg-[#f8f9fc] p-4">
                    <p className="text-sm font-semibold text-[#0a1128]">{deletingSupplier.name}</p>
                    <p className="mt-1 text-xs text-[#8c95b0]">
                      {deletingSupplier.contactPerson}
                      {deletingSupplier.email ? ` • ${deletingSupplier.email}` : ""}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-6">
            <Button
              type="button"
              variant="outline"
              className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-6"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteSupplier}
              disabled={isDeleting}
              className="rounded-[10px] bg-red-600 px-6 hover:bg-red-700"
            >
              {isDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {isDeleting ? "Deleting…" : "Delete supplier"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(Suppliers);
