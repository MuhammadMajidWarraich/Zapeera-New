import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Package,
  MapPin,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { getMissingRequiredFields } from "@/lib/required-fields";
import { cn } from "@/lib/utils";

interface Shelf {
  id: string;
  name: string;
  description?: string;
  location?: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    batches: number;
  };
}

const shelfFormField = cn(
  "h-[46px] w-full rounded-[10px] border-[1.5px] border-black/[0.08] bg-white px-4 text-[15px] text-[#0a1128] transition-colors",
  "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.08)]",
);

const batchCount = (s: Shelf) => s._count?.batches ?? 0;

const Shelves: React.FC = () => {
  const { user } = useAuth();
  const { selectedBranchId } = useAdmin();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingShelf, setEditingShelf] = useState<Shelf | null>(null);
  const [deletingShelf, setDeletingShelf] = useState<Shelf | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [pageSize, setPageSize] = useState(10);

  const [formData, setFormData] = useState({
    name: "",
    location: "",
  });

  const loadShelves = useCallback(async () => {
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
      
      const response = await apiService.getShelves({
        page: 1,
        limit: 500,
        branchId: branchId,
      } as any);

      if (response.success && response.data) {
        const shelvesData = response.data.shelves || [];
        setShelves(shelvesData);
        // Caching disabled
      }
    } catch (err) {
      console.error("Error loading shelves:", err);
      setError("Failed to load shelves");
      setShelves([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, selectedBranchId, user?.role, user?.branchId, user?.membership?.branchIds]);

  useEffect(() => {
    // Cache reading disabled - shelves will load fresh from API
  }, [user?.id, selectedBranchId, user?.role, user?.branchId, user?.membership?.branchIds]);

  useEffect(() => {
    void loadShelves();
  }, [loadShelves, user?.id, selectedBranchId, user?.role, user?.branchId, user?.membership?.branchIds]);

  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  }, []);

  const filteredShelves = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return shelves.filter((shelf) => {
      const matchesSearch =
        !q ||
        shelf.name.toLowerCase().includes(q) ||
        (shelf.description || "").toLowerCase().includes(q) ||
        (shelf.location || "").toLowerCase().includes(q);

      return matchesSearch;
    });
  }, [shelves, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredShelves.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedShelves = filteredShelves.slice((safePage - 1) * pageSize, safePage * pageSize);

  const totalCount = filteredShelves.length;

  const sfInput = cn(
    "h-11 w-full rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] pl-10 pr-3.5 text-sm text-[#0a1128] shadow-none transition-all",
    "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-[4px] focus-visible:ring-[rgba(26,82,197,0.06)]",
  );

  const mfSelectTrigger = cn(
    "h-11 w-full min-w-[140px] rounded-[10px] border-[1.5px] border-black/[0.08] bg-white text-[14px] text-[#0a1128] shadow-none md:w-[160px]",
    "focus:ring-4 focus:ring-[rgba(26,82,197,0.08)] focus:ring-offset-0",
  );

  const handleAddShelf = async () => {
    let tempId: string | null = null;
    try {
      const missing = getMissingRequiredFields(formData as Record<string, unknown>, { name: "Name" });
      if (missing.length > 0) {
        toast.error(`Please fill all required fields: ${missing.join(", ")}`);
        return;
      }

      setIsSubmitting(true);

      const tempShelf: Shelf = {
        id: `temp-${Date.now()}`,
        name: formData.name.trim(),
        location: formData.location.trim() || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _count: { batches: 0 },
      };
      tempId = tempShelf.id;
      setShelves((prev) => [tempShelf, ...prev]);

      setIsCreateDialogOpen(false);
      const formName = formData.name.trim();
      setFormData({ name: "", location: "" });

      toast.success("Shelf created successfully");

      setSearchTerm("");
      setCurrentPage(1);

      const response = await apiService.createShelf({
        name: formName,
        location: tempShelf.location,
      });

      if (response.success && response.data) {
        const realShelf: Shelf = {
          ...response.data,
          _count: (response.data as Shelf)._count || { batches: 0 },
        };
        setShelves((prev) => prev.map((s) => (s.id === tempShelf.id ? realShelf : s)));
        setTimeout(() => void loadShelves(), 100);
      } else {
        setShelves((prev) => prev.filter((s) => s.id !== tempShelf.id));
        toast.error(response.message || "Failed to create shelf");
      }
    } catch (error) {
      console.error("Error creating shelf:", error);
      if (tempId) {
        setShelves((prev) => prev.filter((s) => s.id !== tempId));
      }
      toast.error("Failed to create shelf");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditShelf = async () => {
    if (!editingShelf) return;

    try {
      setIsSubmitting(true);

      const missing = getMissingRequiredFields(formData as Record<string, unknown>, { name: "Name" });
      if (missing.length > 0) {
        toast.error(`Please fill all required fields: ${missing.join(", ")}`);
        return;
      }
      const response = await apiService.updateShelf(editingShelf.id, {
        name: formData.name.trim(),
        location: formData.location.trim() || undefined,
      });

      if (response.success) {
        toast.success("Shelf updated successfully");
        setIsEditDialogOpen(false);
        setEditingShelf(null);
        setFormData({ name: "", location: "" });
        void loadShelves();
      } else {
        toast.error(response.message || "Failed to update shelf");
      }
    } catch (error) {
      console.error("Error updating shelf:", error);
      toast.error("Failed to update shelf");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDeleteDialog = (shelf: Shelf) => {
    setDeletingShelf(shelf);
    setShowDeleteDialog(true);
  };

  const handleDeleteShelf = async () => {
    if (!deletingShelf) return;
    try {
      setIsDeleting(true);
      const response = await apiService.deleteShelf(deletingShelf.id);
      if (response.success) {
        toast.success("Shelf deleted successfully");
        setShowDeleteDialog(false);
        setDeletingShelf(null);
        void loadShelves();
      } else {
        toast.error(response.message || "Failed to delete shelf");
      }
    } catch (error) {
      console.error("Error deleting shelf:", error);
      toast.error("Failed to delete shelf");
    } finally {
      setIsDeleting(false);
    }
  };

  const openEditDialog = (shelf: Shelf) => {
    setEditingShelf(shelf);
    setFormData({
      name: shelf.name,
      location: shelf.location || "",
    });
    setIsEditDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({ name: "", location: "" });
    setEditingShelf(null);
  };

  if (error && shelves.length === 0 && !loading) {
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
          <Button type="button" variant="outline" className="rounded-[10px]" onClick={() => void loadShelves()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (loading && shelves.length === 0) {
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
          <p className="mt-4 text-sm font-medium text-[#8c95b0]">Loading shelves…</p>
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
            <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">Shelves</h1>
            <p className="text-sm text-[#8c95b0]">
              Manage storage locations and batch placement
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
              Add Shelf
            </button>
          </div>
        </div>

        <div className="zv3-animate-fadeUp zv3-delay-1 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-xs font-semibold text-[#8c95b0]">Search shelves</p>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]"
                  strokeWidth={2}
                />
                <Input
                  placeholder="Search by name, description, or location…"
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
            <Package className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
            <span className="text-[17px] font-bold text-[#0a1128]">Shelves</span>
            <span className="text-sm font-medium text-[#8c95b0]">({totalCount})</span>
          </div>

          {filteredShelves.length === 0 ? (
            <div className="rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white px-8 py-16 text-center shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
              <div className="mx-auto mb-6 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[rgba(26,82,197,0.06)]">
                <Package className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
              </div>
              <p className="mb-2 text-sm font-bold text-[#0a1128]">No shelves found</p>
              <p className="mx-auto mb-6 max-w-md text-sm text-[#8c95b0]">
                {searchTerm
                  ? "Try adjusting your search."
                  : "Get started by adding your first shelf."}
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
                  Add Shelf
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
                        Shelf
                      </th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Location
                      </th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Batches
                      </th>
                      <th className="px-5 py-3.5 pr-8 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedShelves.map((shelf) => (
                      <tr
                        key={shelf.id}
                        className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                      >
                        <td className="px-5 py-4 pl-8 align-middle">
                          <div className="flex items-center gap-3">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[rgba(26,82,197,0.12)] to-[rgba(40,194,206,0.08)] text-[#1a52c5]">
                              <Package className="h-5 w-5" strokeWidth={2} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[15px] font-bold text-[#0a1128]">{shelf.name}</p>
                              {shelf.description && (
                                <p className="text-xs text-[#8c95b0]">{shelf.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-middle text-[13px] text-[#4a5578]">
                          {shelf.location ? (
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin className="h-3.5 w-3.5 text-[#8c95b0]" strokeWidth={2} />
                              {shelf.location}
                            </span>
                          ) : (
                            <span className="text-[#8c95b0]">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#0a1128]">
                            <Package className="h-3.5 w-3.5 text-[#8c95b0]" strokeWidth={2} />
                            {batchCount(shelf)}
                          </span>
                        </td>
                        <td className="px-5 py-4 pr-8 text-right align-middle">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              title="Edit"
                              onClick={() => openEditDialog(shelf)}
                              className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                            >
                              <Edit className="h-[15px] w-[15px]" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              title="Delete"
                              onClick={() => openDeleteDialog(shelf)}
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
              {filteredShelves.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4 border-t border-[rgba(15,23,60,0.06)]">
                  <div className="flex items-center gap-3">
                    <div className="text-sm text-[#8c95b0]">
                      Showing {((safePage - 1) * pageSize) + 1} to {Math.min(safePage * pageSize, filteredShelves.length)} of {filteredShelves.length} shelves
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

        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Add shelf</DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
                Create a shelf or storage slot for batch assignments.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-5 py-6">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-semibold text-[#0a1128]">
                  Shelf name <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Shelf A1"
                  className={shelfFormField}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location" className="text-sm font-semibold text-[#0a1128]">
                  Location <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                </Label>
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="e.g. Warehouse A"
                  className={shelfFormField}
                />
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
                onClick={() => void handleAddShelf()}
                disabled={isSubmitting || !formData.name.trim()}
                className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding…
                  </>
                ) : (
                  "Add shelf"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Edit shelf</DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
                Update name and location.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-5 py-6">
              <div className="space-y-2">
                <Label htmlFor="edit-name" className="text-sm font-semibold text-[#0a1128]">
                  Shelf name <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={shelfFormField}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-location" className="text-sm font-semibold text-[#0a1128]">
                  Location <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                </Label>
                <Input
                  id="edit-location"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className={shelfFormField}
                />
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
                onClick={() => void handleEditShelf()}
                disabled={isSubmitting || !formData.name.trim()}
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

        <Dialog
          open={showDeleteDialog}
          onOpenChange={(open) => {
            setShowDeleteDialog(open);
            if (!open) setDeletingShelf(null);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-[#0a1128]">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                Confirm delete
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {deletingShelf && (
              <div className="py-4">
                <p className="text-sm text-[#4a5578]">
                  Delete <span className="font-bold text-[#0a1128]">{deletingShelf.name}</span>?
                </p>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-6"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setDeletingShelf(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDeleteShelf()}
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
export default React.memo(Shelves);
