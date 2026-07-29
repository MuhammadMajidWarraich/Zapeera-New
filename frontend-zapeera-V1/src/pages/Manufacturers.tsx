import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Building2,
  Globe,
  MapPin,
  Phone,
  Users,
  Eye,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { cn } from "@/lib/utils";

interface Manufacturer {
  id: string;
  name: string;
  description?: string;
  phone?: string;
  website?: string;
  country?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    suppliers: number;
  };
  suppliers?: {
    id: string;
    name: string;
  }[];
}

const mfFormField = cn(
  "h-[46px] w-full rounded-[10px] border-[1.5px] border-black/[0.08] bg-white px-4 text-[15px] text-[#0a1128] transition-colors",
  "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.08)]",
);
const mfTextarea = cn(
  "min-h-[90px] w-full resize-y rounded-[10px] border-[1.5px] border-black/[0.08] bg-white px-4 py-3.5 text-[15px] text-[#0a1128] transition-colors",
  "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.08)]",
);

const supplierCount = (m: Manufacturer) => m._count?.suppliers ?? 0;

const Manufacturers: React.FC = () => {
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch, selectedCompanyId } = useAdmin();
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [viewingManufacturer, setViewingManufacturer] = useState<Manufacturer | null>(null);
  const [viewManufacturerSuppliers, setViewManufacturerSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [editingManufacturer, setEditingManufacturer] = useState<Manufacturer | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingManufacturer, setDeletingManufacturer] = useState<Manufacturer | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [pageSize, setPageSize] = useState(10);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    phone: "",
    website: "",
    country: "",
  });

  const loadManufacturers = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      
      // Determine branch ID for managers/cashiers
      let branchId = selectedBranchId;
      if (!branchId && user?.role !== 'OWNER' && user?.role !== 'ADMIN') {
        // For non-owner users, check membership.branchIds
        if (Array.isArray(user?.membership?.branchIds) && user.membership.branchIds.length > 0) {
          branchId = String(user.membership.branchIds[0]);
        } else if (user?.branchId) {
          branchId = user?.membership?.branchIds?.[0] || user?.branchId;
        }
      }
      
      const response = await apiService.getManufacturers({
        page: 1,
        limit: 1000,
        branchId: branchId,
      } as any);

      if (response.success && response.data) {
        const manufacturersData = response.data.manufacturers || [];
        setManufacturers(manufacturersData);
        console.log('✅ Loaded manufacturers:', manufacturersData.length);
      } else {
        setManufacturers([]);
      }
    } catch (err) {
      console.error("Error loading manufacturers:", err);
      setError("Failed to load manufacturers");
      setManufacturers([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, user?.role, user?.branchId, user?.membership?.branchIds]);

  // Reload manufacturers when branch or company changes
  useEffect(() => {
    console.log('🔄 Branch/Company changed, reloading manufacturers:', {
      selectedBranchId: selectedBranchId || 'All Branches',
      selectedCompanyId
    });
    setSearchTerm("");
    setCurrentPage(1);
    void loadManufacturers();
  }, [selectedBranchId, selectedCompanyId, loadManufacturers]);

  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  }, []);

  const filteredManufacturers = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return manufacturers.filter((m) => {
      return (
        !q ||
        m.name.toLowerCase().includes(q) ||
        (m.description || "").toLowerCase().includes(q) ||
        (m.country || "").toLowerCase().includes(q) ||
        (m.website || "").toLowerCase().includes(q)
      );
    });
  }, [manufacturers, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredManufacturers.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedManufacturers = filteredManufacturers.slice((safePage - 1) * pageSize, safePage * pageSize);

  const totalCount = filteredManufacturers.length;

  const sfInput = cn(
    "h-11 w-full rounded-[10px] border-[1.5px] border-black/[0.07] bg-white pl-10 pr-3.5 text-sm font-medium text-[#0a1128] shadow-none transition-all",
    "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-[4px] focus-visible:ring-[rgba(26,82,197,0.06)]",
  );

  const handleAddManufacturer = async () => {
    let tempId: string | null = null;
    try {
      setIsSubmitting(true);

      if (!formData.name.trim()) {
        toast.error("Manufacturer name is required");
        return;
      }

      const cleanedFormData: { name: string; description?: string; phone?: string; website?: string; country?: string } = {
        name: formData.name.trim(),
      };

      if (formData.description?.trim()) cleanedFormData.description = formData.description.trim();
      if (formData.phone?.trim()) cleanedFormData.phone = formData.phone.trim();
      if (formData.website?.trim()) cleanedFormData.website = formData.website.trim();
      if (formData.country?.trim()) cleanedFormData.country = formData.country.trim();

      const tempManufacturer: Manufacturer = {
        id: `temp-${Date.now()}`,
        name: cleanedFormData.name,
        description: cleanedFormData.description,
        phone: cleanedFormData.phone,
        website: cleanedFormData.website,
        country: cleanedFormData.country,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _count: { suppliers: 0 },
      };
      tempId = tempManufacturer.id;
      setManufacturers((prev) => [tempManufacturer, ...prev]);

      setIsCreateDialogOpen(false);
      setFormData({ name: "", description: "", phone: "", website: "", country: "" });

      toast.success("Manufacturer created successfully");

      setSearchTerm("");
      setCurrentPage(1);

      const response = await apiService.createManufacturer(cleanedFormData);

      if (response.success && response.data) {
        const realManufacturer: Manufacturer = {
          ...response.data,
          _count: (response.data as Manufacturer)._count || { suppliers: 0 },
        };
        setManufacturers((prev) => prev.map((m) => (m.id === tempManufacturer.id ? realManufacturer : m)));
        setTimeout(() => void loadManufacturers(), 100);
      } else {
        setManufacturers((prev) => prev.filter((m) => m.id !== tempManufacturer.id));
        toast.error(response.message || "Failed to create manufacturer");
      }
    } catch (error) {
      console.error("Error creating manufacturer:", error);
      if (tempId) {
        setManufacturers((prev) => prev.filter((m) => m.id !== tempId));
      }
      toast.error("Failed to create manufacturer");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditManufacturer = async () => {
    if (!editingManufacturer) return;

    try {
      setIsSubmitting(true);

      const cleanedFormData: { name: string; description?: string; phone?: string; website?: string; country?: string } = {
        name: formData.name.trim(),
      };

      if (formData.description?.trim()) cleanedFormData.description = formData.description.trim();
      if (formData.phone?.trim()) cleanedFormData.phone = formData.phone.trim();
      if (formData.website?.trim()) cleanedFormData.website = formData.website.trim();
      if (formData.country?.trim()) cleanedFormData.country = formData.country.trim();

      const response = await apiService.updateManufacturer(editingManufacturer.id, cleanedFormData);

      if (response.success) {
        toast.success("Manufacturer updated successfully");
        setIsEditDialogOpen(false);
        setEditingManufacturer(null);
        setFormData({ name: "", description: "", phone: "", website: "", country: "" });
        void loadManufacturers();
      } else {
        toast.error(response.message || "Failed to update manufacturer");
      }
    } catch (error) {
      console.error("Error updating manufacturer:", error);
      toast.error("Failed to update manufacturer");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDeleteDialog = (manufacturer: Manufacturer) => {
    setDeletingManufacturer(manufacturer);
    setShowDeleteDialog(true);
  };

  const handleDeleteManufacturer = async () => {
    if (!deletingManufacturer) return;
    try {
      setIsDeleting(true);
      const response = await apiService.deleteManufacturer(deletingManufacturer.id);
      if (response.success) {
        toast.success("Manufacturer deleted successfully");
        setShowDeleteDialog(false);
        setDeletingManufacturer(null);
        void loadManufacturers();
      } else {
        toast.error(response.message || "Failed to delete manufacturer");
      }
    } catch (error) {
      console.error("Error deleting manufacturer:", error);
      toast.error("Failed to delete manufacturer");
    } finally {
      setIsDeleting(false);
    }
  };

  const openEditDialog = (manufacturer: Manufacturer) => {
    setEditingManufacturer(manufacturer);
    setFormData({
      name: manufacturer.name,
      description: manufacturer.description || "",
      phone: manufacturer.phone || "",
      website: manufacturer.website || "",
      country: manufacturer.country || "",
    });
    setIsEditDialogOpen(true);
  };

  const openViewDialog = async (manufacturer: Manufacturer) => {
    setViewingManufacturer(manufacturer);
    setIsViewDialogOpen(true);

    try {
      const suppliersResponse = await apiService.getSuppliers({ manufacturerId: manufacturer.id });
      if (suppliersResponse.success && suppliersResponse.data) {
        const suppliers = Array.isArray(suppliersResponse.data)
          ? suppliersResponse.data
          : suppliersResponse.data.suppliers || [];
        setViewManufacturerSuppliers(suppliers.map((s) => ({ id: s.id, name: s.name })));
      }
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      setViewManufacturerSuppliers([]);
    }
  };

  const resetForm = () => {
    setFormData({ name: "", description: "", phone: "", website: "", country: "" });
    setEditingManufacturer(null);
  };

  if (error && manufacturers.length === 0 && !loading) {
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
          <Button type="button" variant="outline" className="rounded-[10px]" onClick={() => void loadManufacturers()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (loading && manufacturers.length === 0) {
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
          <Loader2 className="h-10 w-10 animate-spin text-[#1a52c5]" strokeWidth={2} />
          <p className="mt-4 text-sm font-medium text-[#8c95b0]">Loading manufacturers…</p>
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
            <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">Manufacturers</h1>
            <p className="text-sm text-[#8c95b0]">
              Manage pharmaceutical manufacturers and linked suppliers
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                resetForm();
                setIsCreateDialogOpen(true);
              }}
              className="ml-1 inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(26,82,197,0.35)]"
            >
              <Plus className="h-[17px] w-[17px] stroke-[2.5]" strokeLinecap="round" />
              Add Manufacturer
            </button>
          </div>
        </div>

        <div className="zv3-animate-fadeUp zv3-delay-1 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-xs font-semibold text-[#8c95b0]">Search manufacturers</p>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]"
                  strokeWidth={2}
                />
                <Input
                  placeholder="Search by name or description…"
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  className={sfInput}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="zv3-animate-fadeUp zv3-delay-3">
          <div className="mb-4 flex items-center gap-2.5">
            <Building2 className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
            <span className="text-[17px] font-bold text-[#0a1128]">Manufacturers</span>
            <span className="text-sm font-medium text-[#8c95b0]">({totalCount})</span>
          </div>

          {filteredManufacturers.length === 0 ? (
            <div className="rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white px-8 py-16 text-center shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
              <div className="mx-auto mb-6 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[rgba(26,82,197,0.06)]">
                <Building2 className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
              </div>
              <p className="mb-2 text-sm font-bold text-[#0a1128]">No manufacturers found</p>
              <p className="mx-auto mb-6 max-w-md text-sm text-[#8c95b0]">
                {searchTerm
                  ? "Try adjusting your search."
                  : "Get started by adding your first manufacturer."}
              </p>
              {!searchTerm && (
                <Button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setIsCreateDialogOpen(true);
                  }}
                  className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Manufacturer
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
                        Manufacturer
                      </th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Description
                      </th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Suppliers
                      </th>
                      <th className="px-5 py-3.5 pr-8 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedManufacturers.map((manufacturer) => (
                      <tr
                        key={manufacturer.id}
                        className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                      >
                        <td className="px-5 py-4 pl-8 align-middle">
                          <div className="flex items-center gap-3">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[rgba(26,82,197,0.12)] to-[rgba(40,194,206,0.08)] text-[#1a52c5]">
                              <Building2 className="h-5 w-5" strokeWidth={2} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[15px] font-bold text-[#0a1128]">{manufacturer.name}</p>
                              {(manufacturer.country || manufacturer.phone) && (
                                <p className="text-xs font-semibold text-[#8c95b0]">
                                  {manufacturer.country && <span>{manufacturer.country}</span>}
                                  {manufacturer.country && manufacturer.phone && <span className="mx-1">•</span>}
                                  {manufacturer.phone && <span>{manufacturer.phone}</span>}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="max-w-xs px-5 py-4 align-middle text-[13px] text-[#4a5578]">
                          {manufacturer.description ? (
                            <span className="line-clamp-2">{manufacturer.description}</span>
                          ) : (
                            <span className="text-[#8c95b0]">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#0a1128]">
                            <Users className="h-3.5 w-3.5 text-[#8c95b0]" strokeWidth={2} />
                            {supplierCount(manufacturer)}
                          </span>
                        </td>
                        <td className="px-5 py-4 pr-8 text-right align-middle">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              title="View"
                              onClick={() => void openViewDialog(manufacturer)}
                              className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                            >
                              <Eye className="h-[15px] w-[15px]" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              title="Edit"
                              onClick={() => openEditDialog(manufacturer)}
                              className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                            >
                              <Edit className="h-[15px] w-[15px]" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              title="Delete"
                              onClick={() => openDeleteDialog(manufacturer)}
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
              {/* Pagination */}
              {filteredManufacturers.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4 border-t border-[rgba(15,23,60,0.06)]">
                  <div className="flex items-center gap-3">
                    <div className="text-sm text-[#8c95b0]">
                      Showing {((safePage - 1) * pageSize) + 1} to {Math.min(safePage * pageSize, filteredManufacturers.length)} of {filteredManufacturers.length} manufacturers
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
              )}
            </div>
          )}
        </div>

        {/* Add manufacturer */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Add manufacturer</DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
                Create a manufacturer record. You can link suppliers to it later.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-5 py-6">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-semibold text-[#0a1128]">
                  Name <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter manufacturer name"
                  className={mfFormField}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description" className="text-sm font-semibold text-[#0a1128]">
                  Description <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                </Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Short description"
                  rows={3}
                  className={mfTextarea}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-semibold text-[#0a1128]">
                  Contact number <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                </Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="e.g. +92-300-1234567"
                  className={mfFormField}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="country" className="text-sm font-semibold text-[#0a1128]">
                    Country <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                  </Label>
                  <Input
                    id="country"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    placeholder="e.g. Pakistan"
                    className={mfFormField}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website" className="text-sm font-semibold text-[#0a1128]">
                    Website <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                  </Label>
                  <Input
                    id="website"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    placeholder="e.g. https://example.com"
                    className={mfFormField}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-6 font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
                onClick={() => setIsCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleAddManufacturer()}
                disabled={isSubmitting}
                className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding…
                  </>
                ) : (
                  "Add manufacturer"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Edit manufacturer</DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
                Update manufacturer details.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-5 py-6">
              <div className="space-y-2">
                <Label htmlFor="edit-name" className="text-sm font-semibold text-[#0a1128]">
                  Name <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter manufacturer name"
                  className={mfFormField}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description" className="text-sm font-semibold text-[#0a1128]">
                  Description <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                </Label>
                <Textarea
                  id="edit-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Short description"
                  rows={3}
                  className={mfTextarea}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone" className="text-sm font-semibold text-[#0a1128]">
                  Contact number <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                </Label>
                <Input
                  id="edit-phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="e.g. +92-300-1234567"
                  className={mfFormField}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-country" className="text-sm font-semibold text-[#0a1128]">
                    Country <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                  </Label>
                  <Input
                    id="edit-country"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    placeholder="e.g. Pakistan"
                    className={mfFormField}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-website" className="text-sm font-semibold text-[#0a1128]">
                    Website <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                  </Label>
                  <Input
                    id="edit-website"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    placeholder="e.g. https://example.com"
                    className={mfFormField}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-6 font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
                onClick={() => setIsEditDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleEditManufacturer()}
                disabled={isSubmitting}
                className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* View */}
        <Dialog
          open={isViewDialogOpen}
          onOpenChange={(open) => {
            setIsViewDialogOpen(open);
            if (!open) {
              setViewingManufacturer(null);
              setViewManufacturerSuppliers([]);
            }
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Manufacturer details</DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
                Overview and linked suppliers for this manufacturer.
              </DialogDescription>
            </DialogHeader>

            {viewingManufacturer && (
              <div className="space-y-5 py-4">
                <div className="rounded-[14px] border border-[rgba(15,23,60,0.06)] bg-[#f8f9fc] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Name</p>
                  <p className="mt-1 text-base font-bold text-[#0a1128]">{viewingManufacturer.name}</p>
                </div>

                <div className="rounded-[14px] border border-[rgba(15,23,60,0.06)] bg-[#f8f9fc] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Description</p>
                  <p className="mt-1 text-sm leading-relaxed text-[#4a5578]">
                    {viewingManufacturer.description || <span className="text-[#8c95b0]">Not provided</span>}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-[14px] border border-[rgba(15,23,60,0.06)] bg-[#f8f9fc] p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                      <Phone className="h-3 w-3" strokeWidth={2} />
                      Contact
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#0a1128]">
                      {viewingManufacturer.phone || <span className="text-[#8c95b0]">Not provided</span>}
                    </p>
                  </div>
                  <div className="rounded-[14px] border border-[rgba(15,23,60,0.06)] bg-[#f8f9fc] p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                      <MapPin className="h-3 w-3" strokeWidth={2} />
                      Country
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#0a1128]">
                      {viewingManufacturer.country || <span className="text-[#8c95b0]">Not provided</span>}
                    </p>
                  </div>
                  <div className="rounded-[14px] border border-[rgba(15,23,60,0.06)] bg-[#f8f9fc] p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                      <Globe className="h-3 w-3" strokeWidth={2} />
                      Website
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#0a1128]">
                      {viewingManufacturer.website ? (
                        <a
                          href={viewingManufacturer.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate font-semibold text-[#1a52c5] hover:underline"
                        >
                          {viewingManufacturer.website}
                        </a>
                      ) : (
                        <span className="text-[#8c95b0]">Not provided</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="rounded-[14px] border border-[rgba(15,23,60,0.06)] bg-[#f8f9fc] p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                    <Users className="h-3.5 w-3.5" strokeWidth={2} />
                    Suppliers ({supplierCount(viewingManufacturer)})
                  </p>
                  {viewManufacturerSuppliers.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {viewManufacturerSuppliers.map((supplier) => (
                        <li key={supplier.id} className="flex items-center gap-2 text-sm text-[#0a1128]">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#1a52c5]" />
                          {supplier.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-[#8c95b0]">No suppliers linked yet.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[14px] border border-[rgba(15,23,60,0.06)] bg-white p-3">
                    <p className="text-[11px] font-semibold text-[#8c95b0]">Created</p>
                    <p className="mt-1 text-sm font-medium text-[#0a1128]">
                      {new Date(viewingManufacturer.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="rounded-[14px] border border-[rgba(15,23,60,0.06)] bg-white p-3">
                    <p className="text-[11px] font-semibold text-[#8c95b0]">Updated</p>
                    <p className="mt-1 text-sm font-medium text-[#0a1128]">
                      {new Date(viewingManufacturer.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex justify-end border-t border-[rgba(15,23,60,0.06)] pt-4">
                  <Button
                    type="button"
                    onClick={() => setIsViewDialogOpen(false)}
                    className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <Dialog
          open={showDeleteDialog}
          onOpenChange={(open) => {
            setShowDeleteDialog(open);
            if (!open) setDeletingManufacturer(null);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-[#0a1128]">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                Confirm delete
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
                This action cannot be undone. The manufacturer will be removed if it has no suppliers.
              </DialogDescription>
            </DialogHeader>

            {deletingManufacturer && (
              <div className="space-y-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-600/[0.08]">
                    <Trash2 className="h-5 w-5 text-red-600" strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-bold tracking-tight text-[#0a1128]">Delete manufacturer</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-[#8c95b0]">
                      Remove <span className="font-semibold text-[#0a1128]">{deletingManufacturer.name}</span> from the
                      system?
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-6"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setDeletingManufacturer(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDeleteManufacturer()}
                disabled={isDeleting}
                className="rounded-[10px] bg-red-600 px-6 hover:bg-red-700"
              >
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                {isDeleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(Manufacturers);
