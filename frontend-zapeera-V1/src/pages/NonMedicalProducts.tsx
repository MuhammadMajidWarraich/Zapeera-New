import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import {
  Search,
  Plus,
  Filter,
  Package,
  AlertTriangle,
  AlertCircle,
  Barcode,
  Edit,
  Trash2,
  Eye,
  ShoppingBag,
  Home,
  Utensils,
  Shirt,
  Book,
  Gamepad2
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";

interface NonMedicalProduct {
  id: string;
  name: string;
  description: string;
  sku: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  maxStock: number;
  category: { id: string; name: string; type: string };
  supplier: { id: string; name: string };
  brand?: string;
  weight?: string;
  dimensions?: string;
  color?: string;
  material?: string;
  warranty?: string;
  createdAt: string;
  updatedAt: string;
}

const NonMedicalProducts = () => {
  const { user } = useAuth();
  const { selectedCompanyId, selectedBranchId } = useAdmin();
  const [products, setProducts] = useState<NonMedicalProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<NonMedicalProduct | null>(null);

  // Load non-medical products
  const loadNonMedicalProducts = async () => {
    try {
      setLoading(true);
      const response = await apiService.getProducts({
        page: 1,
        limit: 100,
        categoryType: 'NON_MEDICAL', // Filter for non-medical products by category type
        companyId: selectedCompanyId || '',
        branchId: selectedBranchId || undefined,
      });

      if (response.success) {
        setProducts(response.data.products || []);
      } else {
        setError('Failed to load non-medical products');
      }
    } catch (err) {
      console.error('Error loading non-medical products:', err);
      setError('Failed to load non-medical products');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNonMedicalProducts();
  }, [selectedCompanyId, selectedBranchId]);

  // Filter products based on search and category
  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         product.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         product.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === "all" || product.category?.name === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  // Get unique categories
  const categories = Array.from(new Set(products.map(p => p.category?.name).filter(Boolean)));

  // Get low stock products
  const lowStockProducts = products.filter(p => p.stock <= p.minStock);

  // Get out of stock products
  const outOfStockProducts = products.filter(p => p.stock === 0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case 'food & beverages':
        return <Utensils className="w-4 h-4" />;
      case 'clothing':
        return <Shirt className="w-4 h-4" />;
      case 'books':
        return <Book className="w-4 h-4" />;
      case 'electronics':
        return <Gamepad2 className="w-4 h-4" />;
      case 'home & garden':
        return <Home className="w-4 h-4" />;
      default:
        return <ShoppingBag className="w-4 h-4" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading non-medical products...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={loadNonMedicalProducts}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center">
            <ShoppingBag className="w-8 h-8 mr-3 text-green-600" />
            Non-Medical Products
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage general merchandise and non-medical products • {products.length} products total
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Button
            onClick={() => setShowAddDialog(true)}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Non-Medical Product
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="bg-white border-0 shadow-soft">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Products</p>
                <p className="text-2xl font-bold text-gray-900">{products.length}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Package className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-0 shadow-soft">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Low Stock</p>
                <p className="text-2xl font-bold text-orange-600">{lowStockProducts.length}</p>
              </div>
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-0 shadow-soft">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Out of Stock</p>
                <p className="text-2xl font-bold text-red-600">{outOfStockProducts.length}</p>
              </div>
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-0 shadow-soft">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Categories</p>
                <p className="text-2xl font-bold text-blue-600">{categories.length}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <ShoppingBag className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6 bg-white border-0 shadow-soft">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <Label htmlFor="search">Search Products</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  id="search"
                  placeholder="Search by name, SKU, brand, or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="lg:w-64">
              <Label htmlFor="category">Category</Label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="all"
                    className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                  >
                    All Categories
                  </SelectItem>
                  {categories.map(category => (
                    <SelectItem
                      key={category}
                      value={category}
                      className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                    >
                      <div className="flex items-center">
                        {getCategoryIcon(category)}
                        <span className="ml-2">{category}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Products Table */}
      <Card className="bg-white border-0 shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Package className="w-5 h-5 mr-2" />
            Non-Medical Products ({filteredProducts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingBag className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No non-medical products found</h3>
              <p className="text-gray-500 mb-4">
                {searchQuery || selectedCategory !== "all"
                  ? "Try adjusting your search or filter criteria."
                  : "Get started by adding your first non-medical product."
                }
              </p>
              {!searchQuery && selectedCategory === "all" && (
                <Button onClick={() => setShowAddDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Non-Medical Product
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Product</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">SKU</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Category</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Brand</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Stock</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Price</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => (
                    <tr key={product.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div>
                          <p className="font-medium text-gray-900">{product.name}</p>
                          <p className="text-sm text-gray-500">{product.description}</p>
                          {product.color && (
                            <div className="flex items-center mt-1">
                              <div
                                className="w-3 h-3 rounded-full mr-2 border border-gray-300"
                                style={{ backgroundColor: product.color }}
                              ></div>
                              <span className="text-xs text-gray-500">{product.color}</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                          {product.sku}
                        </code>
                      </td>
                      <td className="py-4 px-4">
                        <Badge variant="outline" className="flex items-center w-fit">
                          {getCategoryIcon(product.category?.name || '')}
                          <span className="ml-1">{product.category?.name || 'Unknown'}</span>
                        </Badge>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-gray-600">
                          {product.brand || 'N/A'}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center">
                          <span className={`font-medium ${
                            product.stock === 0 ? 'text-red-600' :
                            product.stock <= product.minStock ? 'text-orange-600' :
                            'text-green-600'
                          }`}>
                            {product.stock}
                          </span>
                          <span className="text-gray-500 text-sm ml-1">
                            / {product.maxStock}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="font-medium">{formatCurrency(product.price)}</span>
                      </td>
                      <td className="py-4 px-4">
                        {product.stock === 0 ? (
                          <Badge variant="destructive">Out of Stock</Badge>
                        ) : product.stock <= product.minStock ? (
                          <Badge variant="destructive">Low Stock</Badge>
                        ) : (
                          <Badge variant="default">In Stock</Badge>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <Button variant="ghost" size="sm">
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm">
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(NonMedicalProducts);
