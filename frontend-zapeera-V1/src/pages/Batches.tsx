import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardHeader } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { SearchableSelect } from '../components/ui/searchable-select';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import ConfirmationModal from '../components/ui/ConfirmationModal';
import { useToast } from '../hooks/use-toast';
import { apiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useAdmin } from '../contexts/useAdmin';
import { Search, Plus, Edit, Trash2, Package, Calendar, AlertTriangle, Filter, Download, Eye, Flag, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from "@/lib/utils";

// Safe date helpers to avoid RangeError from date-fns/format when date is invalid
const safeFormatDate = (dateLike: string | Date | number | undefined | null, pattern: string, fallback: string = 'N/A') => {
  if (!dateLike) return fallback;

  let d: Date;
  if (dateLike instanceof Date) {
    d = dateLike;
  } else if (typeof dateLike === 'number') {
    d = new Date(dateLike);
  } else if (typeof dateLike === 'string') {
    d = new Date(dateLike);
  } else {
    return fallback;
  }

  // Check if date is valid
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    return fallback;
  }

  try {
    return format(d, pattern);
  } catch (error) {
    console.warn('Error formatting date:', dateLike, error);
    return fallback;
  }
};

const safeFormatDateForInput = (dateLike: string | Date | number | undefined | null) => {
  // For input[type=date] values: return "" if invalid
  if (!dateLike) return '';

  let d: Date;
  if (dateLike instanceof Date) {
    d = dateLike;
  } else if (typeof dateLike === 'number') {
    d = new Date(dateLike);
  } else if (typeof dateLike === 'string') {
    d = new Date(dateLike);
  } else {
    return '';
  }

  // Check if date is valid
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    return '';
  }

  try {
    return format(d, 'yyyy-MM-dd');
  } catch (error) {
    console.warn('Error formatting date for input:', dateLike, error);
    return '';
  }
};

interface Batch {
  id: string;
  batchNo: string;
  productId: string;
  supplierId?: string;
  supplierName?: string;
  supplierOutstanding: number;
  supplierInvoiceNo?: string;
  expireDate?: string;
  productionDate?: string;
  shelfId?: string;
  shelfName?: string;
  isActive: boolean;
  isReported: boolean;
  reportReason?: string; // Reason for reporting the batch
  reportedBy?: string; // User who reported the batch
  reportedByName?: string; // Name of user who reported the batch
  createdAt: string;
  updatedAt: string;
  // Stock and pricing fields from database
  quantity?: number; // Current stock quantity (main field from database)
  totalStock?: number; // Mapped from quantity for display
  stockQuantity?: number; // Mapped from quantity for display
  totalBoxes?: number;
  unitsPerBox?: number;
  costPrice?: number; // Mapped from purchasePrice
  sellingPrice?: number;
  purchasePrice?: number; // Original database field
  costPricePerUnit?: number;
  costPricePerBox?: number;
  sellingPricePerUnit?: number;
  sellingPricePerBox?: number;
  stockPurchasePrice?: number;
  paidAmount?: number;
  purchasingMethod?: string;
  minStockLevel?: number;
  product: {
    id: string;
    name: string;
    sku: string;
  };
  supplier?: {
    id: string;
    name: string;
  };
}

interface Product {
  id: string;
  name: string;
  sku?: string;
  category?: {
    id: string;
    name: string;
    type?: string; // MEDICAL, NON_MEDICAL, GENERAL
  };
}

interface Supplier {
  id: string;
  name: string;
  manufacturerId?: string;
  manufacturer?: {
    id: string;
    name: string;
  };
}

interface Manufacturer {
  id: string;
  name: string;
}

interface Shelf {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    products: number;
  };
}

const Batches = () => {
  const { user } = useAuth();
  const { selectedBranchId, selectedCompanyId, selectedCompany } = useAdmin();
  const { toast } = useToast();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('active');
  const [showAddModal, setShowAddModal] = useState(false);
  const [batchType, setBatchType] = useState<'medical' | 'non-medical'>('medical'); // Default to medical
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [viewingBatch, setViewingBatch] = useState<Batch | null>(null);
  const [deletingBatch, setDeletingBatch] = useState<Batch | null>(null);
  const [reportingBatch, setReportingBatch] = useState<Batch | null>(null); // Batch being reported
  const [reportReason, setReportReason] = useState<string>(''); // Reason for reporting
  const [isSubmittingReport, setIsSubmittingReport] = useState(false); // Loading state for report submission
  const [viewingReasonBatch, setViewingReasonBatch] = useState<Batch | null>(null); // Batch whose reason is being viewed
  const [nearExpiryBatches, setNearExpiryBatches] = useState<Batch[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [selectedManufacturerFilter, setSelectedManufacturerFilter] = useState<string>('all');
  const [selectedSupplierFilter, setSelectedSupplierFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Dialog states for Add New buttons
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [isShelfDialogOpen, setIsShelfDialogOpen] = useState(false);


  // Form state
  const [formData, setFormData] = useState({
    batchNo: '',
    productId: '',
    supplierId: '',
    supplierName: '',
    expireDate: '',
    productionDate: '',
    shelfId: '',
    shelfName: '',
    // New pricing and stock fields
    costPricePerUnit: 0,
    costPricePerBox: 0,
    sellingPricePerUnit: 0,
    sellingPricePerBox: 0,
    stockQuantity: 0,
    totalBoxes: 0, // Add totalBoxes field
    unitsPerBox: 1,
    minStockLevel: 10,
    taxType: '', // Tax type for non-medical products
  });

  // Load data (background, no loading spinner)
  const loadBatches = useCallback(async () => {
    try {
      // Don't show loading - load in background
      
      // Determine branch ID for managers/cashiers
      let branchId = selectedBranchId;
      if (!branchId && user?.role !== 'OWNER' && user?.role !== 'ADMIN') {
        // For non-owner users, check membership.branchIds
        if (Array.isArray(user?.membership?.branchIds) && user.membership.branchIds.length > 0) {
          branchId = String(user.membership.branchIds[0]);
        } else if (user?.branchId) {
          branchId = user.branchId;
        }
      }
      
      console.log('🔍 Loading batches with params:', {
        page: 1,
        limit: 100,
        search: searchTerm,
        isActive: activeTab === 'active',
        isReported: activeTab === 'reported',
        branchId: branchId,
      });
      // CRITICAL FIX: Explicitly set isReported based on activeTab
      // When activeTab is 'reported', set isReported to true
      // When activeTab is 'active', set isReported to false to exclude reported batches
      const response = await apiService.getBatches({
        page: 1,
        limit: 100,
        search: searchTerm,
        isActive: activeTab === 'active' ? true : undefined, // Only filter by isActive for active tab
        isReported: activeTab === 'reported' ? true : false, // Explicitly set: true for reported, false for active
        branchId: branchId,
      });
      
      console.log('🔍 Batches API call - activeTab:', activeTab, 'isReported:', activeTab === 'reported' ? true : false);
      console.log('🔍 Batches API response:', response);
      console.log('🔍 Response success:', response.success);
      console.log('🔍 Response data:', response.data);

      if (response.success) {
        console.log('🔍 Raw batches from API:', response.data.batches);
        // Debug: Log first batch's expireDate to see what format it's in
        if (response.data.batches.length > 0) {
          console.log('🔍 First batch expireDate raw:', response.data.batches[0].expireDate);
          console.log('🔍 First batch expireDate type:', typeof response.data.batches[0].expireDate);
          console.log('🔍 First batch all date fields:', {
            expireDate: response.data.batches[0].expireDate,
            expiryDate: (response.data.batches[0] as any).expiryDate,
            expirationDate: (response.data.batches[0] as any).expirationDate,
            productionDate: response.data.batches[0].productionDate,
          });
        }
        const mappedBatches = response.data.batches.map((batch: any) => {
          // Try multiple possible field names for expiry date (some databases might use different names)
          const expireDateValue = batch.expireDate || (batch as any).expiryDate || (batch as any).expirationDate;
          const productionDateValue = batch.productionDate || (batch as any).production;

          // Debug log for reported batches
          if (batch.isReported) {
            console.log('🔍 Frontend - Reported batch received:', {
              batchNo: batch.batchNo,
              reportReason: batch.reportReason,
              reportedBy: batch.reportedBy,
              isReported: batch.isReported
            });
          }

          return {
            id: batch.id,
            batchNo: batch.batchNo,
            productId: batch.productId,
            supplierId: batch.supplierId,
            supplierName: batch.supplierName,
            supplierOutstanding: batch.supplierOutstanding || 0,
            supplierInvoiceNo: batch.supplierInvoiceNo,
            expireDate: expireDateValue ? (typeof expireDateValue === 'string' ? expireDateValue : expireDateValue.toISOString?.() || expireDateValue) : null,
            productionDate: productionDateValue ? (typeof productionDateValue === 'string' ? productionDateValue : productionDateValue.toISOString?.() || productionDateValue) : null,
            shelfId: batch.shelfId,
          shelfName: batch.shelfName,
          isActive: batch.isActive,
          isReported: batch.isReported,
          reportReason: batch.reportReason !== null && batch.reportReason !== undefined && batch.reportReason !== '' ? batch.reportReason : undefined, // Include report reason
          reportedBy: batch.reportedBy !== null && batch.reportedBy !== undefined && batch.reportedBy !== '' ? batch.reportedBy : undefined, // User who reported (name/username/id)
          reportedByName: batch.reportedBy !== null && batch.reportedBy !== undefined && batch.reportedBy !== '' ? batch.reportedBy : undefined, // Use reportedBy as name (we save name/username in reportedBy)
          createdAt: batch.createdAt,
          updatedAt: batch.updatedAt,
          // Stock and pricing fields - using correct database field names
          quantity: batch.quantity || 0,
          totalStock: batch.quantity || 0, // Map quantity to totalStock for display
          stockQuantity: batch.quantity || 0, // Map quantity to stockQuantity for display
          totalBoxes: batch.totalBoxes || 0,
          unitsPerBox: batch.unitsPerBox || 0,
          costPrice: batch.purchasePrice || 0, // Map purchasePrice to costPrice
          sellingPrice: batch.sellingPrice || 0,
          purchasePrice: batch.purchasePrice || 0, // Keep original field name too
          costPricePerUnit: batch.costPricePerUnit || 0,
          costPricePerBox: batch.costPricePerBox || 0,
          sellingPricePerUnit: batch.sellingPricePerUnit || 0,
          sellingPricePerBox: batch.sellingPricePerBox || 0,
          stockPurchasePrice: batch.stockPurchasePrice || 0,
          paidAmount: batch.paidAmount || 0,
          purchasingMethod: batch.purchasingMethod,
          minStockLevel: batch.minStockLevel || 0,
          product: {
            id: batch.product.id,
            name: batch.product.name,
            sku: batch.product.sku || ''
          },
          supplier: batch.supplier ? {
            id: batch.supplier.id,
            name: batch.supplier.name
          } : undefined
          };
        });

        // Debug: Log first mapped batch's expireDate
        if (mappedBatches.length > 0) {
          console.log('🔍 First mapped batch expireDate:', mappedBatches[0].expireDate);
          console.log('🔍 First mapped batch expireDate formatted:', safeFormatDate(mappedBatches[0].expireDate, 'MMM dd, yyyy'));
        }

        console.log('🔍 Mapped batches:', mappedBatches);
        setBatches(mappedBatches);
        // Cache writing disabled
      }
    } catch (error) {
      console.error('Error loading batches:', error);
    }
  }, [searchTerm, activeTab, user?.id, selectedBranchId, user?.role, user?.branchId, user?.membership?.branchIds]);

  const loadProducts = useCallback(async () => {
    try {
      const response = await apiService.getProducts({ page: 1, limit: 1000 });
      if (response.success) {
        setProducts(response.data.products.map((product: any) => ({
          id: product.id,
          name: product.name,
          sku: product.sku || '',
          category: product.category ? {
            id: product.category.id,
            name: product.category.name,
            type: product.category.type || 'GENERAL'
          } : undefined,
        })));
      }
    } catch (error) {
      console.error('Error loading products:', error);
    }
  }, []);

  const loadSuppliers = useCallback(async () => {
    try {
      const response = await apiService.getSuppliers({ 
        page: 1, 
        limit: 1000,
        companyId: selectedCompanyId || '',
      });
      if (response.success) {
        setSuppliers(response.data.suppliers.map((supplier: any) => ({
          id: supplier.id,
          name: supplier.name,
          manufacturerId: supplier.manufacturerId,
          manufacturer: supplier.manufacturer ? {
            id: supplier.manufacturer.id,
            name: supplier.manufacturer.name
          } : undefined
        })));
      }
    } catch (error) {
      console.error('Error loading suppliers:', error);
    }
  }, []);

  const loadManufacturers = useCallback(async () => {
    try {
      const response = await apiService.getManufacturers({ page: 1, limit: 1000, active: true });
      if (response.success) {
        setManufacturers(response.data.manufacturers || []);
      }
    } catch (error) {
      console.error('Error loading manufacturers:', error);
    }
  }, []);

  const loadShelves = useCallback(async () => {
    try {
      const response = await apiService.getShelves({ page: 1, limit: 1000 });
      if (response.success) {
        setShelves(response.data.shelves);
      }
    } catch (error) {
      console.error('Error loading shelves:', error);
    }
  }, []);

  const loadNearExpiryBatches = useCallback(async () => {
    try {
      const response = await apiService.getNearExpiryBatches(30);
      if (response.success) {
        setNearExpiryBatches(response.data.map((batch: any) => ({
          id: batch.id,
          batchNo: batch.batchNo,
          productId: batch.productId,
          supplierId: batch.supplierId,
          supplierName: batch.supplierName,
          supplierOutstanding: batch.supplierOutstanding || 0,
          supplierInvoiceNo: batch.supplierInvoiceNo,
          expireDate: batch.expireDate,
          productionDate: batch.productionDate,
          shelfId: batch.shelfId,
          shelfName: batch.shelfName,
          isActive: batch.isActive,
          isReported: batch.isReported,
          reportReason: batch.reportReason || undefined, // Include report reason
          createdAt: batch.createdAt,
          updatedAt: batch.updatedAt,
          product: {
            id: batch.product.id,
            name: batch.product.name,
            sku: batch.product.sku || ''
          },
          supplier: batch.supplier ? {
            id: batch.supplier.id,
            name: batch.supplier.name
          } : undefined
        })));
      }
    } catch (error) {
      console.error('Error loading near expiry batches:', error);
    }
  }, []);

  // Cache reading disabled - batches will load fresh from API
  useEffect(() => {
    loadBatches();
  }, [activeTab, user?.id, selectedBranchId, selectedCompanyId, user?.role, user?.branchId, user?.membership?.branchIds]);

  // Check for prefill data from Order Purchase page
  useEffect(() => {
    const prefillData = sessionStorage.getItem('prefillBatchProduct');
    const urlParams = new URLSearchParams(window.location.search);
    const shouldAddNew = urlParams.get('addNew') === 'true';

    if (prefillData && shouldAddNew) {
      try {
        const data = JSON.parse(prefillData);
        // Find the product to get its ID
        const matchingProduct = products.find(p => p.id === data.productId);
        // Find the supplier by name
        const matchingSupplier = suppliers.find(s => s.name === data.supplier);

        if (matchingProduct || data.productId) {
          setFormData(prev => ({
            ...prev,
            productId: data.productId || '',
            supplierId: matchingSupplier?.id || '',
            supplierName: data.supplier || '',
            costPricePerUnit: data.unitPrice || 0,
            sellingPricePerUnit: data.unitPrice || 0, // Default sell price to cost
            minStockLevel: data.minStock || 10,
          }));
          setShowAddModal(true);
          toast({
            title: "➕ Add New Batch",
            description: `Creating new batch for "${data.productName}"`,
          });
        }
        // Clear the prefill data
        sessionStorage.removeItem('prefillBatchProduct');
        // Clear URL param
        window.history.replaceState({}, '', '/batches');
      } catch (error) {
        console.error('Error parsing prefill data:', error);
        sessionStorage.removeItem('prefillBatchProduct');
      }
    }
  }, [products, suppliers, toast]);

  // Close filter dropdown when clicking outside
  // CRITICAL FIX: Reload batches when activeTab changes (switch between Active and Reported tabs)
  useEffect(() => {
    console.log('🔄 activeTab changed to:', activeTab, '- reloading batches');
    loadBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // CRITICAL FIX: Reload batches instantly when branch OR company changes
  useEffect(() => {
    console.log('🔄 Branch/Company changed - reloading batches instantly:', { selectedBranchId, selectedCompanyId });
    const timer = setTimeout(() => {
      loadBatches();
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId, selectedCompanyId]);

  // Also listen to custom event for immediate reload
  useEffect(() => {
    const handleReload = () => {
      console.log('🔄 Custom event: Branch/Company changed - reloading batches');
      loadBatches();
    };
    window.addEventListener('branchOrCompanyChanged', handleReload);
    return () => window.removeEventListener('branchOrCompanyChanged', handleReload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showFilterDropdown) {
        const target = event.target as Element;
        if (!target.closest('.relative')) {
          setShowFilterDropdown(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilterDropdown]);

  useEffect(() => {
    loadProducts();
    loadSuppliers();
    loadManufacturers();
    loadShelves();
    loadNearExpiryBatches();
  }, [loadProducts, loadSuppliers, loadManufacturers, loadShelves, loadNearExpiryBatches]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterType, selectedSupplierFilter, selectedManufacturerFilter, activeTab]);

  // Handle form submission
  const handleSubmit = async () => {
    // Use batchType state instead of product category
    const isNonMedical = batchType === 'non-medical';

    // Validation
    if (!formData.batchNo.trim()) {
      toast({
        title: "❌ Batch Number Required",
        description: "Please enter a batch number to continue",
        variant: "destructive",
      });
      return;
    }

    if (!formData.productId) {
      toast({
        title: "❌ Product Selection Required",
        description: "Please select a product from the dropdown",
        variant: "destructive",
      });
      return;
    }

    if (!formData.supplierId) {
      toast({
        title: "❌ Supplier Selection Required",
        description: "Please select a supplier from the dropdown",
        variant: "destructive",
      });
      return;
    }

    // Production and Expiry dates are only required for Medical products
    if (!isNonMedical) {
      if (!formData.expireDate) {
        toast({
          title: "❌ Expiry Date Required",
          description: "Please select an expiry date for the batch",
          variant: "destructive",
        });
        return;
      }

      if (!formData.productionDate) {
        toast({
          title: "❌ Production Date Required",
          description: "Please select a production date for the batch",
          variant: "destructive",
        });
        return;
      }
    }

    // Tax Type is required for Non-Medical products
    if (isNonMedical && !formData.taxType) {
      toast({
        title: "❌ Tax Type Required",
        description: "Please select a tax type for the batch",
        variant: "destructive",
      });
      return;
    }

    if (!formData.shelfId) {
      toast({
        title: "❌ Shelf Selection Required",
        description: "Please select a shelf for the batch",
        variant: "destructive",
      });
      return;
    }

    if (!formData.shelfName || formData.shelfName.trim() === '') {
      toast({
        title: "❌ Shelf Name Required",
        description: "Please enter a shelf name for the batch",
        variant: "destructive",
      });
      return;
    }

    // Validate new pricing and stock fields
    if (!formData.costPricePerUnit || formData.costPricePerUnit <= 0) {
      toast({
        title: "❌ Cost Price Required",
        description: "Please enter a valid cost price per unit",
        variant: "destructive",
      });
      return;
    }

    if (!formData.sellingPricePerUnit || formData.sellingPricePerUnit <= 0) {
      toast({
        title: "❌ Selling Price Required",
        description: "Please enter a valid selling price per unit",
        variant: "destructive",
      });
      return;
    }

    if (!formData.stockQuantity || formData.stockQuantity <= 0) {
      toast({
        title: "❌ Stock Quantity Required",
        description: "Please enter a valid stock quantity",
        variant: "destructive",
      });
      return;
    }

    if (!formData.totalBoxes || formData.totalBoxes < 0) {
      toast({
        title: "❌ Total Boxes Required",
        description: "Please enter a valid total boxes count",
        variant: "destructive",
      });
      return;
    }

    if (!formData.unitsPerBox || formData.unitsPerBox <= 0) {
      toast({
        title: "❌ Units per Box Required",
        description: "Please enter a valid units per box count",
        variant: "destructive",
      });
      return;
    }

    try {
      // Don't set loading - instant response with optimistic update

      // Clean up form data - ensure required fields are provided
      // Map frontend field names to backend expected field names
      const cleanedFormData: any = {
        batchNo: formData.batchNo,
        productId: formData.productId,
        supplierId: formData.supplierId,
        supplierName: formData.supplierName || null,
        shelfId: formData.shelfId, // Required field - don't set to null
        shelfName: formData.shelfName.trim(), // Required field - don't set to null
        // Map pricing and stock fields to backend expected names
        purchasePrice: formData.costPricePerUnit,
        sellingPrice: formData.sellingPricePerUnit,
        quantity: formData.stockQuantity,
        totalBoxes: formData.totalBoxes || 0, // Required field
        unitsPerBox: formData.unitsPerBox || 1, // Required field
        // Only include isActive and isReported for updates, not for creation
        ...(editingBatch && {
          isActive: true, // Default to active for updates
          isReported: false, // Default to not reported for updates
        }),
      };

      // For medical products, include expireDate and productionDate
      if (!isNonMedical) {
        cleanedFormData.expireDate = formData.expireDate;
        cleanedFormData.productionDate = formData.productionDate;
      } else {
        // For non-medical products, include taxType
        cleanedFormData.taxType = formData.taxType;
      }

      if (editingBatch) {
        const batchToUpdate = editingBatch;
        const previousBatches = [...batches]; // Store for rollback

        // OPTIMISTIC UPDATE: Update batch in list IMMEDIATELY
        const updatedBatches = batches.map(b =>
          b.id === batchToUpdate.id
            ? { ...b, ...cleanedFormData, batchNo: formData.batchNo }
            : b
        );
        setBatches(updatedBatches);

        // Close dialog IMMEDIATELY
        setEditingBatch(null);
        resetForm();

        // Show success toast IMMEDIATELY
        toast({
          title: "✅ Batch Updated Successfully",
          description: `Batch "${formData.batchNo}" has been updated`,
        });

        // Update in background (non-blocking)
        console.log('🔍 Updating batch with data:', cleanedFormData);
        const response = await apiService.updateBatch(batchToUpdate.id, cleanedFormData);
        if (!response.success) {
          // Rollback on failure
          setBatches(previousBatches);
          toast({
            title: "❌ Update Failed",
            description: response.message || "Failed to update batch",
            variant: "destructive",
          });
        } else {
          // Reload in background to ensure sync
          setTimeout(() => loadBatches(), 0);
        }
      } else {
        // Find product and supplier for optimistic batch
        const product = products.find(p => p.id === formData.productId);
        const supplier = suppliers.find(s => s.id === formData.supplierId);

        // OPTIMISTIC UPDATE: Create temporary batch and add to list IMMEDIATELY
        const tempBatch: any = {
          id: `temp-${Date.now()}`,
          batchNo: formData.batchNo,
          productId: formData.productId,
          product: product ? { id: product.id, name: product.name, sku: product.sku || '' } : undefined,
          supplierId: formData.supplierId,
          supplier: supplier ? { id: supplier.id, name: supplier.name } : undefined,
          supplierName: formData.supplierName,
          shelfId: formData.shelfId,
          shelfName: formData.shelfName,
          quantity: formData.stockQuantity,
          totalBoxes: formData.totalBoxes,
          unitsPerBox: formData.unitsPerBox,
          purchasePrice: formData.costPricePerUnit,
          sellingPrice: formData.sellingPricePerUnit,
          costPricePerUnit: formData.costPricePerUnit,
          sellingPricePerUnit: formData.sellingPricePerUnit,
          ...(!isNonMedical && {
            expireDate: formData.expireDate,
            productionDate: formData.productionDate,
          }),
          ...(isNonMedical && {
            taxType: formData.taxType,
          }),
          isActive: true,
          isReported: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        // Add batch to list IMMEDIATELY
        setBatches([tempBatch, ...batches]);

        // Close dialog and reset form IMMEDIATELY
        setShowAddModal(false);
        resetForm();

        // Show success toast IMMEDIATELY
        toast({
          title: "✅ Batch Created Successfully",
          description: `New batch "${formData.batchNo}" has been added`,
        });

        // Create batch via API in background (non-blocking)
        const response = await apiService.createBatch(cleanedFormData);
        if (response.success && response.data) {
          // Replace temp batch with real batch
          const realBatch = response.data;
          const finalBatches = batches.map(b =>
            b.id === tempBatch.id ? realBatch : b
          );
          setBatches(finalBatches);

          // Reset search and filters to show new item
          setSearchTerm('');
          // Reload in background to ensure sync
          setTimeout(() => loadBatches(), 0);
        } else {
          // Rollback on failure
          setBatches(batches.filter(b => b.id !== tempBatch.id));
          toast({
            title: "❌ Creation Failed",
            description: response.message || "Failed to create batch",
            variant: "destructive",
          });
        }
      }
    } catch (error: any) {
      console.error('Error saving batch:', error);
      console.log('Error details:', {
        message: error.message,
        errors: error.errors,
        response: error.response
      });

      // Handle backend validation errors
      if (error.errors && error.errors.length > 0) {
        error.errors.forEach((err: string) => {
          toast({
            title: "❌ Validation Error",
            description: err,
            variant: "destructive",
          });
        });
      } else if (error.response && error.response.errors && error.response.errors.length > 0) {
        error.response.errors.forEach((err: string) => {
          toast({
            title: "❌ Validation Error",
            description: err,
            variant: "destructive",
          });
        });
      } else {
        toast({
          title: "❌ Failed to Save Batch",
          description: error.message || "An error occurred while saving the batch. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  const resetForm = () => {
    setFormData({
      batchNo: '',
      productId: '',
      supplierId: '',
      supplierName: '',
      expireDate: '',
      productionDate: '',
      shelfId: '',
      shelfName: '',
      // New pricing and stock fields
      costPricePerUnit: 0,
      costPricePerBox: 0,
      sellingPricePerUnit: 0,
      sellingPricePerBox: 0,
      stockQuantity: 0,
      totalBoxes: 0,
      unitsPerBox: 1,
      minStockLevel: 10,
      taxType: '',
    });
    // Reset batch type to medical when form is reset
    setBatchType('medical');
  };

  // Add new batch for the same product (pre-fills product and supplier)
  const handleAddBatchForProduct = (batch: Batch) => {
    // Reset ALL form values to empty/default - nothing should be pre-filled
    setFormData({
      batchNo: '',
      productId: '',
      supplierId: '',
      supplierName: '',
      expireDate: '',
      productionDate: '',
      shelfId: '',
      shelfName: '',
      // Reset all pricing and stock fields to default values
      costPricePerUnit: 0,
      costPricePerBox: 0,
      sellingPricePerUnit: 0,
      sellingPricePerBox: 0,
      stockQuantity: 0,
      totalBoxes: 0,
      unitsPerBox: 1,
      minStockLevel: 10,
      taxType: '',
    });
    setEditingBatch(null); // Make sure we're not in edit mode
    setShowAddModal(true);
    toast({
      title: "➕ Add New Batch",
      description: "Creating new batch - all fields are reset",
    });
  };

  const handleEdit = (batch: Batch) => {
    setEditingBatch(batch);

    // Detect if batch is medical or non-medical
    // Non-medical batches have taxType and no expireDate/productionDate
    const isNonMedicalBatch = (batch as any).taxType && (!batch.expireDate && !batch.productionDate);
    setBatchType(isNonMedicalBatch ? 'non-medical' : 'medical');

    // Calculate unit prices
    const costPricePerUnit = batch.costPricePerUnit || batch.purchasePrice || 0;
    const sellingPricePerUnit = batch.sellingPricePerUnit || batch.sellingPrice || 0;
    const unitsPerBox = batch.unitsPerBox || 1;

    // Calculate box prices from unit prices
    const costPricePerBox = batch.costPricePerBox || (costPricePerUnit * unitsPerBox);
    const sellingPricePerBox = batch.sellingPricePerBox || (sellingPricePerUnit * unitsPerBox);

    setFormData({
      batchNo: batch.batchNo,
      productId: batch.productId,
      supplierId: batch.supplierId || '',
      supplierName: batch.supplierName || '',
      expireDate: safeFormatDateForInput(batch.expireDate),
      productionDate: safeFormatDateForInput(batch.productionDate),
      shelfId: batch.shelfId || '',
      shelfName: batch.shelfName || '',
      // Use actual batch data for pricing and stock fields
      costPricePerUnit: costPricePerUnit,
      costPricePerBox: costPricePerBox,
      sellingPricePerUnit: sellingPricePerUnit,
      sellingPricePerBox: sellingPricePerBox,
      stockQuantity: batch.quantity || batch.totalStock || batch.stockQuantity || 0,
      totalBoxes: batch.totalBoxes || 0,
      unitsPerBox: unitsPerBox,
      minStockLevel: batch.minStockLevel || 10,
      taxType: (batch as any).taxType || '', // Include taxType for non-medical batches
    });
  };


  const handleDeleteClick = (batch: Batch) => {
    setDeletingBatch(batch);
  };

  const handleConfirmDelete = async () => {
    if (!deletingBatch) return;

    const batchToDelete = deletingBatch;
    const previousBatches = [...batches]; // Store for rollback

    // OPTIMISTIC UPDATE: Remove batch from list IMMEDIATELY
    const updatedBatches = batches.filter(b => b.id !== batchToDelete.id);
    setBatches(updatedBatches);

    // Close dialog IMMEDIATELY
    setDeletingBatch(null);

    // Show success toast IMMEDIATELY
    toast({
      title: "✅ Batch Deleted Successfully",
      description: `Batch "${batchToDelete.batchNo}" has been removed from the system`,
    });

    // Delete in background (non-blocking)
    try {
      const response = await apiService.deleteBatch(batchToDelete.id);
      if (!response.success) {
        // Rollback on failure
        setBatches(previousBatches);
        toast({
          title: "❌ Failed to Delete Batch",
          description: response.message || "Failed to delete batch",
          variant: "destructive",
        });
      } else {
        // Reload in background to ensure sync
        setTimeout(() => loadBatches(), 0);
      }
    } catch (error) {
      console.error('Error deleting batch:', error);
      // Rollback on error
      setBatches(previousBatches);
      toast({
        title: "❌ Failed to Delete Batch",
        description: "An error occurred while deleting the batch. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleViewBatch = (batch: Batch) => {
    setViewingBatch(batch);
  };

  // Download batch history as CSV
  const handleDownloadBatchHistory = () => {
    try {
      // Prepare CSV data
      const csvHeaders = [
        'Batch No',
        'Product Name',
        'Product SKU',
        'Supplier',
        'Stock Quantity',
        'Cost Price',
        'Selling Price',
        'Production Date',
        'Expiry Date',
        'Shelf',
        'Status',
        'Created At'
      ];

      const csvData = batches.map(batch => [
        batch.batchNo,
        batch.product?.name || 'N/A',
        batch.product?.sku || 'N/A',
        batch.supplier?.name || 'N/A',
        batch.quantity || 0,
        batch.purchasePrice || 0,
        batch.sellingPrice || 0,
        safeFormatDate(batch.productionDate, 'yyyy-MM-dd'),
        safeFormatDate(batch.expireDate, 'yyyy-MM-dd'),
        batch.shelfName || 'N/A',
        batch.isActive ? 'Active' : 'Inactive',
        safeFormatDate(batch.createdAt, 'yyyy-MM-dd HH:mm:ss')
      ]);

      // Create CSV content
      const csvContent = [
        csvHeaders.join(','),
        ...csvData.map(row => row.map(field => `"${field}"`).join(','))
      ].join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `batch_history_${safeFormatDate(new Date(), 'yyyy-MM-dd_HH-mm-ss', 'now')}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "✅ Download Successful",
        description: `Batch history has been downloaded successfully`,
      });
    } catch (error) {
      console.error('Error downloading batch history:', error);
      toast({
        title: "❌ Download Failed",
        description: "An error occurred while downloading the batch history",
        variant: "destructive",
      });
    }
  };

  const handleReportBatch = (batch: Batch) => {
    // Open the report reason modal
    setReportingBatch(batch);
    setReportReason('');
  };

  const handleRestoreBatch = async (batch: Batch) => {
    try {
      // Update batch to mark as not reported (restore to active)
      const response = await apiService.updateBatch(batch.id, {
        isReported: false,
        reportReason: null,
        reportedBy: null,
      } as any);

      if (response.success) {
        toast({
          title: "✅ Batch Restored",
          description: `Batch "${batch.batchNo}" has been restored and moved back to Active Batches`,
        });
        // Reload batches to reflect the change
        loadBatches();
        // Switch to active tab to show the restored batch
        setActiveTab('active');
      } else {
        toast({
          title: "❌ Restore Failed",
          description: response.message || "Failed to restore batch. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Error restoring batch:', error);
      toast({
        title: "❌ Restore Failed",
        description: error?.response?.data?.message || error?.message || "Failed to restore batch. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSubmitReport = async () => {
    if (!reportingBatch) return;

    // Validate reason
    if (!reportReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for reporting this batch",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSubmittingReport(true);
      // Update batch to mark as reported with reason and reportedBy
      // Schema now allows optional fields, so we only need to send what we're updating
      const reportedByValue = user?.name || user?.username || user?.id || 'Unknown';
      const response = await apiService.updateBatch(reportingBatch.id, {
        isReported: true,
        reportReason: reportReason.trim(),
        reportedBy: reportedByValue,
      } as any);

      if (response.success) {
        toast({
          title: "✅ Batch Reported",
          description: `Batch "${reportingBatch.batchNo}" has been reported and moved to Reported Batches`,
        });
        // Close modal and reset state
        setReportingBatch(null);
        setReportReason('');
        // Reload batches to reflect the change
        loadBatches();
      } else {
        toast({
          title: "❌ Report Failed",
          description: response.message || "Failed to report batch",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error reporting batch:', error);
      toast({
        title: "❌ Report Failed",
        description: "An error occurred while reporting the batch",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingReport(false);
    }
  };

  // Filter batches based on selected filter type
  const getFilteredBatches = () => {
    let filteredBatches = batches;

    // Apply search filter
    if (searchTerm) {
      filteredBatches = filteredBatches.filter(batch =>
        batch.batchNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        batch.product?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        batch.supplier?.name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Apply type filter
    switch (filterType) {
      case 'near-expiry':
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        filteredBatches = filteredBatches.filter(batch => {
          if (!batch.expireDate) return false;
          const expiryDate = new Date(batch.expireDate);
          if (isNaN(expiryDate.getTime())) return false;
          return expiryDate <= thirtyDaysFromNow && expiryDate > new Date();
        });
        break;
      case 'expired':
        filteredBatches = filteredBatches.filter(batch => {
          if (!batch.expireDate) return false;
          const expiryDate = new Date(batch.expireDate);
          if (isNaN(expiryDate.getTime())) return false;
          return expiryDate < new Date();
        });
        break;
      case 'low-stock':
        filteredBatches = filteredBatches.filter(batch => {
          const stock = batch.quantity || 0;
          const minStock = batch.minStockLevel || 10;
          // Include batch if:
          // 1. Stock is at or below the minStockLevel threshold, OR
          // 2. Stock is critically low (<= 20 units) as a safety check
          return stock <= minStock || stock <= 20;
        });
        break;
      case 'all':
      default:
        // No additional filtering
        break;
    }

    // Apply manufacturer filter
    if (selectedManufacturerFilter !== 'all') {
      filteredBatches = filteredBatches.filter(batch => {
        if (batch.supplierId) {
          const supplier = suppliers.find(s => s.id === batch.supplierId);
          if (supplier && supplier.manufacturerId) {
            return supplier.manufacturerId === selectedManufacturerFilter;
          }
        }
        return false;
      });
    }

    // Apply supplier filter
    if (selectedSupplierFilter !== 'all') {
      filteredBatches = filteredBatches.filter(batch =>
        batch.supplierId === selectedSupplierFilter
      );
    }

    return filteredBatches;
  };

  const handleFilterChange = (filter: string) => {
    setFilterType(filter);
    setShowFilterDropdown(false);
  };


  const isNearExpiry = (expireDate: string | Date | number | undefined | null) => {
    if (!expireDate) return false;
    let expiry: Date;
    if (expireDate instanceof Date) {
      expiry = expireDate;
    } else if (typeof expireDate === 'number') {
      expiry = new Date(expireDate);
    } else if (typeof expireDate === 'string') {
      expiry = new Date(expireDate);
    } else {
      return false;
    }

    if (isNaN(expiry.getTime())) return false;

    const now = new Date();
    const diffTime = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 30 && diffDays > 0;
  };

  const isExpired = (expireDate: string | Date | number | undefined | null) => {
    if (!expireDate) return false;
    let expiry: Date;
    if (expireDate instanceof Date) {
      expiry = expireDate;
    } else if (typeof expireDate === 'number') {
      expiry = new Date(expireDate);
    } else if (typeof expireDate === 'string') {
      expiry = new Date(expireDate);
    } else {
      return false;
    }

    if (isNaN(expiry.getTime())) return false;

    const now = new Date();
    return expiry < now;
  };

  const filteredBatches = getFilteredBatches();
  const totalCount = filteredBatches.length;
  const totalPages = Math.max(1, Math.ceil(filteredBatches.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedBatches = filteredBatches.slice((safePage - 1) * pageSize, safePage * pageSize);

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
      <div className="zv3-animate-fadeUp flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">Batches</h1>
          <p className="text-sm text-[#8c95b0]">
            Manage product batches and inventory
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownloadBatchHistory}
            className="rounded-[10px] border border-[rgba(15,23,60,0.06)] font-semibold text-[#4a5578] hover:bg-white"
          >
            <Download className="mr-2 h-4 w-4" strokeWidth={2} />
            Export history
          </Button>
          <Button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(26,82,197,0.35)]"
          >
            <Plus className="mr-2 h-4 w-4 stroke-[2.5]" strokeLinecap="round" />
            Add batch
          </Button>
        </div>
      </div>

      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
              <DialogHeader className="space-y-2 pr-10 text-left">
                <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Add new batch</DialogTitle>
                <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
                  Enter the details for the new product batch.
                </DialogDescription>
              </DialogHeader>
              
              {/* Medical/Non-Medical Tabs */}
              <div className="flex gap-1 mb-6 border-b border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    console.log('🔍 Clicked Medical tab');
                    setBatchType('medical');
                    // Clear taxType when switching to medical
                    setFormData(prev => ({
                      ...prev,
                      taxType: '',
                    }));
                  }}
                  className={`px-6 py-3 font-semibold text-sm transition-all duration-200 relative ${
                    batchType === 'medical'
                      ? 'text-blue-600 bg-blue-50 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-current opacity-60"></span>
                    Medical
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    console.log('🔍 Clicked Non-Medical tab');
                    setBatchType('non-medical');
                    // Clear dates when switching to non-medical
                    setFormData(prev => ({
                      ...prev,
                      expireDate: '',
                      productionDate: '',
                    }));
                  }}
                  className={`px-6 py-3 font-semibold text-sm transition-all duration-200 relative ${
                    batchType === 'non-medical'
                      ? 'text-blue-600 bg-blue-50 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-current opacity-60"></span>
                    Non-Medical
                  </span>
                </button>
              </div>

              <BatchForm
                formData={formData}
                setFormData={setFormData}
                products={products}
                suppliers={suppliers}
                shelves={shelves}
                onSubmit={handleSubmit}
                onCancel={() => {
                  setShowAddModal(false);
                  resetForm();
                  setBatchType('medical'); // Reset to medical when canceling
                }}
                editingBatch={editingBatch}
                isSubmitting={isSubmitting}
                setIsSupplierDialogOpen={setIsSupplierDialogOpen}
                setIsProductDialogOpen={setIsProductDialogOpen}
                setIsShelfDialogOpen={setIsShelfDialogOpen}
                batchType={batchType}
              />
            </DialogContent>
          </Dialog>

      {/* Filters and Search */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div className="flex gap-4 items-center">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="active">Active Batches</TabsTrigger>
                  <TabsTrigger value="reported">Reported Batches</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search batches..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <Select value={selectedSupplierFilter} onValueChange={setSelectedSupplierFilter}>
                <SelectTrigger className="w-48 bg-blue-50 border-blue-200 text-blue-900 hover:bg-blue-100">
                  <SelectValue placeholder="Filter by Supplier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Suppliers</SelectItem>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedManufacturerFilter} onValueChange={setSelectedManufacturerFilter}>
                <SelectTrigger className="w-48 bg-purple-50 border-purple-200 text-purple-900 hover:bg-purple-100">
                  <SelectValue placeholder="Filter by Manufacturer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Manufacturers</SelectItem>
                  {manufacturers.map((manufacturer) => (
                    <SelectItem key={manufacturer.id} value={manufacturer.id}>
                      {manufacturer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                  className="bg-indigo-50 border-indigo-200 text-indigo-900 hover:bg-indigo-100 focus:ring-indigo-500"
                >
                  <Filter className="w-4 h-4 mr-2" />
                  All Batches
                </Button>
                {showFilterDropdown && (
                  <div className="absolute right-0 mt-2 w-48 bg-indigo-50 border border-indigo-200 rounded-md shadow-lg z-10">
                    <div className="py-1">
                      <button
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-indigo-100 hover:text-indigo-900 transition-colors duration-150 ${
                          filterType === 'all' ? 'bg-indigo-100 text-indigo-900' : 'text-indigo-700'
                        }`}
                        onClick={() => handleFilterChange('all')}
                      >
                        All Batches
                      </button>
                      <button
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-indigo-100 hover:text-indigo-900 transition-colors duration-150 ${
                          filterType === 'near-expiry' ? 'bg-indigo-100 text-indigo-900' : 'text-indigo-700'
                        }`}
                        onClick={() => handleFilterChange('near-expiry')}
                      >
                        Near Expiry
                      </button>
                      <button
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-indigo-100 hover:text-indigo-900 transition-colors duration-150 ${
                          filterType === 'expired' ? 'bg-indigo-100 text-indigo-900' : 'text-indigo-700'
                        }`}
                        onClick={() => handleFilterChange('expired')}
                      >
                        Expired
                      </button>
                      <button
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-indigo-100 hover:text-indigo-900 transition-colors duration-150 ${
                          filterType === 'low-stock' ? 'bg-indigo-100 text-indigo-900' : 'text-indigo-700'
                        }`}
                        onClick={() => handleFilterChange('low-stock')}
                      >
                        Low Stock
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Near expiry — Zapeera alert */}
      {nearExpiryBatches.length > 0 && (
        <div className="rounded-[22px] border border-amber-500/18 bg-gradient-to-br from-amber-500/[0.07] via-white to-orange-500/[0.04] px-5 py-4 shadow-[0_4px_24px_rgba(245,158,11,0.06)] sm:px-6 sm:py-5">
          <div className="flex gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-500/12 text-amber-700">
              <AlertTriangle className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold tracking-tight text-[#0a1128]">
                Near expiry medicines{" "}
                <span className="font-extrabold text-amber-700">({nearExpiryBatches.length})</span>
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-[#8c95b0]">
                Some batches expire within <span className="font-semibold text-[#4a5578]">30 days</span>. Review
                stock, rotate product, or create a purchase order.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Batch list table — Zapeera card */}
      <div className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Package className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
            <div>
              <h2 className="text-[17px] font-bold text-[#0a1128]">Batch list</h2>
              <p className="text-sm text-[#8c95b0]">Manage batches and track inventory</p>
            </div>
            <span className="text-sm font-medium text-[#8c95b0]">({totalCount})</span>
          </div>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                  <th className="px-5 py-3.5 pl-8 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                    Batch no.
                  </th>
                  <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                    Product
                  </th>
                  <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                    Supplier
                  </th>
                  <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                    Stock
                  </th>
                  <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                    Expire date
                  </th>
                  <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                    Status
                  </th>
                  {activeTab === "reported" && (
                    <>
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Reported by
                      </th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Reason
                      </th>
                    </>
                  )}
                  <th className="px-5 py-3.5 pr-8 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.length === 0 ? (
                  <tr>
                    <td
                      colSpan={activeTab === "reported" ? 9 : 7}
                      className="px-8 py-16 text-center text-sm text-[#8c95b0]"
                    >
                      No batches match your filters.
                    </td>
                  </tr>
                ) : (
                  paginatedBatches.map((batch) => {
                    const qty = batch.quantity || 0;
                    const qtyColor =
                      qty <= 10 ? "text-red-600" : qty <= 50 ? "text-amber-600" : "text-[#0a1128]";
                    return (
                      <tr
                        key={batch.id}
                        className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                      >
                        <td className="px-5 py-4 pl-8 align-middle font-mono text-[13px] font-semibold text-[#0a1128]">
                          {batch.batchNo}
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <div className="font-semibold text-[#0a1128]">{batch.product.name}</div>
                          <div className="mt-0.5 text-[13px] text-[#8c95b0]">{batch.product.sku}</div>
                        </td>
                        <td className="px-5 py-4 align-middle text-[13px] text-[#4a5578]">
                          {batch.supplierName || "N/A"}
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <div className="flex items-start gap-2.5">
                            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[rgba(26,82,197,0.08)] to-[rgba(40,194,206,0.06)] text-[#1a52c5]">
                              <Package className="h-4 w-4" strokeWidth={2} />
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className={cn("text-lg font-extrabold leading-none tabular-nums", qtyColor)}>
                                {qty}
                              </span>
                              <span className="text-[11px] font-medium uppercase tracking-wide text-[#8c95b0]">
                                units
                              </span>
                              {qty <= 10 && (
                                <span className="mt-0.5 inline-flex w-fit rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-800">
                                  Low stock
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          {batch.expireDate ? (
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                              <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                                <Calendar className="h-4 w-4 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                                {safeFormatDate(batch.expireDate, "MMM dd, yyyy")}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {isExpired(batch.expireDate) && (
                                  <span className="inline-flex rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-800">
                                    Expired
                                  </span>
                                )}
                                {isNearExpiry(batch.expireDate) && !isExpired(batch.expireDate) && (
                                  <span className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                                    Near expiry
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[13px] text-[#8c95b0]">N/A</span>
                          )}
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <span
                            className={cn(
                              "inline-flex rounded-md px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                              batch.isActive
                                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border border-[rgba(15,23,60,0.1)] bg-[#f0f2f7] text-[#4a5578]",
                            )}
                          >
                            {batch.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        {activeTab === "reported" && (
                          <>
                            <td className="px-5 py-4 align-middle text-[13px] text-[#4a5578]">
                              {(batch.reportedByName && batch.reportedByName.trim()) ||
                              (batch.reportedBy && batch.reportedBy.trim())
                                ? batch.reportedByName || batch.reportedBy
                                : batch.isReported
                                  ? "Unknown"
                                  : "N/A"}
                            </td>
                            <td className="px-5 py-4 align-middle text-[13px] text-[#4a5578]">
                              {batch.reportReason && batch.reportReason.trim() ? (
                                batch.reportReason.length > 50 ? (
                                  <span>
                                    {batch.reportReason.substring(0, 50)}…{" "}
                                    <button
                                      type="button"
                                      className="text-[13px] font-semibold text-[#1a52c5] underline-offset-2 hover:underline"
                                      onClick={() => setViewingReasonBatch(batch)}
                                    >
                                      View
                                    </button>
                                  </span>
                                ) : (
                                  batch.reportReason
                                )
                              ) : (
                                <span className="text-[#8c95b0]">N/A</span>
                              )}
                            </td>
                          </>
                        )}
                        <td className="px-5 py-4 pr-8 text-right align-middle">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleViewBatch(batch)}
                              title="View details"
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.08)] bg-white text-[#4a5578] transition-colors hover:border-[#1a52c5]/25 hover:bg-[rgba(26,82,197,0.06)] hover:text-[#1a52c5]"
                            >
                              <Eye className="h-4 w-4" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddBatchForProduct(batch)}
                              title="Add batch for this product"
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.08)] bg-white text-[#4a5578] transition-colors hover:border-[#1a52c5]/25 hover:bg-[rgba(26,82,197,0.06)] hover:text-[#1a52c5]"
                            >
                              <Plus className="h-4 w-4" strokeWidth={2} />
                            </button>
                            {activeTab === "active" && !batch.isReported && (
                              <button
                                type="button"
                                onClick={() => handleReportBatch(batch)}
                                title="Report batch"
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.08)] bg-white text-[#4a5578] transition-colors hover:border-amber-300/60 hover:bg-amber-50 hover:text-amber-800"
                              >
                                <Flag className="h-4 w-4" strokeWidth={2} />
                              </button>
                            )}
                            {activeTab === "reported" && batch.isReported && batch.reportReason && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setViewingReasonBatch(batch)}
                                title="View report reason"
                                className="h-8 rounded-[8px] border border-[rgba(15,23,60,0.08)] px-2.5 text-xs font-semibold text-[#1a52c5] hover:bg-[rgba(26,82,197,0.06)]"
                              >
                                Reason
                              </Button>
                            )}
                            {activeTab === "reported" && batch.isReported && (
                              <button
                                type="button"
                                onClick={() => handleRestoreBatch(batch)}
                                title="Restore to active"
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.08)] bg-white text-[#4a5578] transition-colors hover:border-emerald-300/60 hover:bg-emerald-50 hover:text-emerald-800"
                              >
                                <RotateCcw className="h-4 w-4" strokeWidth={2} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteClick(batch)}
                              title="Delete"
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.08)] bg-white text-[#4a5578] transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={2} />
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
          {filteredBatches.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4 border-t border-[rgba(15,23,60,0.06)]">
              <div className="flex items-center gap-3">
                <div className="text-sm text-[#8c95b0]">
                  Showing {((safePage - 1) * pageSize) + 1} to {Math.min(safePage * pageSize, filteredBatches.length)} of {filteredBatches.length} batches
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
      </div>

      {/* Edit Modal */}
      {editingBatch && (
        <Dialog open={!!editingBatch} onOpenChange={() => setEditingBatch(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Batch</DialogTitle>
              <DialogDescription>
                Update the batch information
              </DialogDescription>
            </DialogHeader>
            
            {/* Medical/Non-Medical Tabs for Edit */}
            <div className="flex gap-1 mb-6 border-b border-gray-200">
              <button
                type="button"
                onClick={() => setBatchType('medical')}
                className={`px-6 py-3 font-semibold text-sm transition-all duration-200 relative ${
                  batchType === 'medical'
                    ? 'text-blue-600 bg-blue-50 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-current opacity-60"></span>
                  Medical
                </span>
              </button>
              <button
                type="button"
                onClick={() => setBatchType('non-medical')}
                className={`px-6 py-3 font-semibold text-sm transition-all duration-200 relative ${
                  batchType === 'non-medical'
                    ? 'text-blue-600 bg-blue-50 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-current opacity-60"></span>
                  Non-Medical
                </span>
              </button>
            </div>

            <BatchForm
              formData={formData}
              setFormData={setFormData}
              products={products}
              suppliers={suppliers}
              shelves={shelves}
              onSubmit={handleSubmit}
              onCancel={() => {
                setEditingBatch(null);
                resetForm();
                setBatchType('medical'); // Reset to medical when canceling
              }}
              editingBatch={editingBatch}
              isSubmitting={isSubmitting}
              setIsSupplierDialogOpen={setIsSupplierDialogOpen}
              setIsProductDialogOpen={setIsProductDialogOpen}
              setIsShelfDialogOpen={setIsShelfDialogOpen}
              batchType={batchType}
            />
          </DialogContent>
        </Dialog>
      )}


      {/* Batch Details Modal */}
      {viewingBatch && (
        <Dialog open={!!viewingBatch} onOpenChange={() => setViewingBatch(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Batch Details - {viewingBatch.batchNo}</DialogTitle>
              <DialogDescription>
                Complete information for batch {viewingBatch.batchNo}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              {/* Basic Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-500">Product Information</Label>
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                      <div className="font-medium">{viewingBatch.product.name}</div>
                      <div className="text-sm text-gray-600">SKU: {viewingBatch.product.sku}</div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-500">Supplier</Label>
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                      <div className="font-medium">{viewingBatch.supplierName || 'N/A'}</div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-500">Batch Number</Label>
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                      <div className="font-medium">{viewingBatch.batchNo}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-500">Stock Information</Label>
                    <div className="mt-2 p-3 bg-blue-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Package className="w-5 h-5 text-blue-600" />
                        <span className="text-2xl font-bold text-blue-600">
                          {viewingBatch.quantity || 0}
                        </span>
                        <span className="text-gray-600">units</span>
                      </div>
                      {(viewingBatch.quantity || 0) <= 10 && (
                        <Badge className="bg-red-100 text-red-800 text-xs mt-2">
                          Low Stock
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-500">Status</Label>
                    <div className="mt-2">
                      <Badge className={viewingBatch.isActive ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'}>
                        {viewingBatch.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                      {viewingBatch.isReported && (
                        <Badge className="bg-orange-500 text-white ml-2">Reported</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Dates and Expiry */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label className="text-sm font-medium text-gray-500">Production Date</Label>
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                    {viewingBatch.productionDate ? (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        {safeFormatDate(viewingBatch.productionDate, 'MMM dd, yyyy')}
                      </div>
                    ) : (
                      'N/A'
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">Expiry Date</Label>
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                    {viewingBatch.expireDate ? (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        {safeFormatDate(viewingBatch.expireDate, 'MMM dd, yyyy')}
                        {isExpired(viewingBatch.expireDate) && (
                          <Badge className="bg-red-500 text-white">Expired</Badge>
                        )}
                        {isNearExpiry(viewingBatch.expireDate) && !isExpired(viewingBatch.expireDate) && (
                          <Badge className="bg-orange-500 text-white">Near Expiry</Badge>
                        )}
                      </div>
                    ) : (
                      'N/A'
                    )}
                  </div>
                </div>
              </div>

              {/* Pricing Information */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <Label className="text-sm font-medium text-gray-500">Cost Price</Label>
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                    <div className="font-medium">PKR {viewingBatch.purchasePrice || viewingBatch.costPrice || 0}</div>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">Selling Price</Label>
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                    <div className="font-medium">PKR {viewingBatch.sellingPrice || 0}</div>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">Total Boxes</Label>
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                    <div className="font-medium">{viewingBatch.totalBoxes || 0}</div>
                  </div>
                </div>
              </div>

              {/* Additional Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label className="text-sm font-medium text-gray-500">Shelf Location</Label>
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                    <div className="font-medium">{viewingBatch.shelfName || 'N/A'}</div>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">Purchasing Method</Label>
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                    <div className="font-medium">{viewingBatch.purchasingMethod || 'N/A'}</div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setViewingBatch(null)}
                >
                  Close
                </Button>
                <Button
                  onClick={() => {
                    setViewingBatch(null);
                    handleEdit(viewingBatch);
                  }}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Batch
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Report Reason Modal */}
      <Dialog open={!!reportingBatch} onOpenChange={(open) => {
        if (!open) {
          setReportingBatch(null);
          setReportReason('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Batch</DialogTitle>
            <DialogDescription>
              Please provide a reason for reporting batch "{reportingBatch?.batchNo}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="reportReason">Reason for Reporting</Label>
              <Textarea
                id="reportReason"
                placeholder="Enter the reason for reporting this batch (e.g., damaged goods, expired, quality issues, etc.)"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                rows={4}
                className="mt-2"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setReportingBatch(null);
                  setReportReason('');
                }}
                disabled={isSubmittingReport}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmitReport}
                disabled={isSubmittingReport || !reportReason.trim()}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {isSubmittingReport ? 'Submitting...' : 'Submit Report'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Report Reason Dialog */}
      <Dialog open={!!viewingReasonBatch} onOpenChange={(open) => {
        if (!open) {
          setViewingReasonBatch(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Details</DialogTitle>
            <DialogDescription>
              Batch: {viewingReasonBatch?.batchNo}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium text-gray-700">Reported By</Label>
              <p className="mt-1 text-sm text-gray-900">
                {viewingReasonBatch?.reportedByName || viewingReasonBatch?.reportedBy || 'Unknown'}
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium text-gray-700">Reason</Label>
              <p className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                {viewingReasonBatch?.reportReason || 'No reason provided'}
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => setViewingReasonBatch(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!deletingBatch}
        onClose={() => setDeletingBatch(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Batch"
        description="Are you sure you want to delete this batch? This action cannot be undone."
        confirmText="Delete Batch"
        cancelText="Cancel"
        variant="danger"
        isLoading={false}
        loadingText=""
        itemName={deletingBatch ? `Batch: ${deletingBatch.batchNo}` : undefined}
        itemDetails="This will permanently remove the batch and all associated data."
        icon={<Trash2 className="w-4 h-4" />}
      />

      {/* Add New Supplier Dialog */}
      <Dialog open={isSupplierDialogOpen} onOpenChange={setIsSupplierDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Supplier</DialogTitle>
            <DialogDescription>
              Create a new supplier for your inventory
            </DialogDescription>
          </DialogHeader>
          <SupplierForm
            onSuccess={(supplier) => {
              setSuppliers([...suppliers, supplier]);
              setFormData({ ...formData, supplierId: supplier.id, supplierName: supplier.name });
              setIsSupplierDialogOpen(false);
            }}
            onCancel={() => setIsSupplierDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Add New Product Dialog */}
      <Dialog open={isProductDialogOpen} onOpenChange={setIsProductDialogOpen}>
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
          <ProductForm
            onSuccess={async (product) => {
              console.log('✅ Product created successfully:', product);
              
              // CRITICAL FIX: Reload products list to ensure new product appears in dropdown
              // The product might have additional fields that need to be fetched
              try {
                await loadProducts();
                console.log('✅ Products list reloaded after product creation');
              } catch (error) {
                console.error('Error reloading products:', error);
                // Fallback: Add product to list manually if reload fails
                const newProduct = {
                  id: product.id,
                  name: product.name || product.name,
                  sku: product.sku || ''
                };
                setProducts(prev => {
                  // Check if product already exists
                  const exists = prev.find(p => p.id === newProduct.id);
                  if (exists) {
                    return prev;
                  }
                  return [...prev, newProduct];
                });
              }
              
              // Set the newly created product in form
              setFormData({ ...formData, productId: product.id });
              setIsProductDialogOpen(false);
              
              toast({
                title: "Success",
                description: `Product "${product.name}" created successfully and added to dropdown`,
              });
            }}
            onCancel={() => setIsProductDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Add New Shelf Dialog */}
      <Dialog open={isShelfDialogOpen} onOpenChange={setIsShelfDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Shelf</DialogTitle>
            <DialogDescription>
              Create a new shelf for your inventory
            </DialogDescription>
          </DialogHeader>
          <ShelfForm
            onSuccess={(shelf) => {
              setShelves([...shelves, shelf]);
              setFormData({ ...formData, shelfId: shelf.id, shelfName: shelf.name });
              setIsShelfDialogOpen(false);
            }}
            onCancel={() => setIsShelfDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      </div>
    </div>
  );
};

// Link Icon Component
const LinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

// Batch Form Component
interface BatchFormProps {
  formData: any;
  setFormData: (data: any) => void;
  products: Product[];
  suppliers: Supplier[];
  shelves: Shelf[];
  onSubmit: () => void;
  onCancel: () => void;
  editingBatch?: Batch | null;
  isSubmitting?: boolean;
  setIsSupplierDialogOpen: (open: boolean) => void;
  setIsProductDialogOpen: (open: boolean) => void;
  setIsShelfDialogOpen: (open: boolean) => void;
  batchType?: 'medical' | 'non-medical'; // Add batchType prop
}

const BatchForm: React.FC<BatchFormProps> = ({
  formData,
  setFormData,
  products,
  suppliers,
  shelves,
  onSubmit,
  onCancel,
  editingBatch,
  isSubmitting = false,
  setIsSupplierDialogOpen,
  setIsProductDialogOpen,
  setIsShelfDialogOpen,
  batchType = 'medical' // Default to medical
}) => {
  // Calculate total stock (units) from boxes
  const totalStockUnits = (formData.totalBoxes || 0) * (formData.unitsPerBox || 1);

  // Use batchType prop instead of product category
  const isNonMedical = batchType === 'non-medical';
  
  // Debug log to verify batchType
  console.log('🔍 BatchForm - batchType:', batchType, 'isNonMedical:', isNonMedical);

  // Handle cost price per unit change - auto calculate box price
  const handleCostPerUnitChange = (value: number) => {
    const unitsPerBox = formData.unitsPerBox || 1;
    setFormData({
      ...formData,
      costPricePerUnit: value,
      costPricePerBox: value * unitsPerBox
    });
  };

  // Handle cost price per box change - auto calculate unit price
  const handleCostPerBoxChange = (value: number) => {
    const unitsPerBox = formData.unitsPerBox || 1;
    setFormData({
      ...formData,
      costPricePerBox: value,
      costPricePerUnit: unitsPerBox > 0 ? value / unitsPerBox : 0
    });
  };

  // Handle sell price per unit change - auto calculate box price
  const handleSellPerUnitChange = (value: number) => {
    const unitsPerBox = formData.unitsPerBox || 1;
    setFormData({
      ...formData,
      sellingPricePerUnit: value,
      sellingPricePerBox: value * unitsPerBox
    });
  };

  // Handle sell price per box change - auto calculate unit price
  const handleSellPerBoxChange = (value: number) => {
    const unitsPerBox = formData.unitsPerBox || 1;
    setFormData({
      ...formData,
      sellingPricePerBox: value,
      sellingPricePerUnit: unitsPerBox > 0 ? value / unitsPerBox : 0
    });
  };

  // Handle units per box change - recalculate all prices and stock
  const handleUnitsPerBoxChange = (value: number) => {
    const unitsPerBox = value || 1;
    const totalBoxes = formData.totalBoxes || 0;

    // Keep unit prices, recalculate box prices
    setFormData({
      ...formData,
      unitsPerBox: unitsPerBox,
      stockQuantity: totalBoxes * unitsPerBox,
      costPricePerBox: (formData.costPricePerUnit || 0) * unitsPerBox,
      sellingPricePerBox: (formData.sellingPricePerUnit || 0) * unitsPerBox
    });
  };

  // Handle total boxes change - recalculate stock quantity
  const handleTotalBoxesChange = (value: number) => {
    const totalBoxes = value || 0;
    const unitsPerBox = formData.unitsPerBox || 1;
    setFormData({
      ...formData,
      totalBoxes: totalBoxes,
      stockQuantity: totalBoxes * unitsPerBox
    });
  };

  return (
    <div className="space-y-6">

      {/* Basic Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="supplier">Supplier <span className="text-red-500">*</span></Label>
          <div className="flex gap-2">
            <SearchableSelect
              options={suppliers.map(supplier => ({
                value: supplier.id,
                label: supplier.name
              }))}
              value={formData.supplierId}
              onValueChange={(value) => {
                const selectedSupplier = suppliers.find(s => s.id === value);
                setFormData({
                  ...formData,
                  supplierId: value,
                  supplierName: selectedSupplier?.name || ''
                });
              }}
              placeholder="Select supplier"
              emptyText="No supplier found"
              className="flex-1 bg-blue-50 border-blue-200 text-blue-900 hover:bg-blue-100 focus:ring-blue-500"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsSupplierDialogOpen(true)}
              className="whitespace-nowrap"
            >
              Add New
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="product">Product Name <span className="text-red-500">*</span></Label>
          <div className="flex gap-2">
            <SearchableSelect
              options={products.map(product => ({
                value: product.id,
                label: product.name
              }))}
              value={formData.productId}
              onValueChange={(value) => setFormData({ ...formData, productId: value })}
              placeholder="Select product"
              emptyText="No product found"
              className="flex-1 bg-green-50 border-green-200 text-green-900 hover:bg-green-100 focus:ring-green-500"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsProductDialogOpen(true)}
              className="whitespace-nowrap"
            >
              Add New
            </Button>
          </div>
        </div>
      </div>

      {/* Batch Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="batchNo">Batch No. <span className="text-red-500">*</span></Label>
          <Input
            id="batchNo"
            placeholder="Enter batch no."
            value={formData.batchNo}
            onChange={(e) => setFormData({ ...formData, batchNo: e.target.value })}
          />
        </div>
        {/* Show Production Date and Expire Date only for Medical products */}
        {!isNonMedical && (
          <>
            <div className="space-y-2">
              <Label htmlFor="productionDate">Production Date <span className="text-red-500">*</span></Label>
              <Input
                id="productionDate"
                type="date"
                value={formData.productionDate}
                onChange={(e) => setFormData({ ...formData, productionDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expireDate">Expire Date <span className="text-red-500">*</span></Label>
              <Input
                id="expireDate"
                type="date"
                value={formData.expireDate}
                onChange={(e) => setFormData({ ...formData, expireDate: e.target.value })}
              />
            </div>
          </>
        )}
      </div>

      {/* Shelf Selection */}
      <div className="space-y-2">
        <Label htmlFor="shelf">Shelf <span className="text-red-500">*</span></Label>
        <div className="flex gap-2">
          <SearchableSelect
            options={shelves.map(shelf => ({
              value: shelf.id,
              label: shelf.name
            }))}
            value={formData.shelfId}
            onValueChange={(value) => {
              const selectedShelf = shelves.find(s => s.id === value);
              setFormData({
                ...formData,
                shelfId: value,
                shelfName: selectedShelf?.name || ''
              });
            }}
            placeholder="Select Shelf"
            emptyText="No shelf found"
            className="flex-1 bg-purple-50 border-purple-200 text-purple-900 hover:bg-purple-100 focus:ring-purple-500"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsShelfDialogOpen(true)}
            className="whitespace-nowrap"
          >
            Add New
          </Button>
        </div>
      </div>

      {/* Stock & Pricing - Clean Simple Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
          <Label>Total Boxes <span className="text-red-500">*</span></Label>
            <Input
              type="number"
            placeholder="Add no. of boxes"
            value={formData.totalBoxes || ''}
            onChange={(e) => handleTotalBoxesChange(parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
          <Label>Units per Box <span className="text-red-500">*</span></Label>
            <Input
              type="number"
            placeholder="Add no. of units per box"
            value={formData.unitsPerBox || ''}
            onChange={(e) => handleUnitsPerBoxChange(parseInt(e.target.value) || 1)}
          />
        </div>
        <div className="space-y-2">
          <Label>Total Stock</Label>
          <Input
            type="number"
            value={totalStockUnits}
            readOnly
            className="bg-gray-100 cursor-not-allowed"
            />
          </div>
        </div>

      {/* Pricing Row - Connected Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Cost Price - Connected Inputs */}
          <div className="space-y-2">
          <Label>Cost Price <span className="text-red-500">*</span></Label>
          <div className="flex items-center">
            <Input
              type="number"
              step="0.01"
              placeholder="Units Price"
              value={formData.costPricePerUnit || ''}
              onChange={(e) => handleCostPerUnitChange(parseFloat(e.target.value) || 0)}
              className="rounded-r-none border-r-0 focus:z-10"
            />
            <div className="flex items-center justify-center w-10 h-9 bg-gray-100 border border-gray-200">
              <LinkIcon />
          </div>
            <Input
              type="number"
              step="0.01"
              placeholder="Boxes Price"
              value={formData.costPricePerBox || ''}
              onChange={(e) => handleCostPerBoxChange(parseFloat(e.target.value) || 0)}
              className="rounded-l-none border-l-0 focus:z-10"
            />
          </div>
        </div>

        {/* Sell Price - Connected Inputs */}
          <div className="space-y-2">
          <Label>Sell Price <span className="text-red-500">*</span></Label>
          <div className="flex items-center">
            <Input
              type="number"
              step="0.01"
              placeholder="Units Price"
              value={formData.sellingPricePerUnit || ''}
              onChange={(e) => handleSellPerUnitChange(parseFloat(e.target.value) || 0)}
              className="rounded-r-none border-r-0 focus:z-10"
            />
            <div className="flex items-center justify-center w-10 h-9 bg-gray-100 border border-gray-200">
              <LinkIcon />
          </div>
            <Input
              type="number"
              step="0.01"
              placeholder="Boxes Price"
              value={formData.sellingPricePerBox || ''}
              onChange={(e) => handleSellPerBoxChange(parseFloat(e.target.value) || 0)}
              className="rounded-l-none border-l-0 focus:z-10"
            />
          </div>
          </div>
      </div>

      {/* Min Stock Level - Only for Medical products */}
      {!isNonMedical && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Min Stock Level <span className="text-red-500">*</span></Label>
            <Input
              type="number"
              placeholder="e.g., 10"
              value={formData.minStockLevel}
              onChange={(e) => setFormData({ ...formData, minStockLevel: parseInt(e.target.value) || 10 })}
            />
          </div>
        </div>
      )}

      {/* Tax Type - Only for Non-Medical products */}
      {isNonMedical && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="taxType">Tax Type <span className="text-red-500">*</span></Label>
            <Select
              value={formData.taxType}
              onValueChange={(value) => setFormData({ ...formData, taxType: value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select tax type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EXEMPT">Exempt</SelectItem>
                <SelectItem value="STANDARD">Standard</SelectItem>
                <SelectItem value="ZERO">Zero Rated</SelectItem>
                <SelectItem value="REDUCED">Reduced Rate</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-all duration-200" onClick={onSubmit}>
          {(editingBatch ? 'Update' : 'Add') + ' Batch'}
        </Button>
      </div>
    </div>
  );
};

// Supplier Form Component
interface SupplierFormProps {
  onSuccess: (supplier: Supplier) => void;
  onCancel: () => void;
}

const SupplierForm: React.FC<SupplierFormProps> = ({ onSuccess, onCancel }) => {
  const [formData, setFormData] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Clean up form data - convert empty strings to undefined for optional fields
      // Note: email and address fields are not stored in database schema, so we don't send them
      const cleanedFormData = {
        name: formData.name.trim(),
        contactPerson: formData.contactPerson.trim(),
        phone: formData.phone.trim()
      };
      const response = await apiService.createSupplier(cleanedFormData);
      if (response.success) {
        onSuccess(response.data);
      }
    } catch (error) {
      console.error('Error creating supplier:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="supplierName">Supplier Name *</Label>
        <Input
          id="supplierName"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contactPerson">Contact Person *</Label>
        <Input
          id="contactPerson"
          value={formData.contactPerson}
          onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone *</Label>
        <Input
          id="phone"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          required
        />
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          Add Supplier
        </Button>
      </div>
    </form>
  );
};

// Product Form Component
interface ProductFormProps {
  onSuccess: (product: Product) => void;
  onCancel: () => void;
}

const ProductForm: React.FC<ProductFormProps> = ({ onSuccess, onCancel }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    formula: '',
    categoryId: '',
    barcode: '',
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);

  // Generate random barcode
  const generateBarcode = () => {
    const randomNum = Math.floor(Math.random() * 10000000000000);
    return randomNum.toString().padStart(13, '0');
  };

  // Load categories on component mount
  useEffect(() => {
    const loadCategories = async () => {
      try {
        setLoadingCategories(true);
        console.log('🔍 Loading categories for ProductForm...');

        // Get branchId from user context (Batches component should have access to this)
        // For now, we'll let the backend determine branchId from user context
        const response = await apiService.getCategories({
          limit: 1000 // Get all categories
        });
        console.log('🔍 Categories API response:', response);

        if (response.success && response.data) {
          // Handle both array and object response formats
          const categoriesData = Array.isArray(response.data) ? response.data : (response.data?.categories || []);
          console.log('🔍 Categories data:', categoriesData);
          setCategories(categoriesData);
        } else {
          console.log('🔍 No categories found or API failed:', response.message);
          // If no categories exist, we'll show an empty state
          setCategories([]);
        }
      } catch (error) {
        console.error('Error loading categories:', error);
        setCategories([]);
      } finally {
        setLoadingCategories(false);
      }
    };
    loadCategories();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Product name is required",
        variant: "destructive",
      });
      return;
    }

    if (!formData.categoryId || formData.categoryId === 'loading' || formData.categoryId === 'no-categories') {
      toast({
        title: "Category Required",
        description: "Please select a category. If no categories are available, please create one first.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Get user's branch ID from auth context
      const branchId = user?.membership?.branchIds?.[0] || user?.branchId || null;

      if (!branchId) {
        toast({
          title: "Branch Required",
          description: "Please select a branch before creating a product.",
          variant: "destructive",
        });
        return;
      }

      const response = await apiService.createProduct({
        name: formData.name,
        description: "",
        formula: formData.formula || "",
        categoryId: formData.categoryId,
        // supplierId not needed - supplier is assigned at batch level
        branchId: branchId,
        barcode: formData.barcode || null,
        requiresPrescription: false,
        isActive: true,
        minStock: 1,
        maxStock: 1000,
        unitsPerPack: 1
      });
      
      console.log('✅ Product creation response:', response);
      
      if (response.success && response.data) {
        const productData = {
          id: response.data.id,
          name: response.data.name,
          sku: (response.data as any).sku || (response.data as any).SKU || ''
        };
        console.log('✅ Calling onSuccess with product:', productData);
        onSuccess(productData);
      } else {
        toast({
          title: "Creation Failed",
          description: 'Failed to create product: ' + (response.message || 'Unknown error'),
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error creating product:', error);
      toast({
        title: "Creation Error",
        description: 'Error creating product: ' + (error instanceof Error ? error.message : 'Unknown error'),
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 ">
        <div className="space-y-2">
          <Label htmlFor="productName">Medicine Name *</Label>
          <Input
            id="productName"
            placeholder="e.g., Paracetamol 500mg"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="productCategory">Category *</Label>
          <Select
            value={formData.categoryId}
            onValueChange={(value) => {
              // Only allow valid category IDs, not special values
              if (value !== 'loading' && value !== 'no-categories') {
                setFormData({ ...formData, categoryId: value });
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {loadingCategories ? (
                <SelectItem value="loading" disabled>Loading categories...</SelectItem>
              ) : categories.length > 0 ? (
                categories.map((category) => (
                  <SelectItem
                    key={category.id}
                    value={category.id}
                    className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                  >
                    {category.name}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="no-categories" disabled>No categories available - Please create a category first</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="productFormula">Formula/Composition</Label>
          <Textarea
            id="productFormula"
            placeholder="Enter product formula or composition (e.g., Paracetamol 500mg, Lactose, Starch)"
            value={formData.formula}
            onChange={(e) => setFormData({ ...formData, formula: e.target.value })}
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="productBarcode">Barcode</Label>
          <div className="flex space-x-2">
            <Input
              id="productBarcode"
              placeholder="e.g., 1234567890123"
              value={formData.barcode}
              onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFormData({ ...formData, barcode: generateBarcode() })}
            >
              Generate
            </Button>
          </div>
        </div>
      </div>

      <div className="flex justify-end space-x-2 pt-6">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="text-white bg-blue-600 hover:bg-blue-700 border-blue-600 shadow-md hover:shadow-lg transition-all duration-200">
          Add Product
        </Button>
      </div>
    </form>
  );
};

// Shelf Form Component
interface ShelfFormProps {
  onSuccess: (shelf: Shelf) => void;
  onCancel: () => void;
}

const ShelfForm: React.FC<ShelfFormProps> = ({ onSuccess, onCancel }) => {
  const [formData, setFormData] = useState({
    name: '',
    location: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await apiService.createShelf({
        name: formData.name.trim(),
        location: formData.location.trim() || undefined
      });
      if (response.success) {
        onSuccess(response.data);
      }
    } catch (error) {
      console.error('Error creating shelf:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="shelfName">Shelf Name *</Label>
        <Input
          id="shelfName"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., Shelf A1, Rack 1"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="shelfLocation">Location</Label>
        <Input
          id="shelfLocation"
          value={formData.location}
          onChange={(e) => setFormData({ ...formData, location: e.target.value })}
          placeholder="e.g., Warehouse A, Room 101"
        />
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!formData.name.trim()}>
          Add Shelf
        </Button>
      </div>
    </form>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(Batches);
