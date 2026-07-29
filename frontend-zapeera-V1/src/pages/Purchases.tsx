import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAdmin } from '@/contexts/useAdmin';
import { apiService } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon, Package, Search, Plus, Edit, Trash2, Eye, Receipt, Loader2, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { PaginationPills } from '@/components/ui/pagination-pills';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface Purchase {
  id: string;
  supplierId: string;
  invoiceNo?: string;
  purchaseDate: string;
  totalAmount: number;
  paidAmount: number;
  outstanding: number;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PARTIAL';
  notes?: string;
  createdAt: string;
  updatedAt: string;
  supplier: {
    id: string;
    name: string;
    contactPerson: string;
    phone: string;
  };
  purchaseItems: Array<{
    id: string;
    productId: string;
    batchId?: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    product: {
      id: string;
      name: string;
      sku: string;
      barcode?: string;
    };
    batch?: {
      id: string;
      batchNo: string;
      quantity: number;
      expireDate?: string;
    };
  }>;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  unitType: string;
  price: number; // Price from batch data
}

interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
}

const Purchases = () => {
  const { user } = useAuth();
  const { selectedCompanyId, selectedBranchId } = useAdmin();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false); // keep previous/cached data on screen
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [viewingPurchase, setViewingPurchase] = useState<Purchase | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 10;
  const [purchaseToDelete, setPurchaseToDelete] = useState<Purchase | null>(null);
  const [isDeletingPurchase, setIsDeletingPurchase] = useState(false);

  // Cache reading disabled - purchases will load fresh from API

  const [formData, setFormData] = useState({
    supplierId: '',
    invoiceNo: '',
    purchaseDate: new Date(),
    paidAmount: 0,
    notes: '',
    items: [] as Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      batchNo: string;
      expireDate: Date;
      productionDate: Date;
    }>
  });

  const [newItem, setNewItem] = useState({
    productId: '',
    quantity: 1,
    unitPrice: 0,
    batchNo: '',
    expireDate: new Date(),
    productionDate: new Date(),
  });

  // Load data
  const loadPurchases = useCallback(async () => {
    try {
      // Only block UI if we have nothing to show yet
      if (purchases.length === 0) setLoading(true);
      setError(null);
      
      // Determine branch ID for managers/cashiers
      let branchId = selectedBranchId;
      if (!branchId && user?.role !== 'OWNER') {
        // For non-owner users, check membership.branchIds
        if (Array.isArray(user?.membership?.branchIds) && user.membership.branchIds.length > 0) {
          branchId = String(user.membership.branchIds[0]);
        } else if (user?.branchId) {
          branchId = user?.membership?.branchIds?.[0] || user?.branchId;
        }
      }
      
      const response = await apiService.getPurchases({
        page: currentPage,
        limit: itemsPerPage,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        supplierId: supplierFilter !== 'all' ? supplierFilter : undefined,
        branchId: branchId,
        companyId: selectedCompanyId || '',
      } as any);
      setPurchases((response.data as any).data || (response.data as any));
      setTotalPages((response.data as any).pagination?.pages || 1);
    } catch (error) {
      console.error('Error loading purchases:', error);
      setError('Failed to load purchases');
    } finally {
      setLoading(false);
    }
  }, [currentPage, itemsPerPage, statusFilter, supplierFilter, purchases.length, user?.id, selectedCompanyId, selectedBranchId, user?.role, user?.branchId, user?.membership?.branchIds]);

  const loadProducts = useCallback(async () => {
    try {
      // Determine branch ID for managers/cashiers
      let branchId = selectedBranchId;
      if (!branchId && user?.role !== 'OWNER') {
        if (Array.isArray(user?.membership?.branchIds) && user.membership.branchIds.length > 0) {
          branchId = String(user.membership.branchIds[0]);
        } else if (user?.branchId) {
          branchId = user?.membership?.branchIds?.[0] || user?.branchId;
        }
      }
      
      const response = await apiService.getProducts({
        page: 1,
        limit: 200,
        branchId: branchId,
      });
      setProducts((response.data as any).products || (response.data as any));
    } catch (error) {
      console.error('Error loading products:', error);
    }
  }, [selectedBranchId, user?.id, selectedCompanyId, user?.role, user?.branchId, user?.membership?.branchIds]);

  const loadSuppliers = useCallback(async () => {
    try {
      const response = await apiService.getSuppliers({
        page: 1,
        limit: 200,
        branchId: selectedBranchId,
        companyId: selectedCompanyId || '',
      });
      setSuppliers((response.data as any).suppliers || (response.data as any));
    } catch (error) {
      console.error('Error loading suppliers:', error);
    }
  }, [selectedBranchId, user?.id, selectedCompanyId]);

  useEffect(() => {
    // For owners, require selectedBranchId. For managers/cashiers, load with their assigned branch
    if (selectedBranchId || (user?.role !== 'OWNER' && (user?.branchId || (user?.membership?.branchIds && user.membership.branchIds.length > 0)))) {
      loadPurchases();
      loadProducts();
      loadSuppliers();
    }
  }, [selectedBranchId, loadPurchases, loadProducts, loadSuppliers, user?.role, user?.branchId, user?.membership?.branchIds]);

  // Filter purchases
  const filteredPurchases = useMemo(() => {
    return purchases.filter(purchase => {
      const matchesSearch = purchase.supplier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           purchase.invoiceNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           purchase.id.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });
  }, [purchases, searchTerm]);

  // Calculate totals
  const totalAmount = useMemo(() => {
    return formData.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  }, [formData.items]);

  const outstandingAmount = totalAmount - formData.paidAmount;

  // Handle form changes
  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleNewItemChange = (field: string, value: any) => {
    setNewItem(prev => ({ ...prev, [field]: value }));
  };

  const handleDateChange = (field: string, date: Date | undefined) => {
    if (date) {
      setFormData(prev => ({ ...prev, [field]: date }));
    }
  };

  const handleNewItemDateChange = (field: string, date: Date | undefined) => {
    if (date) {
      setNewItem(prev => ({ ...prev, [field]: date }));
    }
  };

  // Add item to purchase
  const handleAddItem = () => {
    if (!newItem.productId || newItem.quantity <= 0 || newItem.unitPrice <= 0) {
      toast({
        title: "Error",
        description: "Please fill in all required fields for the item",
        variant: "destructive",
      });
      return;
    }

    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { ...newItem }]
    }));

    setNewItem({
      productId: '',
      quantity: 1,
      unitPrice: 0,
      batchNo: '',
      expireDate: new Date(),
      productionDate: new Date(),
    });
  };

  // Remove item from purchase
  const handleRemoveItem = (index: number) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  // Handle product selection
  const handleProductSelect = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      setNewItem(prev => ({
        ...prev,
        productId,
        unitPrice: (product.price || 0) * 0.8, // Default to 80% of current price from batch
      }));
    }
  };

  // Create/Update purchase
  const handleSubmit = async () => {
    if (!formData.supplierId || formData.items.length === 0) {
      toast({
        title: "Error",
        description: "Please select a supplier and add at least one item",
        variant: "destructive",
      });
      return;
    }

    try {
      const purchaseData = {
        supplierId: formData.supplierId,
        invoiceNo: formData.invoiceNo || undefined,
        purchaseDate: formData.purchaseDate.toISOString(),
        paidAmount: formData.paidAmount,
        notes: formData.notes || undefined,
        items: formData.items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          batchNo: item.batchNo || undefined,
          expireDate: item.expireDate.toISOString(),
          productionDate: item.productionDate.toISOString(),
        })),
      };

      if (editingPurchase) {
        await apiService.updatePurchase(editingPurchase.id, purchaseData);
        toast({
          title: "Success",
          description: "Purchase updated successfully",
          variant: "success",
        });
      } else {
        await apiService.createPurchase(purchaseData);
        toast({
          title: "Success",
          description: "Purchase created successfully",
          variant: "success",
        });
      }

      handleCloseModal();
      loadPurchases();
    } catch (error) {
      console.error('Error saving purchase:', error);
      toast({
        title: "Error",
        description: "Failed to save purchase",
        variant: "destructive",
      });
    }
  };

  const openDeletePurchase = (purchase: Purchase) => {
    setPurchaseToDelete(purchase);
  };

  const handleConfirmDeletePurchase = async () => {
    if (!purchaseToDelete) return;
    try {
      setIsDeletingPurchase(true);
      await apiService.deletePurchase(purchaseToDelete.id);
      toast({
        title: "Success",
        description: "Purchase deleted successfully",
        variant: "success",
      });
      setPurchaseToDelete(null);
      loadPurchases();
    } catch (error) {
      console.error('Error deleting purchase:', error);
      toast({
        title: "Error",
        description: "Failed to delete purchase",
        variant: "destructive",
      });
    } finally {
      setIsDeletingPurchase(false);
    }
  };

  // Modal handlers
  const handleOpenModal = (purchase?: Purchase) => {
    if (purchase) {
      setEditingPurchase(purchase);
      setFormData({
        supplierId: purchase.supplierId,
        invoiceNo: purchase.invoiceNo || '',
        purchaseDate: new Date(purchase.purchaseDate),
        paidAmount: purchase.paidAmount,
        notes: purchase.notes || '',
        items: [],
      });
    } else {
      setEditingPurchase(null);
      setFormData({
        supplierId: '',
        invoiceNo: '',
        purchaseDate: new Date(),
        paidAmount: 0,
        notes: '',
        items: [],
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingPurchase(null);
    setFormData({
      supplierId: '',
      invoiceNo: '',
      purchaseDate: new Date(),
      paidAmount: 0,
      notes: '',
      items: [],
    });
  };

  const handleViewPurchase = (purchase: Purchase) => {
    setViewingPurchase(purchase);
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { className: string; label: string }> = {
      PENDING: {
        className: "border-amber-200 bg-amber-50 text-amber-800",
        label: "Pending",
      },
      COMPLETED: {
        className: "border-green-200 bg-green-50 text-green-800",
        label: "Completed",
      },
      CANCELLED: {
        className: "border-red-200 bg-red-50 text-red-800",
        label: "Cancelled",
      },
      PARTIAL: {
        className: "border-[rgba(26,82,197,0.2)] bg-[rgba(26,82,197,0.06)] text-[#1a52c5]",
        label: "Partial",
      },
    };
    const config = map[status] || map.PENDING;
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
          config.className,
        )}
      >
        {config.label}
      </span>
    );
  };

  const purchaseStats = useMemo(() => {
    const list = purchases;
    const totalValue = list.reduce((s, p) => s + p.totalAmount, 0);
    return {
      count: list.length,
      pending: list.filter((p) => p.status === "PENDING").length,
      completed: list.filter((p) => p.status === "COMPLETED").length,
      totalValue,
    };
  }, [purchases]);

  const sfInput = cn(
    "h-11 w-full rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] pl-10 pr-3.5 text-sm text-[#0a1128] shadow-none transition-all",
    "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-[4px] focus-visible:ring-[rgba(26,82,197,0.06)]",
  );

  const filterSelect = cn(
    "h-11 rounded-[10px] border-[1.5px] border-black/[0.08] bg-white text-[14px] text-[#0a1128] shadow-none",
    "focus:ring-4 focus:ring-[rgba(26,82,197,0.08)] focus:ring-offset-0",
  );

  if (!selectedBranchId) {
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
        <div className="relative z-[1] px-6 pb-14 pt-9 sm:px-11">
          <div className="mx-auto max-w-lg rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white px-8 py-16 text-center shadow-[0_8px_40px_rgba(0,0,0,0.04)]">
            <div className="mx-auto mb-6 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[rgba(26,82,197,0.06)]">
              <Receipt className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
            </div>
            <p className="mb-2 text-sm font-bold text-[#0a1128]">Select a branch</p>
            <p className="text-sm text-[#8c95b0]">Choose a branch in the header to load purchase orders.</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading && purchases.length === 0) {
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
          <p className="mt-4 text-sm font-medium text-[#8c95b0]">Loading purchases…</p>
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
            <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">Purchase orders</h1>
            <p className="text-sm text-[#8c95b0]">
              Manage supplier purchases and stock intake •{" "}
              <b className="font-semibold text-[#4a5578]">{filteredPurchases.length} on this page</b>
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(26,82,197,0.35)]"
          >
            <Plus className="h-[17px] w-[17px] stroke-[2.5]" strokeLinecap="round" />
            New purchase
          </button>
        </div>

        {error ? (
          <div className="rounded-[22px] border border-red-200 bg-white px-6 py-4 text-sm text-red-600">{error}</div>
        ) : null}

        <div className="zv3-animate-fadeUp zv3-delay-1 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white p-6 transition-all duration-300 hover:-translate-y-[3px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-[13px] font-medium text-[#8c95b0]">Orders (page)</p>
                <p className="text-[28px] font-extrabold leading-none tracking-tight text-[#0a1128]">{purchaseStats.count}</p>
              </div>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[rgba(26,82,197,0.08)] to-[rgba(40,194,206,0.06)] text-[#1a52c5]">
                <Receipt className="h-[22px] w-[22px]" strokeWidth={2} />
              </div>
            </div>
          </div>
          <div className="rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white p-6 transition-all duration-300 hover:-translate-y-[3px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-[13px] font-medium text-[#8c95b0]">Pending</p>
                <p className="text-[28px] font-extrabold leading-none tracking-tight text-amber-600">{purchaseStats.pending}</p>
              </div>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-500/[0.08] text-amber-600">
                <Clock className="h-[22px] w-[22px]" strokeWidth={2} />
              </div>
            </div>
          </div>
          <div className="rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white p-6 transition-all duration-300 hover:-translate-y-[3px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-[13px] font-medium text-[#8c95b0]">Completed</p>
                <p className="text-[28px] font-extrabold leading-none tracking-tight text-green-600">{purchaseStats.completed}</p>
              </div>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-green-600/[0.08] text-green-600">
                <CheckCircle2 className="h-[22px] w-[22px]" strokeWidth={2} />
              </div>
            </div>
          </div>
        </div>

        <div className="zv3-animate-fadeUp zv3-delay-2 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-6 py-5">
          <p className="mb-3 text-xs font-semibold text-[#8c95b0]">Filters</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-end">
            <div className="md:col-span-4">
              <Label htmlFor="search" className="mb-2 block text-xs font-semibold text-[#8c95b0]">
                Search
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]" strokeWidth={2} />
                <Input
                  id="search"
                  placeholder="Supplier, invoice, or ID…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={sfInput}
                />
              </div>
            </div>
            <div className="md:col-span-3">
              <Label htmlFor="status" className="mb-2 block text-xs font-semibold text-[#8c95b0]">
                Status
              </Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="status" className={filterSelect}>
                  <SelectValue placeholder="All status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="PARTIAL">Partial</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Label htmlFor="supplier" className="mb-2 block text-xs font-semibold text-[#8c95b0]">
                Supplier
              </Label>
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger id="supplier" className={filterSelect}>
                  <SelectValue placeholder="All suppliers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All suppliers</SelectItem>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Button
                type="button"
                onClick={() => void loadPurchases()}
                variant="outline"
                className="h-11 w-full rounded-[10px] border border-[rgba(15,23,60,0.06)] font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
              >
                Refresh
              </Button>
            </div>
          </div>
        </div>

        <div className="zv3-animate-fadeUp zv3-delay-3">
          <div className="mb-4 flex items-center gap-2.5">
            <Package className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
            <span className="text-[17px] font-bold text-[#0a1128]">Purchases</span>
            <span className="text-sm font-medium text-[#8c95b0]">({filteredPurchases.length})</span>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                    <th className="px-5 py-3.5 pl-8 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Purchase #</th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Supplier</th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Invoice</th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Date</th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Total</th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Paid</th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Outstanding</th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Status</th>
                    <th className="px-5 py-3.5 pr-8 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPurchases.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-8 py-16 text-center text-sm text-[#8c95b0]">
                        No purchases match your filters.
                      </td>
                    </tr>
                  ) : (
                    filteredPurchases.map((purchase) => (
                      <tr
                        key={purchase.id}
                        className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                      >
                        <td className="px-5 py-4 pl-8 align-middle font-mono text-[13px] font-semibold text-[#0a1128]">
                          {purchase.id.slice(-8)}
                        </td>
                        <td className="px-5 py-4 align-middle text-[13px] font-medium text-[#0a1128]">{purchase.supplier.name}</td>
                        <td className="px-5 py-4 align-middle text-[13px] text-[#4a5578]">{purchase.invoiceNo || "—"}</td>
                        <td className="px-5 py-4 align-middle text-[13px] text-[#4a5578]">
                          {format(new Date(purchase.purchaseDate), "MMM dd, yyyy")}
                        </td>
                        <td className="px-5 py-4 align-middle text-[13px] font-semibold text-[#0a1128]">Rs. {purchase.totalAmount.toFixed(2)}</td>
                        <td className="px-5 py-4 align-middle text-[13px] text-[#4a5578]">Rs. {purchase.paidAmount.toFixed(2)}</td>
                        <td className="px-5 py-4 align-middle text-[13px] text-[#4a5578]">Rs. {purchase.outstanding.toFixed(2)}</td>
                        <td className="px-5 py-4 align-middle">{getStatusBadge(purchase.status)}</td>
                        <td className="px-5 py-4 pr-8 text-right align-middle">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              title="View"
                              onClick={() => handleViewPurchase(purchase)}
                              className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                            >
                              <Eye className="h-[15px] w-[15px]" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              title="Edit"
                              onClick={() => handleOpenModal(purchase)}
                              className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                            >
                              <Edit className="h-[15px] w-[15px]" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              title="Delete"
                              onClick={() => openDeletePurchase(purchase)}
                              className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent text-[#8c95b0] transition-colors hover:border-red-600/15 hover:bg-red-600/[0.05] hover:text-red-600"
                            >
                              <Trash2 className="h-[15px] w-[15px]" strokeWidth={2} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationPills variant="v3" page={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </div>

      {/* Purchase Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">
              {editingPurchase ? "Edit purchase" : "New purchase"}
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
              {editingPurchase ? "Update supplier, lines, and payment." : "Record stock received from a supplier."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            {/* Supplier Selection */}
            <div>
              <Label htmlFor="supplier">Supplier *</Label>
              <Select value={formData.supplierId} onValueChange={(value) => handleInputChange('supplierId', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map(supplier => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Invoice Number */}
            <div>
              <Label htmlFor="invoiceNo">Invoice Number</Label>
              <Input
                id="invoiceNo"
                value={formData.invoiceNo}
                onChange={(e) => handleInputChange('invoiceNo', e.target.value)}
                placeholder="Enter invoice number"
              />
            </div>

            {/* Purchase Date */}
            <div>
              <Label>Purchase Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(formData.purchaseDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={formData.purchaseDate}
                    onSelect={(date) => handleDateChange('purchaseDate', date)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Paid Amount */}
            <div>
              <Label htmlFor="paidAmount">Paid Amount</Label>
              <Input
                id="paidAmount"
                type="number"
                value={formData.paidAmount}
                onChange={(e) => handleInputChange('paidAmount', parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                step="0.01"
              />
            </div>

            {/* Notes */}
            <div className="col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                placeholder="Enter any additional notes..."
                rows={3}
              />
            </div>
          </div>

          {/* Items Section */}
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-4">Purchase Items</h3>

            {/* Add New Item */}
            <div className="bg-gray-50 p-4 rounded-lg mb-4">
              <h4 className="font-medium mb-3">Add Item</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="product">Product *</Label>
                  <Select value={newItem.productId} onValueChange={handleProductSelect}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map(product => (
                        <SelectItem
                          key={product.id}
                          value={product.id}
                          className="!hover:bg-blue-100 !hover:text-blue-900 !focus:bg-blue-200 !focus:text-blue-900 !transition-colors !duration-200 cursor-pointer"
                        >
                          {product.name} ({product.sku})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="quantity">Quantity *</Label>
                  <Input
                    id="quantity"
                    type="number"
                    value={newItem.quantity}
                    onChange={(e) => handleNewItemChange('quantity', parseInt(e.target.value) || 1)}
                    min="1"
                  />
                </div>

                <div>
                  <Label htmlFor="unitPrice">Unit Price *</Label>
                  <Input
                    id="unitPrice"
                    type="number"
                    value={newItem.unitPrice}
                    onChange={(e) => handleNewItemChange('unitPrice', parseFloat(e.target.value) || 0)}
                    step="0.01"
                    min="0"
                  />
                </div>

                <div>
                  <Label htmlFor="batchNo">Batch Number</Label>
                  <Input
                    id="batchNo"
                    value={newItem.batchNo}
                    onChange={(e) => handleNewItemChange('batchNo', e.target.value)}
                    placeholder="Enter batch number"
                  />
                </div>

                <div>
                  <Label>Expiry Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(newItem.expireDate, 'PPP')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={newItem.expireDate}
                        onSelect={(date) => handleNewItemDateChange('expireDate', date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <Label>Production Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(newItem.productionDate, 'PPP')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={newItem.productionDate}
                        onSelect={(date) => handleNewItemDateChange('productionDate', date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="col-span-2">
                  <Button onClick={handleAddItem} className="w-full">
                    <Plus className="mr-2 h-4 w-4" /> Add Item
                  </Button>
                </div>
              </div>
            </div>

            {/* Items List */}
            {formData.items.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">Added Items</h4>
                {formData.items.map((item, index) => {
                  const product = products.find(p => p.id === item.productId);
                  return (
                    <div key={index} className="flex items-center justify-between bg-gray-50 p-3 rounded">
                      <div className="flex-1">
                        <span className="font-medium">{product?.name}</span>
                        <span className="text-gray-500 ml-2">({product?.sku})</span>
                        <div className="text-sm text-gray-600">
                          Qty: {item.quantity} × Rs. {item.unitPrice.toFixed(2)} = Rs. {(item.quantity * item.unitPrice).toFixed(2)}
                          {item.batchNo && ` | Batch: ${item.batchNo}`}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRemoveItem(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="mt-6 rounded-[14px] border border-[rgba(15,23,60,0.06)] bg-[#f8f9fc] p-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-[#4a5578]">Total amount</span>
              <span className="text-lg font-bold text-[#0a1128]">Rs. {totalAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-[#4a5578]">Paid amount</span>
              <span className="text-lg font-bold text-[#0a1128]">Rs. {formData.paidAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center border-t border-[rgba(15,23,60,0.06)] pt-2">
              <span className="text-sm font-semibold text-[#4a5578]">Outstanding</span>
              <span className="text-lg font-bold text-[#1a52c5]">Rs. {outstandingAmount.toFixed(2)}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" className="rounded-[10px] border border-[rgba(15,23,60,0.06)] font-semibold text-[#4a5578] hover:bg-[#f0f2f7]" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={formData.items.length === 0}
              className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
            >
              {editingPurchase ? "Update purchase" : "Create purchase"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Purchase Modal */}
      <Dialog open={!!viewingPurchase} onOpenChange={() => setViewingPurchase(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Purchase details</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
              Line items and payment summary for this order.
            </DialogDescription>
          </DialogHeader>

          {viewingPurchase && (
            <div className="space-y-6">
              {/* Purchase Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-500">Purchase ID</Label>
                  <p className="text-lg">{viewingPurchase.id}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">Status</Label>
                  <div className="mt-1">{getStatusBadge(viewingPurchase.status)}</div>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">Supplier</Label>
                  <p className="text-lg">{viewingPurchase.supplier.name}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">Invoice Number</Label>
                  <p className="text-lg">{viewingPurchase.invoiceNo || '-'}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">Purchase Date</Label>
                  <p className="text-lg">{format(new Date(viewingPurchase.purchaseDate), 'PPP')}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">Total Amount</Label>
                  <p className="text-lg font-semibold">Rs. {viewingPurchase.totalAmount.toFixed(2)}</p>
                </div>
              </div>

              {/* Items */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Purchase Items</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Batch</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewingPurchase.purchaseItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{item.product.name}</div>
                            <div className="text-sm text-gray-500">{item.product.sku}</div>
                          </div>
                        </TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>Rs. {item.unitPrice.toFixed(2)}</TableCell>
                        <TableCell>Rs. {item.totalPrice.toFixed(2)}</TableCell>
                        <TableCell>
                          {item.batch ? (
                            <div>
                              <div className="font-medium">{item.batch.batchNo}</div>
                              {item.batch.expireDate && (
                                <div className="text-sm text-gray-500">
                                  Expires: {format(new Date(item.batch.expireDate), 'MMM dd, yyyy')}
                                </div>
                              )}
                            </div>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Notes */}
              {viewingPurchase.notes && (
                <div>
                  <Label className="text-sm font-medium text-gray-500">Notes</Label>
                  <p className="mt-1 p-3 bg-gray-50 rounded">{viewingPurchase.notes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!purchaseToDelete} onOpenChange={(open) => !open && setPurchaseToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-[#0a1128]">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Delete purchase
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
              This cannot be undone. Remove this purchase record from the branch?
            </DialogDescription>
          </DialogHeader>
          {purchaseToDelete && (
            <p className="py-4 text-sm text-[#4a5578]">
              Supplier <span className="font-semibold text-[#0a1128]">{purchaseToDelete.supplier.name}</span>
              {" · "}
              <span className="font-mono text-xs">{purchaseToDelete.id.slice(-8)}</span>
            </p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" className="rounded-[10px]" onClick={() => setPurchaseToDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-[10px] bg-red-600 hover:bg-red-700"
              disabled={isDeletingPurchase}
              onClick={() => void handleConfirmDeletePurchase()}
            >
              {isDeletingPurchase ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {isDeletingPurchase ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(Purchases);
