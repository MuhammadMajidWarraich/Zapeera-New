import React, { useState, useEffect, useMemo, useRef } from "react";
import { config } from "@/lib/config";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShoppingCart,
  Barcode,
  Search,
  Scan,
  Plus,
  Minus,
  Trash2,
  User,
  CreditCard,
  Banknote,
  Smartphone,
  Receipt,
  Pill,
  Package,
  Droplets,
  Syringe,
  X,
  Printer,
  Download,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  RefreshCw
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { withBusinessSlug } from "@/utils/business-routes";
import { useToast } from "@/hooks/use-toast";

interface CartItem {
  id: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  unitType: string;
  saleType: 'UNIT' | 'BOX';
  unitsPerBox?: number;
  unitsDeducted: number;
  availableUnits?: number;
  unitPrice: number;
  totalPrice: number;
  batchId?: string;
  batch: string;
  batchNumber?: string;
  expiry: string;
  instructions?: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  unitType: string;
  category: string;
  requiresPrescription: boolean;
  barcode?: string;
  formula?: string; // Product composition/formula for search
  unitsPerPack?: number; // Number of units in a pack
  unitsPerBox?: number;
}

interface Batch {
  id: string;
  batchNo: string;
  quantity: number;
  sellingPrice: number;
  unitsPerBox?: number;
  totalBoxes?: number;
  expireDate?: string;
  expiryStatus?: 'GOOD' | 'WARNING' | 'CRITICAL' | 'EXPIRED';
  daysUntilExpiry?: number;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  totalPurchases: number;
  lastVisit?: string;
  loyaltyPoints: number;
  isVIP: boolean;
}

interface Promotion {
  id: string;
  code: string;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  minAmount?: number;
  maxDiscount?: number;
  validUntil?: string;
  isActive: boolean;
}

interface SplitPayment {
  id: string;
  method: 'cash' | 'card' | 'mobile' | 'gift_card';
  amount: number;
  reference?: string;
}

interface RefundItem {
  id: string;
  name: string;
  quantity: number;
  saleType?: 'UNIT' | 'BOX';
  unitsDeducted?: number;
  unitsPerBox?: number;
  unitPrice: number;
  totalPrice: number;
  reason: string;
}

interface GiftCard {
  id: string;
  number: string;
  balance: number;
  isActive: boolean;
  expiryDate?: string;
}

interface Receipt {
  id: string;
  customer: Customer | null;
  items: CartItem[];
  subtotal: number;
  discountPercentage?: number;
  discountAmount?: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  date: string;
  time: string;
  cashier: string;
  receiptNumber: string;
}

const POSInterface = () => {
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch, selectedCompanyId, selectedCompany, allCompanies, allBranches } = useAdmin();

  const businessSlug = useMemo(() => {
    const c =
      selectedCompany || allCompanies.find((x) => x.id === selectedCompanyId);
    return String((c as { slug?: string | null })?.slug || "").trim();
  }, [selectedCompany, allCompanies, selectedCompanyId]);
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPayment, setSelectedPayment] = useState<'cash' | 'card' | 'mobile'>('cash');
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isCustomerDialogOpen, setIsCustomerDialogOpen] = useState(false);
  const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);
  const [currentReceipt, setCurrentReceipt] = useState<Receipt | null>(null);
  const [saleBranchId, setSaleBranchId] = useState<string | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const [changeAmount, setChangeAmount] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'processing' | 'completed' | 'failed'>('pending');
  const [isNewCustomerDialogOpen, setIsNewCustomerDialogOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    email: "",
    address: ""
  });
  const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
  const [invoiceCustomer, setInvoiceCustomer] = useState({
    name: "",
    phone: "",
    email: "",
    address: ""
  });
  const [invoiceItems, setInvoiceItems] = useState<CartItem[]>([]);
  const [invoiceSearchQuery, setInvoiceSearchQuery] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [isBarcodeDialogOpen, setIsBarcodeDialogOpen] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");
  const [appliedPromotions, setAppliedPromotions] = useState<Promotion[]>([]);
  const [promoCode, setPromoCode] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([]);
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [settingsUpdateTrigger, setSettingsUpdateTrigger] = useState(0);
  const [refundReceiptNumber, setRefundReceiptNumber] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundItems, setRefundItems] = useState<RefundItem[]>([]);
  const [giftCardNumber, setGiftCardNumber] = useState("");
  const [giftCardBalance, setGiftCardBalance] = useState(0);
  const [giftCardAmount, setGiftCardAmount] = useState(0);
  const [foundInvoice, setFoundInvoice] = useState<any>(null);
  const [invoiceLookupLoading, setInvoiceLookupLoading] = useState(false);
  const [isRefundSearchOpen, setIsRefundSearchOpen] = useState(false);
  const [discountPercentage, setDiscountPercentage] = useState<number>(0);
  const [manualDate, setManualDate] = useState<string>("");
  const [useManualDate, setUseManualDate] = useState<boolean>(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);

  // Check for openInvoice query parameter and open invoice dialog
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    if (urlParams.get('openInvoice') === 'true') {
      setIsInvoiceDialogOpen(true);
      // Clean up the URL by removing the query parameter
      window.history.replaceState({}, '', '/pos');
    }
  }, [location.search]);
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);

  // Load selected customer from localStorage if coming from Customer Management
  React.useEffect(() => {
    // Initialize sale branch for admins based on selected branch or user's branch
    if (!saleBranchId) {
      if (user?.role === 'OWNER') {
        setSaleBranchId(selectedBranchId || null);
      } else {
        const branchId = user?.membership?.branchIds?.[0] || user?.branchId;
        if (branchId) {
          setSaleBranchId(branchId);
        }
      }
    }

    const savedCustomer = localStorage.getItem('selectedCustomer');
    if (savedCustomer) {
      try {
        const customer = JSON.parse(savedCustomer);
        setSelectedCustomer(customer);
        localStorage.removeItem('selectedCustomer'); // Clear after loading
      } catch (error) {
      }
    }
  }, []);

  // Load products from API
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(['all', 'General Medicine']);
  const [loading, setLoading] = useState(false);

  // Batch management state
  const [productBatches, setProductBatches] = useState<Record<string, Batch[]>>({});
  const [selectedBatches, setSelectedBatches] = useState<Record<string, string>>({}); // productId -> batchId
  const [loadingBatches, setLoadingBatches] = useState<Record<string, boolean>>({});

  React.useEffect(() => {
    // console.log('ðŸ”„ POS useEffect triggered');
    // console.log('ðŸ”„ User in useEffect:', user);

    // Load products immediately
    const loadProductsImmediately = async () => {
      try {
          // Determine which branch to load products from
          let branchId: string | undefined;

          if (user?.role === 'OWNER') {
            // Owner users can see products from selected branch or all branches
            if (selectedBranchId) {
              branchId = selectedBranchId;
              // console.log('ðŸ”„ Admin selected specific branch (immediate):', selectedBranch?.name);
            } else {
              // console.log('ðŸ”„ Admin viewing all branches - loading all products (immediate)');
            }
          } else {
            // Regular users see only their branch products
            branchId = user?.membership?.branchIds?.[0] || user?.branchId || null;
            if (!branchId) {
            }
            // console.log('ðŸ”„ Regular user branch (immediate):', branchId);
          }

          const url = branchId
            ? `${config.api.baseUrl}/products?limit=1000&branchId=${branchId}`
            : `${config.api.baseUrl}/products?limit=1000`;

          const response = await fetch(url, {
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json'
            }
          });
          const data = await response.json();
          if (data.success && data.data && data.data.products) {
          const transformedProducts = data.data.products.map((product: any) => ({
            id: product.id,
            name: product.name,
            price: product.sellingPrice,
            stock: product.stock,
            unitType: product.unitType,
            unitsPerPack: product.unitsPerPack || product.unitsPerBox || product.currentBatch?.unitsPerBox || product.batches?.[0]?.unitsPerBox || 1,
            unitsPerBox: product.unitsPerBox || product.unitsPerPack || product.currentBatch?.unitsPerBox || product.batches?.[0]?.unitsPerBox || 1,
            category: product.category?.name || 'No Category',
            requiresPrescription: product.requiresPrescription,
            barcode: product.barcode,
            formula: product.formula, // Include formula for search
            // CRITICAL FIX: Preserve batch information for invoice creation
            currentBatch: product.currentBatch || null,
            batches: product.batches || []
          }));
            setProducts(transformedProducts);
          }
      } catch (error) {
      }
    };

    loadProductsImmediately();

    // Also load products when user is available
    if (user) {
      loadProducts();
    } else {
    }

    // Load categories - only show categories that have products in current branch
    const loadCategoriesSimple = async () => {
      try {
        const response = await fetch(`${config.api.baseUrl}/categories`, {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        if (data.success && data.data && data.data.categories) {
          // Determine which branch to load categories from
          let branchId: string | undefined;

          if (user?.role === 'OWNER') {
            // Owner users can see categories from selected branch or all branches
            if (selectedBranchId) {
              branchId = selectedBranchId;
            } else {
            }
          } else {
            // Regular users see only their branch categories
            branchId = user?.membership?.branchIds?.[0] || user?.branchId || null;
          }

          // Get all products for current branch to filter categories
          const url = branchId
            ? `${config.api.baseUrl}/products?branchId=${branchId}&limit=1000`
            : `${config.api.baseUrl}/products?limit=1000`;

          const productsResponse = await fetch(url, {
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json'
            }
          });
          const productsData = await productsResponse.json();

          if (productsData.success && productsData.data && productsData.data.products) {
            // Get unique category IDs from products in current branch
            const branchCategoryIds = new Set(
              productsData.data.products.map((product: any) => product.categoryId)
            );

            // Filter categories to only include those with products in current branch
            const branchCategories = data.data.categories.filter((cat: any) =>
              branchCategoryIds.has(cat.id)
            );

            const categoryNames = branchCategories.map((cat: any) => cat.name) as string[];
            const uniqueCategories = ["all", ...Array.from(new Set(categoryNames))];
            setCategories(uniqueCategories);
          } else {
            // If no products found, show empty categories
            setCategories(['all']);
          }
        }
      } catch (error) {
        setCategories(['all']);
      }
    };

    loadCategoriesSimple();

    // Listen for product updates â€” smart in-place updates via SSE events
    // NOTE: Previously, legacy 'productCreated'/'productUpdated'/'productDeleted' event listeners
    // called loadProducts() for a FULL reload. Removed because the 'productChanged' handler below
    // already does smart in-place add/update/delete without disrupting the user's work.

    // Real-time data synchronization
    const handleProductChanged = (event: CustomEvent) => {
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

    window.addEventListener('productChanged', handleProductChanged as EventListener);
    window.addEventListener('inventoryChanged', handleInventoryChanged as EventListener);

    return () => {
      window.removeEventListener('productChanged', handleProductChanged as EventListener);
      window.removeEventListener('inventoryChanged', handleInventoryChanged as EventListener);
    };
  }, [user, selectedBranchId]); // Re-run when user or selected branch changes

  const loadProducts = async () => {
    try {
      // Don't show loading - load in background

      // Determine which branch to load products from
      let branchId: string | undefined;

      if (user?.role === 'OWNER') {
        // Owner users can see products from selected branch or all branches
        if (selectedBranchId) {
          branchId = selectedBranchId;
        } else {
          // Admin viewing all branches - don't filter by branch
        }
      } else {
        // Regular users see only their branch products
        branchId = user?.membership?.branchIds?.[0] || user?.branchId || null;
      }

      const params: any = { page: 1, limit: 200 };
      if (branchId) params.branchId = branchId;
      const response = await apiService.getProducts(params);

      if (response.success && response.data) {
        // NOTE: backend may include extra fields (currentBatch/batches/formula) not reflected in apiService typing
        const productsArray: any[] = (response.data as any).products || (response.data as any);

        if (Array.isArray(productsArray) && productsArray.length > 0) {
          // Transform API data to match Product interface
          // Batch data is now included in the product response
          const transformedProducts = productsArray.map((product) => {
            return {
              id: product.id,
              name: product.name,
              // Prefer sellingPrice if available, fallback to price
              price: product.sellingPrice ?? product.price ?? 0,
              stock: product.stock ?? product.totalStock ?? 0,
              unitType: product.unitType,
              unitsPerPack: product.unitsPerPack || product.unitsPerBox || product.currentBatch?.unitsPerBox || product.batches?.[0]?.unitsPerBox || 1,
              unitsPerBox: product.unitsPerBox || product.unitsPerPack || product.currentBatch?.unitsPerBox || product.batches?.[0]?.unitsPerBox || 1,
              category: product.category?.name || 'No Category',
              requiresPrescription: !!product.requiresPrescription,
              barcode: product.barcode,
              formula: product.formula, // Include formula for search
              // CRITICAL FIX: Preserve batch information for invoice creation
              currentBatch: product.currentBatch || null,
              batches: product.batches || []
            };
          });
          setProducts(transformedProducts);
        } else {
          setProducts([]);
        }
      } else {
        setProducts([]);
      }
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      // Determine which branch to load categories from
      let branchId: string | undefined;
      if (user?.role === 'OWNER') {
        if (selectedBranchId) branchId = selectedBranchId;
      } else {
        branchId = user?.membership?.branchIds?.[0] || user?.branchId || null;
      }

      const response = await apiService.getCategories({
        page: 1,
        limit: 500,
        ...(branchId ? { branchId } : {})
      } as any);

      if (response.success && response.data?.categories) {
        const categoryNames = response.data.categories.map((cat: any) => cat.name);
        const uniqueCategories = ["all", ...Array.from(new Set(categoryNames))];
        setCategories(uniqueCategories);
      } else {
        setCategories(["all"]);
      }
    } catch (error) {
      setCategories(["all"]);
    }
  };

  // Load customers from API
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);

  const loadCustomers = async () => {
    try {
      setCustomersLoading(true);
      // Determine which branch to load customers from
      let branchId: string | undefined;
      if (user?.role === 'OWNER') {
        branchId = selectedBranchId || undefined;
      } else {
        branchId = user?.membership?.branchIds?.[0] || user?.branchId || null;
      }
      const response = await apiService.getCustomers({
        ...(branchId ? { branchId } : {}),
        limit: 200
      });
      if (response.success && response.data) {
        const customersArray = response.data.customers || response.data;
        if (Array.isArray(customersArray)) {
          const transformedCustomers = customersArray.map((customer: any) => ({
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            email: customer.email || "",
            address: customer.address || "",
            totalPurchases: customer.totalPurchases || 0,
            lastVisit: customer.lastVisit ? new Date(customer.lastVisit).toISOString().split('T')[0] : "",
            loyaltyPoints: customer.loyaltyPoints || 0,
            isVIP: customer.isVIP || false
          }));
          setCustomers(transformedCustomers);
        }
      }
    } catch (error) {
    } finally {
      setCustomersLoading(false);
    }
  };

  // Load customers when component mounts or when branchId changes
  React.useEffect(() => {
    loadCustomers();
  }, [user?.branchId, selectedBranchId, selectedCompanyId]);

  // Listen for customer creation events to refresh customer list
  React.useEffect(() => {
    const handleCustomerCreated = () => {
      loadCustomers();
    };

    window.addEventListener('customerCreated', handleCustomerCreated);
    return () => {
      window.removeEventListener('customerCreated', handleCustomerCreated);
    };
  }, []);

  // Listen for POS settings updates to refresh tax calculation
  React.useEffect(() => {
    const handleSettingsUpdate = (event: CustomEvent) => {
      // Force re-render by updating the trigger state
      setSettingsUpdateTrigger(prev => prev + 1);
    };

    window.addEventListener('posSettingsUpdated', handleSettingsUpdate as EventListener);

    return () => {
      window.removeEventListener('posSettingsUpdated', handleSettingsUpdate as EventListener);
    };
  }, []);


  const getUnitIcon = (unitType: string) => {
    switch (unitType) {
      case "tablets":
      case "capsules":
        return <Pill className="w-4 h-4" />;
      case "bottles":
        return <Droplets className="w-4 h-4" />;
      case "vials":
        return <Syringe className="w-4 h-4" />;
      default:
        return <Package className="w-4 h-4" />;
    }
  };

  // Track which products we've already attempted to fetch batches for (even if they had none)
  const [fetchedProducts, setFetchedProducts] = useState<Set<string>>(new Set());

  // Fetch batches for a specific product
  const fetchProductBatches = async (productId: string) => {
    // Check if already loading or already has batches
    if (loadingBatches[productId] || productBatches[productId]?.length > 0) {
      return;
    }
    
    // If we've already fetched and got no batches, don't fetch again
    if (fetchedProducts.has(productId) && (!productBatches[productId] || productBatches[productId].length === 0)) {
      return;
    }
    
    // CRITICAL: Don't fetch batches for products with 0 stock
    const product = products.find(p => p.id === productId);
    if (product && product.stock === 0) {
      // Mark as fetched immediately with empty batches to prevent repeated checks
      setProductBatches(prev => ({ ...prev, [productId]: [] }));
      setFetchedProducts(prev => {
        const newSet = new Set(prev);
        newSet.add(productId);
        return newSet;
      });
      return;
    }

    try {
      setLoadingBatches(prev => ({ ...prev, [productId]: true }));

      const queryParams: any = {
        productId: productId,
        limit: 100,
        expired: false,
        isReported: false
      };

      if (saleBranchId) {
        queryParams.branchId = saleBranchId;
      }

      const response = await apiService.getInventoryByBatches(queryParams);

      if (response.success && response.data) {
        const batchesData = Array.isArray(response.data) ? response.data : [];
        const batches: Batch[] = batchesData
          .map((batch: any) => {
          const totalBoxes = batch.totalBoxes || 0;
          const quantity = batch.quantity || 0;
          const computedUnitsPerBox = totalBoxes > 0 && quantity > 0
            ? Math.round(quantity / totalBoxes)
            : 0;
            
            // Check if batch is expired
            const expireDate = batch.expireDate ? new Date(batch.expireDate) : null;
            const isExpired = expireDate && expireDate < new Date();
            const expiryStatus = batch.expiryStatus || (isExpired ? 'EXPIRED' : 'GOOD');
            const daysUntilExpiry = batch.daysUntilExpiry !== undefined 
              ? batch.daysUntilExpiry 
              : (expireDate ? Math.ceil((expireDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : undefined);
            
          return {
            id: batch.id,
            batchNo: batch.batchNo || batch.batchNumber || `BATCH-${batch.id}`,
            quantity,
            sellingPrice: batch.sellingPrice || batch.unitPrice || 0,
            unitsPerBox: batch.unitsPerBox ||
              batch.unitsPerPack ||
              (computedUnitsPerBox > 0 ? computedUnitsPerBox : undefined) ||
              batch.product?.unitsPerPack ||
              0,
            totalBoxes: totalBoxes || undefined,
            expireDate: batch.expireDate,
              expiryStatus: expiryStatus,
              daysUntilExpiry: daysUntilExpiry
            };
          })
          // Filter out expired batches
          .filter((batch: Batch) => {
            // Exclude if explicitly marked as EXPIRED
            if (batch.expiryStatus === 'EXPIRED') return false;
            // Exclude if daysUntilExpiry is negative or zero
            if (batch.daysUntilExpiry !== undefined && batch.daysUntilExpiry <= 0) return false;
            // Exclude if expireDate is in the past
            if (batch.expireDate) {
              const expireDate = new Date(batch.expireDate);
              if (expireDate < new Date()) return false;
            }
            return true;
        });
        
        batches.sort((a, b) => {
          const aDate = a.expireDate ? new Date(a.expireDate).getTime() : Number.MAX_SAFE_INTEGER;
          const bDate = b.expireDate ? new Date(b.expireDate).getTime() : Number.MAX_SAFE_INTEGER;
          return aDate - bDate;
        });

        const needsUnitsPerBox = batches.some(b => !b.unitsPerBox || b.unitsPerBox <= 1);
        if (needsUnitsPerBox) {
          const fallbackResponse = await apiService.getBatches({
            page: 1,
            limit: 100,
            productId,
            isActive: true,
            isReported: false,
          });
          if (fallbackResponse.success && fallbackResponse.data?.batches?.length) {
            const fallbackMap = new Map(
              fallbackResponse.data.batches.map((batch: any) => [
                batch.id,
                {
                  unitsPerBox: batch.unitsPerBox || 0,
                  totalBoxes: batch.totalBoxes || 0,
                  stockQuantity: batch.stockQuantity || batch.totalStock || 0,
                }
              ])
            );
            for (const batch of batches) {
              const fallback = fallbackMap.get(batch.id);
              if (fallback) {
                const computedUnits = fallback.totalBoxes > 0 && (fallback.stockQuantity || batch.quantity) > 0
                  ? Math.round((fallback.stockQuantity || batch.quantity) / fallback.totalBoxes)
                  : 0;
                const resolvedUnitsPerBox = fallback.unitsPerBox || computedUnits || batch.unitsPerBox || 0;
                if (resolvedUnitsPerBox > 1) {
                  batch.unitsPerBox = resolvedUnitsPerBox;
                  batch.totalBoxes = batch.totalBoxes || fallback.totalBoxes || undefined;
                }
              }
            }
          }
        }

        // Sort batches by expiry date (nearest first)
        batches.sort((a, b) => {
          if (!a.expireDate && !b.expireDate) return 0;
          if (!a.expireDate) return 1;
          if (!b.expireDate) return -1;
          return new Date(a.expireDate).getTime() - new Date(b.expireDate).getTime();
        });

        // Set batches and mark as fetched immediately
        setProductBatches(prev => ({ ...prev, [productId]: batches }));
        setFetchedProducts(prev => {
          const newSet = new Set(prev);
          newSet.add(productId);
          return newSet;
        });

        // Auto-select first available batch
        if (batches.length > 0 && !selectedBatches[productId]) {
          const availableBatch = batches.find(b => b.quantity > 0) || batches[0];
          if (availableBatch) {
            setSelectedBatches(prev => ({ ...prev, [productId]: availableBatch.id }));
          }
        }
      } else {
        // No batches found - set empty array and mark as fetched immediately
        setProductBatches(prev => ({ ...prev, [productId]: [] }));
        setFetchedProducts(prev => {
          const newSet = new Set(prev);
          newSet.add(productId);
          return newSet;
        });
      }
    } catch (error) {
      // On error, set empty batches and mark as fetched immediately
      setProductBatches(prev => ({ ...prev, [productId]: [] }));
      setFetchedProducts(prev => {
        const newSet = new Set(prev);
        newSet.add(productId);
        return newSet;
      });
    } finally {
      // Always clear loading state
      setLoadingBatches(prev => {
        const newState = { ...prev };
        delete newState[productId];
        return newState;
      });
    }
  };

  // Get selected batch for a product
  const getSelectedBatch = (productId: string): Batch | null => {
    const batches = productBatches[productId] || [];
    const selectedBatchId = selectedBatches[productId];
    if (selectedBatchId) {
      return batches.find(b => b.id === selectedBatchId) || null;
    }
    return batches.length > 0 ? batches[0] : null;
  };

  // Calculate total stock from non-expired batches only
  const getTotalStockFromBatches = (productId: string): number => {
    const batches = productBatches[productId] || [];
    return batches.reduce((total, batch) => total + (batch.quantity || 0), 0);
  };

  // Filter products based on search query and exclude products with only expired batches
  // Use useMemo to prevent unnecessary recalculations
  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        product.name.toLowerCase().includes(query) ||
        (product.formula && product.formula.toLowerCase().includes(query)) ||
        (product.barcode && product.barcode.toLowerCase().includes(query));
      const matchesCategory = selectedCategory === "all" || product.category === selectedCategory;
      
      if (!matchesSearch || !matchesCategory) return false;
      
      // CRITICAL FIX: Exclude products that only have expired batches
      const batchesForProduct = productBatches[product.id] || [];
      const hasBeenFetched = fetchedProducts.has(product.id);
      
      if (batchesForProduct.length > 0) {
        // Check if all batches are expired
        const hasNonExpiredBatches = batchesForProduct.some(batch => {
          // Check if batch is expired
          if (batch.expiryStatus === 'EXPIRED') return false;
          if (batch.daysUntilExpiry !== undefined && batch.daysUntilExpiry <= 0) return false;
          if (batch.expireDate) {
            const expireDate = new Date(batch.expireDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            expireDate.setHours(0, 0, 0, 0);
            if (expireDate < today) return false;
          }
          return true;
        });
        
        if (!hasNonExpiredBatches) return false;
        
        // CRITICAL FIX: Exclude products with 0 stock
        const totalStockFromBatches = batchesForProduct.reduce((total, batch) => total + (batch.quantity || 0), 0);
        if (totalStockFromBatches === 0) return false;
        
        return true;
      }
      
      // If batches have been fetched and there are none, exclude the product
      if (hasBeenFetched && batchesForProduct.length === 0) {
        // Also check if product stock is 0
        if (product.stock === 0) return false;
      }
      
      // If batches haven't been fetched yet, include the product (will be filtered later when batches are loaded)
      // But exclude if product stock is already 0
      if (product.stock === 0 && !hasBeenFetched) {
        return false; // Don't show products with 0 stock even if batches haven't been fetched
      }
      
      return true;
    });
  }, [products, searchQuery, selectedCategory, productBatches, fetchedProducts]);

  // Track which product IDs we've already processed to prevent repeated fetching
  const processedProductIds = useRef<Set<string>>(new Set());
  const lastProductIdsString = useRef<string>('');

  // Auto-fetch batches for filtered products (only once per product)
  React.useEffect(() => {
    if (filteredProducts.length === 0) return;

    // Get current product IDs as a sorted string for comparison
    const currentProductIds = filteredProducts.map(p => p.id).sort().join(',');
    
    // Only process if product IDs have actually changed
    if (currentProductIds === lastProductIdsString.current) {
      return; // Product IDs haven't changed, skip
    }

    // Update the reference
    lastProductIdsString.current = currentProductIds;

    // Fetch batches for products that haven't been fetched yet
    filteredProducts.forEach((product) => {
      // Skip if already processed
      if (processedProductIds.current.has(product.id)) {
        return;
      }

      // Only fetch if:
      // 1. Not already loading
      // 2. Not already fetched (even if result was empty)
      // 3. Not already has batches
      if (
        !loadingBatches[product.id] &&
        !fetchedProducts.has(product.id) &&
        (!productBatches[product.id] || productBatches[product.id].length === 0)
      ) {
        // Mark as processed immediately to prevent duplicate fetches
        processedProductIds.current.add(product.id);
        fetchProductBatches(product.id);
      } else {
        // Mark as processed even if we're not fetching (already has batches or fetched)
        processedProductIds.current.add(product.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredProducts.map(p => p.id).sort().join(',')]); // Only re-run when product IDs actually change

  const addToCart = (product: Product, quantity: number, unitType: string) => {
    // Get the selected batch
    const selectedBatch = getSelectedBatch(product.id);

    if (!selectedBatch) {
      toast({
        title: "No Batch Available",
        description: "No available batches found for this product. Please check inventory.",
        variant: "destructive",
      });
      return;
    }

    const unitsPerBox = selectedBatch.unitsPerBox || product.unitsPerPack || 1;
    const normalizedSaleType: 'UNIT' | 'BOX' = unitType.toLowerCase() === 'box' ? 'BOX' : 'UNIT';
    const unitsRequired = normalizedSaleType === 'BOX' ? quantity * unitsPerBox : quantity;

    // Validate quantity against batch stock (unit-level)
    if (unitsRequired > selectedBatch.quantity) {
      toast({
        title: "Insufficient Stock",
        description: `Available stock in batch ${selectedBatch.batchNo}: ${selectedBatch.quantity} units.`,
        variant: "destructive",
      });
      return;
    }

    // Show prescription warning if product requires prescription
    if (product.requiresPrescription) {
      toast({
        title: "âš ï¸ Prescription Required",
        description: `"${product.name}" requires a valid doctor's prescription before sale. Please verify the prescription.`,
        variant: "destructive",
        duration: 5000,
      });
    }

    // Find existing item by productId only (merge same products regardless of saleType/UNIT/BOX)
    const existingItem = cart.find(item =>
      item.productId === product.id
    );

    if (existingItem) {
      // Convert existing item quantity to units for comparison
      const existingUnits = existingItem.saleType === 'BOX'
        ? existingItem.quantity * (existingItem.unitsPerBox || 1)
        : existingItem.quantity;
      
      // Calculate new quantity in units
      const newQuantityInUnits = normalizedSaleType === 'BOX'
        ? quantity * unitsPerBox
        : quantity;
      
      // Total units after merge
      const totalUnits = existingUnits + newQuantityInUnits;
      
      // Check stock from the selected batch
      if (totalUnits > selectedBatch.quantity) {
        toast({
          title: "Insufficient Stock",
          description: `Available stock in batch ${selectedBatch.batchNo}: ${selectedBatch.quantity} units.`,
          variant: "destructive",
        });
        return;
      }
      
      // Calculate new unit price
      const batchPrice = selectedBatch.sellingPrice || product.price;
      const newUnitPrice = normalizedSaleType === 'BOX'
        ? batchPrice * unitsPerBox
        : batchPrice;
      
      // Calculate total price: existing total + new total
      const existingTotalPrice = existingItem.totalPrice;
      const newTotalPrice = newUnitPrice * quantity;
      const totalPrice = existingTotalPrice + newTotalPrice;
      
      // Calculate average unit price
      const averageUnitPrice = totalPrice / totalUnits;
      
      // Update existing item - always use UNIT format for merged items
      setCart(cart.map(item =>
        item.id === existingItem.id ? {
          ...item,
          quantity: totalUnits,
          saleType: 'UNIT' as const,
          unitType: 'UNIT',
          unitsDeducted: totalUnits,
          unitPrice: averageUnitPrice,
          totalPrice: totalPrice,
          // Update batch info to latest batch
          batchId: selectedBatch.id,
          batch: selectedBatch.batchNo,
          expiry: selectedBatch.expireDate
            ? new Date(selectedBatch.expireDate).toLocaleDateString()
            : "N/A"
        } : item
      ));
    } else {
      const batchPrice = selectedBatch.sellingPrice || product.price;
      const expiryDate = selectedBatch.expireDate
        ? new Date(selectedBatch.expireDate).toLocaleDateString()
        : "N/A";

      const unitPrice = normalizedSaleType === 'BOX'
        ? batchPrice * unitsPerBox
        : batchPrice;
      const totalPrice = unitPrice * quantity;

      setCart([...cart, {
        id: `${product.id}-${unitType}-${selectedBatch.id}-${Date.now()}`,
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: quantity,
        unitType: normalizedSaleType === 'BOX' ? 'BOX' : 'UNIT',
        saleType: normalizedSaleType,
        unitsPerBox: unitsPerBox,
        unitsDeducted: unitsRequired,
        availableUnits: selectedBatch.quantity,
        unitPrice: unitPrice,
        totalPrice: totalPrice,
        batchId: selectedBatch.id,
        batch: selectedBatch.batchNo,
        expiry: expiryDate,
        instructions: normalizedSaleType === 'BOX'
          ? `Take ${quantity} box(es) as directed`
          : `Take ${quantity} unit(s) as directed`
      }]);
    }
  };

  const updateQuantity = (id: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      setCart(cart.filter(item => item.id !== id));
    } else {
      const currentItem = cart.find(item => item.id === id);
      if (!currentItem) return;
      const unitsRequired = currentItem.saleType === 'BOX'
        ? newQuantity * (currentItem.unitsPerBox || 1)
        : newQuantity;
      if (currentItem.availableUnits !== undefined && unitsRequired > currentItem.availableUnits) {
        toast({
          title: "Insufficient Stock",
          description: `Available stock in batch ${currentItem.batch}: ${currentItem.availableUnits} units.`,
          variant: "destructive",
        });
        return;
      }
      setCart(cart.map(item =>
        item.id === id ? {
          ...item,
          quantity: newQuantity,
          unitsDeducted: item.saleType === 'BOX'
            ? newQuantity * (item.unitsPerBox || 1)
            : newQuantity,
          totalPrice: item.unitPrice * newQuantity
        } : item
      ));
    }
  };

  const subtotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  // Calculate discount based on percentage
  const calculatedDiscountAmount = (subtotal * discountPercentage) / 100;
  const subtotalAfterDiscount = subtotal - calculatedDiscountAmount;

  // Calculate total without tax
  const total = subtotalAfterDiscount;

  // Debug log for totals

  const paymentMethods = [
    { id: 'cash', label: 'Cash', icon: Banknote },
    { id: 'card', label: 'Card', icon: CreditCard },
    { id: 'mobile', label: 'Mobile', icon: Smartphone },
    { id: 'gift_card', label: 'Gift Card', icon: CreditCard }
  ];

  // Debug: Log products state (commented out to prevent repeated logging)
  // console.log('ðŸ”„ Current products state:', products);
  // console.log('ðŸ”„ Filtered products:', filteredProducts);

  const filteredInvoiceProducts = products.filter(product => {
    const query = invoiceSearchQuery.toLowerCase();
    const matchesSearch =
      product.name.toLowerCase().includes(query) ||
      (product.formula && product.formula.toLowerCase().includes(query)) ||
      (product.barcode && product.barcode.toLowerCase().includes(query));
    return matchesSearch;
  });

  // Barcode scanning functionality
  const handleBarcodeScan = async () => {
    // Check if browser supports camera access
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        setIsScanning(true);
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        stream.getTracks().forEach(track => track.stop());
        // Camera works â€” open the manual entry dialog as the in-app fallback
      } catch (error) {
        toast({
          title: "Camera Not Available",
          description: "Camera could not be opened. You can enter the barcode manually.",
          variant: "destructive",
        });
      } finally {
        setIsScanning(false);
      }
    } else {
      toast({
        title: "Camera Not Supported",
        description: "Camera access not supported in this browser. You can enter the barcode manually.",
        variant: "destructive",
      });
    }
    setManualBarcode("");
    setIsBarcodeDialogOpen(true);
  };

  const handleManualBarcodeSubmit = async () => {
    const barcode = manualBarcode.trim();
    if (!barcode) return;
    setScannedBarcode(barcode);
    setIsBarcodeDialogOpen(false);
    await searchProductByBarcode(barcode);
  };

  const searchProductByBarcode = async (barcode: string) => {
    const product = products.find(p => p.barcode === barcode);
    if (product) {
      // Auto-add to cart
      addToCart(product, 1, "unit");
      setSearchQuery(product.name); // Update search to show the found product
    } else {
      toast({
        title: "Product Not Found",
        description: `Product with barcode ${barcode} not found`,
        variant: "destructive",
      });
    }
  };

  // Handle barcode lookup on Enter key in search input
  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>, value: string) => {
    // Enter key = submit barcode scan
    if (e.key === 'Enter') {
      e.preventDefault();
      const barcode = value.trim();

      if (!barcode) return;

      // Check if it looks like a barcode (mostly digits, or starts with letters)
      const isBarcodeLike = /^\d{8,14}$/.test(barcode) || /^[A-Z]{2,4}\d{4,}$/i.test(barcode);

      if (isBarcodeLike || barcode.length > 6) {
        // Barcode-like input - do API lookup and auto-add to cart
        try {
          const response = await apiService.lookupBarcode(barcode);
          if (response.success && response.data?.product) {
            const p = response.data.product;
            // Convert to POS Product type and add to cart
            const product: Product = {
              id: p.id,
              name: p.name,
              price: p.sellingPrice || p.mrp || 0,
              costPrice: p.costPrice || 0,
              mrp: p.mrp || 0,
              stock: p.totalStock || p.stock || 0,
              unitType: p.unitType || 'strip',
              category: p.category?.name || 'General',
              requiresPrescription: p.requiresPrescription || false,
              barcode: p.barcode || barcode,
              formula: p.formula || '',
              unitsPerPack: p.unitsPerPack || 1,
              unitsPerBox: p.unitsPerBox || 1,
            };
            addToCart(product, 1, 'unit');
            setSearchQuery('');
            toast({ title: 'Product found', description: `${p.name} added to cart` });
          } else {
            toast({ title: 'Unknown Barcode', description: `No product found for barcode: ${barcode}`, variant: 'destructive' });
          }
        } catch {
          toast({ title: 'Lookup failed', description: `Could not find product for barcode: ${barcode}`, variant: 'destructive' });
        }
      }
      // If not barcode-like, let normal text search continue
    }
  };

  // Sample promotions data
  const availablePromotions: Promotion[] = [
    {
      id: "1",
      code: "WELCOME10",
      name: "Welcome Discount",
      type: "percentage",
      value: 10,
      minAmount: 1000,
      maxDiscount: 500,
      validUntil: "2024-12-31",
      isActive: true
    },
    {
      id: "2",
      code: "SAVE50",
      name: "Fixed Discount",
      type: "fixed",
      value: 50,
      minAmount: 200,
      validUntil: "2024-12-31",
      isActive: true
    },
    {
      id: "3",
      code: "VIP20",
      name: "VIP Customer Discount",
      type: "percentage",
      value: 20,
      minAmount: 500,
      maxDiscount: 1000,
      validUntil: "2024-12-31",
      isActive: true
    }
  ];

  const applyPromotion = () => {
    if (!promoCode.trim()) {
      toast({
        title: "Promotion Code Required",
        description: "Please enter a promotion code",
        variant: "destructive",
      });
      return;
    }

    const promotion = availablePromotions.find(p =>
      p.code.toLowerCase() === promoCode.toLowerCase() && p.isActive
    );

    if (!promotion) {
      toast({
        title: "Invalid Promotion",
        description: "Invalid or expired promotion code",
        variant: "destructive",
      });
      return;
    }

    // Check if promotion is already applied
    if (appliedPromotions.find(p => p.id === promotion.id)) {
      toast({
        title: "Promotion Already Applied",
        description: "This promotion has already been applied",
        variant: "destructive",
      });
      return;
    }

    // Check minimum amount requirement
    if (promotion.minAmount && subtotal < promotion.minAmount) {
      toast({
        title: "Minimum Amount Required",
        description: `Minimum purchase amount of PKR ${promotion.minAmount} required for this promotion`,
        variant: "destructive",
      });
      return;
    }

    // Check validity
    if (promotion.validUntil && new Date(promotion.validUntil) < new Date()) {
      toast({
        title: "Promotion Expired",
        description: "This promotion has expired",
        variant: "destructive",
      });
      return;
    }

    // Calculate discount
    let discount = 0;
    if (promotion.type === 'percentage') {
      discount = (subtotal * promotion.value) / 100;
      if (promotion.maxDiscount) {
        discount = Math.min(discount, promotion.maxDiscount);
      }
    } else {
      discount = promotion.value;
    }

    // Apply discount
    setAppliedPromotions([...appliedPromotions, promotion]);
    setDiscountAmount(discountAmount + discount);
    setPromoCode("");
    toast({
      title: "Promotion Applied",
      description: `Promotion "${promotion.name}" applied! Discount: PKR ${discount.toFixed(2)}`,
      variant: "success",
    });
  };

  const removePromotion = (promotionId: string) => {
    const promotion = appliedPromotions.find(p => p.id === promotionId);
    if (promotion) {
      let discount = 0;
      if (promotion.type === 'percentage') {
        discount = (subtotal * promotion.value) / 100;
        if (promotion.maxDiscount) {
          discount = Math.min(discount, promotion.maxDiscount);
        }
      } else {
        discount = promotion.value;
      }

      setAppliedPromotions(appliedPromotions.filter(p => p.id !== promotionId));
      setDiscountAmount(Math.max(0, discountAmount - discount));
    }
  };

  // Split payment functionality
  const addSplitPayment = (method: 'cash' | 'card' | 'mobile' | 'gift_card', amount: number, reference?: string) => {
    const newPayment: SplitPayment = {
      id: String(Date.now()),
      method,
      amount,
      reference
    };
    setSplitPayments([...splitPayments, newPayment]);
  };

  const removeSplitPayment = (paymentId: string) => {
    setSplitPayments(splitPayments.filter(p => p.id !== paymentId));
  };

  const getTotalSplitAmount = () => {
    return splitPayments.reduce((sum, payment) => sum + payment.amount, 0);
  };

  const getRemainingAmount = () => {
    return total - getTotalSplitAmount();
  };

  const isSplitPaymentComplete = () => {
    return Math.abs(getRemainingAmount()) < 0.01; // Allow for small floating point differences
  };

  const handleCashPayment = () => {
    const cash = parseFloat(cashAmount);
    if (cash >= total) {
      setChangeAmount(cash - total);
      setPaymentStatus('completed');
    } else {
      toast({
        title: "Invalid Amount",
        description: "Cash amount must be greater than or equal to total amount!",
        variant: "destructive",
      });
    }
  };

  const handleCardPayment = () => {
    setPaymentStatus('processing');
    // Simulate card payment processing
    setTimeout(() => {
      setPaymentStatus('completed');
    }, 2000);
  };

  const handleMobilePayment = () => {
    setPaymentStatus('processing');
    // Simulate mobile payment processing
    setTimeout(() => {
      setPaymentStatus('completed');
    }, 2000);
  };

  const processPayment = () => {
    if (selectedPayment === 'cash') {
      handleCashPayment();
    } else if (selectedPayment === 'card') {
      handleCardPayment();
    } else if (selectedPayment === 'mobile') {
      handleMobilePayment();
    }
  };

  const generateReceipt = async () => {
    try {
      setIsProcessingPayment(true);

      // First, create customer if selected and not already in database
      let customerId = null;
      if (selectedCustomer && !selectedCustomer.id.startsWith('temp_')) {
        // Customer is already in database
        customerId = selectedCustomer.id;
      } else if (selectedCustomer && selectedCustomer.id.startsWith('temp_')) {
        // Create new customer in database
        try {
          const customerResponse = await apiService.createCustomer({
            name: selectedCustomer.name,
            phone: selectedCustomer.phone,
            email: selectedCustomer.email || "",
            address: selectedCustomer.address || "",
            branchId: user?.role === 'OWNER'
              ? (saleBranchId || selectedBranchId || user?.branchId || "")
              : (user?.branchId || "")
          });

          if (customerResponse.success) {
            customerId = customerResponse.data.id;
          } else {
          }
        } catch (error) {
        }
      }

      // Prepare sale data for API
      const saleData = {
        customerId: customerId,
        branchId: saleBranchId || selectedBranchId || user?.branchId || "",
        items: cart.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          saleType: item.saleType,
          unitsDeducted: item.unitsDeducted,
          unitsPerBox: item.unitsPerBox,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          batchId: item.batchId || null,
          batchNumber: item.batch || "",
          expiryDate: item.expiry || ""
        })),
        paymentMethod: selectedPayment.toUpperCase() as 'CASH' | 'CARD' | 'MOBILE' | 'BANK_TRANSFER',
        discountAmount: calculatedDiscountAmount,
        discountPercentage: discountPercentage,
        saleDate: useManualDate && manualDate ? manualDate : undefined
      };
      // Create sale via API (this will reduce stock in database)
      const saleResponse = await apiService.createSale(saleData);

      if (!saleResponse.success) {
        toast({
          title: "Error",
          description: saleResponse.message || "Failed to create sale. Please try again.",
          variant: "destructive",
        });
        return;
      }

      const sale = saleResponse.data;
      // Create receipt for display using the actual sale data from API
      const now = new Date();

      // Create customer object if needed
      let customer: Customer | null = sale.customer;
      if (!customer && selectedCustomer) {
        customer = {
          id: selectedCustomer.id,
          name: selectedCustomer.name,
          phone: selectedCustomer.phone,
          email: selectedCustomer.email || "",
          address: selectedCustomer.address,
          totalPurchases: selectedCustomer.totalPurchases,
          lastVisit: selectedCustomer.lastVisit,
          loyaltyPoints: selectedCustomer.loyaltyPoints,
          isVIP: selectedCustomer.isVIP
        };
      }

      // Use manual date if provided, otherwise use current date
      const receiptDate = useManualDate && manualDate ? new Date(manualDate) : now;

      const receipt: Receipt = {
        id: sale.id,
        customer: customer,
        items: sale.items.map((item: any) => ({
          id: item.product.id,
          productId: item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          saleType: item.saleType || 'UNIT',
          unitsDeducted: item.unitsDeducted || item.quantity,
          unitsPerBox: item.unitsPerBox,
          unitPrice: item.unitPrice,
          price: item.unitPrice, // Add required price field
          totalPrice: item.totalPrice,
          unitType: item.saleType === 'BOX' ? 'BOX' : 'UNIT',
          batchId: item.batchId || undefined,
          batch: item.batchNumber || "",
          expiry: item.expiryDate ? new Date(item.expiryDate).toISOString().split('T')[0] : ""
        })),
        subtotal: sale.subtotal,
        discountPercentage: discountPercentage || 0,
        discountAmount: calculatedDiscountAmount || 0,
        total: sale.totalAmount,
        paymentMethod: sale.paymentMethod.toLowerCase() as 'cash' | 'card' | 'mobile',
        paymentStatus: sale.paymentStatus === 'COMPLETED' ? 'Paid' : 'Pending',
        date: receiptDate.toLocaleDateString(),
        time: receiptDate.toLocaleTimeString(),
        cashier: user?.name || "Cashier",
        receiptNumber: sale.receiptNumber
      };

      setCurrentReceipt(receipt);
      setIsReceiptDialogOpen(true);

      // Reset cart and form
      setCart([]);
      setSelectedCustomer(null);
      setCashAmount("");
      setChangeAmount(0);
      setPaymentStatus('pending');
      setDiscountPercentage(0);
      setManualDate("");
      setUseManualDate(false);

      toast({
        title: "Success",
        description: "Sale completed successfully! Receipt generated.",
      });

    } catch (error) {
      toast({
        title: "Error",
        description: "Error creating sale. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const addNewCustomer = () => {
    if (!newCustomer.name || !newCustomer.phone) {
      toast({
        title: "Missing Information",
        description: "Please enter customer name and phone number!",
        variant: "destructive",
      });
      return;
    }

    const customer: Customer = {
      id: `temp_${Date.now()}`, // Mark as temporary customer
      name: newCustomer.name,
      phone: newCustomer.phone,
      email: newCustomer.email || "",
      address: newCustomer.address || "",
      totalPurchases: 0,
      lastVisit: new Date().toISOString().split('T')[0],
      loyaltyPoints: 0,
      isVIP: false
    };

    // Add to customers list
    customers.push(customer);

    // Set as selected customer
    setSelectedCustomer(customer);

    // Reset form and close dialog
    setNewCustomer({
      name: "",
      phone: "",
      email: "",
      address: ""
    });
    setIsNewCustomerDialogOpen(false);
  };

  const addToInvoiceCart = (product: Product, quantity: number, unitType: string) => {
    // Validate quantity
    if (quantity <= 0) {
      toast({
        title: "Invalid Quantity",
        description: "Quantity must be greater than 0",
        variant: "destructive",
      });
      return;
    }

    if (quantity > 1000) {
      toast({
        title: "Invalid Quantity",
        description: "Quantity cannot exceed 1000 units. Please enter a smaller quantity.",
        variant: "destructive",
      });
      return;
    }

    const selectedBatch = getSelectedBatch(product.id);
    if (!selectedBatch) {
      toast({
        title: "Batch Selection Required",
        description: "Please select a batch first.",
        variant: "destructive",
      });
      return;
    }

    const unitsPerBox = selectedBatch.unitsPerBox || product.unitsPerPack || 1;
    const normalizedSaleType: 'UNIT' | 'BOX' = unitType.toLowerCase() === 'box' ? 'BOX' : 'UNIT';
    const unitsRequired = normalizedSaleType === 'BOX' ? quantity * unitsPerBox : quantity;

    if (unitsRequired > selectedBatch.quantity) {
      toast({
        title: "Insufficient Stock",
        description: `Insufficient stock in batch ${selectedBatch.batchNo}! Available: ${selectedBatch.quantity} units, Required: ${unitsRequired}`,
        variant: "destructive",
      });
      return;
    }

    const existingItem = invoiceItems.find(item =>
      item.productId === product.id &&
      item.saleType === normalizedSaleType &&
      item.batchId === selectedBatch.id
    );

    if (existingItem) {
      updateInvoiceQuantity(existingItem.id, existingItem.quantity + quantity);
    } else {
      const unitPrice = normalizedSaleType === 'BOX'
        ? (selectedBatch.sellingPrice || product.price) * unitsPerBox
        : (selectedBatch.sellingPrice || product.price);
      const totalPrice = unitPrice * quantity;
      const expiryDate = selectedBatch.expireDate || null;
      
      // Format expiry date if available
      let formattedExpiry = "N/A";
      if (expiryDate) {
        try {
          const expiry = new Date(expiryDate);
          if (!isNaN(expiry.getTime())) {
            formattedExpiry = expiry.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          }
        } catch (e) {
          formattedExpiry = expiryDate.toString();
        }
      }

      const newItem = {
        id: `${product.id}-${unitType}-${selectedBatch.id}-${Date.now()}`,
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: quantity,
        unitType: normalizedSaleType === 'BOX' ? 'BOX' : 'UNIT',
        saleType: normalizedSaleType,
        unitsPerBox: unitsPerBox,
        unitsDeducted: unitsRequired,
        availableUnits: selectedBatch.quantity,
        unitPrice: unitPrice,
        totalPrice: totalPrice,
        batchId: selectedBatch.id,
        batch: selectedBatch.batchNo,
        expiry: formattedExpiry,
        instructions: normalizedSaleType === 'BOX'
          ? `Take ${quantity} box(es) as directed`
          : `Take ${quantity} unit(s) as directed`
      };
      setInvoiceItems([...invoiceItems, newItem]);
    }
  };

  const updateInvoiceQuantity = (id: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      setInvoiceItems(invoiceItems.filter(item => item.id !== id));
    } else {
      // Validate quantity
      if (newQuantity > 1000) {
        toast({
          title: "Invalid Quantity",
          description: "Quantity cannot exceed 1000 units. Please enter a smaller quantity.",
          variant: "destructive",
        });
        return;
      }

      const item = invoiceItems.find(item => item.id === id);
      if (item) {
        const unitsRequired = item.saleType === 'BOX'
          ? newQuantity * (item.unitsPerBox || 1)
          : newQuantity;
        if (item.availableUnits !== undefined && unitsRequired > item.availableUnits) {
          toast({
            title: "Insufficient Stock",
            description: `Insufficient stock in batch ${item.batch}! Available: ${item.availableUnits} units, Required: ${unitsRequired}`,
            variant: "destructive",
          });
          return;
        }
      }

      setInvoiceItems(invoiceItems.map(item =>
        item.id === id ? {
          ...item,
          quantity: newQuantity,
          unitsDeducted: item.saleType === 'BOX'
            ? newQuantity * (item.unitsPerBox || 1)
            : newQuantity,
          totalPrice: item.unitPrice * newQuantity
        } : item
      ));
    }
  };


  const createInvoice = async () => {
    if (invoiceItems.length === 0) {
      toast({
        title: "Empty Invoice",
        description: "Please add at least one item to the invoice!",
        variant: "destructive",
      });
      return;
    }

    // Check if owner has selected a branch
    if (user?.role === 'OWNER' && !saleBranchId && !selectedBranchId) {
      toast({
        title: "Branch Selection Required",
        description: "Please select a branch before creating an invoice.",
        variant: "destructive",
      });
      return;
    }

    // Validate all items before creating invoice
    for (const item of invoiceItems) {
      const originalProduct = products.find(p => p.id === item.id);
      if (originalProduct && item.quantity > originalProduct.stock) {
        toast({
          title: "Insufficient Stock",
          description: `Insufficient stock for ${item.name}! Available: ${originalProduct.stock}, Required: ${item.quantity}`,
          variant: "destructive",
        });
        return;
      }
    }

    try {
      // Always create or find customer for every purchase
      let customerId = null;
      let customerName = "Walk-in Customer";
      let customerPhone = "";

      // Use provided customer details or create a walk-in customer
      if (invoiceCustomer.name && invoiceCustomer.phone) {
        customerName = invoiceCustomer.name;
        customerPhone = invoiceCustomer.phone;
      } else if (invoiceCustomer.phone) {
        customerName = `Customer-${invoiceCustomer.phone}`;
        customerPhone = invoiceCustomer.phone;
      } else {
        // Generate a unique walk-in customer identifier
        const timestamp = Date.now();
        customerName = `Walk-in-${timestamp}`;
        customerPhone = `000-${timestamp}`;
      }

      // Get branch ID - convert empty string to null/undefined
      const customerBranchId = user?.role === 'OWNER'
        ? (saleBranchId || selectedBranchId || user?.membership?.branchIds?.[0] || user?.branchId || null)
        : (user?.membership?.branchIds?.[0] || user?.branchId || null);

      try {
        const customerResponse = await apiService.createCustomer({
          name: customerName,
          phone: customerPhone,
          email: invoiceCustomer.email || "",
          address: invoiceCustomer.address || "",
          branchId: user?.membership?.branchIds?.[0] || user?.branchId || undefined // Send undefined instead of empty string
        });

        if (customerResponse.success) {
          customerId = customerResponse.data.id;
          // Dispatch event to refresh customer list
          window.dispatchEvent(new CustomEvent('customerCreated', {
            detail: customerResponse.data
          }));

          // Show success message for new customers
          if (customerResponse.message !== 'Customer already exists') {
          }
        } else {
          // Continue with sale even if customer creation fails
        }
      } catch (error) {
        // Continue with sale even if customer creation fails
      }

      // Prepare sale data for API
      const invoiceSubtotal = invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
      const invoiceDiscountAmount = (invoiceSubtotal * discountPercentage) / 100;

      const targetBranchId = user?.role === 'OWNER'
        ? (saleBranchId || selectedBranchId || user?.membership?.branchIds?.[0] || user?.branchId || null)
        : (user?.membership?.branchIds?.[0] || user?.branchId || null);

      if (!targetBranchId) {
        toast({
          title: "Branch Required",
          description: "Please select a branch before creating an invoice.",
          variant: "destructive",
        });
        return;
      }

      const saleData = {
        customerId: customerId,
        branchId: targetBranchId,
        items: invoiceItems.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          saleType: item.saleType,
          unitsDeducted: item.unitsDeducted,
          unitsPerBox: item.unitsPerBox,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          // CRITICAL FIX: Include batchId if available, otherwise use batchNumber
          batchId: item.batchId || undefined,
          batchNumber: item.batch || item.batchNumber || undefined,
          expiryDate: item.expiry || null
        })),
        paymentMethod: 'CASH' as const,
        discountAmount: invoiceDiscountAmount,
        discountPercentage: discountPercentage,
        saleDate: useManualDate && manualDate ? manualDate : undefined
      };
      // Create sale via API (this will reduce stock in database)
      const saleResponse = await apiService.createSale(saleData);

      if (!saleResponse.success) {
        toast({
          title: "Failed to Create Invoice",
          description: saleResponse.message || "Failed to create invoice. Please try again.",
          variant: "destructive",
        });
        return;
      }

      const sale = saleResponse.data;
      // Dispatch sale change event to notify inventory system
      window.dispatchEvent(new CustomEvent('saleChanged', {
        detail: {
          action: 'created',
          sale: sale
        }
      }));

      // Create receipt for display
      // Use manual date if provided, otherwise use current date
      const invoiceReceiptDate = useManualDate && manualDate ? new Date(manualDate) : new Date();

      const receipt: Receipt = {
        id: sale.id,
        customer: {
          id: customerId || "",
          name: customerName,
          phone: customerPhone,
          email: invoiceCustomer.email || "",
          address: invoiceCustomer.address || "",
          totalPurchases: sale.totalAmount,
          loyaltyPoints: Math.floor(sale.totalAmount / 100),
          isVIP: false,
          lastVisit: new Date().toISOString().split('T')[0]
        },
        items: invoiceItems,
        subtotal: sale.subtotal,
        discountPercentage: discountPercentage || 0,
        discountAmount: invoiceDiscountAmount || 0,
        total: sale.totalAmount,
        paymentMethod: 'cash',
        paymentStatus: 'Paid',
        date: invoiceReceiptDate.toLocaleDateString(),
        time: invoiceReceiptDate.toLocaleTimeString(),
        cashier: user?.name || "Cashier",
        receiptNumber: sale.receiptNumber
      };

      // Invoice caching disabled

      setCurrentReceipt(receipt);
      setIsReceiptDialogOpen(true);
      setIsInvoiceDialogOpen(false);

      // Reset invoice form
      setInvoiceCustomer({
        name: "",
        phone: "",
        email: "",
        address: ""
      });
      setInvoiceItems([]);
      setInvoiceSearchQuery("");
      setDiscountPercentage(0);
      setManualDate("");
      setUseManualDate(false);
      setAppliedPromotions([]);
      setPromoCode("");
      setDiscountAmount(0);

      // Reload products to update stock (this will show the reduced quantities)
      await loadProducts();

      // Notify other components about new invoice
      window.dispatchEvent(new CustomEvent('invoiceCreated', {
        detail: { invoice: sale }
      }));

      toast({
        title: "Invoice Created Successfully",
        description: `Invoice Number: ${sale.id}\nReceipt Number: ${sale.receiptNumber}\nTotal Amount: PKR ${sale.totalAmount.toFixed(2)}`,
        variant: "success",
      });

    } catch (error) {
      toast({
        title: "Error Creating Invoice",
        description: "Error creating invoice. Please try again.",
        variant: "destructive",
      });
    }
  };

  const printReceipt = () => {
    if (!currentReceipt) return;

    // Generate receipt HTML content
    const receiptHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Receipt - ${currentReceipt.receiptNumber}</title>
          <style>
          * { box-sizing: border-box; }
            body {
              font-family: 'Courier New', monospace;
              font-size: 12px;
              line-height: 1.4;
              margin: 0;
              padding: 20px;
              background: white;
              color: black;
            width: 300px;
            }
            .receipt {
              max-width: 300px;
              margin: 0 auto;
            }
            .header {
              text-align: center;
              border-bottom: 2px solid #000;
              padding-bottom: 10px;
              margin-bottom: 15px;
            }
            .header h1 {
            font-size: 16px;
              margin: 0;
              font-weight: bold;
            }
            .header p {
              font-size: 10px;
              margin: 5px 0;
            }
            .receipt-info {
              display: flex;
              justify-content: space-between;
              font-size: 10px;
              margin-bottom: 15px;
            }
            .customer-info {
              border: 1px solid #000;
              padding: 8px;
              margin-bottom: 15px;
              font-size: 10px;
            }
            .customer-info h3 {
              margin: 0 0 5px 0;
              font-size: 11px;
              font-weight: bold;
            }
            .items {
              margin-bottom: 15px;
            }
            .item {
              display: flex;
              justify-content: space-between;
              padding: 3px 0;
              border-bottom: 1px dotted #ccc;
            }
            .item-name {
              flex: 1;
              font-weight: bold;
            font-size: 11px;
            }
            .item-details {
              font-size: 9px;
              color: #666;
            }
            .item-price {
              font-weight: bold;
            font-size: 11px;
            }
            .totals {
              border-top: 2px solid #000;
              padding-top: 10px;
              margin-top: 15px;
            }
            .total-line {
              display: flex;
              justify-content: space-between;
              padding: 2px 0;
            font-size: 11px;
            }
            .total-final {
              font-weight: bold;
              font-size: 14px;
              border-top: 1px solid #000;
              padding-top: 5px;
              margin-top: 5px;
            }
            .payment-info {
              border: 1px solid #000;
              padding: 8px;
              margin: 15px 0;
              font-size: 10px;
            }
            .footer {
              text-align: center;
              font-size: 9px;
              margin-top: 20px;
              border-top: 1px solid #000;
              padding-top: 10px;
            }
            @media print {
            body { margin: 0; padding: 10px; width: 100%; }
              .receipt { max-width: none; }
            @page { size: 80mm auto; margin: 0; }
            }
          </style>
        </head>
        <body>
          <div class="receipt">
            <div class="header">
            <h1>Zapeera</h1>
              <p>Your Health, Our Priority</p>
            </div>

            <div class="receipt-info">
              <div>
                <strong>Receipt:</strong> ${currentReceipt.receiptNumber}<br>
                <strong>Date:</strong> ${currentReceipt.date}
              </div>
              <div>
                <strong>Time:</strong> ${currentReceipt.time}<br>
                <strong>Cashier:</strong> ${currentReceipt.cashier}
              </div>
            </div>

            ${currentReceipt.customer ? `
            <div class="customer-info">
              <h3>Customer Information</h3>
              <strong>Name:</strong> ${currentReceipt.customer.name}<br>
              <strong>Phone:</strong> ${currentReceipt.customer.phone}<br>
              ${currentReceipt.customer.email ? `<strong>Email:</strong> ${currentReceipt.customer.email}<br>` : ''}
              ${currentReceipt.customer.address ? `<strong>Address:</strong> ${currentReceipt.customer.address}` : ''}
            </div>
            ` : ''}

            <div class="items">
              <h3>Items Purchased:</h3>
              ${currentReceipt.items.map(item => `
                <div class="item">
                  <div>
                    <div class="item-name">${item.name}</div>
                    <div class="item-details">${item.quantity} ${item.unitType} Ã— PKR ${item.unitPrice.toFixed(2)}</div>
                    ${item.instructions ? `<div class="item-details">${item.instructions}</div>` : ''}
                  </div>
                  <div class="item-price">PKR ${item.totalPrice.toFixed(2)}</div>
                </div>
              `).join('')}
            </div>

            <div class="totals">
              <div class="total-line">
                <span>Subtotal:</span>
                <span>PKR ${currentReceipt.subtotal.toFixed(2)}</span>
              </div>
              ${currentReceipt.discountPercentage && currentReceipt.discountPercentage > 0 ? `
              <div class="total-line" style="color: #16a34a;">
                <span>Discount (${currentReceipt.discountPercentage}%):</span>
                <span>-PKR ${currentReceipt.discountAmount?.toFixed(2) || '0.00'}</span>
              </div>
              ` : ''}
              <div class="total-line total-final">
                <span>TOTAL:</span>
                <span>PKR ${currentReceipt.total.toFixed(2)}</span>
              </div>
            </div>

            <div class="payment-info">
              <strong>Payment Method:</strong> ${currentReceipt.paymentMethod.toUpperCase()}<br>
              <strong>Status:</strong> ${currentReceipt.paymentStatus}
              ${selectedPayment === 'cash' && changeAmount > 0 ? `
                <br><strong>Cash Received:</strong> PKR ${parseFloat(cashAmount).toFixed(2)}
                <br><strong>Change:</strong> PKR ${changeAmount.toFixed(2)}
              ` : ''}
            </div>

            <div class="footer">
            <p>Thank you for choosing Zapeera!</p>
              <p>Please keep this receipt for your records</p>
              <p><strong>Important:</strong> Follow dosage instructions carefully.<br>
              Consult your doctor if you have any questions.</p>
            </div>
          </div>
        </body>
        </html>
    `;

    // Create a hidden iframe for printing (works in Electron)
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = 'none';
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow?.document;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(receiptHTML);
      frameDoc.close();

      // Wait for content to load, then print
      printFrame.onload = () => {
      setTimeout(() => {
          try {
            printFrame.contentWindow?.focus();
            printFrame.contentWindow?.print();
          } catch (e) {
            // Fallback: Try window.open
            const newWindow = window.open('', '_blank');
            if (newWindow) {
              newWindow.document.write(receiptHTML);
              newWindow.document.close();
              setTimeout(() => {
                newWindow.print();
                newWindow.close();
      }, 500);
    }
          }
          // Clean up iframe after printing
          setTimeout(() => {
            document.body.removeChild(printFrame);
          }, 1000);
        }, 300);
      };
    }
  };

  const downloadReceipt = async () => {
    if (!currentReceipt) return;

    try {
      // Generate HTML content for the receipt
      const receiptHTML = generateReceiptHTML(currentReceipt);
      const filename = `receipt-${currentReceipt.receiptNumber}.html`;

      // Check if running in Electron
      if (window.electronAPI?.saveFile) {
        // Use Electron's save dialog
        const result = await window.electronAPI.saveFile({
          content: receiptHTML,
          filename: filename,
          type: 'html'
        });

        if (result.success) {
          toast({
            title: "Receipt Saved",
            description: `Receipt saved to: ${result.filePath}`,
            variant: "success",
          });
        } else if (!result.canceled) {
          throw new Error(result.error || 'Failed to save file');
        }
      } else {
        // Fallback for browser: Use blob download
      const blob = new Blob([receiptHTML], { type: 'text/html' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
        link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);
      }
    } catch (error) {
      toast({
        title: "Download Error",
        description: "Error downloading receipt. Please try again.",
        variant: "destructive",
      });
    }
  };

  const generateReceiptHTML = (receipt: any) => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt ${receipt.receiptNumber}</title>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            margin: 0;
            padding: 20px;
            background: white;
            color: black;
            max-width: 400px;
            margin: 0 auto;
          }
          .receipt-header {
            text-align: center;
            border-bottom: 2px solid #1C623C;
            padding-bottom: 15px;
            margin-bottom: 20px;
          }
          .receipt-header h1 {
            color: #1C623C;
            margin: 0;
            font-size: 24px;
          }
          .receipt-header p {
            color: #666;
            margin: 5px 0;
            font-size: 14px;
          }
          .receipt-info {
            display: flex;
            justify-content: space-between;
            margin-bottom: 20px;
            font-size: 14px;
          }
          .customer-info {
            margin-bottom: 20px;
            padding: 15px;
            background-color: #f8f9fa;
            border-radius: 8px;
          }
          .customer-info h3 {
            color: #1C623C;
            margin-bottom: 10px;
            font-size: 16px;
          }
          .items {
            margin-bottom: 20px;
          }
          .item {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
          }
          .item-name {
            font-weight: bold;
          }
          .item-details {
            font-size: 12px;
            color: #666;
            margin-top: 2px;
          }
          .totals {
            border-top: 2px solid #1C623C;
            padding-top: 15px;
            margin-top: 20px;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            margin: 5px 0;
          }
          .total-final {
            font-weight: bold;
            font-size: 18px;
            color: #1C623C;
            border-top: 1px solid #ddd;
            padding-top: 10px;
            margin-top: 10px;
          }
          .payment-info {
            margin-top: 20px;
            padding: 15px;
            background-color: #f0f8f0;
            border-radius: 8px;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            font-size: 12px;
            color: #666;
          }
          .important-note {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 10px;
            border-radius: 5px;
            margin-top: 15px;
            font-size: 12px;
          }
          @media print {
            body { margin: 0; padding: 10px; }
          }
        </style>
      </head>
      <body>
        <div class="receipt-header">
          <h1>Zapeera</h1>
          <p>Your Health, Our Priority</p>
        </div>

        <div class="receipt-info">
          <div>
            <strong>Receipt:</strong> ${receipt.receiptNumber}<br>
            <strong>Date:</strong> ${receipt.date}<br>
            <strong>Time:</strong> ${receipt.time}
          </div>
          <div>
            <strong>Cashier:</strong> ${receipt.cashier}
          </div>
        </div>

        ${receipt.customer ? `
        <div class="customer-info">
          <h3>Customer Information</h3>
          <strong>Name:</strong> ${receipt.customer.name}<br>
          <strong>Phone:</strong> ${receipt.customer.phone}<br>
          ${receipt.customer.email ? `<strong>Email:</strong> ${receipt.customer.email}<br>` : ''}
          ${receipt.customer.address ? `<strong>Address:</strong> ${receipt.customer.address}` : ''}
        </div>
        ` : ''}

        <div class="items">
          <h3>Items Purchased</h3>
          ${receipt.items.map(item => `
            <div class="item">
              <div>
                <div class="item-name">${item.name}</div>
                <div class="item-details">
                  ${item.quantity} ${item.unitType} Ã— PKR ${item.unitPrice.toFixed(2)}<br>
                  ${item.instructions ? `Instructions: ${item.instructions}` : ''}
                </div>
              </div>
              <div style="text-align: right;">
                PKR ${item.totalPrice.toFixed(2)}
              </div>
            </div>
          `).join('')}
        </div>

        <div class="totals">
          <div class="total-row">
            <span>Subtotal:</span>
            <span>PKR ${receipt.subtotal.toFixed(2)}</span>
          </div>
          ${receipt.discountPercentage && receipt.discountPercentage > 0 ? `
          <div class="total-row" style="color: #16a34a;">
            <span>Discount (${receipt.discountPercentage}%):</span>
            <span>-PKR ${receipt.discountAmount?.toFixed(2) || '0.00'}</span>
          </div>
          ` : ''}
          <div class="total-row total-final">
            <span>Total:</span>
            <span>PKR ${receipt.total.toFixed(2)}</span>
          </div>
        </div>

        <div class="payment-info">
          <strong>Payment Method:</strong> ${receipt.paymentMethod}<br>
          <strong>Status:</strong> ${receipt.status}
        </div>

        <div class="footer">
          <p>Thank you for choosing Zapeera! Please keep this receipt for your records</p>
          <div class="important-note">
            <strong>Important:</strong> Follow dosage instructions carefully. Consult your doctor if you have any questions.
          </div>
        </div>
      </body>
      </html>
    `;
  };

  const sendSMSReceipt = async () => {
    if (!currentReceipt?.customer?.phone) {
      toast({
        title: "Phone Number Required",
        description: "Customer phone number is required to send SMS receipt",
        variant: "destructive",
      });
      return;
    }

    try {
      // Create a concise SMS message
      const smsMessage = `Zapeera Receipt
Receipt: ${currentReceipt.receiptNumber}
Total: PKR ${currentReceipt.total.toFixed(2)}
Date: ${currentReceipt.date} ${currentReceipt.time}

Items: ${currentReceipt.items.map(item => `${item.name} (${item.quantity} ${item.unitType})`).join(', ')}

Thank you for choosing us!`;

      // In a real implementation, you would call an SMS API service here
      // For now, we'll simulate the SMS sending with a more realistic approach

      // Create a clickable SMS link
      const smsUrl = `sms:${currentReceipt.customer.phone}?body=${encodeURIComponent(smsMessage)}`;

      // Try to open SMS app
      if (navigator.userAgent.match(/iPhone|iPad|iPod/i)) {
        // iOS devices
        window.location.href = smsUrl;
      } else if (navigator.userAgent.match(/Android/i)) {
        // Android devices
        window.location.href = smsUrl;
      } else {
        // Desktop/other devices - show the message for manual sending
        const smsWindow = window.open('', '_blank', 'width=500,height=400');
        if (smsWindow) {
          smsWindow.document.write(`
            <html>
              <head><title>SMS Receipt</title></head>
              <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2>SMS Receipt for ${currentReceipt.customer.phone}</h2>
                <p><strong>To:</strong> ${currentReceipt.customer.phone}</p>
                <p><strong>Message:</strong></p>
                <textarea readonly style="width: 100%; height: 200px; font-family: monospace; padding: 10px; border: 1px solid #ccc;">${smsMessage}</textarea>
                <p><em>Copy the message above and send it via your SMS app.</em></p>
                <button onclick="window.close()" style="padding: 10px 20px; background: #1C623C; color: white; border: none; border-radius: 5px; cursor: pointer;">Close</button>
              </body>
            </html>
          `);
        } else {
          toast({
            title: "SMS Receipt Ready",
            description: `Message prepared for ${currentReceipt.customer.phone}. Copy and send it via your SMS app.`,
          });
        }
      }
    } catch (error) {
      toast({
        title: "SMS Error",
        description: "Error preparing SMS receipt. Please try again.",
        variant: "destructive",
      });
    }
  };

  const sendEmailReceipt = async () => {
    if (!currentReceipt?.customer?.email) {
      toast({
        title: "Email Required",
        description: "Customer email address is required to send email receipt",
        variant: "destructive",
      });
      return;
    }

    try {
      // In a real implementation, you would call an email API service
      const emailSubject = `Receipt from Zapeera - ${currentReceipt.receiptNumber}`;

      const emailBody = `
Dear ${currentReceipt.customer.name},

Thank you for your purchase at Zapeera!

Receipt Details:
- Receipt Number: ${currentReceipt.receiptNumber}
- Date: ${currentReceipt.date}
- Time: ${currentReceipt.time}
- Cashier: ${currentReceipt.cashier}

Items Purchased:
${currentReceipt.items.map(item => `
â€¢ ${item.name}
  Quantity: ${item.quantity} ${item.unitType}
  Unit Price: PKR ${item.unitPrice.toFixed(2)}
  Total: PKR ${item.totalPrice.toFixed(2)}
`).join('')}

Summary:
- Subtotal: PKR ${currentReceipt.subtotal.toFixed(2)}
${currentReceipt.discountPercentage && currentReceipt.discountPercentage > 0 ? `- Discount (${currentReceipt.discountPercentage}%): -PKR ${currentReceipt.discountAmount?.toFixed(2) || '0.00'}\n` : ''}- Total: PKR ${currentReceipt.total.toFixed(2)}
- Payment Method: ${currentReceipt.paymentMethod.toUpperCase()}

Please keep this receipt for your records.

Important: Follow dosage instructions carefully. Consult your doctor if you have any questions.

Thank you for choosing Zapeera!
Your Health, Our Priority

Best regards,
Zapeera Staff
      `;

      // Create a mailto link with the email content
      const mailtoUrl = `mailto:${currentReceipt.customer.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

      // Try to open email client
      const emailWindow = window.open(mailtoUrl, '_blank');

      if (!emailWindow) {
        // If popup blocked, show the email content in a new window
        const emailWindow = window.open('', '_blank', 'width=600,height=500');
        if (emailWindow) {
          emailWindow.document.write(`
            <html>
              <head>
                <title>Email Receipt</title>
                <style>
                  body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }
                  .header { background: #1C623C; color: white; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                  .content { background: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                  .items { margin: 15px 0; }
                  .item { margin: 10px 0; padding: 10px; background: white; border-radius: 3px; }
                  .totals { background: #e8f5e8; padding: 15px; border-radius: 5px; margin: 15px 0; }
                  .footer { text-align: center; color: #666; font-size: 12px; }
                  button { padding: 10px 20px; background: #1C623C; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
                </style>
              </head>
              <body>
                <div class="header">
                  <h2>Email Receipt for ${currentReceipt.customer.email}</h2>
                </div>
                <div class="content">
                  <p><strong>To:</strong> ${currentReceipt.customer.email}</p>
                  <p><strong>Subject:</strong> ${emailSubject}</p>
                  <p><strong>Message:</strong></p>
                  <div style="background: white; padding: 15px; border-radius: 5px; white-space: pre-wrap; font-family: monospace; max-height: 300px; overflow-y: auto;">${emailBody}</div>
                </div>
                <div style="text-align: center;">
                  <button onclick="window.close()">Close</button>
                  <button onclick="navigator.clipboard.writeText('${emailBody.replace(/'/g, "\\'")}').then(() => alert('Email content copied to clipboard!'))">Copy Content</button>
                </div>
                <div class="footer">
                  <p>Copy the content above and send it via your email client.</p>
                </div>
              </body>
            </html>
          `);
        } else {
          toast({
            title: "Email Receipt Ready",
            description: `Email prepared for ${currentReceipt.customer.email}. Copy the content and send it via your email client.`,
          });
        }
      }
    } catch (error) {
      toast({
        title: "Email Error",
        description: "Error preparing email receipt. Please try again.",
        variant: "destructive",
      });
    }
  };

  // No mock data - only use real data from API

  // Invoice lookup functionality
  const lookupInvoice = async () => {
    if (!refundReceiptNumber.trim()) {
      toast({
        title: "Receipt Number Required",
        description: "Please enter a receipt number",
        variant: "destructive",
      });
      return;
    }

    try {
      setInvoiceLookupLoading(true);

      // Make API call to get sales data
      const response = await apiService.getSales({
        limit: 1000,
        startDate: undefined,
        endDate: undefined,
        branchId: undefined,
        companyId: selectedCompanyId || '',
      });

      if (response.success && response.data?.sales) {
        // Find invoice by receipt number
        const foundInvoice = response.data.sales.find((sale: any) =>
          sale.receipts?.some((receipt: any) =>
            receipt.receiptNumber.toLowerCase() === refundReceiptNumber.toLowerCase()
          )
        );

        if (foundInvoice) {
          // Transform the sale data to match the expected format
          const transformedInvoice = {
            id: foundInvoice.id,
            invoiceNumber: foundInvoice.id,
            customerId: foundInvoice.customerId,
            userId: foundInvoice.userId,
            branchId: foundInvoice.branchId,
            subtotal: foundInvoice.subtotal,
            taxAmount: foundInvoice.taxAmount,
            discountAmount: foundInvoice.discountAmount,
            totalAmount: foundInvoice.totalAmount,
            paymentMethod: foundInvoice.paymentMethod,
            paymentStatus: foundInvoice.paymentStatus,
            status: foundInvoice.status,
            createdAt: foundInvoice.createdAt,
            updatedAt: foundInvoice.createdAt,
            customer: foundInvoice.customer,
            user: foundInvoice.user,
            branch: foundInvoice.branch,
            items: foundInvoice.items.map((item: any) => ({
              id: item.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              batchNumber: item.batchNumber,
              expiryDate: item.expiryDate,
              product: item.product
            })),
            receipts: [],
            receiptNumber: foundInvoice.id
          };

          setFoundInvoice(transformedInvoice);
          setIsRefundDialogOpen(true);
        } else {
          toast({
            title: "Invoice Not Found",
            description: `Invoice with receipt number "${refundReceiptNumber}" not found.`,
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Load Failed",
          description: "Failed to load invoices. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Lookup Error",
        description: "Error looking up invoice. Please try again.",
        variant: "destructive",
      });
    } finally {
      setInvoiceLookupLoading(false);
    }
  };


  // Refund and return functionality
  const processRefund = async () => {
    if (!refundReceiptNumber.trim()) {
      toast({
        title: "Receipt Number Required",
        description: "Please enter a receipt number",
        variant: "destructive",
      });
      return;
    }

    try {
      // Find the original sale by receipt number
      const salesResponse = await apiService.getSales({
        limit: 1000,
        companyId: selectedCompanyId || '',
      });
      if (!salesResponse.success || !salesResponse.data?.sales?.length) {
        toast({
          title: "Sale Not Found",
          description: "Sale not found with the given receipt number",
          variant: "destructive",
        });
        return;
      }

      // Find the specific sale by receipt number
      const sales = salesResponse.data.sales;
      const originalSale = sales.find((sale: any) =>
        sale.receipts?.some((receipt: any) =>
          receipt.receiptNumber === refundReceiptNumber
        )
      );

      if (!originalSale) {
        toast({
          title: "Sale Not Found",
          description: `Receipt number ${refundReceiptNumber} not found`,
          variant: "destructive",
        });
        return;
      }
      // Automatically use all items from the original sale for refund
      const itemsToRefund = originalSale.items.map((item: any) => ({
        productId: item.productId,
        quantity: item.quantity,
        saleType: item.saleType,
        unitsDeducted: item.unitsDeducted || item.quantity,
        unitsPerBox: item.unitsPerBox,
        unitPrice: item.unitPrice,
        reason: refundReason || "Customer requested refund",
        batchId: item.batchId || null, // Include batch ID for stock return
        saleItemId: item.id || null
      }));

      const totalRefundAmount = originalSale.totalAmount;

      // Prepare refund data
      const refundData = {
        originalSaleId: originalSale.id,
        refundReason: refundReason || "Customer requested refund",
        items: itemsToRefund,
        refundedBy: user?.id || ""
      };
      // Call the refund API
      const refundResponse = await apiService.createRefund(refundData);
      if (refundResponse.success) {
        toast({
          title: "Refund Processed",
          description: `Receipt ${refundReceiptNumber} refunded. Amount: PKR ${totalRefundAmount.toFixed(2)}. Stock has been updated.`,
          variant: "success",
        });

        // Reset refund form
        setRefundReceiptNumber("");
        setRefundReason("");
        setRefundItems([]);
        setIsRefundDialogOpen(false);

        // Refresh products to show updated stock
        loadProducts();

        // Trigger refresh of refunds list by dispatching a custom event
        window.dispatchEvent(new CustomEvent('refundCreated', {
          detail: { refund: refundResponse.data.refund }
        }));
      } else {
        const errorMessage = refundResponse.message || "Failed to process refund. Please try again.";
        const isAlreadyRefunded = errorMessage.toLowerCase().includes('already refunded') || (refundResponse as any).error === 'ALREADY_REFUNDED';
        
        toast({
          title: isAlreadyRefunded ? "Already Refunded" : "Refund Failed",
          description: isAlreadyRefunded
            ? `${errorMessage}. This item has already been refunded. Please check the refund history.`
            : errorMessage,
          variant: "destructive",
        });
      }
    } catch (error) {
      const errorMessage = error?.response?.message 
        || error?.response?.data?.message 
        || error?.message 
        || 'Error processing refund. Please try again.';
      
      const isAlreadyRefunded = errorMessage.toLowerCase().includes('already refunded') 
        || error?.response?.error === 'ALREADY_REFUNDED'
        || error?.response?.data?.error === 'ALREADY_REFUNDED';
      
      toast({
        title: isAlreadyRefunded ? "Already Refunded" : "Refund Error",
        description: isAlreadyRefunded
          ? `${errorMessage}. This item has already been refunded. Please check the refund history.`
          : errorMessage,
        variant: "destructive",
      });
    }
  };

  const addRefundItem = (item: CartItem, quantity: number, reason: string) => {
    if (quantity <= 0) return;

    const refundItem: RefundItem = {
      id: item.id,
      name: item.name,
      quantity: quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.unitPrice * quantity,
      reason: reason
    };

    setRefundItems([...refundItems, refundItem]);
  };

  const removeRefundItem = (itemId: string) => {
    setRefundItems(refundItems.filter(item => item.id !== itemId));
  };

  // Gift card functionality
  const validateGiftCard = async (cardNumber: string) => {
    // In a real implementation, you would call the backend API to validate the gift card
    // For demo purposes, we'll simulate some gift cards
    const sampleGiftCards: GiftCard[] = [
      { id: "1", number: "1234567890123456", balance: 500, isActive: true, expiryDate: "2025-12-31" },
      { id: "2", number: "2345678901234567", balance: 1000, isActive: true, expiryDate: "2025-06-30" },
      { id: "3", number: "3456789012345678", balance: 250, isActive: true, expiryDate: "2024-12-31" },
      { id: "4", number: "4567890123456789", balance: 0, isActive: false, expiryDate: "2023-12-31" }
    ];

    const giftCard = sampleGiftCards.find(card => card.number === cardNumber);

    if (!giftCard) {
      toast({
        title: "Gift Card Not Found",
        description: "Gift card not found",
        variant: "destructive",
      });
      return false;
    }

    if (!giftCard.isActive) {
      toast({
        title: "Gift Card Inactive",
        description: "Gift card is inactive",
        variant: "destructive",
      });
      return false;
    }

    if (giftCard.expiryDate && new Date(giftCard.expiryDate) < new Date()) {
      toast({
        title: "Gift Card Expired",
        description: "Gift card has expired",
        variant: "destructive",
      });
      return false;
    }

    setGiftCardBalance(giftCard.balance);
    return true;
  };

  const applyGiftCard = () => {
    if (!giftCardNumber.trim()) {
      toast({
        title: "Gift Card Number Required",
        description: "Please enter a gift card number",
        variant: "destructive",
      });
      return;
    }

    if (giftCardAmount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    if (giftCardAmount > giftCardBalance) {
      toast({
        title: "Insufficient Balance",
        description: `Insufficient balance. Available: PKR ${giftCardBalance.toFixed(2)}`,
        variant: "destructive",
      });
      return;
    }

    if (giftCardAmount > total) {
      toast({
        title: "Amount Exceeds Total",
        description: `Amount cannot exceed total. Total: PKR ${total.toFixed(2)}`,
        variant: "destructive",
      });
      return;
    }

    // Add gift card payment to split payments
    addSplitPayment('gift_card', giftCardAmount, giftCardNumber);

    // Reset gift card form
    setGiftCardNumber("");
    setGiftCardAmount(0);
    setGiftCardBalance(0);

    toast({
      title: "Gift Card Applied",
      description: `Gift card applied successfully! Amount: PKR ${giftCardAmount.toFixed(2)}`,
      variant: "success",
    });
  };

  const searchReceiptForRefund = async () => {
    if (!refundReceiptNumber.trim()) {
      toast({
        title: "Receipt Number Required",
        description: "Please enter a receipt number",
        variant: "destructive",
      });
      return;
    }

    try {
      // Search for the receipt in the sales API
      const response = await apiService.getSales({
        limit: 1000, // Get more results to search through
        companyId: selectedCompanyId || '',
      });

      if (response.success && response.data) {
        // Find the specific receipt
        const sales = response.data.sales;
        const foundSale = sales.find((sale: any) =>
          sale.receipts?.some((receipt: any) =>
            receipt.receiptNumber === refundReceiptNumber
          )
        );

        if (foundSale) {
          // Set the found invoice and open refund dialog
          setFoundInvoice(foundSale);
          setRefundReason("Customer requested refund");

          // Automatically populate refund items from the found sale
          const itemsToRefund = foundSale.items.map((item: any) => ({
            id: item.productId,
            name: item.product?.name || 'Unknown Product',
            quantity: item.quantity,
            saleType: item.saleType,
            unitsDeducted: item.unitsDeducted || item.quantity,
            unitsPerBox: item.unitsPerBox,
            unitPrice: item.unitPrice,
            totalPrice: item.quantity * item.unitPrice,
            reason: "Customer requested refund"
          }));
          setRefundItems(itemsToRefund);

          // Open the refund dialog
          setIsRefundDialogOpen(true);

          // Reset the search
          setRefundReceiptNumber("");
          setIsRefundSearchOpen(false);

          toast({
            title: "Receipt Found",
            description: `Receipt ${refundReceiptNumber} found! All items are ready for refund.`,
            variant: "success",
          });
        } else {
          toast({
            title: "Receipt Not Found",
            description: `Receipt number ${refundReceiptNumber} not found`,
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Search Error",
          description: "Error searching for receipt",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Search Error",
        description: "Error searching for receipt. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="p-6">
      {/* Branch selector for owners */}
      {user?.role === 'OWNER' && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Select Branch</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-gray-600">Branch</Label>
              <Select
                value={saleBranchId || selectedBranchId || ''}
                onValueChange={(v) => setSaleBranchId(v)}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder={selectedBranch?.name || 'Select branch'} />
                </SelectTrigger>
                <SelectContent>
                  {allBranches?.map((b) => (
                    <SelectItem
                      key={b.id}
                      value={b.id}
                      className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                    >
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">

        {/* Product Search & Selection */}
        <Card className="lg:col-span-2 shadow-soft border-0">
          <CardHeader>
            <div className="flex items-center justify-between">
            <CardTitle className="flex items-center space-x-2">
              <Search className="w-5 h-5 text-[#0c2c8a]" />
              <span>Product Search</span>
            </CardTitle>
              <div className="flex space-x-2">
                <Button
                  onClick={() => navigate(withBusinessSlug(businessSlug || null, "/point-of-sale"))}
                  className="text-white bg-blue-600 hover:bg-blue-700 border-blue-600 hover:border-blue-700 shadow-md hover:shadow-lg transition-all duration-200"
                >
                  <Receipt className="w-4 h-4 mr-2" />
                  Create Invoice for New Customer
                </Button>
                <Button
                  onClick={() => setIsRefundDialogOpen(true)}
                  variant="outline"
                  className="text-red-600 border-red-600 hover:bg-red-50"
                >
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Refunds & Returns
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search Bar */}
            <div className="flex space-x-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Scan barcode or search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => handleSearchKeyDown(e, searchQuery)}
                  className="pl-10 h-12"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  loadProducts();
                }}
                disabled={loading}
                className="h-12 px-3"
                title="Refresh Products"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const response = await fetch(`${config.api.baseUrl}/products?limit=1000&branchId=${user?.branchId || ''}`, {
                      credentials: 'include',
                      headers: {
                        'Content-Type': 'application/json'
                      }
                    });
                    const data = await response.json();
                    if (data.success && data.data && data.data.products) {
                      const products = data.data.products.map((product: any) => ({
                        id: product.id,
                        name: product.name,
                        price: product.sellingPrice,
                        stock: product.stock,
                        unitType: product.unitType,
                        category: product.category?.name || 'No Category',
                        requiresPrescription: product.requiresPrescription,
                        barcode: product.barcode
                      }));
                      setProducts(products);
                    }
                  } catch (error) {
                  }
                }}
                className="h-12 px-3 text-white bg-transparent text-[#0c2c8a] border-[1px] border-[#0c2c8a]"
                title="Load Products"
              >
                Load Products
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="px-4"
                onClick={handleBarcodeScan}
                disabled={isScanning}
              >
                <Scan className="w-5 h-5" />
                {isScanning ? 'Scanning...' : 'Scan'}
              </Button>
            </div>

            {/* Category Filter */}
            <div className="flex flex-wrap gap-2">
              {categories.map((category, index) => (
                <Button
                  key={`${category}-${index}`}
                  variant={selectedCategory === category ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(category)}
                  className={`capitalize ${selectedCategory === category
                      ? "text-white bg-blue-600 hover:bg-blue-700 border-blue-600"
                      : ""
                    }`}
                >
                  {category}
                </Button>
              ))}
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProducts.length === 0 ? (
                <div className="col-span-full text-center py-8">
                  <div className="text-muted-foreground">
                    {products.length === 0 ? 'No products found. Please check your inventory.' : 'No products match your search criteria.'}
                  </div>
                  <div className="text-sm text-muted-foreground mt-2">
                    Total products: {products.length} | Filtered: {filteredProducts.length}
                  </div>
                </div>
              ) : (
                filteredProducts.map((product) => {
                  const batches = productBatches[product.id] || [];
                  const selectedBatch = getSelectedBatch(product.id);
                  const hasBeenFetched = fetchedProducts.has(product.id);
                  const isCurrentlyLoading = !!loadingBatches[product.id];
                  const totalStock = batches.length > 0 
                    ? getTotalStockFromBatches(product.id)
                    : product.stock;
                  
                  // CRITICAL: Check if stock is actually 0
                  // If batches have been fetched and there are none, or if total stock is 0, show "Stock not available"
                  const hasNoStock = (hasBeenFetched && batches.length === 0) || totalStock === 0 || (selectedBatch && selectedBatch.quantity === 0);
                  
                  // Only show loading if:
                  // 1. Currently loading
                  // 2. Haven't fetched yet
                  // 3. Product has stock > 0 (don't show loading for 0 stock products)
                  const isLoadingBatch = isCurrentlyLoading && !hasBeenFetched && product.stock > 0;
                  
                  return (
                  <Card key={product.id} className={`hover:shadow-medium transition-shadow ${product.requiresPrescription ? 'border-amber-300 bg-amber-50/30' : ''}`}>
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        {/* Prescription Badge */}
                        {product.requiresPrescription && (
                          <div className="flex items-center justify-center gap-1 bg-amber-100 text-amber-800 text-xs font-medium px-2 py-1 rounded-full">
                            <AlertCircle className="w-3 h-3" />
                            Prescription Required
                          </div>
                        )}

                        {/* Product Name */}
                        <div className="text-center">
                          <h4 className="font-medium text-sm text-foreground mb-2">{product.name}</h4>
                        </div>

                        {/* Price and Stock */}
                        <div className="flex items-center justify-between">
                          <span className="text-lg font-bold text-[#0c2c8a]">
                            PKR {selectedBatch?.sellingPrice || product.price}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {selectedBatch?.quantity || totalStock} left
                          </Badge>
                        </div>

                        {/* Batch Selection */}
                        {isLoadingBatch ? (
                          <div className="text-xs text-muted-foreground text-center py-2">
                            <div className="flex items-center justify-center gap-2">
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600"></div>
                            Loading batches...
                            </div>
                          </div>
                        ) : batches.length > 0 ? (
                          <Select
                            value={selectedBatches[product.id] || ''}
                            onValueChange={(value) => setSelectedBatches(prev => ({ ...prev, [product.id]: value }))}
                          >
                            <SelectTrigger className="w-full h-8 text-xs">
                              <SelectValue placeholder="Select batch" />
                            </SelectTrigger>
                            <SelectContent>
                              {batches.map((batch) => (
                                <SelectItem key={batch.id} value={batch.id}>
                                  {batch.batchNo} - Qty: {batch.quantity} - Exp: {batch.expireDate ? new Date(batch.expireDate).toLocaleDateString() : 'N/A'}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="text-xs text-muted-foreground text-center py-2">
                            No batches available
                          </div>
                        )}

                        {/* Add to Cart Buttons or Stock Not Available */}
                        {hasNoStock ? (
                          <div className="text-center py-2">
                            <span className="text-sm text-red-600 font-medium">Stock not available</span>
                          </div>
                        ) : (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => {
                              if (selectedBatch) {
                                addToCart(product, 1, "unit");
                              } else {
                                toast({
                                  title: "No Batch Selected",
                                  description: "Please select a batch first",
                                  variant: "destructive",
                                });
                              }
                            }}
                            disabled={!selectedBatch || batches.length === 0}
                          >
                            Unit
                          </Button>
                          {(selectedBatch?.unitsPerBox || product.unitsPerPack || 1) > 1 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              onClick={() => {
                                if (selectedBatch) {
                                  addToCart(product, 1, "box");
                                } else {
                                  toast({
                                    title: "No Batch Selected",
                                    description: "Please select a batch first",
                                    variant: "destructive",
                                  });
                                }
                              }}
                              disabled={!selectedBatch || batches.length === 0}
                            >
                              Box
                            </Button>
                          )}
                        </div>
                        )}

                        {/* Prescription Required Badge below price */}
                        {product.requiresPrescription && (
                          <div className="mt-2 flex justify-center">
                            <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs px-2 py-1">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              Rx Required
                            </Badge>
                          </div>
                        )}

                      </div>
                    </CardContent>
                  </Card>
                )})
              )}
            </div>
          </CardContent>
        </Card>

        {/* Selected Items - Compact Table Display */}
        {cart.length > 0 && (
          <Card className="lg:col-span-2 shadow-soft border-0">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center space-x-2 text-lg">
                <ShoppingCart className="w-5 h-5 text-[#0c2c8a]" />
                <span>Selected Items</span>
                <Badge variant="outline" className="ml-2">{cart.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="w-[40%] py-2">Name</TableHead>
                      <TableHead className="text-center w-[20%] py-2">Qty</TableHead>
                      <TableHead className="text-right w-[15%] py-2">Price</TableHead>
                      <TableHead className="text-right w-[15%] py-2">Total</TableHead>
                      <TableHead className="text-center w-[10%] py-2">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cart.map((item) => (
                      <TableRow key={item.id} className="hover:bg-gray-50">
                        <TableCell className="font-medium py-2">{item.name}</TableCell>
                        <TableCell className="text-center py-2">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-7 h-7 p-0"
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            >
                              <Minus className="w-3 h-3" />
                            </Button>
                            <span className="font-medium w-10 text-center text-sm">{item.quantity}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-7 h-7 p-0"
                              onClick={() => {
                                const unitsRequired = item.saleType === 'BOX'
                                  ? (item.quantity + 1) * (item.unitsPerBox || 1)
                                  : item.quantity + 1;
                                if (item.availableUnits !== undefined && unitsRequired > item.availableUnits) {
                                  toast({
                                    title: "Insufficient Stock",
                                    description: `Available stock: ${item.availableUnits} units.`,
                                    variant: "destructive",
                                  });
                                  return;
                                }
                                updateQuantity(item.id, item.quantity + 1);
                              }}
                            >
                              <Plus className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-right py-2 text-sm">
                          PKR {item.unitPrice.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-semibold py-2 text-sm text-green-600">
                          PKR {item.totalPrice.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-center py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updateQuantity(item.id, 0)}
                            className="text-destructive hover:text-destructive h-7 w-7 p-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Receipt Search for Refund */}
        {/* <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 text-orange-600" />
              <span>Search Receipt for Refund</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Enter receipt number (e.g., RCP-20250913-961)"
                  value={refundReceiptNumber}
                  onChange={(e) => setRefundReceiptNumber(e.target.value)}
                  className="pl-10"
                  onKeyPress={(e) => e.key === 'Enter' && searchReceiptForRefund()}
                />
              </div>
              <Button
                onClick={searchReceiptForRefund}
                disabled={!refundReceiptNumber.trim()}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                <Search className="w-4 h-4 mr-2" />
                Find Receipt
              </Button>
            </div>
            <p className="text-sm text-orange-700">
              Enter a receipt number to search for it and process refunds. The receipt will be found and you can go to the Refunds & Returns tab to complete the refund process.
            </p>
          </CardContent>
        </Card> */}
      </div>

      {/* Receipt Dialog */}
      <Dialog open={isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Receipt</span>
              <div className="flex space-x-2">
                <Button variant="outline" size="sm" onClick={printReceipt}>
                  <Printer className="w-4 h-4 mr-2" />
                  Print
                </Button>
                <Button variant="outline" size="sm" onClick={downloadReceipt}>
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
                {currentReceipt?.customer?.phone && (
                  <Button variant="outline" size="sm" onClick={sendSMSReceipt}>
                    <Phone className="w-4 h-4 mr-2" />
                    SMS
                  </Button>
                )}
                {currentReceipt?.customer?.email && (
                  <Button variant="outline" size="sm" onClick={sendEmailReceipt}>
                    <Mail className="w-4 h-4 mr-2" />
                    Email
                  </Button>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>

          {currentReceipt && (
            <div className="space-y-6 print:p-6">
              {/* Receipt Number - Clickable to Copy */}
              <div
                className="text-center bg-gray-100 p-3 rounded-lg cursor-pointer hover:bg-gray-200 transition-colors group"
                onClick={() => {
                  navigator.clipboard.writeText(currentReceipt.receiptNumber);
                  toast({
                    title: "Receipt Number Copied",
                    description: `Receipt number copied: ${currentReceipt.receiptNumber}`,
                  });
                }}
              >
                <p className="text-xs text-gray-500 mb-1">Click to copy receipt number</p>
                <p className="text-xl font-bold text-gray-900 font-mono group-hover:text-blue-600">
                  {currentReceipt.receiptNumber}
                </p>
              </div>

              {/* Receipt Header */}
              <div className="text-center border-b pb-4">
                <h2 className="text-2xl font-bold text-primary">Zapeera</h2>
                <p className="text-muted-foreground">Your Health, Our Priority</p>
                <div className="flex justify-between text-sm mt-4">
                  <div>
                    <p><strong>Date:</strong> {currentReceipt.date}</p>
                  </div>
                  <div>
                    <p><strong>Time:</strong> {currentReceipt.time}</p>
                    <p><strong>Cashier:</strong> {currentReceipt.cashier}</p>
                  </div>
                </div>
              </div>

              {/* Customer Info */}
              {currentReceipt.customer && (
                <div className="border-b pb-4">
                  <h3 className="font-semibold mb-2">Customer Information</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p><strong>Name:</strong> {currentReceipt.customer.name}</p>
                      <p><strong>Phone:</strong> {currentReceipt.customer.phone}</p>
                    </div>
                    <div>
                      <p><strong>Email:</strong> {currentReceipt.customer.email}</p>
                      <p><strong>Address:</strong> {currentReceipt.customer.address}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Items */}
              <div className="space-y-3">
                <h3 className="font-semibold">Items Purchased</h3>
                {currentReceipt.items.map((item) => (
                  <div key={item.id} className="flex justify-between items-center py-2 border-b border-dashed">
                    <div className="flex-1">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.quantity} {item.unitType} Ã— PKR {item.unitPrice.toFixed(2)}
                      </p>
                      {item.instructions && (
                        <p className="text-xs text-blue-600 mt-1">{item.instructions}</p>
                      )}
                    </div>
                    <p className="font-semibold">PKR {item.totalPrice.toFixed(2)}</p>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="border-t pt-4 space-y-2">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>PKR {currentReceipt.subtotal.toFixed(2)}</span>
                </div>
                {currentReceipt.discountPercentage && currentReceipt.discountPercentage > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount ({currentReceipt.discountPercentage}%):</span>
                    <span>-PKR {currentReceipt.discountAmount?.toFixed(2) || '0.00'}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>Total:</span>
                  <span className="text-primary">PKR {currentReceipt.total.toFixed(2)}</span>
                </div>
              </div>

              {/* Payment Info */}
              <div className="border-t pt-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p><strong>Payment Method:</strong> {currentReceipt.paymentMethod.toUpperCase()}</p>
                    <p><strong>Status:</strong> {currentReceipt.paymentStatus}</p>
                  </div>
                  {selectedPayment === 'cash' && changeAmount > 0 && (
                    <div>
                      <p><strong>Cash Received:</strong> PKR {parseFloat(cashAmount).toFixed(2)}</p>
                      <p><strong>Change:</strong> PKR {changeAmount.toFixed(2)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="text-center text-sm text-muted-foreground border-t pt-4">
                <p>Thank you for choosing Zapeera!</p>
                <p>Please keep this receipt for your records</p>
                <p className="mt-2">
                  <strong>Important:</strong> Follow dosage instructions carefully.
                  Consult your doctor if you have any questions.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manual Barcode Entry Dialog */}
      <Dialog open={isBarcodeDialogOpen} onOpenChange={setIsBarcodeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Barcode className="w-5 h-5 text-primary" />
              <span>Enter Barcode</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="manualBarcode">Barcode / SKU</Label>
              <Input
                id="manualBarcode"
                autoFocus
                placeholder="Scan or type barcode..."
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleManualBarcodeSubmit();
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsBarcodeDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleManualBarcodeSubmit} disabled={!manualBarcode.trim()}>
                <Search className="mr-2 h-4 w-4" />
                Look Up
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Customer Dialog */}
      <Dialog open={isNewCustomerDialogOpen} onOpenChange={setIsNewCustomerDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Plus className="w-5 h-5 text-primary" />
              <span>Add New Customer</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="customerName">Customer Name *</Label>
              <Input
                id="customerName"
                placeholder="Enter customer name"
                value={newCustomer.name}
                onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customerPhone">Phone Number *</Label>
              <Input
                id="customerPhone"
                placeholder="Enter phone number"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customerEmail">Email (Optional)</Label>
              <Input
                id="customerEmail"
                type="email"
                placeholder="Enter email address"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customerAddress">Address (Optional)</Label>
              <Input
                id="customerAddress"
                placeholder="Enter address"
                value={newCustomer.address}
                onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-6 border-t">
            <Button
              variant="outline"
              onClick={() => setIsNewCustomerDialogOpen(false)}
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
            <Button
              onClick={addNewCustomer}
              className="text-white bg-[linear-gradient(135deg,#1C623C_0%,#247449_50%,#6EB469_100%)] hover:opacity-90"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Customer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoice Creation Dialog */}
      <Dialog open={isInvoiceDialogOpen} onOpenChange={(open) => {
        setIsInvoiceDialogOpen(open);
        if (!open) {
          // Reset promotions when dialog is closed
          setAppliedPromotions([]);
          setPromoCode("");
          setDiscountAmount(0);
        }
      }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Receipt className="w-5 h-5 text-primary" />
              <span>Create Invoice for New Customer</span>
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Side: Search & Customer Details */}
            <div className="space-y-6">
              {/* Product Search Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Search & Add Products</h3>

                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Scan barcode or search products..."
                    value={invoiceSearchQuery}
                    onChange={(e) => setInvoiceSearchQuery(e.target.value)}
                    onKeyDown={(e) => handleSearchKeyDown(e, invoiceSearchQuery)}
                    className="pl-10 h-12 text-base"
                  />
                </div>

                {/* Products List - Only show search results */}
                <div className="space-y-2 max-h-80 overflow-y-auto border rounded-lg p-4 bg-gray-50">
                  {invoiceSearchQuery.trim() && filteredInvoiceProducts.length > 0 ? (
                    filteredInvoiceProducts.map((product) => (
                      <div key={product.id} className="p-3 border rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center space-x-3">
                          {/* Product Info */}
                          <div className="flex items-center space-x-2 flex-1 min-w-0">
                            {getUnitIcon(product.unitType)}
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-sm truncate">{product.name}</h4>
                              <span className="text-xs text-muted-foreground">
                                {product.unitType} â€¢ Stock: {product.stock}
                              </span>
                            </div>
                          </div>

                          {/* Price and Prescription Badge */}
                          <div className="flex flex-col items-end">
                            <span className="text-sm font-bold text-primary whitespace-nowrap">
                              PKR {product.price}
                            </span>
                            {product.requiresPrescription && (
                              <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] px-1.5 py-0.5 mt-1">
                                <AlertCircle className="w-2.5 h-2.5 mr-0.5" />
                                Rx
                              </Badge>
                            )}
                          </div>

                          {/* Quantity Input */}
                          <Input
                            type="number"
                            min="0"
                            max="1000"
                            placeholder="Qty"
                            className="w-16 h-8 text-sm text-center"
                            id={`invoice-pack-${product.id}`}
                          />

                          {/* Action Buttons */}
                          <div className="flex space-x-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="px-2 h-8 text-xs"
                              onClick={() => {
                                const input = document.getElementById(`invoice-pack-${product.id}`) as HTMLInputElement;
                                const quantity = parseInt(input.value) || 0;
                                if (quantity > 0) {
                                  addToInvoiceCart(product, quantity, "box");
                                  input.value = "";
                                }
                              }}
                            >
                              <Package className="w-3 h-3 mr-1" />
                              Box
                            </Button>
                            <Button
                              size="sm"
                              className="px-2 h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs"
                              onClick={() => {
                                const input = document.getElementById(`invoice-pack-${product.id}`) as HTMLInputElement;
                                const quantity = parseInt(input.value) || 0;
                                if (quantity > 0) {
                                  addToInvoiceCart(product, quantity, "unit");
                                  input.value = "";
                                }
                              }}
                            >
                              {getUnitIcon(product.unitType)}
                              <span className="ml-1">Add</span>
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : invoiceSearchQuery.trim() ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No products found</p>
                      <p className="text-xs">Try a different search term</p>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>Start typing to search for medicines</p>
                      <p className="text-xs">Search by name, barcode, or SKU</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Customer Details Section */}
              <div className="space-y-4 border-t pt-6">
                <h3 className="text-lg font-semibold">Customer Details (Optional)</h3>
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="invoiceCustomerName">Customer Name</Label>
                    <Input
                      id="invoiceCustomerName"
                      placeholder="Enter customer name"
                      value={invoiceCustomer.name}
                      onChange={(e) => setInvoiceCustomer({ ...invoiceCustomer, name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="invoiceCustomerPhone">Phone Number</Label>
                    <Input
                      id="invoiceCustomerPhone"
                      placeholder="Enter phone number"
                      value={invoiceCustomer.phone}
                      onChange={(e) => setInvoiceCustomer({ ...invoiceCustomer, phone: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="invoiceCustomerEmail">Email</Label>
                    <Input
                      id="invoiceCustomerEmail"
                      type="email"
                      placeholder="Enter email address"
                      value={invoiceCustomer.email}
                      onChange={(e) => setInvoiceCustomer({ ...invoiceCustomer, email: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="invoiceCustomerAddress">Address</Label>
                    <Input
                      id="invoiceCustomerAddress"
                      placeholder="Enter address"
                      value={invoiceCustomer.address}
                      onChange={(e) => setInvoiceCustomer({ ...invoiceCustomer, address: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Side: Selected Items & Totals */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Selected Items</h3>

                {/* Selected Items List */}
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {invoiceItems.map((item) => (
                  (() => {
                    const isBoxItem = item.saleType === 'BOX';
                    const unitsPerBox = item.unitsPerBox || 1;
                    const displayUnits = isBoxItem ? (item.unitsDeducted || item.quantity) : item.quantity;
                    const displayBoxes = isBoxItem ? (displayUnits / unitsPerBox) : null;
                    return (
                  <div key={item.id} className="p-3 bg-gradient-surface rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h4 className="font-medium text-sm text-foreground">{item.name}</h4>
                        <div className="flex items-center space-x-2 mt-1">
                          {getUnitIcon(item.unitType)}
                          <span className="text-xs text-muted-foreground">
                            {isBoxItem
                              ? `${displayBoxes?.toFixed(0)} box (${displayUnits} units) â€¢ PKR ${item.unitPrice.toFixed(2)} each`
                              : `${displayUnits} ${item.unitType} â€¢ PKR ${item.unitPrice.toFixed(2)} each`}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Batch: {item.batch} â€¢ Exp: {item.expiry}
                        </p>
                        {item.instructions && (
                          <p className="text-xs text-blue-600 mt-1 font-medium">
                            ðŸ’Š {item.instructions}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateInvoiceQuantity(item.id, 0)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            updateInvoiceQuantity(item.id, item.quantity - 1);
                          }}
                          className="w-8 h-8 p-0"
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-8 text-center font-medium">{displayUnits}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            updateInvoiceQuantity(item.id, item.quantity + 1);
                          }}
                          className="w-8 h-8 p-0"
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-primary">PKR {item.totalPrice.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                    );
                  })()
                ))}

                {invoiceItems.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <ShoppingCart className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No items selected</p>
                    <p className="text-xs">Search and add medicines to create invoice</p>
                  </div>
                )}
              </div>

              {/* Promotions & Discounts Section */}
              {invoiceItems.length > 0 && (
                <div className="space-y-3 border-t pt-4">
                  <h4 className="font-medium text-sm">Promotions & Discounts</h4>

                  {/* Applied Promotions */}
                  {appliedPromotions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Applied Promotions:</p>
                      {appliedPromotions.map((promotion) => (
                        <div key={promotion.id} className="flex items-center justify-between p-2 bg-green-50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-green-800">{promotion.name}</p>
                            <p className="text-xs text-green-600">Code: {promotion.code}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removePromotion(promotion.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Apply Promotion */}
                  <div className="flex space-x-2">
                    <Input
                      placeholder="Enter promotion code"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      onClick={applyPromotion}
                      variant="outline"
                      size="sm"
                      disabled={!promoCode.trim()}
                    >
                      Apply
                    </Button>
                  </div>

                  {/* Discount Amount Display */}
                  {discountAmount > 0 && (
                    <div className="flex justify-between items-center p-2 bg-green-50 rounded-lg">
                      <span className="text-sm font-medium text-green-800">Discount Applied</span>
                      <span className="text-sm font-bold text-green-800">-PKR {discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Discount Percentage Section */}
              {invoiceItems.length > 0 && (
                <div className="space-y-3 border-t pt-4">
                  <h4 className="font-medium text-sm discountPercentage">Discount</h4>
                  <div className="flex items-center space-x-2">
                    <Input
                      id="discountPercentage"
                      type="number"
                      min="0"
                      max="100"
                      placeholder="0"
                      value={discountPercentage || ''}
                      onChange={(e) => setDiscountPercentage(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                      className="flex-1"
                    />
                    <span className="text-sm font-medium">%</span>
                  </div>
                </div>
              )}

              {/* Date Selection Section */}
              {invoiceItems.length > 0 && (
                <div className="space-y-3 border-t pt-4">
                  <h4 className="font-medium text-sm">Invoice Date</h4>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="useManualDate"
                      checked={useManualDate}
                      onChange={(e) => setUseManualDate(e.target.checked)}
                      className="w-4 h-4"
                      aria-label="Use manual date"
                    />
                    <Label htmlFor="useManualDate" className="text-sm">Use manual date</Label>
                  </div>
                  {useManualDate ? (
                    <div className="flex items-center space-x-2">
                      <Label htmlFor="manualDate" className="text-sm whitespace-nowrap">Date:</Label>
                      <Input
                        id="manualDate"
                        type="date"
                        value={manualDate}
                        onChange={(e) => setManualDate(e.target.value)}
                        className="flex-1"
                      />
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Using today's date: {new Date().toLocaleDateString()}
                    </div>
                  )}
                </div>
              )}

              {/* Totals */}
              {invoiceItems.length > 0 && (
                <div className="space-y-2 border-t pt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium">PKR {invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0).toFixed(2)}</span>
                  </div>
                  {discountPercentage > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>Discount ({discountPercentage}%)</span>
                      <span>-PKR {((invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0) * discountPercentage) / 100).toFixed(2)}</span>
                    </div>
                  )}
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>Promo Discount</span>
                      <span>-PKR {discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span className="text-primary">PKR {(() => {
                      const invoiceSubtotal = invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
                      const discountAmt = (invoiceSubtotal * discountPercentage) / 100;
                      const subtotalAfterDiscount = invoiceSubtotal - discountAmt;
                      return subtotalAfterDiscount.toFixed(2);
                    })()}</span>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setIsInvoiceDialogOpen(false)}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  onClick={createInvoice}
                  className="text-white bg-[linear-gradient(135deg,#1C623C_0%,#247449_50%,#6EB469_100%)] hover:opacity-90"
                  disabled={invoiceItems.length === 0}
                >
                  <Receipt className="w-4 h-4 mr-2" />
                  Create Invoice & Print Receipt
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Refunds & Returns Dialog */}
      <Dialog open={isRefundDialogOpen} onOpenChange={(open) => {
        setIsRefundDialogOpen(open);
        if (!open) {
          // Reset form when dialog is closed
          setRefundReceiptNumber("");
          setRefundReason("");
          setFoundInvoice(null);
          setRefundItems([]);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <span>Refunds & Returns</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Invoice Lookup Form */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Invoice Lookup</h3>
              <div className="flex space-x-2">
                <Input
                  placeholder="Enter invoice/receipt number"
                  value={refundReceiptNumber}
                  onChange={(e) => setRefundReceiptNumber(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={lookupInvoice}
                  variant="outline"
                  disabled={invoiceLookupLoading}
                >
                  {invoiceLookupLoading ? 'Loading...' : 'Show Invoice'}
                </Button>
              </div>
            </div>

            {/* Found Invoice Display */}
            {foundInvoice && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Found Invoice</h3>
                <Card className="border-green-200 bg-green-50">
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      {/* Invoice Header */}
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-semibold text-lg">Receipt: {foundInvoice.receipts[0]?.receiptNumber || 'N/A'}</h4>
                          <p className="text-sm text-muted-foreground">
                            Date: {new Date(foundInvoice.createdAt).toLocaleDateString()} {new Date(foundInvoice.createdAt).toLocaleTimeString()}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Cashier: {foundInvoice.user.name}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-green-600">
                            PKR {foundInvoice.totalAmount.toFixed(2)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {foundInvoice.paymentMethod} â€¢ {foundInvoice.paymentStatus}
                          </p>
                        </div>
                      </div>

                      {/* Customer Info */}
                      {foundInvoice.customer && (
                        <div className="border-t pt-3">
                          <h5 className="font-medium text-sm mb-2">Customer Information</h5>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <p><strong>Name:</strong> {foundInvoice.customer.name}</p>
                            <p><strong>Phone:</strong> {foundInvoice.customer.phone}</p>
                            {foundInvoice.customer.email && (
                              <p><strong>Email:</strong> {foundInvoice.customer.email}</p>
                            )}
                            {foundInvoice.customer.address && (
                              <p><strong>Address:</strong> {foundInvoice.customer.address}</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Items List */}
                      <div className="border-t pt-3">
                        <h5 className="font-medium text-sm mb-2">Items in Invoice</h5>
                        <div className="space-y-2">
                          {foundInvoice.items.map((item: any, index: number) => (
                            <div key={index} className="flex justify-between items-center p-2 bg-white rounded border">
                              <div className="flex-1">
                                <p className="font-medium text-sm">{item.product.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {item.quantity} {item.product.unitType} Ã— PKR {item.unitPrice.toFixed(2)}
                                  {item.batchNumber && ` â€¢ Batch: ${item.batchNumber}`}
                                  {item.expiryDate && ` â€¢ Exp: ${new Date(item.expiryDate).toLocaleDateString()}`}
                                </p>
                              </div>
                              <p className="font-semibold text-sm">PKR {item.totalPrice.toFixed(2)}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Invoice Summary */}
                      <div className="border-t pt-3">
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span>Subtotal:</span>
                            <span>PKR {foundInvoice.subtotal.toFixed(2)}</span>
                          </div>
                          {foundInvoice.discountAmount > 0 && (
                            <div className="flex justify-between text-green-600">
                              <span>Discount:</span>
                              <span>-PKR {foundInvoice.discountAmount.toFixed(2)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold text-lg border-t pt-1">
                            <span>Total:</span>
                            <span>PKR {foundInvoice.totalAmount.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="border-t pt-3">
                        <Button
                          onClick={processRefund}
                          className="w-full text-white bg-red-600 hover:bg-red-700"
                        >
                          <AlertCircle className="w-4 h-4 mr-2" />
                          Process Full Refund & Return Items to Stock
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Refund Reason */}
            {foundInvoice && (
              <div className="space-y-2">
                <Label htmlFor="refundReason">Refund Reason *</Label>
                <Input
                  id="refundReason"
                  placeholder="Enter reason for refund"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => setIsRefundDialogOpen(false)}
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              {foundInvoice && (
                <Button
                  onClick={processRefund}
                  className="text-white bg-red-600 hover:bg-red-700"
                  disabled={!refundReason.trim()}
                >
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Process Refund
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Customer Selection Dialog */}
      <Dialog open={isCustomerDialogOpen} onOpenChange={setIsCustomerDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <User className="w-5 h-5 text-primary" />
              <span>Select Customer</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search customers by name or phone..."
                className="pl-10"
                onChange={(e) => {
                  const query = e.target.value.toLowerCase();
                  // Filter customers based on search query
                }}
              />
            </div>

            {/* Customer List */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {customersLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <RefreshCw className="w-8 h-8 mx-auto mb-4 animate-spin" />
                  <p>Loading customers...</p>
                </div>
              ) : customers.length > 0 ? (
                customers.map((customer) => (
                  <div
                    key={customer.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      setSelectedCustomer(customer);
                      setIsCustomerDialogOpen(false);
                    }}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                        <User className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium">{customer.name}</p>
                        <p className="text-sm text-muted-foreground">{customer.phone}</p>
                        {customer.email && (
                          <p className="text-sm text-muted-foreground">{customer.email}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">PKR {customer.totalPurchases.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">{customer.loyaltyPoints} points</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No customers found</p>
                  <p className="text-sm">Add a new customer to get started</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(POSInterface);