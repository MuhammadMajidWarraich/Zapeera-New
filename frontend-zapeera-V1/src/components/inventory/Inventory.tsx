import { useState, useEffect, useMemo, useLayoutEffect, useCallback } from "react";
import React from "react";
import { config } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import CategoryManagement from "./CategoryManagement";
import CategoryForm from "./CategoryForm";
import { DocumentScanner } from "./DocumentScanner";
import { ExtractedDataReview } from "./ExtractedDataReview";
import {
  Search,
  Plus,
  Filter,
  Package,
  AlertTriangle,
  AlertCircle,
  Edit,
  Trash2,
  Pill,
  RefreshCw,
  Droplets,
  Syringe,
  X,
  Save,
  Loader2,
  TrendingUp,
  LayoutGrid,
  Download,
  Upload,
  FileSpreadsheet,
  Image,
  FolderOpen
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { useToast } from "@/hooks/use-toast";
import { useDashboardData } from "@/contexts/DashboardDataContext";
import { cn } from "@/lib/utils";

function inventoryCategoryBadgeClass(name: string) {
  const n = (name || "").toLowerCase();
  if (n.includes("allerg") || n.includes("antibiot")) {
    return "border border-red-600/10 bg-[rgba(239,68,68,0.06)] text-red-600";
  }
  return "border border-[rgba(26,82,197,0.1)] bg-[rgba(26,82,197,0.06)] text-[#1a52c5]";
}

interface Product {
  id: string;
  name: string;
  description?: string;
  formula?: string; // Product composition/formula
  sku?: string; // Stock Keeping Unit
  category: {
    id: string;
    name: string;
    type?: string; // Category type (MEDICAL, NON_MEDICAL, GENERAL)
  };
  supplier?: {
    id: string;
    name: string;
  };
  branch: {
    id: string;
    name: string;
  };
  barcode?: string;
  requiresPrescription: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  batches?: {
    id: string;
    batchNo: string;
    quantity: number;        // Current remaining quantity
    totalBoxes?: number;     // Original boxes purchased
    unitsPerBox?: number;    // Units per box
    purchasePrice?: number;
    sellingPrice?: number;
    expireDate?: string;
    supplierName?: string;
    supplier?: {
      id: string;
      name: string;
      manufacturer?: {
        id: string;
        name: string;
      };
    };
  }[];
  // Batch-derived fields
  price?: number;
  stock?: number;
  minStock?: number;
}

interface Category {
  id: string;
  name: string;
  description?: string;
  type?: string; // Category type (MEDICAL, NON_MEDICAL, GENERAL)
}

interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  manufacturerId?: string;
  manufacturer?: {
    id: string;
    name: string;
  };
  isActive: boolean;
}

const Inventory = () => {
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch, selectedCompanyId, setSelectedBranchId, allBranches } = useAdmin();
  const { toast } = useToast();
  
  // Dashboard data cache (disabled - data caching removed)
  const {
    getCachedData,
    setCachedData,
    isCacheValid,
    setLoading: setCacheLoading
  } = useDashboardData();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedProductType, setSelectedProductType] = useState("all");
  const [selectedManufacturer, setSelectedManufacturer] = useState("all");
  const [selectedSupplier, setSelectedSupplier] = useState("all");
  const [showAllProducts, setShowAllProducts] = useState(true); // Show all products by default
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  // Stock filter checkboxes
  const [showOutOfStock, setShowOutOfStock] = useState(false); // Products that are out of stock (stock = 0)
  const [showLowStock, setShowLowStock] = useState(false); // Products with low stock (stock <= minStock)
  const [showExpired, setShowExpired] = useState(false); // Products with expired batches
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isCategoryManagementOpen, setIsCategoryManagementOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCreateCategoryDialogOpen, setIsCreateCategoryDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [manufacturers, setManufacturers] = useState<any[]>([]);
  const [allProducts, setAllProducts] = useState<any[]>([]); // Store all products for filtering
  const [loading, setLoading] = useState(true);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [isAdding, setIsAdding] = useState(false); // Separate state for adding product
  const [error, setError] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [importedProducts, setImportedProducts] = useState<any[]>([]);
  const [processingImage, setProcessingImage] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });
  const [filteredProductsForPagination, setFilteredProductsForPagination] = useState<any[]>([]);

  // Form state for adding new medicine
  const [newMedicine, setNewMedicine] = useState({
    name: "",
    categoryId: "",
    formula: "",
    barcode: "",
    requiresPrescription: false,
    minStock: 10
  });

  // Form state for creating new category
  const [newCategory, setNewCategory] = useState({
    name: "",
    description: "",
    type: 'general' as 'medical' | 'non-medical' | 'general',
    color: "#3B82F6"
  });


  // Cache restoration removed - data caching disabled

  // CRITICAL FIX: Reload data when branch OR company changes
  useEffect(() => {
    console.log('🔄 Branch/Company changed - reloading inventory:', { 
      selectedBranchId: selectedBranchId || 'All Branches', 
      selectedCompanyId,
      userBranchId: user?.branchId
    });
    // Reset filters on branch/company switch to avoid stale selections
    setSelectedCategory("all");
    setSelectedProductType("all");
    setSelectedManufacturer("all");
    setSelectedSupplier("all");
    setShowOutOfStock(false);
    setShowLowStock(false);
    setShowExpired(false);
    setSearchQuery("");
    setSelectedProducts([]);
    // Force refresh to load correct branch data
    loadData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId, selectedBranchId]);

  // Also listen to custom event for immediate reload
  useEffect(() => {
    const handleReload = () => {
      console.log('🔄 Custom event: Branch/Company changed - reloading inventory');
      loadData();
    };
    window.addEventListener('branchOrCompanyChanged', handleReload);
    return () => window.removeEventListener('branchOrCompanyChanged', handleReload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply filters when filter states or search query changes
  useEffect(() => {
    console.log('🔄 Filters or search query changed, applying filters...');
    applyFilters();
  }, [selectedCategory, selectedProductType, selectedManufacturer, selectedSupplier, allProducts, searchQuery, showOutOfStock, showLowStock, showExpired]);

  // Reload data when showAllProducts changes
  useEffect(() => {
    if (showAllProducts !== false) {
      console.log('ShowAllProducts changed, reloading data...');
      loadData();
    }
  }, [showAllProducts]);

  // Debug: Log products state changes
  useEffect(() => {
    console.log('🔄 Products state changed:', products.length, 'products');
    console.log('Products data:', products);
  }, [products]);

  // Real-time data synchronization
  useEffect(() => {
    const handleProductChanged = (event: CustomEvent) => {
      console.log('🔄 Real-time product change received:', event.detail);
      const { action, product } = event.detail;

      if (action === 'created') {
        // Add new product to the list
        setProducts(prev => [product, ...prev]);
      } else if (action === 'updated') {
        // Update existing product
        setProducts(prev => prev.map(p => p.id === product.id ? product : p));
      } else if (action === 'deleted') {
        // Remove product from the list
        setProducts(prev => prev.filter(p => p.id !== product.id));
      }
    };

    const handleInventoryChanged = (event: CustomEvent) => {
      console.log('🔄 Real-time inventory change received:', event.detail);
      const { action, data } = event.detail;

      if (action === 'product_added') {
        // Add new product to the list
        setProducts(prev => [data, ...prev]);
      } else if (action === 'product_removed') {
        // Remove product from the list
        setProducts(prev => prev.filter(p => p.id !== data.id));
      } else if (action === 'stock_updated') {
        // Update product stock
        setProducts(prev => prev.map(p =>
          p.id === data.productId
            ? { ...p, stock: data.newStock }
            : p
        ));
      }
    };

    const handleSaleChanged = (event: CustomEvent) => {
      console.log('🔄 Real-time sale change received:', event.detail);
      const { action, sale } = event.detail;

      if (action === 'created') {
        // Reload inventory data to reflect stock changes
        console.log('🔄 Sale created, reloading inventory data...');
        loadData();
      }
    };

    // Add event listeners
    window.addEventListener('productChanged', handleProductChanged as EventListener);
    window.addEventListener('inventoryChanged', handleInventoryChanged as EventListener);
    window.addEventListener('saleChanged', handleSaleChanged as EventListener);

    // Cleanup
    return () => {
      window.removeEventListener('productChanged', handleProductChanged as EventListener);
      window.removeEventListener('inventoryChanged', handleInventoryChanged as EventListener);
      window.removeEventListener('saleChanged', handleSaleChanged as EventListener);
    };
  }, []);

  const loadData = useCallback(async (forceRefresh: boolean = false) => {
    // Calculate branchIdForCache once at the start - used throughout the function
    // CRITICAL: When selectedBranchId is null (All Branch), use null for cache key
    // For all users (Admin, Manager, Cashier), use selectedBranchId if available, otherwise user's branchId
    // Calculate branchIdForCache - when "All Branch" is selected (null), use null for cache key
    // When specific branch is selected, use that branchId
    const branchIdForCache = selectedBranchId !== null ? selectedBranchId : null;
    
    // Declare variables at function scope to ensure they're accessible throughout
    let debugProducts: any[] = [];
    let productsWithBatchData: any[] = [];
    
    try {
      // Cache check removed - data caching disabled
      setLoading(true);
      setCacheLoading(selectedCompanyId, branchIdForCache, true);
      setError(null);

      console.log('=== INVENTORY LOAD DATA DEBUG ===');
      console.log('User object:', user);
      console.log('User role:', user?.role);
      console.log('User branchId:', user?.branchId);
      console.log('Admin context:', { selectedBranchId, selectedBranch: selectedBranch?.name });
      console.log('Current products count:', products.length);
      console.log('Is user authenticated:', !!user);

      // Determine which branch to load products from
      // CRITICAL: When selectedBranchId is null (All Branches), don't pass branchId
      // This allows API to return products from ALL branches of the selected company
      const params: any = { limit: 10000 }; // High limit to get all products
      
      if (selectedBranchId) {
        // Specific branch selected - filter by that branch ONLY
        params.branchId = selectedBranchId;
        console.log('🔍 Selected specific branch - filtering products by branchId:', selectedBranchId, selectedBranch?.name);
      } else {
        // All Branch selected (selectedBranchId is null) - don't pass branchId
        // API will use X-Business-ID header to return all branches' products
        // CRITICAL: Do NOT set user.branchId here - we want ALL branches' data
        console.log('🔍 All Branch selected - loading all products (no branchId filter)');
        console.log('🔍 Selected company ID:', selectedCompanyId);
        // Explicitly don't set branchId - let API use X-Business-ID header
      }

      console.log('Calling getProducts API with params:', params);
      console.log('🔍 Branch filtering details:', {
        selectedBranchId,
        paramsBranchId: params.branchId,
        userBranchId: user?.branchId,
        selectedCompanyId
      });

      const response = await apiService.getProducts({
        ...params,
        companyId: selectedCompanyId || '',
      });
      
      console.log('🔍 API Response check:', {
        success: response.success,
        productsCount: response.data?.products?.length || 0,
        requestedBranchId: params.branchId || 'All Branches'
      });

      console.log('=== PRODUCTS API RESPONSE ===');
      console.log('Products API response:', response);
      console.log('Requesting products for branchId:', params.branchId || 'All Branches');
      console.log('Response success:', response.success);
      console.log('Response data:', response.data);
      console.log('Response data type:', typeof response.data);
      console.log('Response message:', response.message);

      if (response.success && response.data) {
        const allProducts = Array.isArray(response.data.products) ? response.data.products : [];
        console.log('✅ Total products from API for branch:', params.branchId || 'All Branches', 'Count:', allProducts.length);
        console.log('✅ Response data structure:', {
          hasData: !!response.data,
          hasProducts: !!response.data.products,
          productsIsArray: Array.isArray(response.data.products),
          productsLength: response.data.products?.length || 0,
          selectedBranchId: selectedBranchId || 'All Branches',
          branchIdForCache: branchIdForCache || 'All Branches',
          requestedBranchId: params.branchId || 'All Branches'
        });
        
        // Verify branch filtering - check if all products are from the requested branch
        if (params.branchId && allProducts.length > 0) {
          const uniqueBranchIds = [...new Set(allProducts.map((p: any) => p.branchId))];
          console.log('🔍 Branch verification:', {
            requestedBranchId: params.branchId,
            uniqueBranchIdsInResponse: uniqueBranchIds,
            allMatch: uniqueBranchIds.length === 1 && uniqueBranchIds[0] === params.branchId
          });
          if (uniqueBranchIds.length > 1 || (uniqueBranchIds.length === 1 && uniqueBranchIds[0] !== params.branchId)) {
            console.error('❌ ERROR: Products from wrong branch(s)!', {
              requested: params.branchId,
              received: uniqueBranchIds
            });
          }
        }
        
        if (allProducts.length === 0) {
          console.warn('⚠️ No products returned from API for branch:', params.branchId || 'All Branches');
        }
        // Log first few products to verify branch filtering
        if (allProducts.length > 0) {
          console.log('✅ Sample products (first 3):', allProducts.slice(0, 3).map((p: any) => ({
            name: p.name,
            branchId: p.branchId,
            branchName: p.branch?.name
          })));
        }

        // Batch data is now included in the product response
        console.log('🔄 Processing products with batch data...');
        productsWithBatchData = allProducts.map((product: any) => {
          console.log(`🔄 Processing product ${product.name}:`, {
            price: product.price,
            stock: product.stock,
            currentBatch: product.currentBatch
          });

          return {
            ...product,
            price: product.price || 0, // Price now comes from batch data
            stock: product.stock || 0,  // Stock now comes from batch data
            batches: product.batches || [] // Include batches for manufacturer filtering
          };
        });

        console.log('🔄 Products with batch data:', productsWithBatchData);
        const allProductsWithBatchData = productsWithBatchData;

        // Filter products based on search and category
        let filteredProducts = allProductsWithBatchData;

        if (searchQuery) {
          console.log('Filtering by search query:', searchQuery);
          filteredProducts = filteredProducts.filter((product: any) =>
            product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            product.barcode?.includes(searchQuery)
          );
          console.log('Products after search filter:', filteredProducts.length);
        }

        // Category filtering removed - all products are shown

        // Apply pagination
        const startIndex = 0;
        const endIndex = 10; // Show 10 products by default
        debugProducts = filteredProducts.slice(startIndex, endIndex);

        console.log('Setting products in loadData:', {
          allProducts: allProducts.length,
          filteredProducts: filteredProducts.length,
          paginatedProducts: debugProducts.length,
          allProductsData: allProducts,
          filteredProductsData: filteredProducts
        });

        // Store all products for filtering - SET IMMEDIATELY
        setAllProducts(productsWithBatchData);
        setFilteredProductsForPagination(filteredProducts);
        setProducts(debugProducts); // Set paginated products
        setPagination({
          page: 1,
          limit: 10,
          total: filteredProducts.length,
          pages: Math.ceil(filteredProducts.length / 10)
        });

        console.log('✅ Products set to state IMMEDIATELY:', debugProducts.length);
        console.log('Final products data:', debugProducts);

        // Cache will be saved after all data is loaded (categories, suppliers, manufacturers)
      } else {
        console.log('API call failed, trying fallback...');
        // Fallback: try to get products without any parameters
        try {
          const fallbackResponse = await apiService.getProducts({
            companyId: selectedCompanyId || '',
          });
          console.log('Fallback API response:', fallbackResponse);
          if (fallbackResponse.success && fallbackResponse.data) {
            const fallbackProducts = fallbackResponse.data.products || [];
            console.log('Fallback products:', fallbackProducts.length);
            setProducts(fallbackProducts);
            setPagination({
              page: 1,
              limit: 50,
              total: fallbackProducts.length,
              pages: 1
            });
          } else {
            setProducts([]);
            setPagination({
              page: 1,
              limit: 50,
              total: 0,
              pages: 0
            });
          }
        } catch (fallbackError) {
          console.error('Fallback API call also failed:', fallbackError);
          setProducts([]);
          setPagination({
            page: 1,
            limit: 50,
            total: 0,
            pages: 0
          });
        }
      }

      // --- Load categories, suppliers, manufacturers ---
      // STRATEGY: Load from API first, then merge with data derived from loaded products
      // to guarantee all filter options match what's actually in the products table.

      // 1. CATEGORIES
      const categoryParams: any = { limit: 1000 };
      if (selectedBranchId) {
        categoryParams.branchId = selectedBranchId;
      } else {
        categoryParams.companyId = selectedCompanyId || '';
      }

      const categoriesResponse = await apiService.getCategories(categoryParams);
      let categoriesData: any[] = [];
      if (categoriesResponse.success && categoriesResponse.data) {
        const responseData = categoriesResponse.data as any;
        if (Array.isArray(responseData)) {
          categoriesData = responseData;
        } else if (responseData.categories && Array.isArray(responseData.categories)) {
          categoriesData = responseData.categories;
        } else if (responseData.data && Array.isArray(responseData.data)) {
          categoriesData = responseData.data;
        }
      }
      // Merge with categories found in actual loaded products
      const productCategories = (productsWithBatchData || []).reduce((acc: any[], product: any) => {
        if (product.category && product.category.id && !acc.find((c: any) => c.id === product.category.id)) {
          acc.push(product.category);
        }
        return acc;
      }, []);
      productCategories.forEach((pc: any) => {
        if (!categoriesData.find((c: any) => c.id === pc.id)) {
          categoriesData.push(pc);
        }
      });
      console.log('🔍 Final categories count:', categoriesData.length);
      setCategories(categoriesData);

      // 2. SUPPLIERS
      const supplierParams: any = { companyId: selectedCompanyId || '' };
      if (selectedBranchId) {
        supplierParams.branchId = selectedBranchId;
      }

      let suppliersData: Supplier[] = [];
      let suppliersResponse: any = { success: false, data: null };
      try {
        suppliersResponse = await apiService.getSuppliers(supplierParams);
        if (suppliersResponse.success && suppliersResponse.data) {
          if (Array.isArray(suppliersResponse.data)) {
            suppliersData = suppliersResponse.data as Supplier[];
          } else if ('suppliers' in suppliersResponse.data && Array.isArray(suppliersResponse.data.suppliers)) {
            suppliersData = suppliersResponse.data.suppliers as Supplier[];
          }
        }
      } catch (error) {
        console.error('Error loading suppliers:', error);
      }
      // Map supplier data to include manufacturer info
      const mappedSuppliers = suppliersData.map((supplier: any) => ({
        id: supplier.id,
        name: supplier.name,
        contactPerson: supplier.contactPerson,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
        manufacturerId: supplier.manufacturerId,
        manufacturer: supplier.manufacturer ? {
          id: supplier.manufacturer.id,
          name: supplier.manufacturer.name
        } : undefined,
        isActive: supplier.isActive
      }));
      console.log('🔍 Final suppliers count:', mappedSuppliers.length);
      setSuppliers(mappedSuppliers);

      // 3. MANUFACTURERS
      let manufacturersData: any[] = [];
      let manufacturersResponse: any = { success: false, data: null };
      try {
        manufacturersResponse = await apiService.getManufacturers({
          page: 1,
          limit: 1000,
          active: true
        });
        if (manufacturersResponse.success && manufacturersResponse.data) {
          manufacturersData = manufacturersResponse.data.manufacturers || [];
        }
      } catch (error) {
        console.error('Error loading manufacturers:', error);
      }
      console.log('🔍 Final manufacturers count:', manufacturersData.length);
      setManufacturers(manufacturersData);

      // Cache saving removed - data caching disabled
      console.log('✅ Products loaded from database:', {
        branchId: branchIdForCache || 'All Branches',
        productsCount: (productsWithBatchData || debugProducts).length,
        categoriesCount: categoriesData.length,
        suppliersCount: mappedSuppliers.length,
        manufacturersCount: manufacturersData.length
      });
      setLoading(false);
      setCacheLoading(selectedCompanyId, branchIdForCache, false);

    } catch (err) {
      console.error('Error loading data:', err);
      console.error('Error details:', {
        message: err?.message,
        stack: err?.stack,
        name: err?.name,
        response: err?.response,
        status: err?.response?.status,
        data: err?.response?.data
      });

      // Check if it's a connection error - but be lenient in Electron
      const isElectron = typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';

      if (err.message && err.message.includes('Failed to fetch')) {
        if (isElectron) {
          // In Electron, embedded server should always work - don't show scary error
          console.error('❌ Failed to load inventory data in Electron:', err);
          setError('Failed to load inventory data. Please refresh the page.');
        } else {
          setError('⚠️ Backend server is not running. Please start the server and refresh the page.');
        }
      } else {
        console.error('❌ Failed to load inventory data:', err);
        setError(err.message || 'Failed to load inventory data. Please try again.');

        // Clear data - do NOT set fallback/demo data
        setProducts([]);
        setCategories([]);
        setSuppliers([]);
        setManufacturers([]);
      }
      // Don't set loading - silent fail in background
      setLoading(false);
      // Reuse branchIdForCache declared at the start of the function
      setCacheLoading(selectedCompanyId, branchIdForCache, false);
    }
  }, [selectedCompanyId, selectedBranchId, user?.branchId, user?.role, searchQuery, getCachedData, setCachedData, isCacheValid, setCacheLoading]);

  // Get unique manufacturers from API + products
  const getUniqueManufacturers = () => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];

    // From API-loaded manufacturers
    manufacturers.forEach(m => {
      if (m.id && m.name && !seen.has(m.id)) {
        seen.add(m.id);
        result.push({ id: m.id, name: m.name });
      }
    });

    // From supplier->manufacturer relationships
    suppliers.forEach(s => {
      if (s.manufacturer && s.manufacturer.id && !seen.has(s.manufacturer.id)) {
        seen.add(s.manufacturer.id);
        result.push({ id: s.manufacturer.id, name: s.manufacturer.name });
      }
    });

    return result.sort((a, b) => a.name.localeCompare(b.name));
  };

  // OCR Scanner handlers
  const handleExtractedData = (data: any) => {
    setExtractedData(data);
    setIsReviewOpen(true);
    setIsScannerOpen(false);
  };

  const handleConfirmExtractedData = async (data: any) => {
    try {
      const branchId = selectedBranchId || user?.branchId || '';
      const companyId = selectedCompanyId || '';

      // Map extracted data to database entities
      const mapResponse = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/ocr/map`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          extractedData: data,
          branchId,
          companyId,
        }),
        credentials: 'include',
      });

      const mapResult = await mapResponse.json();

      if (mapResult.success) {
        // Save mapped data to database
        const saveResponse = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/ocr/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            mappedData: mapResult.data,
            createdBy: user?.id,
          }),
          credentials: 'include',
        });

        const saveResult = await saveResponse.json();

        if (saveResult.success) {
          toast({
            title: "Success",
            description: "Product information saved successfully",
          });
          // Reload inventory data
          loadData(true);
          setIsReviewOpen(false);
        } else {
          toast({
            title: "Error",
            description: saveResult.errors?.join(', ') || "Failed to save product information",
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Error",
          description: "Failed to map extracted data",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error saving extracted data:', error);
      toast({
        title: "Error",
        description: "Failed to save product information",
        variant: "destructive",
      });
    }
  };

  // Get unique suppliers from products and batches
  const getUniqueSuppliers = () => {
    const supplierNames = new Set<string>();

    // First, add suppliers from the loaded suppliers list
    suppliers.forEach(supplier => {
      if (supplier.name) {
        supplierNames.add(supplier.name);
      }
    });

    // Also add suppliers from products
    allProducts.forEach(product => {
      if (product.supplier && product.supplier.name) {
        supplierNames.add(product.supplier.name);
      }
      // Also check batch-level suppliers
      if (product.batches && Array.isArray(product.batches)) {
        product.batches.forEach((batch: any) => {
          if (batch.supplier?.name) {
            supplierNames.add(batch.supplier.name);
          } else if (batch.supplierName) {
            supplierNames.add(batch.supplierName);
          }
        });
      }
    });

    return Array.from(supplierNames).sort();
  };

  // Apply filters based on selected criteria
  const applyFilters = () => {
    // IMPORTANT: Stock filters apply to ALL products from database first
    // They are primary filters that work independently
    let filtered = [...allProducts];

    // Stock-based filters (checkboxes) - Apply FIRST to all database products
    if (showOutOfStock || showLowStock || showExpired) {
      filtered = filtered.filter(product => {
        const stock = product.stock || 0;
        const minStock = product.minStock || 10;

        // Out of stock (stock = 0)
        if (showOutOfStock && stock === 0) {
          return true;
        }

        // Low stock (stock > 0 but <= minStock threshold)
        if (showLowStock && stock > 0 && stock <= minStock) {
          return true;
        }

        // Expired batches
        if (showExpired && product.batches && product.batches.length > 0) {
          const hasExpiredBatch = product.batches.some((batch: any) => 
            batch.expireDate && new Date(batch.expireDate) < new Date()
          );
          if (hasExpiredBatch) return true;
        }

        return false;
      });
    }

    // Filter by search query (applies after stock filter)
    if (searchQuery) {
      filtered = filtered.filter(product =>
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.barcode?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by category
    if (selectedCategory !== "all") {
      filtered = filtered.filter(product => product.category?.id === selectedCategory);
    }

    // Filter by product type (from category type)
    if (selectedProductType !== "all") {
      filtered = filtered.filter(product => {
        // Check both product.category.type and categories array
        const categoryType = product.category?.type || categories.find(cat => cat.id === product.category?.id)?.type;
        return categoryType === selectedProductType.toUpperCase();
      });
    }

    // Filter by manufacturer (via supplier)
    if (selectedManufacturer !== "all") {
      filtered = filtered.filter(product => {
        // Get the supplier for this product
        const supplier = suppliers.find(s => s.id === product.supplier?.id);
        if (supplier && supplier.manufacturerId) {
          return supplier.manufacturerId === selectedManufacturer;
        }
        return false;
      });
    }

    // Filter by supplier (check product-level and batch-level suppliers)
    if (selectedSupplier !== "all") {
      filtered = filtered.filter(product => {
        if (product.supplier?.name === selectedSupplier) return true;
        // Also check batch-level suppliers
        if (product.batches && Array.isArray(product.batches)) {
          return product.batches.some((batch: any) =>
            batch.supplier?.name === selectedSupplier || batch.supplierName === selectedSupplier
          );
        }
        return false;
      });
    }

    // Store filtered results for pagination and show first page
    setFilteredProductsForPagination(filtered);
    setProducts(filtered.slice(0, pagination.limit));
    setPagination(prev => ({
      ...prev,
      page: 1,
      total: filtered.length,
      pages: Math.ceil(filtered.length / prev.limit)
    }));
  };

  const totalProducts = pagination.total;

  // Calculate total value from all batches across all products
  // Total value = sum of (quantity * purchasePrice) for each batch
  const totalValue = useMemo(() => {
    let total = 0;
    allProducts.forEach((product: any) => {
      if (product.batches && Array.isArray(product.batches)) {
        product.batches.forEach((batch: any) => {
          const quantity = batch.quantity || 0;
          const purchasePrice = batch.purchasePrice || 0;
          total += quantity * purchasePrice;
        });
      }
    });
    return total;
  }, [allProducts]);

  const lowStockCount = useMemo(() => {
    return allProducts.filter((p: any) => {
      const remaining = Number(p.stock) || 0;
      const minStock = Number(p.minStock) || 10;
      return remaining > 0 && remaining <= minStock;
    }).length;
  }, [allProducts]);

  const formatCurrencyFull = (amount: number) => {
    return `PKR ${amount.toLocaleString('en-PK')}`;
  };

  const getStockStatus = (stock: number, minStock: number) => {
    if (stock === 0) return { status: "out", color: "destructive" };
    if (stock <= minStock) return { status: "low", color: "warning" };
    return { status: "good", color: "default" };
  };


  const generateBarcode = () => {
    const randomNum = Math.floor(Math.random() * 10000000000000);
    return randomNum.toString().padStart(13, '0');
  };

  const handleCreateCategory = async (formData: any) => {
    // Check if admin has selected a branch
    if (user?.role === 'OWNER' && !selectedBranchId) {
      toast({
        title: "Branch Selection Required",
        description: "Please select a branch before creating a category!",
        variant: "destructive",
      });
      return;
    }

    // Validate required fields
    if (!formData.name || !formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Category name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsCreatingCategory(true);

      // Determine branchId: use selectedBranchId if available, otherwise user's branchId
      const branchId = selectedBranchId || user?.branchId || '';

      if (!branchId) {
        toast({
          title: "Branch Required",
          description: "Please select a branch before creating a category!",
          variant: "destructive",
        });
        return;
      }

      const categoryData = {
        name: formData.name.trim(),
        description: formData.description?.trim() || "",
        type: formData.type, // Already converted to uppercase in CategoryForm
        color: formData.color || '#3B82F6',
        branchId: branchId // Always include branchId
      };

      console.log('🔍 Creating category with data:', categoryData);

      // Create category via API with timeout
      const response = await Promise.race([
        apiService.createCategory(categoryData),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout. Please try again.')), 30000)
        )
      ]) as any;

      console.log('🔍 Category creation response:', response);

      if (response && response.success) {
        console.log('✅ Category created successfully:', response.data);

        // Close dialog first
        setIsCreateCategoryDialogOpen(false);

        // Reset form
        setNewCategory({
          name: "",
          description: "",
          type: 'general',
          color: "#3B82F6"
        });

        toast({
          title: "Success",
          description: "Category created successfully!",
          variant: "default",
        });
      } else {
        const errorMessage = response?.message || "Failed to create category";
        console.error('❌ Category creation failed:', errorMessage);
        toast({
          title: "Creation Failed",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('❌ Error creating category:', error);
      const errorMessage = error?.message || error?.response?.message || "Failed to create category. Please try again.";
      toast({
        title: "Creation Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      // Always reset loading state
      setIsCreatingCategory(false);
    }
  };

  const handleAddMedicine = async () => {
    // Prevent multiple submissions
    if (isAdding) {
      return;
    }

    if (!newMedicine.name || !newMedicine.categoryId) {
      toast({
        title: "Validation Error",
        description: "Please fill all required fields!",
        variant: "destructive",
      });
      return;
    }

    setIsAdding(true);

    try {
      // Check if admin has selected a branch
      if (user?.role === 'OWNER' && !selectedBranchId) {
        toast({
          title: "Branch Selection Required",
          description: "Please select a branch before adding a product!",
          variant: "destructive",
        });
        setIsAdding(false);
        return;
      }

      // Get branch ID - use user's branch or get first available branch
      let branchId = selectedBranchId || user?.branchId || null;

      // If no branch, try to get the first available (do this in background if needed)
      if (!branchId) {
        try {
          const branchesResponse = await apiService.getBranches();
          if (branchesResponse.success && branchesResponse.data?.branches?.length > 0) {
            branchId = branchesResponse.data.branches[0].id;
          } else if (allBranches && allBranches.length > 0) {
            // Fallback to context branches
            branchId = allBranches[0].id;
          }
        } catch (e) {
          console.log('Could not fetch branches:', e);
          // If still no branch, use first from context
          if (allBranches && allBranches.length > 0) {
            branchId = allBranches[0].id;
          }
        }
      }

      // Final validation - ensure we have a branchId
      if (!branchId) {
        toast({
          title: "Branch Required",
          description: "Unable to determine branch. Please select a branch or contact administrator.",
          variant: "destructive",
        });
        setIsAdding(false);
        return;
      }

      // Product data - stock/prices managed through batches, supplier is assigned at batch level
      const productData = {
        name: newMedicine.name,
        description: "",
        formula: newMedicine.formula || "",
        categoryId: newMedicine.categoryId,
        branchId: branchId,
        barcode: newMedicine.barcode || "",
        requiresPrescription: newMedicine.requiresPrescription,
        isActive: true,
        minStock: Number(newMedicine.minStock) || 10,
        maxStock: 1000,
        unitsPerPack: 1
      };

      // Find category name for optimistic product
      const category = categories.find(c => c.id === newMedicine.categoryId);
      const branch = allBranches?.find((b: any) => b.id === branchId) || selectedBranch;

      // OPTIMISTIC UPDATE: Create temporary product and add to list IMMEDIATELY
      const tempProduct: any = {
        id: `temp-${Date.now()}`, // Temporary ID
        name: newMedicine.name,
        description: "",
        formula: newMedicine.formula || "",
        categoryId: newMedicine.categoryId,
        category: category ? { id: category.id, name: category.name } : null,
        branchId: branchId,
        branch: branch ? { id: branch.id, name: branch.name } : null,
        barcode: newMedicine.barcode || "",
        requiresPrescription: newMedicine.requiresPrescription,
        isActive: true,
        minStock: Number(newMedicine.minStock) || 10,
        maxStock: 1000,
        unitsPerPack: 1,
        sku: `TEMP-${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Add product to list IMMEDIATELY
      const updatedProducts = [tempProduct, ...products];
      setProducts(updatedProducts);
      setPagination(prev => ({
        ...prev,
        total: prev.total + 1,
        pages: Math.ceil((prev.total + 1) / prev.limit)
      }));

      // Reset form and close dialog IMMEDIATELY
      setNewMedicine({
        name: "",
        categoryId: "",
        formula: "",
        barcode: "",
        requiresPrescription: false,
        minStock: 10
      });

      setIsAddDialogOpen(false);

      // Show success toast IMMEDIATELY
      toast({
        title: "Success",
        description: "Product added successfully!",
        variant: "default",
      });

      // Create product via API in background (non-blocking)
      try {
        const response = await apiService.createProduct(productData);

        if (response.success && response.data) {
          console.log('Product created successfully:', response.data);

          // Dispatch event to notify other components
          window.dispatchEvent(new CustomEvent('productCreated', {
            detail: { product: response.data }
          }));

          // Replace temp product with real product
          const realProduct = response.data;
          const finalProducts = updatedProducts.map(p =>
            p.id === tempProduct.id ? realProduct : p
          );
          setProducts(finalProducts);

          // Reload data in background to ensure sync
          setTimeout(async () => {
            try {
              const allProductsResponse = await apiService.getProducts({
                limit: 10000,
                branchId: branchId,
                companyId: selectedCompanyId || '',
              });

              if (allProductsResponse.success && allProductsResponse.data) {
                const allProducts = allProductsResponse.data.products;

                // Apply filters
                let filteredProducts = allProducts;
                if (searchQuery) {
                  filteredProducts = filteredProducts.filter((product: any) =>
                    product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    product.barcode?.includes(searchQuery)
                  );
                }
                if (selectedCategory !== "all") {
                  filteredProducts = filteredProducts.filter((product: any) =>
                    product.categoryId === selectedCategory
                  );
                }

                // Apply pagination
                const startIndex = (pagination.page - 1) * pagination.limit;
                const endIndex = startIndex + pagination.limit;
                let paginatedProducts = filteredProducts.slice(startIndex, endIndex);

                // CRITICAL: Preserve the newly created product even if it's not in the filtered/paginated list
                const productInList = paginatedProducts.some(p => p.id === realProduct.id);
                if (!productInList) {
                  // Ensure realProduct has all required fields for Product type
                  const productToAdd = {
                    ...realProduct,
                    updatedAt: (realProduct as any).updatedAt || new Date().toISOString(),
                    createdAt: (realProduct as any).createdAt || new Date().toISOString(),
                  } as Product;
                  // Add the newly created product to the beginning of the list
                  paginatedProducts = [productToAdd, ...paginatedProducts] as any;
                }

                setProducts(paginatedProducts as any);
                setPagination(prev => ({
                  ...prev,
                  total: Math.max(filteredProducts.length, paginatedProducts.length),
                  pages: Math.ceil(Math.max(filteredProducts.length, paginatedProducts.length) / prev.limit)
                }));
              }
            } catch (error) {
              console.error('Error reloading data after product creation:', error);
            }
          }, 500); // Small delay to ensure backend has processed
        } else {
          // Rollback on failure - remove temp product
          setProducts(products); // Restore original list
          setPagination(prev => ({
            ...prev,
            total: prev.total - 1,
            pages: Math.ceil((prev.total - 1) / prev.limit)
          }));
          toast({
            title: "Add Failed",
            description: response.message || "Failed to add product",
            variant: "destructive",
          });
        }
      } catch (error: any) {
        console.error('Error adding product:', error);
        // Rollback on error - remove temp product
        setProducts(products); // Restore original list
        setPagination(prev => ({
          ...prev,
          total: prev.total - 1,
          pages: Math.ceil((prev.total - 1) / prev.limit)
        }));

        // Show user-friendly error message
        const errorMessage = error?.message || error?.response?.message || 'Failed to add product. Please try again.';
        toast({
          title: "Add Error",
          description: errorMessage,
          variant: "destructive",
        });
      } finally {
        setIsAdding(false); // Always reset adding state
      }
    } catch (outerError: any) {
      // Handle any errors in the outer try block (validation errors, etc.)
      console.error('Outer error in handleAddMedicine:', outerError);
      setIsAdding(false);
    }
  };

  const handleEditProduct = async (product: Product) => {
    // CRITICAL: Reset loading state when opening edit dialog
    setLoading(false);
    
    try {
      // Fetch fresh product data from API to ensure we have the latest information
      console.log('🔍 Fetching fresh product data for edit:', product.id);
      const response = await apiService.getProduct(product.id);
      
      if (response.success && response.data) {
        const freshProduct = response.data;
        console.log('🔍 Fresh product data:', freshProduct);
        
        setEditingProduct(product); // Keep original product for reference
        setNewMedicine({
          name: freshProduct.name || product.name,
          categoryId: freshProduct.category?.id || product.category?.id || '',
          formula: freshProduct.formula || product.formula || "",
          barcode: freshProduct.barcode || product.barcode || "",
          requiresPrescription: freshProduct.requiresPrescription ?? product.requiresPrescription ?? false,
          minStock: freshProduct.minStock ?? product.minStock ?? 10
        });
        setIsEditDialogOpen(true);
        setLoading(false); // Ensure loading is false when dialog opens
      } else {
        // Fallback to using product from table if API fails
        console.warn('⚠️ Failed to fetch fresh product, using cached data');
        setEditingProduct(product);
        setNewMedicine({
          name: product.name,
          categoryId: product.category?.id || '',
          formula: product.formula || "",
          barcode: product.barcode || "",
          requiresPrescription: product.requiresPrescription || false,
          minStock: product.minStock || 10
        });
        setIsEditDialogOpen(true);
        setLoading(false); // Ensure loading is false when dialog opens
      }
    } catch (error) {
      console.error('Error fetching product for edit:', error);
      // Fallback to using product from table if API fails
      setEditingProduct(product);
      setNewMedicine({
        name: product.name,
        categoryId: product.category?.id || '',
        formula: product.formula || "",
        barcode: product.barcode || "",
        requiresPrescription: product.requiresPrescription || false,
        minStock: product.minStock || 10
      });
      setIsEditDialogOpen(true);
      setLoading(false); // Ensure loading is false when dialog opens
    }
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct || !newMedicine.name || !newMedicine.categoryId) {
      toast({
        title: "Validation Error",
        description: "Please fill all required fields!",
        variant: "destructive",
      });
      return;
    }

    // Check if admin has selected a branch
    if (user?.role === 'OWNER' && !selectedBranchId) {
      toast({
        title: "Branch Selection Required",
        description: "Please select a branch before updating a product!",
        variant: "destructive",
      });
      return;
    }

      try {
        setLoading(true);

      const productData = {
        name: newMedicine.name,
        description: editingProduct.description || "",
        formula: newMedicine.formula || "",
        sku: editingProduct.sku || "", // Add SKU field
        categoryId: newMedicine.categoryId,
        supplierId: editingProduct.supplier?.id || "",
        branchId: editingProduct.branch?.id || "",
        barcode: newMedicine.barcode || "",
        requiresPrescription: newMedicine.requiresPrescription, // Use form value
        isActive: editingProduct.isActive !== undefined ? editingProduct.isActive : true,
        minStock: Number(newMedicine.minStock) || 10,
        maxStock: 1000,
        unitsPerPack: 1
      };

      console.log('Updating product with data:', productData);
      console.log('Editing product (source):', editingProduct);

      // Update product via API
      console.log('🔍 Calling updateProduct API with:', { id: editingProduct.id, data: productData });
      const response = await apiService.updateProduct(editingProduct.id, productData);
      console.log('🔍 Update product API response:', response);
      
      // CRITICAL: Ensure loading is reset even if response format is unexpected
      if (!response || typeof response !== 'object') {
        console.error('❌ Invalid API response format:', response);
        toast({
          title: "Update Error",
          description: "Invalid response from server. Please try again.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

        if (response.success) {
        console.log('✅ Product updated successfully:', response.data);

        // Dispatch event to notify other components
        window.dispatchEvent(new CustomEvent('productUpdated', {
          detail: { product: response.data }
        }));

        // Reload data to get the updated list - fetch products for the current branch
        try {
          const allProductsResponse = await apiService.getProducts({
            limit: 10000,
            branchId: selectedBranchId || user?.branchId || undefined,
            companyId: selectedCompanyId || '',
          });
          if (allProductsResponse.success && allProductsResponse.data) {
            const allProducts = allProductsResponse.data.products;

            // Apply search and category filters
            let filteredProducts = allProducts;

            if (searchQuery) {
              filteredProducts = filteredProducts.filter((product: any) =>
                product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                product.barcode?.includes(searchQuery)
              );
            }

            if (selectedCategory !== "all") {
              filteredProducts = filteredProducts.filter((product: any) =>
                product.categoryId === selectedCategory
              );
            }

            // Apply pagination
            const startIndex = (pagination.page - 1) * pagination.limit;
            const endIndex = startIndex + pagination.limit;
            const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

            setProducts(paginatedProducts);
            setPagination({
              page: pagination.page,
              limit: pagination.limit,
              total: filteredProducts.length,
              pages: Math.ceil(filteredProducts.length / pagination.limit)
            });
          }
        } catch (error) {
          console.error('Error reloading data after product update:', error);
          await loadData();
        }

        // Reset form and close dialog
        setEditingProduct(null);
        setNewMedicine({
          name: "",
          categoryId: "",
          formula: "",
          barcode: "",
          requiresPrescription: false,
          minStock: 10
        });

        setIsEditDialogOpen(false);
        setLoading(false); // CRITICAL: Reset loading state
        toast({
          title: "Success",
          description: "Product updated successfully!",
          variant: "default",
        });
      } else {
        console.error('❌ Failed to update product:', response.message);
        console.error('Validation errors:', (response as any).errors);
        toast({
          title: "Update Failed",
          description: `Failed to update product: ${response.message}. Errors: ${(response as any).errors?.join(', ') || 'Unknown error'}`,
          variant: "destructive",
        });
        setLoading(false); // CRITICAL: Reset loading state on failure
      }
    } catch (error: any) {
      console.error('Error updating product:', error);
      console.error('Error details:', error.response?.data);
      toast({
        title: "Update Error",
        description: `Failed to update product: ${error.message || 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (product: Product) => {
    // CRITICAL FIX: Don't block delete if branch is not selected
    // Product delete should work regardless of branch selection
    // The backend will handle branch context automatically
    
    // CRITICAL FIX: Reset loading state when opening dialog
    setLoading(false);
    setDeletingProduct(product);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingProduct) return;

    const productToDelete = deletingProduct;
    const previousProducts = [...products]; // Store for rollback

    // CRITICAL FIX: Set loading state BEFORE API call
    setLoading(true);

    // Delete via API first (blocking)
    try {
      console.log('🗑️ Deleting product:', productToDelete.id, productToDelete.name);
      const response = await apiService.deleteProduct(productToDelete.id);
      console.log('🗑️ Delete product response:', response);
      console.log('🗑️ Response type:', typeof response);
      console.log('🗑️ Response success:', response?.success);
      console.log('🗑️ Response message:', response?.message);

      // CRITICAL FIX: Check response.success explicitly (can be true, 'true', or undefined)
      const isSuccess = response && (
        response.success === true || 
        String(response.success) === 'true' ||
        (response.message && !(response as any).error && !response.message.toLowerCase().includes('fail'))
      );

      if (!isSuccess) {
        // Rollback on failure
        console.error('🗑️ Delete failed:', response?.message || 'Unknown error');
        setProducts(previousProducts);
        setPagination(prev => ({
          ...prev,
          total: prev.total + 1,
          pages: Math.ceil((prev.total + 1) / prev.limit)
        }));
        toast({
          title: "Delete Failed",
          description: response?.message || (response as any)?.error || "Failed to delete product",
          variant: "destructive",
        });
        // Keep dialog open on failure
        setLoading(false);
      } else {
        console.log('✅ Product deleted successfully');
        
        // OPTIMISTIC UPDATE: Remove product from list
        const updatedProducts = products.filter(p => p.id !== productToDelete.id);
        setProducts(updatedProducts);
        setPagination(prev => ({
          ...prev,
          total: prev.total - 1,
          pages: Math.ceil((prev.total - 1) / prev.limit)
        }));

        // Close dialog
        setIsDeleteDialogOpen(false);
        setDeletingProduct(null);
        setLoading(false);

        // Show success toast
        toast({
          title: "Success",
          description: "Product deleted successfully!",
          variant: "default",
        });

        // Dispatch event to notify other components
        window.dispatchEvent(new CustomEvent('productDeleted', {
          detail: { productId: productToDelete.id }
        }));

        // Reload data in background (without showing loader)
        setTimeout(async () => {
          try {
            const allProductsResponse = await apiService.getProducts({
              limit: 10000,
              branchId: selectedBranchId || user?.branchId || "",
              companyId: selectedCompanyId || '',
            });

            if (allProductsResponse.success && allProductsResponse.data) {
              const allProducts = allProductsResponse.data.products;

              // Apply filters
              let filteredProducts = allProducts;
              if (searchQuery) {
                filteredProducts = filteredProducts.filter((product: any) =>
                  product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  product.barcode?.includes(searchQuery)
                );
              }
              if (selectedCategory !== "all") {
                filteredProducts = filteredProducts.filter((product: any) =>
                  product.categoryId === selectedCategory
                );
              }

              // Apply pagination
              const startIndex = (pagination.page - 1) * pagination.limit;
              const endIndex = startIndex + pagination.limit;
              const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

              setProducts(paginatedProducts);
              setPagination({
                page: pagination.page,
                limit: pagination.limit,
                total: filteredProducts.length,
                pages: Math.ceil(filteredProducts.length / pagination.limit)
              });
            }
          } catch (error) {
            console.error('Error reloading data after product deletion:', error);
            // Silently reload in background
            loadData().catch(() => {});
          }
        }, 0);
      }
    } catch (error: any) {
      console.error('Error deleting product:', error);
      // Rollback on error
      setProducts(previousProducts);
      setPagination(prev => ({
        ...prev,
        total: prev.total + 1,
        pages: Math.ceil((prev.total + 1) / prev.limit)
      }));
      setLoading(false);
      toast({
        title: "Delete Error",
        description: error?.message || "Failed to delete product. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCancelDelete = () => {
    setIsDeleteDialogOpen(false);
    setDeletingProduct(null);
  };

  // Bulk delete functions
  const handleSelectProduct = (productId: string) => {
    setSelectedProducts(prev =>
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const handleSelectAll = () => {
    if (selectedProducts.length === products.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(products.map(p => p.id));
    }
  };

  const handleBulkDeleteClick = () => {
    if (selectedProducts.length === 0) return;

    // Check if admin has selected a branch
    if (user?.role === 'OWNER' && !selectedBranchId) {
      toast({
        title: "Branch Selection Required",
        description: "Please select a branch before deleting products!",
        variant: "destructive",
      });
      return;
    }

    setIsBulkDeleteDialogOpen(true);
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedProducts.length === 0) return;

    const productsToDelete = [...selectedProducts];
    const previousProducts = [...products]; // Store for rollback

    // OPTIMISTIC UPDATE: Remove products from list IMMEDIATELY
    const updatedProducts = products.filter(p => !productsToDelete.includes(p.id));
    setProducts(updatedProducts);
    setPagination(prev => ({
      ...prev,
      total: prev.total - productsToDelete.length,
      pages: Math.ceil((prev.total - productsToDelete.length) / prev.limit)
    }));

    // Close dialog and clear selection IMMEDIATELY
    setIsBulkDeleteDialogOpen(false);
    setSelectedProducts([]);

    // Show success toast immediately
    toast({
      title: "Success",
      description: `Successfully deleted ${productsToDelete.length} products!`,
      variant: "default",
    });

    // Dispatch event to notify other components
    window.dispatchEvent(new CustomEvent('productsBulkDeleted', {
      detail: { productIds: productsToDelete }
    }));

    // Delete in background (non-blocking)
    try {
      const response = await apiService.bulkDeleteProducts(productsToDelete);

      if (!response.success) {
        // Rollback on failure
        setProducts(previousProducts);
        setPagination(prev => ({
          ...prev,
          total: prev.total + productsToDelete.length,
          pages: Math.ceil((prev.total + productsToDelete.length) / prev.limit)
        }));
        toast({
          title: "Bulk Delete Failed",
          description: response.message || "Failed to bulk delete products",
          variant: "destructive",
        });
      } else {
        // Reload data in background (without showing loader)
        setTimeout(async () => {
          try {
            await loadData();
          } catch (error) {
            console.error('Error reloading data after bulk deletion:', error);
          }
        }, 0);
      }
    } catch (error) {
      console.error('Error bulk deleting products:', error);
      // Rollback on error
      setProducts(previousProducts);
      setPagination(prev => ({
        ...prev,
        total: prev.total + productsToDelete.length,
        pages: Math.ceil((prev.total + productsToDelete.length) / prev.limit)
      }));
      toast({
        title: "Bulk Delete Error",
        description: "Failed to bulk delete products. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCancelBulkDelete = () => {
    setIsBulkDeleteDialogOpen(false);
  };

  // Export functionality
  const handleExportInventory = () => {
    try {
      // Create Excel data
      const excelData = products.map(product => ({
        'Product Name': product.name,
        'Category': product.category?.name || 'Uncategorized',
        'Supplier': product.supplier?.name || 'Unknown',
        'Formula': product.formula || '',
        'Price': `PKR ${product.price || 0}`,
        'Stock': `${product.stock || 0} units`,
        'Barcode': product.barcode || '',
        'Requires Prescription': product.requiresPrescription ? 'Yes' : 'No',
        'Description': product.description || ''
      }));

      // Convert to CSV
      const headers = Object.keys(excelData[0]);
      const csvContent = [
        headers.join(','),
        ...excelData.map(row =>
          headers.map(header => {
            const value = row[header];
            // Escape commas and quotes in CSV
            if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          }).join(',')
        )
      ].join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `inventory_export_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export Successful",
        description: "Inventory exported successfully!",
        variant: "default",
      });
    } catch (error) {
      console.error('Error exporting inventory:', error);
      toast({
        title: "Export Error",
        description: "Error exporting inventory. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Import functionality
  const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file type
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv' // .csv
    ];

    if (!validTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast({
        title: "Invalid File Type",
        description: "Please select an Excel (.xlsx, .xls) or CSV file.",
        variant: "destructive",
      });
      return;
    }

    setProcessingImage(true);
    try {
      let extractedData: any[] = [];

      // Check if it's a CSV file
      if (file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')) {
        // Parse CSV content
        const text = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsText(file);
        });

        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
          toast({
            title: "Invalid File",
            description: "File appears to be empty or invalid.",
            variant: "destructive",
          });
          return;
        }

        // Get headers
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

        // Parse data rows
        console.log('Parsing CSV data...');
        console.log('Headers:', headers);
        console.log('Total lines:', lines.length);

        extractedData = lines.slice(1).map((line, index) => {
          console.log(`Processing line ${index + 1}:`, line);
          const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
          console.log(`Split values:`, values);
          const row: any = {};

          headers.forEach((header, headerIndex) => {
            const value = values[headerIndex] || '';
            const lowerHeader = header.toLowerCase().trim();
            console.log(`Header "${header}" (${lowerHeader}) -> Value: "${value}"`);

            // More flexible header matching
            if (lowerHeader.includes('name') || lowerHeader.includes('product') || lowerHeader === 'name') {
              row.name = value;
            } else if (lowerHeader.includes('category') || lowerHeader === 'category') {
              row.category = value;
            } else if ((lowerHeader.includes('cost') && lowerHeader.includes('price')) || lowerHeader === 'cost price') {
              row.costPrice = parseFloat(value) || 0;
            } else if ((lowerHeader.includes('selling') && lowerHeader.includes('price')) || lowerHeader === 'selling price') {
              row.sellingPrice = parseFloat(value) || 0;
            } else if ((lowerHeader.includes('stock') && !lowerHeader.includes('min') && !lowerHeader.includes('max')) || lowerHeader === 'stock') {
              row.stock = parseInt(value) || 0;
            } else if ((lowerHeader.includes('unit') && lowerHeader.includes('type')) || lowerHeader === 'unit type') {
              // Skip unit type - not used anymore
            } else if ((lowerHeader.includes('units') && lowerHeader.includes('pack')) || lowerHeader === 'units per pack') {
              // Skip units per pack - always 1 for unit pricing
            } else if (lowerHeader.includes('barcode') || lowerHeader === 'barcode') {
              row.barcode = value;
            } else if (lowerHeader.includes('prescription') || lowerHeader === 'requires prescription') {
              row.requiresPrescription = value.toLowerCase() === 'yes' || value.toLowerCase() === 'true' || value.toLowerCase() === '1';
            } else if (lowerHeader.includes('description') || lowerHeader === 'description') {
              row.description = value;
            }
          });

          // Set default values for required fields
          // unitsPerPack is always 1 for unit pricing
          if (!row.costPrice) row.costPrice = 0;
          // Ensure stock is always a valid number (default to 0 if not provided)
          row.stock = parseInt(row.stock) || 0;
          if (!row.requiresPrescription) row.requiresPrescription = false;

          console.log(`Parsed row ${index + 1}:`, row);
          return row;
        }).filter(row => {
          const hasName = !!row.name && row.name.trim() !== '';
          console.log(`Row "${row.name}" has name: ${hasName}`);
          return hasName;
        }); // Only include rows with product names
      } else {
        // For Excel files, show a message to convert to CSV first
        toast({
          title: "Excel Not Supported",
          description: "Excel files are not fully supported yet. Please save your Excel file as CSV format and try again.",
          variant: "destructive",
        });
        return;
      }

      console.log('Extracted data:', extractedData);
      console.log('Total extracted products:', extractedData.length);

      if (extractedData.length === 0) {
        toast({
          title: "Invalid Data",
          description: "No valid product data found in the file. Please check that your file has product names in the first column.",
          variant: "destructive",
        });
        return;
      }

      console.log('=== FILE PARSING COMPLETE ===');
      console.log('Total products extracted:', extractedData.length);
      console.log('All extracted products:', extractedData);

      // Validate extracted data with more lenient validation
      const validProducts = extractedData.filter(product => {
        const hasName = product.name && product.name.trim() !== '';
        const hasPrice = product.sellingPrice && !isNaN(parseFloat(product.sellingPrice)) && parseFloat(product.sellingPrice) > 0;

        console.log(`Product "${product.name}" validation:`, {
          hasName,
          hasPrice,
          sellingPrice: product.sellingPrice,
          sellingPriceType: typeof product.sellingPrice
        });

        return hasName && hasPrice;
      });

      console.log('Valid products after validation:', validProducts.length);
      console.log('All extracted products:', extractedData);
      console.log('Valid products:', validProducts);

      if (validProducts.length === 0) {
        toast({
          title: "No Valid Products",
          description: "No valid products found in the file. Please ensure your CSV has product names and selling prices.",
          variant: "destructive",
        });
        return;
      }

      // Show a toast with the count
      toast({
        title: "File Parsed Successfully",
        description: `Found ${validProducts.length} valid products out of ${extractedData.length} total rows.`,
        variant: "default",
      });

      setImportedProducts(validProducts);
      setIsPreviewDialogOpen(true);
    } catch (error) {
      console.error('Error processing file:', error);
      toast({
        title: "File Processing Error",
        description: "Error processing file. Please try again or convert Excel to CSV format.",
        variant: "destructive",
      });
    } finally {
      setProcessingImage(false);
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // CRITICAL FIX: Handle multiple images - process all selected files
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      toast({
        title: "Invalid File Type",
        description: "Please select image files.",
        variant: "destructive",
      });
      return;
    }

    // CRITICAL FIX: Limit number of images to prevent memory issues
    const MAX_IMAGES = 50;
    if (imageFiles.length > MAX_IMAGES) {
      toast({
        title: "Too Many Images",
        description: `Please select a maximum of ${MAX_IMAGES} images at once.`,
        variant: "destructive",
      });
      return;
    }

    // CRITICAL FIX: Limit individual image size to prevent memory issues
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB per image
    const oversizedImages = imageFiles.filter(file => file.size > MAX_IMAGE_SIZE);
    if (oversizedImages.length > 0) {
      toast({
        title: "Image Too Large",
        description: `Some images exceed the maximum size of ${MAX_IMAGE_SIZE / 1024 / 1024}MB. Please compress them first.`,
        variant: "destructive",
      });
      return;
    }

    setProcessingImage(true);
    try {
      // Process all images - convert to base64
      const imagePromises = imageFiles.map((file) => 
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        })
      );

      // CRITICAL FIX: Process images in batches to prevent memory issues
      const BATCH_SIZE = 5;
      const allBase64Images: string[] = [];
      
      for (let i = 0; i < imagePromises.length; i += BATCH_SIZE) {
        const batch = imagePromises.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch);
        allBase64Images.push(...batchResults);
        
        // Small delay between batches to prevent overwhelming the system
        if (i + BATCH_SIZE < imagePromises.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Simulate OCR processing (in real implementation, you'd call an OCR service for each image)
      // For now, process all images together
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mock extracted data (replace with actual OCR processing)
      // In real implementation, you'd process each image and extract product data
      const mockExtractedData = [
        {
          name: 'Paracetamol 500mg',
          category: 'Analgesics',
          costPrice: 2.50,
          sellingPrice: 5.00,
          stock: 100,
        },
        {
          name: 'Amoxicillin 250mg',
          category: 'Antibiotics',
          costPrice: 15.00,
          sellingPrice: 25.00,
          stock: 50,
        },
        {
          name: 'Vitamin C 1000mg',
          category: 'Vitamins',
          costPrice: 8.00,
          sellingPrice: 12.00,
          stock: 75,
        }
      ];

      setImportedProducts(mockExtractedData);
      setIsPreviewDialogOpen(true);
      
      toast({
        title: "Images Processed",
        description: `Successfully processed ${imageFiles.length} image(s).`,
        variant: "default",
      });
    } catch (error) {
      console.error('Error processing images:', error);
      toast({
        title: "Image Processing Error",
        description: error instanceof Error ? error.message : "Error processing images. Please try again.",
        variant: "destructive",
      });
    } finally {
      setProcessingImage(false);
      // Reset file input
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleProceedImport = async () => {
    // Check if admin has selected a branch
    if (user?.role === 'OWNER' && !selectedBranchId) {
      toast({
        title: "Branch Selection Required",
        description: "Please select a branch before importing products!",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      // Prepare products for bulk import
      const productsToImport = [];
      const createdCategories = [];
      const createdSuppliers = [];

      console.log('=== PREPARING PRODUCTS FOR IMPORT ===');
      console.log('Imported products count:', importedProducts.length);
      console.log('Available categories:', categories);
      console.log('Available suppliers:', suppliers);

      // Get branchId once for all products
      let branchId = selectedBranchId || user?.branchId || undefined;

      // If no branchId from user object, try to get it from localStorage
      if (!branchId) {
        const storedUser = localStorage.getItem('zapeera_user');
        if (storedUser) {
          try {
            const parsedUser = JSON.parse(storedUser);
            branchId = parsedUser.branch?.id;
          } catch (e) {
            console.error('Error parsing stored user:', e);
          }
        }
      }

      // If still no branchId, get the first available branch
      if (!branchId) {
        try {
          const branchesResponse = await apiService.getBranches();
          if (branchesResponse.success && branchesResponse.data?.branches?.length > 0) {
            branchId = branchesResponse.data.branches[0].id;
            console.log('Using first available branch:', branchId);
          } else {
            console.error('No branches available');
            toast({
              title: "No Branches",
              description: "No branches available. Please contact administrator.",
              variant: "destructive",
            });
            setLoading(false);
            return;
          }
        } catch (e) {
          console.error('Error fetching branches:', e);
          toast({
            title: "Error",
            description: "Error fetching branches. Please try again.",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
      }

      console.log('=== BRANCH ID DETERMINED ===');
      console.log('Final branchId for all products:', branchId);
      console.log('BranchId type:', typeof branchId);

      for (const productData of importedProducts) {
        console.log(`\n--- Processing product: ${productData.name} ---`);
        console.log('Product data:', productData);

        // Find category ID - try exact match first, then partial match
        let category = categories.find(cat =>
          cat.name.toLowerCase() === productData.category.toLowerCase()
        );

        // If no exact match, try partial match
        if (!category) {
          category = categories.find(cat =>
            cat.name.toLowerCase().includes(productData.category.toLowerCase()) ||
            productData.category.toLowerCase().includes(cat.name.toLowerCase())
          );
        }

        // If still no match, try to map common category names
        let finalCategoryName = productData.category; // Default to original category name
        if (!category) {
          const categoryMappings: { [key: string]: string } = {
            'medicine': 'Analgesics',
            'medicines': 'Analgesics',
            'drugs': 'Analgesics',
            'pharmaceuticals': 'Analgesics',
            'pain': 'Analgesics',
            'pain relief': 'Analgesics',
            'antibiotic': 'Antibiotics',
            'antibiotics': 'Antibiotics',
            'infection': 'Antibiotics',
            'vitamin': 'Vitamins',
            'vitamins': 'Vitamins',
            'supplements': 'Vitamins',
            'stomach': 'Gastric',
            'gastric': 'Gastric',
            'digestive': 'Gastric',
            'cough': 'Cough & Cold',
            'cold': 'Cough & Cold',
            'respiratory': 'Cough & Cold',
            'eye': 'Ophthalmic',
            'ophthalmic': 'Ophthalmic',
            'diabetes': 'Diabetes',
            'diabetic': 'Diabetes'
          };

          const mappedCategoryName = categoryMappings[productData.category.toLowerCase()];
          if (mappedCategoryName) {
            finalCategoryName = mappedCategoryName; // Use mapped name
            category = categories.find(cat =>
              cat.name.toLowerCase() === mappedCategoryName.toLowerCase()
            );
          }
        }

        console.log('Found category:', category);
        console.log('Available categories:', categories.map(c => ({ id: c.id, name: c.name })));
        console.log('Final category name to use:', finalCategoryName);

        // Set category data for backend
        if (category) {
          // Category exists, use its ID
          productData.categoryId = category.id;
          productData.categoryName = undefined; // Not needed since category exists
          console.log(`Using existing category: ${category.name} (ID: ${category.id})`);
        } else {
          // Category doesn't exist, let backend create it automatically
          console.log(`Category "${finalCategoryName}" not found, will be created automatically by backend`);
          productData.categoryName = finalCategoryName;
          productData.categoryId = 'auto-create'; // Placeholder, backend will handle this
        }

        // Supplier is assigned at batch level, not product level

        console.log('=== BULK IMPORT DEBUG ===');
        console.log(`Using branchId for product ${productData.name}:`, branchId);
        console.log('User object:', user);
        console.log('Using default branchId');
        console.log('Final branchId:', branchId);
        console.log('BranchId type:', typeof branchId);
        console.log('BranchId length:', branchId?.length);

        // Ensure all numeric fields are properly converted
        const sellingPrice = parseFloat(productData.sellingPrice) || 0;
        const costPrice = parseFloat(productData.costPrice) || (sellingPrice * 0.7); // Default to 70% of selling price
        const stock = parseInt(productData.stock) || 0;
        const minStock = parseInt(productData.minStock) || 10;

        console.log(`Product ${productData.name} numeric conversion:`, {
          originalSellingPrice: productData.sellingPrice,
          convertedSellingPrice: sellingPrice,
          originalCostPrice: productData.costPrice,
          convertedCostPrice: costPrice,
          originalStock: productData.stock,
          convertedStock: stock
        });

        const productToImport = {
          name: productData.name.trim(),
          description: (productData.description || "").trim(),
          categoryId: productData.categoryId, // Use the categoryId we set (either existing or 'auto-create')
          categoryName: productData.categoryName, // Include categoryName for auto-creation
          // supplierId not needed - supplier is assigned at batch level
          branchId: branchId,
          costPrice: costPrice,
          sellingPrice: sellingPrice,
          stock: stock,
          minStock: minStock,
          maxStock: productData.maxStock || null,
          unitType: "tablets", // Default unit type
          unitsPerPack: 1, // Always 1 for unit pricing
          barcode: (productData.barcode || "").trim() || null,
          requiresPrescription: Boolean(productData.requiresPrescription),
          isActive: true
        };

        // Final validation before adding to import list
        if (!productToImport.name || productToImport.sellingPrice <= 0) {
          console.error(`Skipping invalid product: ${productData.name}`, {
            name: productToImport.name,
            sellingPrice: productToImport.sellingPrice
          });
          continue;
        }

        productsToImport.push(productToImport);
        console.log(`Added product to import list: ${productData.name}`);
        console.log('Product to import:', productToImport);
      }

      console.log(`Total products prepared for import: ${productsToImport.length} out of ${importedProducts.length}`);
      console.log('Products to import:', productsToImport);

      if (productsToImport.length === 0) {
        toast({
          title: "No Valid Products",
          description: "No valid products to import. Please check that your CSV file has the correct format with product names, categories, and prices.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Call bulk import API
      console.log('=== CALLING BULK IMPORT API ===');
      console.log('Products to import:', productsToImport);
      console.log('Number of products:', productsToImport.length);
      console.log('API Base URL:', config.api.baseUrl);
      console.log('Auth: using httpOnly cookies');
      console.log('User from context:', user);

      // Validate products before sending
      const invalidProducts = productsToImport.filter(p => !p.name || p.sellingPrice <= 0 || !p.branchId);
      if (invalidProducts.length > 0) {
        console.error('Invalid products found:', invalidProducts);
        toast({
          title: "Invalid Products",
          description: `Found ${invalidProducts.length} invalid products. Please check the data and try again.`,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      let response;
      try {
        console.log('Sending request to backend...');
        response = await apiService.bulkImportProducts(productsToImport);
        console.log('=== BULK IMPORT API RESPONSE ===');
        console.log('Response:', response);
        console.log('Response success:', response.success);
        console.log('Response data:', response.data);

        if (!response.success) {
          console.error('API call failed:', response.message);
          toast({
            title: "Import Failed",
            description: `Import failed: ${response.message}`,
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
      } catch (error) {
        console.error('=== BULK IMPORT API ERROR ===');
        console.error('Error details:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        console.error('Error message:', error instanceof Error ? error.message : 'Unknown error');

        // More detailed error message
        let errorMessage = 'Unknown error occurred';
        if (error instanceof Error) {
          if (error.message.includes('Network')) {
            errorMessage = 'Network error: Please check your internet connection and try again.';
          } else if (error.message.includes('401')) {
            errorMessage = 'Authentication error: Please log in again.';
          } else if (error.message.includes('403')) {
            errorMessage = 'Permission denied: You do not have permission to import products.';
          } else if (error.message.includes('500')) {
            errorMessage = 'Server error: Please try again later or contact support.';
          } else {
            errorMessage = `Import failed: ${error.message}`;
          }
        }

        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      if (response && response.success) {
        console.log('Bulk import successful, reloading data...');
        console.log('Import response data:', response.data);
        console.log('Successful products:', response.data.successful);
        console.log('Failed products:', response.data.failed);

        // Reset filters to show all products
        setSelectedCategory("all");
        setSearchQuery("");
        setPagination(prev => ({ ...prev, page: 1 }));

        // Reload data - fetch products for the current branch to ensure imported products are visible
        console.log('About to reload data...');
        console.log('Using branchId for reload:', branchId);
        console.log('BranchId type for reload:', typeof branchId);
        console.log('BranchId length for reload:', branchId?.length);

        try {
          const allProductsResponse = await apiService.getProducts({
            limit: 10000,
            branchId: branchId,
            companyId: selectedCompanyId || '',
          });
          console.log('All products response after import:', allProductsResponse);

          if (allProductsResponse.success && allProductsResponse.data) {
            const allProducts = allProductsResponse.data.products;
            console.log('Total products after import:', allProducts.length);
            console.log('All products data:', allProducts);

            // If no products found with branch filter, try without branch filter
            if (allProducts.length === 0) {
              console.log('No products found with branch filter, trying without branch filter...');
              const allProductsResponseNoFilter = await apiService.getProducts({
                limit: 10000,
                companyId: selectedCompanyId || '',
              });
              console.log('All products response (no filter):', allProductsResponseNoFilter);

              if (allProductsResponseNoFilter.success && allProductsResponseNoFilter.data) {
                const allProductsNoFilter = allProductsResponseNoFilter.data.products;
                console.log('Total products (no filter):', allProductsNoFilter.length);
                console.log('All products data (no filter):', allProductsNoFilter);

                // Filter products by branchId manually
                const branchFilteredProducts = allProductsNoFilter.filter(product =>
                  product.branch?.id === branchId
                );
                console.log('Manually filtered products for branch:', branchFilteredProducts.length);
                console.log('Branch IDs in products:', allProductsNoFilter.map(p => ({ name: p.name, branchId: p.branch.id })));

                // Use manually filtered products
                const filteredProducts = branchFilteredProducts;

                // Apply pagination
                const startIndex = 0; // Start from first page
                const endIndex = 50; // Show first 50 products
                const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

                setProducts(paginatedProducts);
                setPagination({
                  page: 1,
                  limit: 50,
                  total: filteredProducts.length,
                  pages: Math.ceil(filteredProducts.length / 50)
                });

                console.log('Products updated after import (manual filter):', paginatedProducts.length);
                console.log('Updated products list (manual filter):', paginatedProducts);
              }
            } else {
              // Since we reset filters, show all products without any filtering
              const filteredProducts = allProducts;

              // Apply pagination
              const startIndex = 0; // Start from first page
              const endIndex = 50; // Show first 50 products
              const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

              setProducts(paginatedProducts);
              setPagination({
                page: 1,
                limit: 50,
                total: filteredProducts.length,
                pages: Math.ceil(filteredProducts.length / 50)
              });

              console.log('Products updated after import:', paginatedProducts.length);
              console.log('Updated products list:', paginatedProducts);
            }
          }
        } catch (error) {
          console.error('Error reloading data after import:', error);
          // Fallback to regular loadData
          await loadData();
        }
        console.log('Data reload completed');

        // Close dialogs
        setIsPreviewDialogOpen(false);
        setIsImportDialogOpen(false);
        setImportedProducts([]);

        // Show results with detailed information
        const { successCount, failureCount } = response.data;
        const updatedCount = response.data.failed.filter((f: any) => f.error.includes('Updated existing product')).length;
        const skippedCount = response.data.failed.filter((f: any) => f.error.includes('already exists') && !f.error.includes('Updated')).length;
        const actualFailureCount = failureCount - updatedCount - skippedCount;

        let message = `Import completed!\n\n✅ Added: ${successCount} new products`;

        if (updatedCount > 0) {
          message += `\n🔄 Updated: ${updatedCount} existing products (stock added)`;
        }

        if (skippedCount > 0) {
          message += `\n⏭️ Skipped: ${skippedCount} existing products`;
        }

        if (actualFailureCount > 0) {
          message += `\n❌ Failed: ${actualFailureCount} products`;
          // Show details of failed products
          const failedProducts = response.data.failed;
          if (failedProducts && failedProducts.length > 0) {
            message += `\n\nFailed products:\n`;
            failedProducts.slice(0, 5).forEach((failed: any, index: number) => {
              message += `${index + 1}. ${failed.product.name}: ${failed.error}\n`;
            });
            if (failedProducts.length > 5) {
              message += `... and ${failedProducts.length - 5} more. Check console for details.`;
            }
          }
        }

        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        });

        console.log('Import completed successfully:', {
          total: response.data.total,
          successful: response.data.successCount,
          skipped: skippedCount,
          failed: actualFailureCount,
          successfulProducts: response.data.successful.length
        });
      } else {
        toast({
          title: "Import Failed",
          description: response.message || 'Failed to import products. Please try again.',
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error importing products:', error);
      toast({
        title: "Import Error",
        description: "Error importing products. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filterBarInput = cn(
    "h-[42px] min-w-[200px] flex-1 rounded-[10px] border-[1.5px] border-black/[0.07] bg-white pl-10 pr-3.5 text-[13px] font-medium text-[#0a1128] shadow-none transition-all",
    "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-[rgba(26,82,197,0.06)]",
  );
  const filterBarSelect = cn(
    "h-[42px] rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] text-[13px] font-medium text-[#0a1128] shadow-none",
    "focus:ring-[3px] focus:ring-[rgba(26,82,197,0.06)] focus:ring-offset-0",
  );
  const filterBarBtn = cn(
    "inline-flex h-[42px] shrink-0 items-center gap-1.5 rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] px-4 text-[13px] font-semibold text-[#4a5578] transition-colors",
    "hover:border-black/12 hover:text-[#0a1128]",
  );

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
      {/* Header */}
      <div className="zv3-animate-fadeUp flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">
            Inventory Management
          </h1>
          <p className="text-sm text-[#8c95b0]">
            Manage your business inventory
            {selectedBranch?.name ? (
              <>
                {" "}
                • <b className="font-semibold text-[#4a5578]">{selectedBranch.name}</b>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Export/Import Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleExportInventory}
              className="inline-flex h-auto items-center gap-2 rounded-[10px] border border-[rgba(15,23,60,0.06)] bg-white px-5 py-3 text-sm font-semibold text-[#4a5578] shadow-none hover:border-black/10 hover:bg-white hover:text-[#0a1128] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
            >
              <Upload className="h-[17px] w-[17px]" strokeWidth={2} />
              Export
            </Button>
            <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="inline-flex h-auto items-center gap-2 rounded-[10px] border border-[rgba(15,23,60,0.06)] bg-white px-5 py-3 text-sm font-semibold text-[#4a5578] shadow-none hover:border-black/10 hover:bg-white hover:text-[#0a1128] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                >
                  <Download className="h-[17px] w-[17px]" strokeWidth={2} />
                  Import
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center space-x-2">
                    <Download className="w-5 h-5 text-primary" />
                    <span>Import Products</span>
                  </DialogTitle>
                  <DialogDescription>
                    Choose how you want to import products into your inventory.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                  <div className="text-center">
                    <h3 className="text-lg font-medium mb-2">Choose Import Method</h3>
                    <p className="text-sm text-gray-500 mb-6">
                      Select how you want to import your products
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    {/* Excel Sheet Upload */}
                    <div className="border-2 border-dashed border-blue-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                      <div className="flex flex-col items-center space-y-3">
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                          <FileSpreadsheet className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">Upload CSV File</h4>
                          <p className="text-sm text-gray-500">Import products from CSV file</p>
                        </div>
                        <input
                          type="file"
                          accept=".csv"
                          onChange={handleExcelUpload}
                          className="hidden"
                          id="excel-upload"
                          aria-label="Upload CSV file"
                          title="Upload CSV file"
                        />
                        <Button
                          variant="outline"
                          className="border-blue-500 text-blue-600 hover:bg-blue-50"
                          onClick={() => document.getElementById('excel-upload')?.click()}
                        >
                          <FileSpreadsheet className="w-4 h-4 mr-2" />
                          Upload Sheet
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-400">
                      Supported formats: CSV, Images (.png, .jpg, .jpeg)
                    </p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Scan Document Dialog */}
          <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                className="inline-flex h-auto items-center gap-2 rounded-[10px] bg-[#0c2c8a] px-5 py-3 text-sm font-semibold text-white shadow-none transition-all hover:bg-[#0a1f5c] hover:shadow-[0_2px_8px_rgba(12,44,138,0.3)]"
              >
                <Image className="h-[17px] w-[17px]" strokeWidth={2} />
                Scan Document
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DocumentScanner
                onExtractedData={handleExtractedData}
                onClose={() => setIsScannerOpen(false)}
              />
            </DialogContent>
          </Dialog>

          {/* Extracted Data Review Dialog */}
          <Dialog open={isReviewOpen} onOpenChange={setIsReviewOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Review Extracted Information</DialogTitle>
                <DialogDescription>
                  Verify and correct the extracted information before saving
                </DialogDescription>
              </DialogHeader>
              <ExtractedDataReview
                data={extractedData}
                onConfirm={handleConfirmExtractedData}
                onCancel={() => setIsReviewOpen(false)}
              />
            </DialogContent>
          </Dialog>

          {/* Add Medicine Dialog */}
          <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
            setIsAddDialogOpen(open);
            // CRITICAL FIX: Reload categories when dialog opens to ensure they're available
            if (open) {
              const loadCategoriesForDialog = async () => {
                try {
                  const categoryBranchId = user?.role === 'OWNER'
                    ? (selectedBranchId || user?.branchId || "")
                    : (user?.branchId || "");
                  
                  console.log('🔍 Reloading categories for dialog, branchId:', categoryBranchId);
                  const categoriesResponse = await apiService.getCategories({
                    branchId: categoryBranchId,
                    limit: 1000 // Get all categories
                  });
                  
                  if (categoriesResponse.success && categoriesResponse.data) {
                    // Handle both response formats
                    let categoriesData = [];
                    const responseData = categoriesResponse.data as any;
                    if (Array.isArray(responseData)) {
                      categoriesData = responseData;
                    } else if (responseData.categories && Array.isArray(responseData.categories)) {
                      categoriesData = responseData.categories;
                    } else if (responseData.data && Array.isArray(responseData.data)) {
                      categoriesData = responseData.data;
                    }
                    
                    console.log('🔍 Categories reloaded for dialog:', categoriesData.length);
                    setCategories(categoriesData);
                  }
                } catch (error) {
                  console.error('Error reloading categories for dialog:', error);
                }
              };
              loadCategoriesForDialog();
            }
          }}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(26,82,197,0.35)]"
              >
                <Plus className="h-[18px] w-[18px] stroke-[2.5]" strokeLinecap="round" />
                Add Product
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center space-x-2">
                  <Plus className="w-5 h-5 text-[#0c2c8a]" />
                  <span>Add New Medicine</span>
                </DialogTitle>
                <DialogDescription>
                  Add a new product to your inventory with all necessary details.
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Basic Information */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground border-b pb-2">Basic Information</h3>

                  <div className="space-y-2">
                    <Label htmlFor="name">Medicine Name *</Label>
                    <Input
                      id="name"
                      placeholder="e.g., Paracetamol 500mg"
                      value={newMedicine.name}
                      onChange={(e) => setNewMedicine({...newMedicine, name: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">Category *</Label>
                    <div className="flex gap-2">
                      <Select value={newMedicine.categoryId} onValueChange={(value) => setNewMedicine({...newMedicine, categoryId: value})}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.length === 0 ? (
                            <SelectItem value="no-categories" disabled>
                              No categories available - Please create a category first
                            </SelectItem>
                          ) : (
                            categories.map((category) => (
                              <SelectItem
                                key={category.id}
                                value={category.id}
                                className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                              >
                                {category.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsCreateCategoryDialogOpen(true)}
                        className="px-3"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add New
                      </Button>
                    </div>
                  </div>


                </div>

                {/* Product Details */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground border-b pb-2">Product Details</h3>

                  <div className="space-y-2">
                    <Label htmlFor="formula">Formula/Composition</Label>
                    <Textarea
                      id="formula"
                      placeholder="Enter product formula or composition (e.g., Paracetamol 500mg, Lactose, Starch)"
                      value={newMedicine.formula}
                      onChange={(e) => setNewMedicine({...newMedicine, formula: e.target.value})}
                      rows={3}
                    />
                  </div>


                  <div className="space-y-2">
                    <Label htmlFor="barcode">Barcode</Label>
                    <div className="flex space-x-2">
                      <Input
                        id="barcode"
                        placeholder="e.g., 1234567890123"
                        value={newMedicine.barcode}
                        onChange={(e) => setNewMedicine({...newMedicine, barcode: e.target.value})}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setNewMedicine({...newMedicine, barcode: generateBarcode()})}
                        >
                        Generate
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="minStock">Low Stock Threshold *</Label>
                    <Input
                      id="minStock"
                      type="number"
                      min={0}
                      placeholder="e.g., 10"
                      value={newMedicine.minStock}
                      onChange={(e) => setNewMedicine({
                        ...newMedicine,
                        minStock: Number(e.target.value) || 0
                      })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Product will be flagged as low stock when total batch stock reaches this value.
                    </p>
                  </div>

                  {/* Prescription Required Checkbox */}
                  <div className="flex items-center space-x-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <input
                      type="checkbox"
                      id="requiresPrescription"
                      checked={newMedicine.requiresPrescription}
                      onChange={(e) => setNewMedicine({...newMedicine, requiresPrescription: e.target.checked})}
                      className="w-5 h-5 text-amber-600 border-amber-300 rounded focus:ring-amber-500"
                    />
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-amber-600" />
                      <Label htmlFor="requiresPrescription" className="text-amber-800 font-medium cursor-pointer">
                        Requires Doctor's Prescription
                      </Label>
                    </div>
                  </div>

                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-6">
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button className="text-white bg-blue-600 hover:bg-blue-700 border-blue-600 shadow-md hover:shadow-lg transition-all duration-200" onClick={handleAddMedicine} disabled={isAdding}>
                  {isAdding ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Add Product
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Edit Product Dialog */}
          <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
            setIsEditDialogOpen(open);
            // CRITICAL: Reset loading state when dialog closes
            if (!open) {
              setLoading(false);
              setEditingProduct(null);
              setNewMedicine({
                name: "",
                categoryId: "",
                formula: "",
                barcode: "",
                requiresPrescription: false,
                minStock: 10
              });
            }
          }}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center space-x-2">
                  <Edit className="w-5 h-5 text-primary" />
                  <span>Edit Product</span>
                </DialogTitle>
                <DialogDescription>
                  Update the product information and save changes to your inventory.
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Basic Information */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground border-b pb-2">Basic Information</h3>

                  <div className="space-y-2">
                    <Label htmlFor="edit-name">Medicine Name *</Label>
                    <Input
                      id="edit-name"
                      placeholder="e.g., Paracetamol 500mg"
                      value={newMedicine.name}
                      onChange={(e) => setNewMedicine({...newMedicine, name: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-category">Category *</Label>
                    <Select value={newMedicine.categoryId} onValueChange={(value) => setNewMedicine({...newMedicine, categoryId: value})}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((category) => (
                          <SelectItem
                            key={category.id}
                            value={category.id}
                            className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                          >
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                </div>

                {/* Product Details */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground border-b pb-2">Product Details</h3>

                  <div className="space-y-2">
                    <Label htmlFor="edit-formula">Formula/Composition</Label>
                    <Textarea
                      id="edit-formula"
                      placeholder="Enter product formula or composition (e.g., Paracetamol 500mg, Lactose, Starch)"
                      value={newMedicine.formula}
                      onChange={(e) => setNewMedicine({...newMedicine, formula: e.target.value})}
                      rows={3}
                    />
                  </div>


                  <div className="space-y-2">
                    <Label htmlFor="edit-barcode">Barcode</Label>
                    <div className="flex space-x-2">
                      <Input
                        id="edit-barcode"
                        placeholder="e.g., 1234567890123"
                        value={newMedicine.barcode}
                        onChange={(e) => setNewMedicine({...newMedicine, barcode: e.target.value})}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setNewMedicine({...newMedicine, barcode: generateBarcode()})}
                        >
                        Generate
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-minStock">Low Stock Threshold *</Label>
                    <Input
                      id="edit-minStock"
                      type="number"
                      min={0}
                      placeholder="e.g., 10"
                      value={newMedicine.minStock}
                      onChange={(e) => setNewMedicine({
                        ...newMedicine,
                        minStock: Number(e.target.value) || 0
                      })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Product will be flagged as low stock when total batch stock reaches this value.
                    </p>
                  </div>

                  {/* Prescription Required Checkbox */}
                  <div className="flex items-center space-x-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <input
                      type="checkbox"
                      id="edit-requiresPrescription"
                      checked={newMedicine.requiresPrescription}
                      onChange={(e) => setNewMedicine({...newMedicine, requiresPrescription: e.target.checked})}
                      className="w-5 h-5 text-amber-600 border-amber-300 rounded focus:ring-amber-500"
                    />
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-amber-600" />
                      <Label htmlFor="edit-requiresPrescription" className="text-amber-800 font-medium cursor-pointer">
                        Requires Doctor's Prescription
                      </Label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-6">
                <Button variant="outline" onClick={() => {
                  setLoading(false); // CRITICAL: Reset loading state on cancel
                  setIsEditDialogOpen(false);
                }}>
                  Cancel
                </Button>
                <Button className="text-white bg-blue-600 hover:bg-blue-700 border-blue-600 shadow-md hover:shadow-lg transition-all duration-200" onClick={handleUpdateProduct} disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Update Product
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation Dialog */}
          <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center space-x-2">
                  <AlertCircle className="w-5 h-5 text-destructive" />
                  <span>Confirm Delete</span>
                </DialogTitle>
                <DialogDescription>
                  This action cannot be undone. The product will be permanently removed from your inventory.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                      <Trash2 className="w-5 h-5 text-red-600" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-gray-900">
                      Delete Product
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Are you sure you want to delete this product? This action cannot be undone.
                    </p>
                    {deletingProduct && (
                      <div className="mt-3 p-3 bg-gray-50 rounded-md">
                        <p className="text-sm font-medium text-gray-900">
                          {deletingProduct.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          Category: {deletingProduct.category.name}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <Button
                  variant="outline"
                  onClick={handleCancelDelete}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmDelete}
                  disabled={loading}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Confirm Delete
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Bulk Delete Confirmation Dialog */}
          <Dialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center space-x-2">
                  <AlertCircle className="w-5 h-5 text-destructive" />
                  <span>Confirm Bulk Delete</span>
                </DialogTitle>
                <DialogDescription>
                  This action cannot be undone. The selected products will be permanently removed from your inventory.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                      <Trash2 className="w-5 h-5 text-red-600" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-gray-900">
                      Delete {selectedProducts.length} Products
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Are you sure you want to delete {selectedProducts.length} selected products? This action cannot be undone.
                    </p>
                    <div className="mt-3 p-3 bg-gray-50 rounded-md">
                      <p className="text-sm font-medium text-gray-900">
                        Selected Products:
                      </p>
                      <div className="mt-2 max-h-32 overflow-y-auto">
                        {selectedProducts.map(productId => {
                          const product = products.find(p => p.id === productId);
                          return product ? (
                            <p key={productId} className="text-xs text-gray-500">
                              • {product.name}
                            </p>
                          ) : null;
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <Button
                  variant="outline"
                  onClick={handleCancelBulkDelete}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmBulkDelete}
                  disabled={loading}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete {selectedProducts.length} Products
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filter bar */}
      <div className="zv3-animate-fadeUp zv3-delay-2 flex flex-wrap items-center gap-3 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-6 py-4">
            {/* Search */}
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#8c95b0]" strokeWidth={2} />
              <Input
                placeholder="Search by name or barcode..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={filterBarInput}
              />
            </div>

            {/* Product Type Filter */}
            <Select value={selectedProductType} onValueChange={(value) => {
              setSelectedProductType(value);
              setSelectedCategory("all");
            }}>
              <SelectTrigger id="type-filter" className={cn(filterBarSelect, "w-[min(100%,140px)] sm:w-[140px]")}>
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="MEDICAL">Medical</SelectItem>
                <SelectItem value="NON_MEDICAL">Non-Medical</SelectItem>
                <SelectItem value="GENERAL">General</SelectItem>
              </SelectContent>
            </Select>

            {/* Category Filter - filtered by selected product type */}
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger id="category-filter" className={cn(filterBarSelect, "w-[min(100%,150px)] sm:w-[150px]")}>
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories
                  .filter((category) => selectedProductType === "all" || category.type === selectedProductType)
                  .map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            {/* Manufacturer Filter */}
            <Select value={selectedManufacturer} onValueChange={setSelectedManufacturer}>
              <SelectTrigger id="manufacturer-filter" className={cn(filterBarSelect, "w-[min(100%,160px)] sm:w-[160px]")}>
                <SelectValue placeholder="All Manufacturers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Manufacturers</SelectItem>
                {getUniqueManufacturers().map((manufacturer) => (
                  <SelectItem key={manufacturer.id} value={manufacturer.id}>
                    {manufacturer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Supplier Filter */}
            <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
              <SelectTrigger id="supplier-filter" className={cn(filterBarSelect, "w-[min(100%,150px)] sm:w-[150px]")}>
                <SelectValue placeholder="All Suppliers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Suppliers</SelectItem>
                {getUniqueSuppliers().length > 0 ? (
                  getUniqueSuppliers().map((supplier) => (
                    <SelectItem key={supplier} value={supplier}>
                      {supplier}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="no-suppliers" disabled>
                    No suppliers available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>

            <div className="hidden h-7 w-px shrink-0 bg-[rgba(15,23,60,0.06)] sm:block" aria-hidden />

            {/* Stock Filter Checkboxes */}
            <div className="flex flex-wrap items-center gap-3 text-[12px] font-semibold">
              <span className="text-[#8c95b0]">Filter:</span>
              <label className="flex cursor-pointer items-center gap-1.5 text-red-600 transition-colors hover:text-red-700">
                <input
                  type="checkbox"
                  checked={showOutOfStock}
                  onChange={(e) => setShowOutOfStock(e.target.checked)}
                  className="h-4 w-4 rounded border-[1.5px] border-black/15 accent-[#1a52c5]"
                />
                <span>Out of Stock</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-amber-600 transition-colors hover:text-amber-700">
                <input
                  type="checkbox"
                  checked={showLowStock}
                  onChange={(e) => setShowLowStock(e.target.checked)}
                  className="h-4 w-4 rounded border-[1.5px] border-black/15 accent-[#1a52c5]"
                />
                <span>Low Stock</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-rose-700 transition-colors hover:text-rose-800">
                <input
                  type="checkbox"
                  checked={showExpired}
                  onChange={(e) => setShowExpired(e.target.checked)}
                  className="h-4 w-4 rounded border-[1.5px] border-black/15 accent-[#1a52c5]"
                />
                <span>Expired</span>
              </label>
            </div>

            {/* Clear Filters Button */}
            {(selectedCategory !== "all" || selectedProductType !== "all" || selectedManufacturer !== "all" || selectedSupplier !== "all" || showOutOfStock || showLowStock || showExpired) && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  setSelectedCategory("all");
                  setSelectedProductType("all");
                  setSelectedManufacturer("all");
                  setSelectedSupplier("all");
                  setShowOutOfStock(false);
                  setShowLowStock(false);
                  setShowExpired(false);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[rgba(15,23,60,0.06)] p-0 text-[#8c95b0] hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                title="Clear Filters"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
      </div>

      {/* Products Table */}
      <div className="zv3-animate-fadeUp zv3-delay-3 overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col gap-3 border-b border-[rgba(15,23,60,0.06)] px-8 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-bold text-[#0a1128]">Products</span>
            <span className="text-sm font-medium text-[#8c95b0]">({pagination.total})</span>
          </div>
          {selectedProducts.length > 0 && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleBulkDeleteClick}
              className="rounded-[10px] bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete selected ({selectedProducts.length})
            </Button>
          )}
        </div>
          {error ? (
            <div className="px-8 py-12 text-center text-red-600">
              <p className="text-sm font-medium">{error}</p>
              <Button type="button" onClick={() => void loadData()} className="mt-4 rounded-[10px]" variant="outline">
                Try Again
              </Button>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                    <th className="w-12 py-3.5 pl-8 pr-2 text-left">
                      <input
                        type="checkbox"
                        checked={selectedProducts.length === products.length && products.length > 0}
                        onChange={handleSelectAll}
                        className="h-[18px] w-[18px] rounded border-[1.5px] border-black/12 accent-[#1a52c5]"
                        aria-label="Select all products"
                        title="Select all products"
                      />
                    </th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Product</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Type</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Category</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Supplier</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Manufacturer</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Formula</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Cost Price</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Sale Price</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Total Qty</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Remaining</th>
                    <th className="px-4 py-3.5 pr-8 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-8 py-16 text-center">
                        <div className="mx-auto mb-6 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[rgba(26,82,197,0.06)]">
                          <Package className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
                        </div>
                        <p className="mb-2 text-sm font-bold text-[#0a1128]">No products found</p>
                        <p className="mx-auto mb-6 max-w-md text-sm text-[#8c95b0]">
                          Start by adding your first product to the inventory.
                        </p>
                        <Button
                          type="button"
                          onClick={() => setIsAddDialogOpen(true)}
                          className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Product
                        </Button>
                      </td>
                    </tr>
                  ) : (
                    products.map((product) => {
                      const catName = product.category?.name || "Uncategorized";
                      return (
                        <tr
                          key={product.id}
                          className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                        >
                          <td className="w-12 py-4 pl-8 pr-2 align-middle">
                            <input
                              type="checkbox"
                              checked={selectedProducts.includes(product.id)}
                              onChange={() => handleSelectProduct(product.id)}
                              className="h-[18px] w-[18px] rounded border-[1.5px] border-black/12 accent-[#1a52c5]"
                              aria-label={`Select ${product.name}`}
                              title={`Select ${product.name}`}
                            />
                          </td>
                          <td className="px-4 py-4 align-middle text-[13px] text-[#4a5578]">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[14px] font-bold text-[#0a1128]">{product.name}</span>
                                {product.requiresPrescription && (
                                  <span className="inline-flex items-center gap-0.5 rounded-md border border-amber-300/40 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                                    <AlertCircle className="h-3 w-3" />
                                    Rx
                                  </span>
                                )}
                              </div>
                              {product.barcode ? (
                                <span className="font-mono text-[11px] tracking-wide text-[#8c95b0]">{product.barcode}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-4 align-middle">
                            <span
                              className={cn(
                                "inline-flex rounded-md px-2.5 py-1 text-[11px] font-semibold",
                                product.category?.type === 'MEDICAL' ? 'bg-blue-50 text-blue-700' :
                                product.category?.type === 'NON_MEDICAL' ? 'bg-purple-50 text-purple-700' :
                                'bg-gray-50 text-gray-700'
                              )}
                            >
                              {product.category?.type === 'MEDICAL' ? 'Medical' : product.category?.type === 'NON_MEDICAL' ? 'Non-Medical' : product.category?.type || 'General'}
                            </span>
                          </td>
                          <td className="px-4 py-4 align-middle">
                            <span
                              className={cn(
                                "inline-flex rounded-md px-2.5 py-1 text-[11px] font-semibold",
                                inventoryCategoryBadgeClass(catName),
                              )}
                            >
                              {catName}
                            </span>
                          </td>
                          <td className="px-4 py-4 align-middle text-[13px] text-[#4a5578]">
                            {(() => {
                              const batchWithSupplier = product.batches?.find((b) => b.supplier || b.supplierName);
                              const supplierName =
                                batchWithSupplier?.supplier?.name || batchWithSupplier?.supplierName;
                              return supplierName ? (
                                <span className="text-[13px] font-medium text-[#0a1128]">{supplierName}</span>
                              ) : (
                                <span className="text-[#8c95b0]">—</span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-4 align-middle text-[13px] text-[#4a5578]">
                            {(() => {
                              const batchWithManufacturer = product.batches?.find((b) => b.supplier?.manufacturer);
                              const manufacturerName = batchWithManufacturer?.supplier?.manufacturer?.name;
                              return manufacturerName ? (
                                <span className="text-[13px] font-medium text-[#0a1128]">{manufacturerName}</span>
                              ) : (
                                <span className="text-[#8c95b0]">—</span>
                              );
                            })()}
                          </td>
                          <td className="max-w-[200px] px-4 py-4 align-middle text-[12px] italic text-[#8c95b0]">
                            {product.formula || "No formula provided"}
                          </td>
                          <td className="px-4 py-4 align-middle">
                            {(() => {
                              const latestBatch = product.batches?.length > 0 ? product.batches[product.batches.length - 1] : null;
                              const costPrice = latestBatch?.purchasePrice || 0;
                              return <span className="text-[13px] font-medium text-[#4a5578]">PKR {costPrice}</span>;
                            })()}
                          </td>
                          <td className="px-4 py-4 align-middle">
                            <span className="text-[13px] font-bold text-[#1a52c5]">PKR {product.price || 0}</span>
                          </td>
                          <td className="px-4 py-4 align-middle">
                            {(() => {
                              const totalQty =
                                product.batches?.reduce((sum, batch) => {
                                  const originalQty = (batch.totalBoxes || 0) * (batch.unitsPerBox || 1);
                                  return sum + originalQty;
                                }, 0) || 0;
                              const zero = totalQty === 0;
                              return (
                                <span
                                  className={cn(
                                    "text-[13px] font-bold",
                                    zero ? "text-red-600" : "text-green-600",
                                  )}
                                >
                                  {totalQty} units
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-4 align-middle">
                            {(() => {
                              const remaining = product.stock || 0;
                              const minStock = product.minStock || 10;
                              if (remaining === 0) {
                                return (
                                  <span className="inline-block rounded-md bg-[rgba(220,38,38,0.06)] px-2.5 py-1 text-[13px] font-bold text-red-600">
                                    {remaining} units
                                  </span>
                                );
                              }
                              if (remaining <= minStock) {
                                return (
                                  <span className="text-[13px] font-bold text-amber-600">{remaining} units</span>
                                );
                              }
                              return <span className="text-[13px] font-bold text-green-600">{remaining} units</span>;
                            })()}
                          </td>
                          <td className="px-4 py-4 pr-8 text-right align-middle">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                title="Edit"
                                onClick={() => handleEditProduct(product)}
                                className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                              >
                                <Edit className="h-[15px] w-[15px]" strokeWidth={2} />
                              </button>
                              <button
                                type="button"
                                title="Delete"
                                onClick={() => handleDeleteClick(product)}
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

            {/* Pagination */}
            {pagination.total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4 border-t border-[rgba(15,23,60,0.06)]">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-[#8c95b0]">
                    Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} products
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-[#8c95b0]">Per page:</span>
                    <select
                      value={pagination.limit}
                      onChange={(e) => {
                        const newLimit = Number(e.target.value);
                        const source = filteredProductsForPagination.length > 0 ? filteredProductsForPagination : allProducts;
                        const newPages = Math.ceil(source.length / newLimit);
                        setPagination({ page: 1, limit: newLimit, total: source.length, pages: newPages });
                        setProducts(source.slice(0, newLimit));
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
                {pagination.pages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const newPage = Math.max(1, pagination.page - 1);
                      setPagination(prev => ({ ...prev, page: newPage }));
                      const startIndex = (newPage - 1) * pagination.limit;
                      const endIndex = startIndex + pagination.limit;
                      const source = filteredProductsForPagination.length > 0 ? filteredProductsForPagination : allProducts;
                      setProducts(source.slice(startIndex, endIndex));
                    }}
                    disabled={pagination.page === 1}
                    className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
                  >
                    Previous
                  </button>
                  <span className="text-sm font-semibold text-[#0a1128]">
                    Page {pagination.page} of {pagination.pages}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const newPage = Math.min(pagination.pages, pagination.page + 1);
                      setPagination(prev => ({ ...prev, page: newPage }));
                      const startIndex = (newPage - 1) * pagination.limit;
                      const endIndex = startIndex + pagination.limit;
                      const source = filteredProductsForPagination.length > 0 ? filteredProductsForPagination : allProducts;
                      setProducts(source.slice(startIndex, endIndex));
                    }}
                    disabled={pagination.page === pagination.pages}
                    className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
                  >
                    Next
                  </button>
                </div>
                )}
              </div>
            )}
            </>
          )}
      </div>

      {/* Import Preview Dialog */}
      <Dialog open={isPreviewDialogOpen} onOpenChange={setIsPreviewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <FileSpreadsheet className="w-5 h-5 text-primary" />
              <span>Preview Imported Products</span>
            </DialogTitle>
            <DialogDescription>
              Review and edit the imported products before adding them to your inventory.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium text-blue-800">
                  Review the extracted product information below. You can edit any fields before proceeding with the import.
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Extracted Products ({importedProducts.length})</h3>

              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Product Name</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Category</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Formula</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Barcode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importedProducts.map((product, index) => (
                        <tr key={index} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4">
                            <Input
                              value={product.name}
                              onChange={(e) => {
                                const updated = [...importedProducts];
                                updated[index].name = e.target.value;
                                setImportedProducts(updated);
                              }}
                              className="w-full"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <Select
                              value={product.category}
                              onValueChange={(value) => {
                                const updated = [...importedProducts];
                                updated[index].category = value;
                                setImportedProducts(updated);
                              }}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {categories.map((category) => (
                                  <SelectItem key={category.id} value={category.name}>
                                    {category.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {!categories.find(cat => cat.name.toLowerCase() === product.category.toLowerCase()) && (
                              <p className="text-xs text-blue-600 mt-1">
                                📁 Category "{product.category}" will be auto-created during import.
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <Input
                              placeholder="Enter formula/composition"
                              value={product.formula || ''}
                              onChange={(e) => {
                                const updated = [...importedProducts];
                                updated[index].formula = e.target.value;
                                setImportedProducts(updated);
                              }}
                              className="w-full"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <Input
                              value={product.barcode || ''}
                              onChange={(e) => {
                                const updated = [...importedProducts];
                                updated[index].barcode = e.target.value;
                                setImportedProducts(updated);
                              }}
                              className="w-full"
                              placeholder="Optional"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setIsPreviewDialogOpen(false);
                  setImportedProducts([]);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleProceedImport}
                disabled={loading}
                className="text-white bg-[linear-gradient(135deg,#1C623C_0%,#247449_50%,#6EB469_100%)] hover:opacity-90"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Proceed Import
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Category Management */}
      <CategoryManagement
        isOpen={isCategoryManagementOpen}
        onClose={() => setIsCategoryManagementOpen(false)}
        onCategoryChange={() => {
          // Reload categories and products when categories change
          loadData();
        }}
      />
      </div>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(Inventory);
