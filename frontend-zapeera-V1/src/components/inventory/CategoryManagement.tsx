import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  Edit,
  Trash2,
  Plus,
  Search,
  Package,
  Loader2,
  Save,
  X
} from "lucide-react";
import { apiService } from "@/services/api";
import CategoryForm from "./CategoryForm";
import { PaginationPills } from "@/components/ui/pagination-pills";

interface Category {
  id: string;
  name: string;
  description?: string;
  type?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    products: number;
  };
}

interface CategoryManagementProps {
  isOpen: boolean;
  onClose: () => void;
  onCategoryChange?: () => void;
}

const CategoryManagement = ({ isOpen, onClose, onCategoryChange }: CategoryManagementProps) => {
  const { user } = useAuth();
  const { selectedBranchId } = useAdmin();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false); // Don't show loading initially
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [newCategory, setNewCategory] = useState({
    name: "",
    description: "",
    type: 'general' as 'medical' | 'non-medical' | 'general',
    color: "#3B82F6"
  });
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const loadCategories = async () => {
    try {
      const response = await apiService.getCategories({
        limit: 100,
        branchId: user?.branchId || ""
      });

      if (response.success && response.data) {
        const categoriesData = response.data.categories;
        setCategories(categoriesData);
      } else {
        setError('Failed to load categories');
      }
    } catch (error) {
      console.error('Error loading categories:', error);
      setError('Failed to load categories');
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadCategories();
    }
  }, [isOpen, selectedBranchId, user?.id, user?.branchId, user?.role, loadCategories]);

  const handleCreateCategory = async (formData: any) => {
    try {
      // Don't set loading - instant response

      // Determine branchId: use selectedBranchId for admin, or user's branchId for others
      const branchId = user?.role === 'OWNER'
        ? (selectedBranchId || user?.branchId || '')
        : (user?.branchId || '');

      const response = await apiService.createCategory({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        type: formData.type, // Already converted to uppercase in CategoryForm
        color: formData.color,
        branchId: branchId // Always include branchId
      });

      if (response.success) {
        setNewCategory({ name: "", description: "", type: 'general', color: "#3B82F6" });
        setIsCreateDialogOpen(false);
        await loadCategories();
        onCategoryChange?.();
      } else {
        setError(response.message || 'Failed to create category');
      }
    } catch (error) {
      console.error('Error creating category:', error);
      setError('Failed to create category');
    }
  };

  const handleEditCategory = async (formData: any) => {
    if (!editingCategory) return;

    try {
      // Don't set loading - instant response
      const response = await apiService.updateCategory(editingCategory.id, {
        name: formData.name.trim(),
        description: formData.description?.trim() || undefined,
        type: formData.type, // Already converted to uppercase in CategoryForm
        color: formData.color
      });

      if (response.success) {
        setEditingCategory(null);
        setIsEditDialogOpen(false);
        await loadCategories();
        onCategoryChange?.();
      } else {
        setError(response.message || 'Failed to update category');
      }
    } catch (error) {
      console.error('Error updating category:', error);
      setError('Failed to update category');
    }
  };

  const handleDeleteCategory = async () => {
    if (!deletingCategory) return;

    try {
      // Don't set loading - instant response
      const response = await apiService.deleteCategory(deletingCategory.id);

      if (response.success) {
        setDeletingCategory(null);
        setIsDeleteDialogOpen(false);
        await loadCategories();
        onCategoryChange?.();
      } else {
        setError(response.message || 'Failed to delete category');
      }
    } catch (error: any) {
      console.error('Error deleting category:', error);
      // Extract the specific error message from the backend
      const errorMessage = error?.message || 'Failed to delete category';
      setError(errorMessage);
    }
  };

  const handleEditClick = (category: Category) => {
    setEditingCategory({ ...category });
    setIsEditDialogOpen(true);
  };

  const handleDeleteClick = (category: Category) => {
    setDeletingCategory(category);
    setIsDeleteDialogOpen(true);
  };

  const filteredCategories = categories.filter(category =>
    category.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    category.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Reset pagination when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredCategories.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedCategories = filteredCategories.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Package className="w-5 h-5 text-primary" />
            <span>Category Management</span>
          </DialogTitle>
          <DialogDescription>
            Manage your product categories. You can create, edit, and delete categories.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Search and Actions */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search categories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              onClick={() => setIsCreateDialogOpen(true)}
              className="bg-green-600 hover:bg-green-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Category
            </Button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex">
                <AlertCircle className="w-5 h-5 text-red-400" />
                <div className="ml-3">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Categories Table */}
          <Card>
            <CardHeader>
              <CardTitle>Categories ({filteredCategories.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {filteredCategories.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-lg font-medium">No categories found</p>
                  <p className="text-sm">Create your first category to get started</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Products</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedCategories.map((category) => (
                      <TableRow key={category.id}>
                        <TableCell className="font-medium">{category.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {category.description || 'No description'}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {category._count?.products || 0} products
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(category.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditClick(category)}
                              className="text-blue-600 hover:text-blue-700"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteClick(category)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* Pagination */}
              <div className="mt-6">
                <PaginationPills
                  page={safePage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Create Category Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Category</DialogTitle>
              <DialogDescription>
                Add a new category to organize your products.
              </DialogDescription>
            </DialogHeader>

            <CategoryForm
              onSubmit={handleCreateCategory}
              onCancel={() => setIsCreateDialogOpen(false)}
              isSubmitting={false}
              submitButtonText="Create Category"
            />
          </DialogContent>
        </Dialog>

        {/* Edit Category Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Category</DialogTitle>
              <DialogDescription>
                Update the category information.
              </DialogDescription>
            </DialogHeader>

            <CategoryForm
              initialData={editingCategory ? {
                name: editingCategory.name,
                description: editingCategory.description || '',
                type: (editingCategory.type?.toLowerCase() as 'general' | 'medical' | 'non-medical') || 'general',
                color: editingCategory.color || '#3B82F6'
              } : {}}
              onSubmit={handleEditCategory}
              onCancel={() => setIsEditDialogOpen(false)}
              isSubmitting={false}
              submitButtonText="Update Category"
            />
          </DialogContent>
        </Dialog>

        {/* Delete Category Dialog */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                <AlertCircle className="w-5 h-5 text-destructive" />
                <span>Confirm Delete</span>
              </DialogTitle>
              <DialogDescription>
                {deletingCategory?._count?.products > 0
                  ? "This category cannot be deleted because it contains products. Please move or delete all products first."
                  : "This action cannot be undone. The category will be permanently removed."
                }
              </DialogDescription>
            </DialogHeader>

            {deletingCategory && (
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                      <Trash2 className="w-5 h-5 text-red-600" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-gray-900">
                      Delete Category
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Are you sure you want to delete this category?
                    </p>
                    <div className="mt-3 p-3 bg-gray-50 rounded-md">
                      <p className="text-sm font-medium text-gray-900">
                        {deletingCategory.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {deletingCategory._count?.products || 0} products in this category
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4">
              <Button
                variant="outline"
                onClick={() => setIsDeleteDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteCategory}
                disabled={(deletingCategory?._count?.products || 0) > 0}
                className="bg-red-600 hover:bg-red-700"
              >
                {(deletingCategory?._count?.products || 0) > 0 ? (
                  <>
                    <AlertCircle className="w-4 h-4 mr-2" />
                    Cannot Delete (Has Products)
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Category
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
};

export default CategoryManagement;
