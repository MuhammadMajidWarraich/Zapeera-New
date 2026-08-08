import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Search,
  Plus,
  Package,
  AlertTriangle,
  AlertCircle,
  Edit,
  Trash2,
  Tag,
  Grid3X3,
  Activity,
  Layers,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";
import CategoryForm from "@/components/inventory/CategoryForm";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import { cn } from "@/lib/utils";

interface Category {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    products: number;
  };
  // Frontend-only fields for enhanced UI
  type?: 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL';
  parentId?: string;
  isActive?: boolean;
  productCount?: number;
  color?: string;
  icon?: string;
  children?: Category[];
}

const Categories = () => {
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch, selectedCompanyId } = useAdmin();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false); // Don't show loading initially
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Form state for adding/editing categories
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'GENERAL' as 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL',
    parentId: '',
    color: '#3B82F6',
    icon: 'Package'
  });

  // Load categories based on selected branch
  const loadCategories = async () => {
    try {
      setError(null);
      console.log('🔍 Loading categories for branch:', selectedBranchId || 'All Branches');

      // Build params: specific branch gets branchId, All Branches gets companyId
      const params: any = { limit: 1000 };
      if (selectedBranchId) {
        params.branchId = selectedBranchId;
      } else {
        params.companyId = selectedCompanyId || '';
      }

      const response = await apiService.getCategories(params);
      console.log('🔍 Categories API response:', response);

      if (response.success) {
        const categoriesData = Array.isArray(response.data) ? response.data : (response.data?.categories || []);

        const transformedCategories = categoriesData.map((category: any) => ({
          ...category,
          type: category.type || 'general',
          isActive: category.isActive !== undefined ? category.isActive : true,
          productCount: category._count?.products || 0,
          color: category.color || '#3B82F6',
          icon: category.icon || 'Package',
          description: category.description || ''
        }));

        setCategories(transformedCategories);
        console.log('✅ Loaded categories:', transformedCategories.length);
      } else {
        console.log('🔍 No categories found or API failed');
        setCategories([]);
      }
    } catch (err) {
      console.error('Error loading categories:', err);
      setCategories([]);
      setError('Failed to load categories');
    }
  };

  // Reload categories when branch or company changes
  useEffect(() => {
    console.log('🔄 Branch/Company changed, reloading categories:', {
      selectedBranchId: selectedBranchId || 'All Branches',
      selectedCompanyId
    });
    // Reset filters on branch switch
    setSearchQuery("");
    setSelectedType("all");
    setCurrentPage(1);
    loadCategories();
  }, [selectedBranchId, selectedCompanyId]);

  // Filter categories based on search and type
  const filteredCategories = (Array.isArray(categories) ? categories : []).filter(category => {
    const matchesSearch =
      category.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (category.description || "").toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType =
      selectedType === "all" || String(category.type || "").toUpperCase() === selectedType;

    return matchesSearch && matchesType;
  });

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedType]);

  const totalPages = Math.max(1, Math.ceil(filteredCategories.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedCategories = filteredCategories.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Get unique types
  const types = Array.from(new Set((Array.isArray(categories) ? categories : []).map(c => c.type)));

  // Get category statistics
  const totalCategories = Array.isArray(categories) ? categories.length : 0;
  const medicalCategories = (Array.isArray(categories) ? categories : []).filter(
    (c) => String(c.type || "").toUpperCase() === "MEDICAL",
  ).length;
  const nonMedicalCategories = (Array.isArray(categories) ? categories : []).filter(
    (c) => String(c.type || "").toUpperCase() === "NON_MEDICAL",
  ).length;

  const handleAddCategory = async (formData: any) => {
    try {
      setIsSubmitting(true);

      // Send the fields that the backend expects
      const branchId = selectedBranchId || user?.membership?.branchIds?.[0] || user?.branchId || '';

      const categoryData = {
        name: formData.name,
        description: formData.description,
        type: formData.type, // Already converted to uppercase in CategoryForm
        color: formData.color,
        branchId
      };

      // OPTIMISTIC UPDATE: Add temporary category to list immediately
      const tempCategory: Category = {
        id: `temp-${Date.now()}`,
        name: categoryData.name,
        description: categoryData.description || '',
        type: categoryData.type as 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL',
        color: categoryData.color || '#3B82F6',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _count: { products: 0 },
        productCount: 0
      };
      setCategories([tempCategory, ...categories]);

      // Close dialog and reset form immediately
      setShowAddDialog(false);
      const categoryName = categoryData.name;
      setFormData({
        name: '',
        description: '',
        type: 'GENERAL',
        parentId: '',
        color: '#3B82F6',
        icon: 'Package'
      });

      // Reset filters to show new item
      setSearchQuery('');
      setSelectedType('all');

      // Show success toast immediately
      toast({
        title: "Category Added",
        description: "Category has been saved to database successfully.",
      });

      console.log('🔍 Creating category with data:', categoryData);
      const response = await apiService.createCategory(categoryData);
      console.log('🔍 Create category response:', response);

      if (response.success && response.data) {
        // Replace temp category with real category - ensure all required fields
        const apiData = response.data as any;
        const realCategory: Category = {
          ...apiData,
          type: (apiData.type || 'GENERAL') as 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL',
          isActive: apiData.isActive !== undefined ? apiData.isActive : true,
          productCount: apiData._count?.products || 0,
          color: apiData.color || '#3B82F6',
          icon: 'Package',
          description: apiData.description || '',
          _count: apiData._count || { products: 0 },
          updatedAt: apiData.updatedAt || apiData.createdAt || new Date().toISOString()
        };
        setCategories(prevCategories =>
          prevCategories.map(c => c.id === tempCategory.id ? realCategory : c)
        );
        // Reload to ensure sync
        setTimeout(() => loadCategories(), 100);
      } else {
        // Rollback on failure
        setCategories(categories);
        toast({
          title: "Error",
          description: response.message || "Failed to add category. Please try again.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error('Error adding category:', err);
      // Rollback on error
      setCategories(categories);
      toast({
        title: "Error",
        description: err.message || "Failed to add category. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditCategory = async (formData: any) => {
    if (!editingCategory) return;

    try {
      setIsSubmitting(true);

      // Convert type to uppercase to match backend validation
      const updateData = {
        name: formData.name,
        description: formData.description,
        type: formData.type, // Already converted to uppercase in CategoryForm
        color: formData.color
      };

      const response = await apiService.updateCategory(editingCategory.id, updateData);

      if (response.success) {
        toast({
          title: "Category Updated",
          description: "Category has been updated successfully.",
        });
        setEditingCategory(null);
        setFormData({
          name: '',
          description: '',
          type: 'GENERAL',
          parentId: '',
          color: '#3B82F6',
          icon: 'Package'
        });
        loadCategories();
      } else {
        toast({
          title: "Error",
          description: "Failed to update category.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error('Error updating category:', err);
      toast({
        title: "Error",
        description: "Failed to update category.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    if (category) {
      setDeletingCategory(category);
    }
  };

  const handleConfirmDeleteCategory = async () => {
    if (!deletingCategory) return;
    
    try {
      setIsDeleting(deletingCategory.id);
      const response = await apiService.deleteCategory(deletingCategory.id);

      if (response.success) {
        toast({
          title: "Category Deleted",
          description: "Category has been deleted from database successfully.",
        });
        loadCategories();
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to delete category. Please try again.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      console.error('Error deleting category:', err);
      toast({
        title: "Error",
        description: err.message || "Failed to delete category. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(null);
      setDeletingCategory(null);
    }
  };

  const openEditDialog = (category: Category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      description: category.description,
      type: category.type,
      parentId: category.parentId || '',
      color: category.color,
      icon: category.icon
    });
  };

  const getTypeIcon = (type: string | undefined) => {
    const t = String(type || "").toUpperCase();
    if (t === "MEDICAL") return <Activity className="h-3 w-3 shrink-0" strokeWidth={2} />;
    if (t === "NON_MEDICAL") return <Layers className="h-3 w-3 shrink-0" strokeWidth={2} />;
    return <Package className="h-3 w-3 shrink-0" strokeWidth={2} />;
  };

  const getTypeBadgeClass = (type: string | undefined) => {
    const t = String(type || "").toUpperCase();
    if (t === "MEDICAL")
      return "border border-[rgba(26,82,197,0.1)] bg-[rgba(26,82,197,0.06)] text-[#1a52c5]";
    if (t === "NON_MEDICAL")
      return "border border-green-600/12 bg-[rgba(22,163,74,0.06)] text-green-700";
    return "border border-[rgba(15,23,60,0.08)] bg-black/[0.03] text-[#4a5578]";
  };

  const formatTypeLabel = (type: string | undefined) => {
    const t = String(type || "").toUpperCase();
    if (t === "NON_MEDICAL") return "Non-Medical";
    return t ? t.charAt(0) + t.slice(1).toLowerCase() : "General";
  };

  // Don't show loading screen - show content immediately

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
          <div className="max-w-md w-full">
            <div className="relative overflow-hidden rounded-[22px] border border-red-200 bg-white p-8 shadow-[0_2px_16px_rgba(239,68,68,0.08)]">
              <div className="absolute top-0 right-0 h-32 w-32 rounded-full bg-gradient-to-br from-red-50 to-transparent opacity-50" />
              <div className="absolute bottom-0 left-0 h-24 w-24 rounded-full bg-gradient-to-tr from-red-50 to-transparent opacity-50" />
              
              <div className="relative z-[1] flex flex-col items-center text-center">
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                  <AlertCircle className="h-8 w-8 text-red-500" />
                </div>
                
                <h3 className="mb-2 text-xl font-bold text-[#0a1128]">
                  Unable to Load Categories
                </h3>
                
                <p className="mb-6 text-sm text-[#8c95b0]">
                  {error}
                </p>
                
                <div className="mb-6 space-y-2 text-left rounded-lg bg-red-50 p-4">
                  <p className="text-xs font-semibold text-red-700 mb-2">Troubleshooting tips:</p>
                  <ul className="space-y-1 text-xs text-red-600">
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 h-1 w-1 rounded-full bg-red-500 flex-shrink-0" />
                      Check your internet connection
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 h-1 w-1 rounded-full bg-red-500 flex-shrink-0" />
                      Verify the server is running
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 h-1 w-1 rounded-full bg-red-500 flex-shrink-0" />
                      Try refreshing the page
                    </li>
                  </ul>
                </div>
                
                <Button 
                  type="button" 
                  className="w-full rounded-[10px] bg-[#1a52c5] text-white hover:bg-[#0f3a8c]"
                  onClick={() => void loadCategories()}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try Again
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sfInput = cn(
    "h-11 w-full rounded-[10px] border-[1.5px] border-black/[0.07] bg-white pl-10 pr-3.5 text-sm font-medium text-[#0a1128] shadow-none transition-all",
    "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-[4px] focus-visible:ring-[rgba(26,82,197,0.06)]",
  );
  const sfSelect = cn(
    "h-11 w-full rounded-[10px] border-[1.5px] border-black/[0.07] bg-white text-sm font-medium text-[#0a1128] shadow-none sm:min-w-[200px]",
    "focus:ring-[4px] focus:ring-[rgba(26,82,197,0.06)] focus:ring-offset-0",
  );

  return (
    <>
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
          <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">Categories</h1>
          <p className="text-sm text-[#8c95b0]">
            Manage product categories and organize your inventory
            {selectedBranch?.name ? (
              <>
                {" "}
                • <b className="font-semibold text-[#4a5578]">{selectedBranch.name}</b>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddDialog(true)}
            className="ml-1 inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(26,82,197,0.35)]"
          >
            <Plus className="h-[17px] w-[17px] stroke-[2.5]" strokeLinecap="round" />
            Add Category
          </button>
        </div>
      </div>

      <div className="zv3-animate-fadeUp zv3-delay-1 flex flex-col gap-4 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-6 py-5 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-[3]">
          <p className="mb-2 text-xs font-semibold text-[#8c95b0]">Search Categories</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]" strokeWidth={2} />
            <Input
              id="search"
              placeholder="Search by name or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={sfInput}
            />
          </div>
        </div>
        <div className="w-full lg:w-56">
          <p className="mb-2 text-xs font-semibold text-[#8c95b0]">Type</p>
          <Select value={selectedType} onValueChange={setSelectedType}>
            <SelectTrigger className={sfSelect}>
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="MEDICAL">Medical</SelectItem>
              <SelectItem value="NON_MEDICAL">Non-Medical</SelectItem>
              <SelectItem value="GENERAL">General</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="zv3-animate-fadeUp zv3-delay-3">
        <div className="mb-4 flex items-center gap-2.5">
          <Grid3X3 className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
          <span className="text-[17px] font-bold text-[#0a1128]">Categories</span>
          <span className="text-sm font-medium text-[#8c95b0]">({filteredCategories.length})</span>
        </div>

        {filteredCategories.length === 0 ? (
          <div className="rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white px-8 py-16 text-center shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
            <div className="mx-auto mb-6 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[rgba(26,82,197,0.06)]">
              <Tag className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
            </div>
            <p className="mb-2 text-sm font-bold text-[#0a1128]">No categories found</p>
            <p className="mx-auto mb-6 max-w-md text-sm text-[#8c95b0]">
              {searchQuery || selectedType !== "all"
                ? "Try adjusting your search or filter criteria."
                : "Get started by adding your first category."}
            </p>
            {!searchQuery && selectedType === "all" && (
              <Button
                type="button"
                onClick={() => setShowAddDialog(true)}
                className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Category
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
                      Category
                    </th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                      Type
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
                  {paginatedCategories.map((category) => (
                    <tr
                      key={category.id}
                      className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                    >
                      <td className="px-5 py-4 pl-8 align-middle">
                        <div className="flex items-center gap-3">
                          <div
                            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] text-white"
                            style={{
                              background: `linear-gradient(135deg, ${category.color || "#1a52c5"}, #28c2ce)`,
                            }}
                          >
                            <Package className="h-[18px] w-[18px]" strokeWidth={2} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[15px] font-bold text-[#0a1128]">{category.name}</p>
                            <p className="truncate text-sm text-[#8c95b0]">{category.description || "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold",
                            getTypeBadgeClass(category.type),
                          )}
                        >
                          {getTypeIcon(category.type)}
                          {formatTypeLabel(category.type)}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <span className="text-sm font-bold text-[#0a1128]">{category.productCount ?? 0}</span>
                      </td>
                      <td className="px-5 py-4 pr-8 text-right align-middle">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            title="Edit"
                            onClick={() => openEditDialog(category)}
                            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                          >
                            <Edit className="h-[15px] w-[15px]" strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            title="Delete category"
                            onClick={() => handleDeleteCategory(category.id)}
                            disabled={isDeleting === category.id}
                            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-red-600/15 hover:bg-red-600/[0.05] hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isDeleting === category.id ? (
                              <Loader2 className="h-[15px] w-[15px] animate-spin" />
                            ) : (
                              <Trash2 className="h-[15px] w-[15px]" strokeWidth={2} />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {filteredCategories.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4 border-t border-[rgba(15,23,60,0.06)]">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-[#8c95b0]">
                    Showing {((safePage - 1) * pageSize) + 1} to {Math.min(safePage * pageSize, filteredCategories.length)} of {filteredCategories.length} categories
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

      {/* Add/Edit Category Dialog */}
      <Dialog open={showAddDialog || !!editingCategory} onOpenChange={(open) => {
        if (!open) {
          setShowAddDialog(false);
          setEditingCategory(null);
          setFormData({
            name: '',
            description: '',
            type: 'GENERAL',
            parentId: '',
            color: '#3B82F6',
            icon: 'Package'
          });
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">
              {editingCategory ? "Edit category" : "Add new category"}
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
              {editingCategory ? "Update category information." : "Create a new product category for your inventory."}
            </DialogDescription>
          </DialogHeader>

          <CategoryForm
            initialData={editingCategory ? {
              name: editingCategory.name,
              description: editingCategory.description || '',
              type: (() => {
                const t = String(editingCategory.type || "").toUpperCase();
                if (t === "MEDICAL") return "medical" as const;
                if (t === "NON_MEDICAL") return "non-medical" as const;
                return "general" as const;
              })(),
              color: editingCategory.color || '#3B82F6'
            } : {}}
            onSubmit={editingCategory ? handleEditCategory : handleAddCategory}
            onCancel={() => {
              setShowAddDialog(false);
              setEditingCategory(null);
            }}
            isSubmitting={isSubmitting}
            submitButtonText={editingCategory ? 'Update Category' : 'Add Category'}
          />
        </DialogContent>
      </Dialog>

      </div>

    {/* Delete Confirmation Modal */}
    <ConfirmationModal
      isOpen={!!deletingCategory}
      onClose={() => setDeletingCategory(null)}
      onConfirm={handleConfirmDeleteCategory}
      title="Delete Category"
      description="Are you sure you want to delete this category? This action cannot be undone."
      confirmText="Delete Category"
      cancelText="Cancel"
      variant="danger"
      isLoading={!!isDeleting}
      loadingText="Deleting..."
      itemName={deletingCategory ? `Category: ${deletingCategory.name}` : undefined}
      itemDetails="This will permanently remove the category and all associated data."
      icon={<Trash2 className="w-4 h-4" />}
    />
      </div>
    </>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(Categories);
