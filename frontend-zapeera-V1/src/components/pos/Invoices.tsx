import { useState, useEffect, useCallback, useMemo, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { useDashboardData } from "@/contexts/DashboardDataContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Receipt,
  Search,
  Filter,
  Download,
  Printer,
  Eye,
  Calendar,
  User,
  CreditCard,
  Banknote,
  Smartphone,
  Package,
  Pill,
  Droplets,
  Syringe,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Edit,
  Save,
  X,
  TrendingUp,
  Wallet,
  Percent,
  Clock,
} from "lucide-react";

interface InvoiceItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  batchId?: string;
  batchNumber?: string;
  expiryDate?: string;
  product: {
    id: string;
    name: string;
    unitType: string;
    barcode?: string;
  };
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId?: string;
  userId: string;
  branchId: string;
  subtotal: number;
  discountAmount: number;
  discountPercentage?: number;
  totalAmount: number;
  paidAmount?: number; // Amount paid by customer
  returnedAmount?: number; // Amount returned/refunded
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  saleDate?: string;
  createdAt: string;
  receiptNumber?: string;
  customer?: {
    id: string;
    name: string;
    phone: string;
    email?: string;
    address?: string;
  };
  user: {
    id: string;
    name: string;
    username: string;
  };
  branch: {
    id: string;
    name: string;
    address: string;
  };
  items: InvoiceItem[];
  receipts: Array<{
    id: string;
    receiptNumber: string;
    printedAt?: string;
  }>;
}

const Invoices = () => {
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch, selectedCompanyId } = useAdmin();
  const { toast } = useToast();
  
  // Cache for invoices data
  const {
    getCachedData,
    setCachedData,
    isCacheValid,
    setLoading: setCacheLoading
  } = useDashboardData();
  
  // CRITICAL: Initialize from cache IMMEDIATELY on mount
  const initializeFromCache = () => {
    const cached = getCachedData(selectedCompanyId, selectedBranchId);
    if (cached && isCacheValid(cached) && cached.data.invoices) {
      return cached.data.invoices;
    }
    return null;
  };
  
  const cachedInvoicesOnMount = initializeFromCache();
  
  const [invoices, setInvoices] = useState<Invoice[]>(() => cachedInvoicesOnMount || []);
  const [filteredInvoices, setFilteredInvoices] = useState<Invoice[]>(() => cachedInvoicesOnMount || []);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({
    discountPercentage: 0,
    saleDate: '',
    notes: '',
    paymentStatus: 'COMPLETED' as string
  });
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [refundItems, setRefundItems] = useState<Array<{
    productId: string;
    productName: string;
    maxQuantity: number;
    quantity: number;
    unitPrice: number;
    reason: string;
    batchId?: string | null;
    saleItemId?: string | null;
  }>>([]);
  const [refundReason, setRefundReason] = useState("");
  const [loading, setLoading] = useState(false); // Don't show loading initially
  const [isEditing, setIsEditing] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [allBatches, setAllBatches] = useState<any[]>(() => {
    const cached = getCachedData(selectedCompanyId, selectedBranchId);
    if (cached && isCacheValid(cached) && cached.data.allBatches) {
      return cached.data.allBatches;
    }
    return [];
  });

  // CRITICAL: Restore from cache immediately on mount or when context changes
  useLayoutEffect(() => {
    const cached = getCachedData(selectedCompanyId, selectedBranchId);
    if (cached && isCacheValid(cached) && cached.data.invoices) {
      console.log('⚡ useLayoutEffect: Restoring invoices from cache IMMEDIATELY');
      const cachedData = cached.data;
      
      // Restore state synchronously
      if (cachedData.invoices) {
        setInvoices(cachedData.invoices);
        setFilteredInvoices(cachedData.invoices);
      }
      if (cachedData.allBatches) {
        setAllBatches(cachedData.allBatches);
      }
      
      setLoading(false);
    }
  }, [selectedCompanyId, selectedBranchId, getCachedData, isCacheValid]);

  // Load batches to calculate total cost
  useEffect(() => {
    // Check cache first
    const cached = getCachedData(selectedCompanyId, selectedBranchId);
    if (cached && isCacheValid(cached) && cached.data.allBatches) {
      setAllBatches(cached.data.allBatches);
      return; // Don't fetch if we have cached batches
    }
    
    const loadBatches = async () => {
      try {
        const response = await apiService.getBatches({ limit: 1000, isActive: true });
        if (response.success && response.data?.batches) {
          setAllBatches(response.data.batches);
          
          // Cache batches
          const existingCache = getCachedData(selectedCompanyId, selectedBranchId);
          const cacheData = existingCache?.data || {};
          cacheData.allBatches = response.data.batches;
          setCachedData(selectedCompanyId, selectedBranchId, cacheData);
        }
      } catch (error) {
        console.error('Error loading batches for cost calculation:', error);
      }
    };
    loadBatches();
  }, [selectedCompanyId, selectedBranchId, getCachedData, setCachedData, isCacheValid]);

  // Calculate financial metrics from filtered invoices
  const financialMetrics = useMemo(() => {
    const grossSales = filteredInvoices.reduce((sum, inv) => sum + (inv.subtotal || 0), 0);
    const totalDiscount = filteredInvoices.reduce((sum, inv) => sum + (inv.discountAmount || 0), 0);
    const netSales = filteredInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
    
    // Calculate total cost from invoice items using batch purchase prices
    let totalCost = 0;
    filteredInvoices.forEach(inv => {
      inv.items?.forEach(item => {
        // Try to find batch by batchId or batchNumber
        let batch = null;
        if (item.batchId) {
          batch = allBatches.find(b => b.id === item.batchId);
        } else if (item.batchNumber) {
          batch = allBatches.find(b => b.batchNo === item.batchNumber);
        }
        
        // If batch found, use purchasePrice, otherwise estimate as 70% of unitPrice (typical margin)
        const costPerUnit = batch?.purchasePrice || batch?.costPrice || (item.unitPrice * 0.7);
        totalCost += item.quantity * costPerUnit;
      });
    });
    
    const netRevenue = netSales - totalCost;
    const pending = filteredInvoices
      .filter(inv => inv.paymentStatus === 'PENDING' || inv.status === 'PENDING')
      .reduce((sum, inv) => sum + ((inv.totalAmount || 0) - (inv.paidAmount || 0)), 0);

    return {
      grossSales,
      totalDiscount,
      netSales,
      totalCost,
      netRevenue,
      pending
    };
  }, [filteredInvoices, allBatches]);

  // Format currency
  const formatCurrency = (amount: number) => {
    return `Rs. ${amount.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  // No mock data - only use real data from API

  useEffect(() => {
    // Check cache first before loading
    const cached = getCachedData(selectedCompanyId, selectedBranchId);
    if (cached && isCacheValid(cached) && cached.data.invoices) {
      console.log('✅ Found cached invoices on mount, skipping initial load');
      // Data already restored by useLayoutEffect
    } else {
      loadInvoices();
    }

    // Listen for new invoices created from POS
    const handleInvoiceCreated = (event: CustomEvent) => {
      loadInvoices(true); // Force refresh when new invoice is created
    };

    window.addEventListener('invoiceCreated', handleInvoiceCreated as EventListener);

    return () => {
      window.removeEventListener('invoiceCreated', handleInvoiceCreated as EventListener);
    };
  }, []);

  const loadInvoices = useCallback(async (forceRefresh: boolean = false) => {
    try {
      // CRITICAL: Check cache first (unless forcing refresh)
      const cached = getCachedData(selectedCompanyId, selectedBranchId);
      const cacheValid = isCacheValid(cached);
      
      // If we have valid cache and not forcing refresh, use cached data immediately
      if (cached && cacheValid && !forceRefresh && cached.data.invoices) {
        console.log('✅ Using cached invoices data - INSTANT LOAD');
        const cachedInvoices = cached.data.invoices;
        const cachedBatches = cached.data.allBatches || [];
        
        // Restore state from cache IMMEDIATELY
        setInvoices(cachedInvoices);
        setFilteredInvoices(cachedInvoices);
        if (cachedBatches.length > 0) {
          setAllBatches(cachedBatches);
        }
        
        setLoading(false);
        setCacheLoading(selectedCompanyId, selectedBranchId, false);
        
        // Still refresh in background if cache is older than 2 minutes (stale-while-revalidate)
        const cacheAge = Date.now() - cached.timestamp;
        if (cacheAge > 2 * 60 * 1000) {
          console.log('🔄 Cache is stale, refreshing invoices in background...');
          // Continue to fetch fresh data in background
        } else {
          // Cache is fresh, no need to fetch
          console.log('✅ Cache is fresh, skipping API call');
          return;
        }
      }
      
      // Only show loading if no cache
      if (!cached || !cacheValid) {
        setLoading(true);
      }
      setCacheLoading(selectedCompanyId, selectedBranchId, true);

      // Load from real API with date filtering and branch filtering
      console.log('🔍 Loading invoices with date filter:', { startDate, endDate });
      console.log('🔍 User context:', {
        id: user?.id,
        name: user?.name,
        role: user?.role,
        branchId: user?.branchId,
        adminId: user?.adminId
      });

      // Determine which invoices to load based on user role and selected branch
      const params: any = {
        limit: 200, // keep first load fast; UI paginates locally
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };

      if (user?.role === 'OWNER') {
        // Admin users can see invoices from selected branch or all branches
        if (selectedBranchId) {
          params.branchId = selectedBranchId;
          console.log('Admin selected specific branch for invoices:', selectedBranch?.name);
        } else {
          console.log('Admin viewing all branches - loading all invoices');
        }
      } else {
        // Regular users see only their branch invoices
        params.branchId = user?.membership?.branchIds?.[0] || user?.branchId;
        console.log('Regular user branch for invoices:', user?.branchId);
      }

      const response = await apiService.getSales(params);
      console.log('Invoices API response:', response);
      if (response.success && response.data?.sales) {
        // Transform sales data to match invoice format
        const transformedInvoices = response.data.sales.map((sale: any) => {
          return {
            id: sale.id,
            invoiceNumber: sale.invoiceNumber || sale.id, // Use invoiceNumber from database, fallback to id for backward compatibility
            customerId: sale.customerId,
            userId: sale.userId,
            branchId: sale.branchId,
            subtotal: sale.subtotal,
            discountAmount: sale.discountAmount,
            discountPercentage: sale.discountPercentage,
            totalAmount: sale.totalAmount,
            paidAmount: sale.paidAmount || 0, // Amount paid by customer
            returnedAmount: sale.returnedAmount || 0, // Amount returned/refunded
            paymentMethod: sale.paymentMethod,
            paymentStatus: sale.paymentStatus,
            status: sale.status,
            saleDate: sale.saleDate,
            createdAt: sale.createdAt,
            updatedAt: sale.updatedAt,
            customer: sale.customer ? {
              id: sale.customer.id,
              name: sale.customer.name,
              phone: sale.customer.phone,
              email: sale.customer.email,
              address: sale.customer.address
            } : null,
            user: sale.user,
            branch: sale.branch,
            items: (sale.items || []).map((item: any) => ({
              id: item.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              batchId: item.batchId || item.batch?.id || null,
              batchNumber: item.batchNumber || item.batch?.batchNo || null,
              expiryDate: item.expiryDate || item.batch?.expireDate || null,
              product: {
                id: item.product?.id || item.productId,
                name: item.product?.name || 'Unknown Product',
                unitType: item.product?.unitType || 'Item',
                sku: item.product?.sku || '',
                description: item.product?.description || ''
              }
            })),
            receipts: sale.receipts || [],
            receiptNumber: sale.receipts?.[0]?.receiptNumber || sale.id
          };
        });
        setInvoices(transformedInvoices);

        // CRITICAL: Cache invoices using DashboardDataContext
        // This ensures cache is shared and accessible instantly
        const existingCache = getCachedData(selectedCompanyId, selectedBranchId);
        const cacheData = existingCache?.data || {};
        cacheData.invoices = transformedInvoices;
        cacheData.allBatches = allBatches; // Also cache batches
        
        setCachedData(selectedCompanyId, selectedBranchId, cacheData);
        console.log('✅ Cached invoices immediately:', transformedInvoices.length);
      } else {
        // No data from API - show empty list
        console.log('No invoices found in API response');
        setInvoices([]);
      }
    } catch (error) {
      console.error('Error loading invoices:', error);
      // Show empty list on error instead of mock data
      setInvoices([]);
      // Don't show error toast - silent fail in background
    } finally {
      setLoading(false);
      setCacheLoading(selectedCompanyId, selectedBranchId, false);
    }
  }, [startDate, endDate, selectedBranchId, selectedCompanyId, user, getCachedData, setCachedData, isCacheValid, setCacheLoading, allBatches]);

  useEffect(() => {
    filterInvoices();
  }, [invoices, searchQuery, statusFilter, paymentMethodFilter]);

  useEffect(() => {
    // Check cache first when branch changes
    const cached = getCachedData(selectedCompanyId, selectedBranchId);
    if (cached && isCacheValid(cached) && cached.data.invoices) {
      console.log('✅ Found cached invoices for new branch, restoring immediately');
      const cachedData = cached.data;
      setInvoices(cachedData.invoices);
      setFilteredInvoices(cachedData.invoices);
      if (cachedData.allBatches) {
        setAllBatches(cachedData.allBatches);
      }
      
      // Refresh in background if cache is stale
      const cacheAge = Date.now() - cached.timestamp;
      if (cacheAge > 2 * 60 * 1000) {
        console.log('🔄 Cache is stale, refreshing in background...');
        loadInvoices(false).catch(console.error);
      }
    } else {
      loadInvoices();
    }
  }, [selectedBranchId, selectedCompanyId]);

  const filterInvoices = () => {
    console.log('🔍 Filtering invoices...');
    console.log('Total invoices before filtering:', invoices.length);

    let filtered = [...invoices];

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(invoice =>
        invoice.invoiceNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        invoice.customer?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        invoice.customer?.phone?.includes(searchQuery) ||
        invoice.receipts?.some(receipt =>
          receipt.receiptNumber?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(invoice => invoice.status === statusFilter);
    }

    // Payment method filter
    if (paymentMethodFilter !== "all") {
      filtered = filtered.filter(invoice => invoice.paymentMethod === paymentMethodFilter);
    }

    console.log('Filtered invoices count:', filtered.length);
    console.log('Filtered invoices:', filtered.map(inv => ({ id: inv.id, createdBy: inv.user?.username, total: inv.totalAmount })));

    setFilteredInvoices(filtered);
    setCurrentPage(1);
  };

  const getPaymentMethodIcon = (method: string) => {
    switch (method) {
      case "CASH":
        return <Banknote className="w-4 h-4" />;
      case "CARD":
        return <CreditCard className="w-4 h-4" />;
      case "MOBILE":
        return <Smartphone className="w-4 h-4" />;
      default:
        return <CreditCard className="w-4 h-4" />;
    }
  };

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

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      COMPLETED: "border-green-200 bg-green-50 text-green-800",
      PENDING: "border-amber-200 bg-amber-50 text-amber-800",
      CANCELLED: "border-red-200 bg-red-50 text-red-800",
      REFUNDED: "border-red-200 bg-red-50 text-red-800",
    };
    const label =
      status === "COMPLETED"
        ? "Completed"
        : status === "PENDING"
          ? "Pending"
          : status === "CANCELLED"
            ? "Cancelled"
            : status === "REFUNDED"
              ? "Refunded"
              : status;
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
          styles[status] || "border-[rgba(15,23,60,0.12)] bg-[#f8f9fc] text-[#4a5578]",
        )}
      >
        {label}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatReceiptNumber = (receiptNumber: string) => {
    if (receiptNumber === 'N/A' || !receiptNumber) {
      return 'N/A';
    }

    // If already in RCP format, return as is
    if (receiptNumber.startsWith('RCP-')) {
      return receiptNumber;
    }

    // Format as RCP-{original_receipt_number}
    return `RCP-${receiptNumber}`;
  };

  const paginatedInvoices = filteredInvoices.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const totalPages = Math.ceil(filteredInvoices.length / pageSize);

  // Calculate total revenue from filtered invoices
  const totalRevenue = filteredInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0);
  const totalInvoices = filteredInvoices.length;

  const viewInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsInvoiceDialogOpen(true);
  };

  const editInvoice = (invoice: Invoice) => {
    setEditingInvoice(invoice);
    setEditFormData({
      discountPercentage: invoice.discountPercentage || 0,
      saleDate: invoice.saleDate ? new Date(invoice.saleDate).toISOString().split('T')[0] : '',
      notes: '',
      paymentStatus: invoice.paymentStatus || 'COMPLETED'
    });
    setIsEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!editingInvoice) return;

    try {
      setIsEditing(true);

      // Call backend API to update the sale
      const response = await apiService.updateSale(editingInvoice.id, {
        discountPercentage: editFormData.discountPercentage,
        saleDate: editFormData.saleDate || undefined,
        notes: editFormData.notes,
        paymentStatus: editFormData.paymentStatus
      });

      if (response.success) {
        // Update the invoice in the local state with the response data
        const updatedInvoices = invoices.map(inv =>
          inv.id === editingInvoice.id
            ? {
              ...inv,
              discountPercentage: response.data.discountPercentage,
              discountAmount: response.data.discountAmount,
              totalAmount: response.data.totalAmount,
              paymentStatus: response.data.paymentStatus,
              status: response.data.status,
              saleDate: response.data.saleDate,
              updatedAt: response.data.updatedAt
            }
            : inv
        );

        setInvoices(updatedInvoices);
        setFilteredInvoices(updatedInvoices);

        // Close edit dialog
        setIsEditDialogOpen(false);
        setEditingInvoice(null);

        toast({
          title: "Success",
          description: "Invoice updated successfully!",
        });
      } else {
        toast({
          title: "Error",
          description: `Failed to update invoice: ${response.message}`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error updating invoice:', error);
      toast({
        title: "Error",
        description: "Error updating invoice. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsEditing(false);
    }
  };

  const printInvoice = (invoice: Invoice) => {
    try {
      // Create a new window for printing
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast({
          title: "Popup Blocked",
          description: "Please allow popups to print invoices",
          variant: "destructive",
        });
        return;
      }

      // Generate HTML content for the invoice
      const invoiceHTML = generateInvoiceHTML(invoice);

      printWindow.document.write(invoiceHTML);
      printWindow.document.close();

      // Wait for content to load, then print
      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
        printWindow.close();
      };
    } catch (error) {
      console.error('Error printing invoice:', error);
      toast({
        title: "Print Error",
        description: "Error printing invoice. Please try again.",
        variant: "destructive",
      });
    }
  };

  const downloadInvoice = (invoice: Invoice) => {
    try {
      // Generate HTML content for the invoice
      const invoiceHTML = generateInvoiceHTML(invoice);

      // Create a blob with the HTML content
      const blob = new Blob([invoiceHTML], { type: 'text/html' });
      const url = URL.createObjectURL(blob);

      // Create a temporary link element and trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${invoice.invoiceNumber}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the URL object
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading invoice:', error);
      toast({
        title: "Error",
        description: "Error downloading invoice. Please try again.",
        variant: "destructive",
      });
    }
  };

  const generateInvoiceHTML = (invoice: Invoice) => {
    const formatDate = (dateString: string) => {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice ${invoice.invoiceNumber}</title>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            margin: 0;
            padding: 20px;
            background: white;
            color: black;
          }
          .invoice-container {
            max-width: 800px;
            margin: 0 auto;
            border: 1px solid #ddd;
            padding: 30px;
          }
          .header {
            text-align: center;
            border-bottom: 2px solid #1C623C;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          .header h1 {
            color: #1C623C;
            margin: 0;
            font-size: 28px;
          }
          .header p {
            color: #666;
            margin: 5px 0;
          }
          .invoice-info {
            display: flex;
            justify-content: space-between;
            margin-bottom: 30px;
          }
          .invoice-details, .customer-details {
            flex: 1;
          }
          .invoice-details h3, .customer-details h3 {
            color: #1C623C;
            margin-bottom: 10px;
            font-size: 16px;
          }
          .info-row {
            margin: 5px 0;
            font-size: 14px;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
          }
          .items-table th, .items-table td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
          }
          .items-table th {
            background-color: #f8f9fa;
            font-weight: bold;
            color: #1C623C;
          }
          .items-table tr:nth-child(even) {
            background-color: #f8f9fa;
          }
          .totals {
            margin-top: 20px;
            text-align: right;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            margin: 5px 0;
            padding: 5px 0;
          }
          .total-final {
            font-weight: bold;
            font-size: 18px;
            color: #1C623C;
            border-top: 2px solid #1C623C;
            padding-top: 10px;
            margin-top: 10px;
          }
          .status {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
          }
          .status-completed {
            background-color: #d4edda;
            color: #155724;
          }
          .status-refunded {
            background-color: #f8d7da;
            color: #721c24;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            color: #666;
            font-size: 12px;
            border-top: 1px solid #ddd;
            padding-top: 20px;
          }
          @media print {
            body { margin: 0; padding: 10px; }
            .invoice-container { border: none; padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="header">
            <h1>${invoice.branch.name}</h1>
            <p>Your Health, Our Priority</p>
          </div>

          <div class="invoice-info">
            <div class="invoice-details">
              <h3>Invoice Details</h3>
              <div class="info-row"><strong>Invoice #:</strong> ${invoice.invoiceNumber}</div>
              <div class="info-row"><strong>Date:</strong> ${invoice.saleDate ? formatDate(invoice.saleDate) : formatDate(invoice.createdAt)}</div>
              <div class="info-row"><strong>Status:</strong> <span class="status status-${invoice.status.toLowerCase()}">${invoice.status}</span></div>
              <div class="info-row"><strong>Payment Method:</strong> ${invoice.paymentMethod}</div>
              <div class="info-row"><strong>Cashier:</strong> ${invoice.user.name}</div>
              <div class="info-row"><strong>Branch:</strong> ${invoice.branch.name}</div>
            </div>

            <div class="customer-details">
              <h3>Customer Information</h3>
              ${invoice.customer ? `
                <div class="info-row"><strong>Name:</strong> ${invoice.customer.name}</div>
              ` : `
                <div class="info-row"><strong>Customer Type:</strong> Walk-in Customer</div>
              `}
            </div>
          </div>

          <table class="items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Quantity</th>
                <th>Unit Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${invoice.items.map(item => `
                <tr>
                  <td>${item.product.name}</td>
                  <td>${item.quantity} ${item.product.unitType}</td>
                  <td>PKR ${item.unitPrice.toFixed(2)}</td>
                  <td>PKR ${item.totalPrice.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="totals">
            <div class="total-row">
              <span>Subtotal:</span>
              <span>PKR ${invoice.subtotal.toFixed(2)}</span>
            </div>
            ${(invoice.discountPercentage && invoice.discountPercentage > 0) || invoice.discountAmount > 0 ? `
              <div class="total-row" style="color: #16a34a;">
                <span>${invoice.discountPercentage && invoice.discountPercentage > 0 ? `Discount (${invoice.discountPercentage}%):` : 'Discount:'}</span>
                <span>-PKR ${invoice.discountPercentage && invoice.discountPercentage > 0 ? (invoice.subtotal * invoice.discountPercentage / 100).toFixed(2) : invoice.discountAmount.toFixed(2)}</span>
              </div>
            ` : ''}
            <div class="total-row total-final">
              <span>TOTAL:</span>
              <span>PKR ${invoice.totalAmount.toFixed(2)}</span>
            </div>
          </div>

          <div class="footer">
            <p>Thank you for choosing ${invoice.branch.name}!</p>
            <p>For any queries, please contact us at your nearest branch.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  };

  const openRefundDialog = (invoice: Invoice) => {
    console.log('Opening refund dialog for invoice:', invoice);
    console.log('Invoice status:', invoice.status);
    console.log('Invoice items:', invoice.items);
    console.log('Invoice items length:', invoice.items?.length || 0);
    console.log('Invoice items structure:', JSON.stringify(invoice.items, null, 2));

    // Check if invoice is already refunded
    if (invoice.status === 'REFUNDED') {
      toast({
        title: "Already Refunded",
        description: "This invoice has already been refunded.",
        variant: "destructive",
      });
      return;
    }

    // Check if invoice is completed
    if (invoice.status !== 'COMPLETED') {
      toast({
        title: "Invalid Invoice Status",
        description: "Only completed invoices can be refunded.",
        variant: "destructive",
      });
      return;
    }

    setSelectedInvoice(invoice);

    // Check if invoice has items
    if (!invoice.items || invoice.items.length === 0) {
      console.error('No items found in invoice:', invoice);
      toast({
        title: "No Items",
        description: "No items found in this invoice. Cannot process refund.",
        variant: "destructive",
      });
      return;
    }

    // Initialize refund items with invoice items
    const items = (invoice.items || []).map(item => {
      console.log('Mapping item for refund:', item);
      console.log('Item product:', item.product);
      console.log('Item batchId:', item.batchId);
      return {
        productId: item.productId,
        productName: item.product?.name || 'Unknown Product',
        maxQuantity: item.quantity,
        quantity: 0, // Start with 0 quantity for refund
        unitPrice: item.unitPrice,
        reason: "Customer requested refund",
        batchId: item.batchId || null, // Include batch ID for stock return
        saleItemId: item.id || null
      };
    });

    console.log('Mapped refund items:', items);
    setRefundItems(items);
    setRefundReason("Customer requested refund");
    setIsRefundDialogOpen(true);
  };

  const handleRefundItemChange = (index: number, field: string, value: any) => {
    const updatedItems = [...refundItems];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setRefundItems(updatedItems);
  };

  const createRefund = async () => {
    if (!selectedInvoice) return;

    try {
      setIsRefunding(true);

      // Filter out items with quantity 0
      const itemsToRefund = refundItems.filter(item => item.quantity > 0);

      if (itemsToRefund.length === 0) {
        toast({
          title: "No Items Selected",
          description: "Please select at least one item to refund.",
          variant: "destructive",
        });
        return;
      }

      // Calculate total refund amount
      const totalRefundAmount = itemsToRefund.reduce((total, item) => {
        return total + (item.quantity * item.unitPrice);
      }, 0);

      console.log('Creating refund with data:', {
        originalSaleId: selectedInvoice.id,
        refundReason: refundReason,
        totalRefundAmount: totalRefundAmount,
        items: itemsToRefund
      });

      const refundData = {
        originalSaleId: selectedInvoice.id,
        refundReason: refundReason,
        items: itemsToRefund.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          reason: item.reason,
          batchId: item.batchId || null, // Include batch ID for stock return
          saleItemId: item.saleItemId || null
        })),
        refundedBy: user?.id || selectedInvoice.user?.id
      };

      const response = await apiService.createRefund(refundData);
      if (response.success) {
        console.log('Refund created successfully:', response.data);
        toast({
          title: "Success",
          description: `Refund created successfully for invoice: ${selectedInvoice.invoiceNumber}. Refund Amount: PKR ${totalRefundAmount.toFixed(2)}`,
        });
        setIsRefundDialogOpen(false);
        // Reset refund form
        setRefundItems([]);
        setRefundReason("");
        // Reload invoices to reflect the refund
        loadInvoices();
      } else {
        console.error('Refund creation failed:', response);
        const errorMessage = response.message || 'Failed to create refund';
        const isAlreadyRefunded = errorMessage.toLowerCase().includes('already refunded') || (response as any).error === 'ALREADY_REFUNDED';
        
        toast({
          title: isAlreadyRefunded ? "Already Refunded" : "Error",
          description: isAlreadyRefunded ? errorMessage : `Failed to create refund: ${errorMessage}`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Error creating refund:', error);
      const errorMessage = error?.response?.message 
        || error?.response?.data?.message 
        || error?.message 
        || "Error creating refund. Please try again.";
      
      const isAlreadyRefunded = errorMessage.toLowerCase().includes('already refunded') 
        || error?.response?.error === 'ALREADY_REFUNDED'
        || error?.response?.data?.error === 'ALREADY_REFUNDED';
      
      toast({
        title: isAlreadyRefunded ? "Already Refunded" : "Error",
        description: isAlreadyRefunded ? errorMessage : errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsRefunding(false);
    }
  };

  const invFilterSelect = "h-11 min-w-[140px] rounded-[10px] border-[1.5px] border-black/[0.08] bg-white text-[13px] text-[#0a1128] shadow-none focus:ring-4 focus:ring-[rgba(26,82,197,0.08)] md:w-[168px]";
  const invDateInput = "h-11 w-[150px] rounded-[10px] border-[1.5px] border-black/[0.08] bg-[#f0f2f7] text-sm text-[#0a1128] focus-visible:border-[#1a52c5] focus-visible:bg-white";
  const invSearchInput = "h-11 w-full rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] pl-10 pr-3 text-sm text-[#0a1128] placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-[4px] focus-visible:ring-[rgba(26,82,197,0.06)]";

  // Don't show loading screen - show content immediately

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
            <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">Invoices</h1>
            <p className="text-sm text-[#8c95b0]">
              Sales and receipts for your branch
            </p>
          </div>
          <Button
            type="button"
            onClick={() => void loadInvoices(true)}
            variant="outline"
            className="rounded-[10px] border border-[rgba(15,23,60,0.06)] font-semibold text-[#4a5578] hover:bg-white"
          >
            <RefreshCw className="mr-2 h-4 w-4" strokeWidth={2} />
            Refresh
          </Button>
        </div>

        <div className="zv3-animate-fadeUp zv3-delay-1 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-5 py-5">
          <p className="mb-3 text-xs font-semibold text-[#8c95b0]">Filters</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 shrink-0 text-[#8c95b0]" strokeWidth={2} />
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={invDateInput} />
            </div>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={invDateInput} />
            {(startDate || endDate) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
                className="h-9 w-9 shrink-0 rounded-[10px] p-0 text-[#8c95b0] hover:bg-[#f0f2f7] hover:text-[#0a1128]"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]" strokeWidth={2} />
              <Input
                placeholder="Invoice #, customer, phone, receipt…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={invSearchInput}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className={invFilterSelect}>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
              <SelectTrigger className={cn(invFilterSelect, "md:min-w-[180px]")}>
                <SelectValue placeholder="Payment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All methods</SelectItem>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="MOBILE">Mobile</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 whitespace-nowrap text-sm text-[#8c95b0]">
              <Filter className="h-4 w-4" strokeWidth={2} />
              <span className="font-medium text-[#4a5578]">Filter</span>
            </div>
          </div>
        </div>

        <div className="zv3-animate-fadeUp zv3-delay-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {[
            { label: "Gross sales", value: formatCurrency(financialMetrics.grossSales), icon: Receipt },
            { label: "Discounts", value: formatCurrency(financialMetrics.totalDiscount), icon: Percent },
            { label: "Net sales", value: formatCurrency(financialMetrics.netSales), icon: TrendingUp },
            { label: "Total cost", value: formatCurrency(financialMetrics.totalCost), icon: Package },
            { label: "Net revenue", value: formatCurrency(financialMetrics.netRevenue), icon: Wallet },
            { label: "Pending", value: formatCurrency(financialMetrics.pending), icon: Clock },
          ].map((m) => (
            <div
              key={m.label}
              className="rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white p-4 transition-all duration-300 hover:-translate-y-[2px] hover:shadow-[0_8px_28px_rgba(0,0,0,0.05)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[#8c95b0]">{m.label}</p>
                  <p className="text-base font-extrabold leading-tight tracking-tight text-[#0a1128]">{m.value}</p>
                </div>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[rgba(26,82,197,0.08)] to-[rgba(40,194,206,0.06)] text-[#1a52c5]">
                  <m.icon className="h-[18px] w-[18px]" strokeWidth={2} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="zv3-animate-fadeUp zv3-delay-3">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <Receipt className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              <span className="text-[17px] font-bold text-[#0a1128]">Invoice list</span>
              <span className="text-sm font-medium text-[#8c95b0]">({filteredInvoices.length})</span>
            </div>
            {filteredInvoices.length > 0 && (
              <p className="text-sm text-[#8c95b0]">
                Total revenue{" "}
                <span className="font-bold text-green-600">PKR {totalRevenue.toFixed(2)}</span>
              </p>
            )}
          </div>

          <div className="rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
            {paginatedInvoices.length === 0 ? (
              <div className="px-8 py-16 text-center">
                <div className="mx-auto mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[rgba(26,82,197,0.06)]">
                  <Receipt className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
                </div>
                <p className="text-sm font-bold text-[#0a1128]">No invoices found</p>
                <p className="mt-1 text-sm text-[#8c95b0]">Try adjusting search, dates, or filters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1400px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                      {["Invoice #", "Customer", "Date", "Cashier", "Payment", "Branch", "Items", "Total", "Paid", "Returned", "Status", "Actions"].map((h) => (
                        <th
                          key={h}
                          className={cn(
                            "px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]",
                            h === "Actions" && "pr-6 text-right sticky right-0 bg-black/[0.015] z-10 shadow-[-4px_0_10px_rgba(0,0,0,0.05)]",
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedInvoices.map((invoice) => {
                      const totalQuantity = invoice.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
                      const qtyLabel = totalQuantity > 0 ? `${totalQuantity} item(s)` : `${invoice.items.length} item(s)`;
                      return (
                        <tr
                          key={invoice.id}
                          className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                        >
                          <td className="px-4 py-3.5 pl-6 align-middle font-semibold text-[#0a1128]">{invoice.invoiceNumber}</td>
                          <td className="max-w-[140px] truncate px-4 py-3.5 align-middle text-[13px] text-[#4a5578]" title={invoice.customer?.name || "Walk-in"}>
                            {invoice.customer?.name || "Walk-in Customer"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 align-middle text-[13px] text-[#4a5578]">
                            {invoice.saleDate ? formatDate(invoice.saleDate) : formatDate(invoice.createdAt)}
                          </td>
                          <td className="max-w-[100px] truncate px-4 py-3.5 align-middle text-[13px] text-[#4a5578]">{invoice.user.name}</td>
                          <td className="px-4 py-3.5 align-middle">
                            <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                              <span className="text-[#8c95b0]">{getPaymentMethodIcon(invoice.paymentMethod)}</span>
                              {invoice.paymentMethod}
                            </div>
                          </td>
                          <td className="max-w-[120px] truncate px-4 py-3.5 align-middle text-[13px] text-[#4a5578]">{invoice.branch.name}</td>
                          <td className="px-4 py-3.5 align-middle text-[13px] text-[#4a5578]">{qtyLabel}</td>
                          <td className="px-4 py-3.5 align-middle text-[13px] font-bold text-[#1a52c5]">PKR {invoice.totalAmount.toFixed(2)}</td>
                          <td className="px-4 py-3.5 align-middle text-[13px] font-semibold text-green-600">PKR {(invoice.paidAmount || 0).toFixed(2)}</td>
                          <td className="px-4 py-3.5 align-middle text-[13px] font-semibold text-red-600">PKR {(invoice.returnedAmount || 0).toFixed(2)}</td>
                          <td className="px-4 py-3.5 align-middle">{getStatusBadge(invoice.status)}</td>
                          <td className="px-4 py-3.5 pr-6 text-right align-middle sticky right-0 bg-white z-10 shadow-[-4px_0_10px_rgba(0,0,0,0.05)]">
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              <button
                                type="button"
                                title="View"
                                onClick={() => viewInvoice(invoice)}
                                className="grid h-8 w-8 place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] text-[#8c95b0] hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                              >
                                <Eye className="h-3.5 w-3.5" strokeWidth={2} />
                              </button>
                              <button
                                type="button"
                                title="Print"
                                onClick={() => printInvoice(invoice)}
                                className="grid h-8 w-8 place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] text-[#8c95b0] hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                              >
                                <Printer className="h-3.5 w-3.5" strokeWidth={2} />
                              </button>
                              <button
                                type="button"
                                title="Download"
                                onClick={() => downloadInvoice(invoice)}
                                className="grid h-8 w-8 place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] text-[#8c95b0] hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                              >
                                <Download className="h-3.5 w-3.5" strokeWidth={2} />
                              </button>
                              <button
                                type="button"
                                title="Edit"
                                onClick={() => editInvoice(invoice)}
                                className="grid h-8 w-8 place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] text-[#8c95b0] hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                              >
                                <Edit className="h-3.5 w-3.5" strokeWidth={2} />
                              </button>
                              <button
                                type="button"
                                title={invoice.status === "REFUNDED" ? "Refunded" : "Refund"}
                                onClick={() => openRefundDialog(invoice)}
                                disabled={invoice.status === "REFUNDED"}
                                className={cn(
                                  "grid h-8 w-8 place-items-center rounded-lg border border-[rgba(15,23,60,0.06)]",
                                  invoice.status === "REFUNDED"
                                    ? "cursor-not-allowed opacity-40"
                                    : "text-amber-600 hover:border-amber-600/20 hover:bg-amber-500/[0.06]",
                                )}
                              >
                                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {paginatedInvoices.length > 0 && (
              <div className="border-t border-[rgba(15,23,60,0.06)] px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4 border-t border-[rgba(15,23,60,0.06)]">
                  <div className="flex items-center gap-3">
                    <div className="text-sm text-[#8c95b0]">
                      Showing {Math.min((currentPage - 1) * pageSize + 1, filteredInvoices.length)} to {Math.min(currentPage * pageSize, filteredInvoices.length)} of {filteredInvoices.length} invoices
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-[#8c95b0]">Per page:</span>
                      <select
                        value={pageSize}
                        onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                        className="h-[32px] rounded-lg border border-[rgba(15,23,60,0.06)] bg-white px-2 text-sm font-semibold text-[#0a1128] outline-none focus:ring-2 focus:ring-[rgba(26,82,197,0.15)]"
                      >
                        <option value="10">10</option>
                        <option value="25">25</option>
                        <option value="50">50</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
                    >
                      Previous
                    </button>
                    <span className="text-sm font-semibold text-[#0a1128]">Page {currentPage} of {totalPages}</span>
                    <button
                      type="button"
                      onClick={() => setCurrentPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>



        {/* Invoice Details Dialog */}
        <Dialog open={isInvoiceDialogOpen} onOpenChange={setIsInvoiceDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="flex flex-col gap-3 text-[22px] font-extrabold tracking-tight text-[#0a1128] sm:flex-row sm:items-center sm:justify-between">
                <span>Invoice {selectedInvoice?.invoiceNumber}</span>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="rounded-[10px] border border-[rgba(15,23,60,0.06)]" onClick={() => selectedInvoice && printInvoice(selectedInvoice)}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-[10px] border border-[rgba(15,23,60,0.06)]" onClick={() => selectedInvoice && downloadInvoice(selectedInvoice)}>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => selectedInvoice && openRefundDialog(selectedInvoice)}
                    className={cn(
                      "rounded-[10px] border border-[rgba(15,23,60,0.06)]",
                      selectedInvoice?.status === "REFUNDED"
                        ? "cursor-not-allowed opacity-50"
                        : "text-amber-700 hover:bg-amber-500/[0.06]",
                    )}
                    disabled={selectedInvoice?.status === "REFUNDED"}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {selectedInvoice?.status === "REFUNDED" ? "Refunded" : "Refund"}
                  </Button>
                </div>
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
                Full line items, totals, and payment summary.
              </DialogDescription>
            </DialogHeader>

            {selectedInvoice && (
              <div className="space-y-6">
                {/* Invoice Header */}
                <div className="flex justify-between items-start border-b pb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-primary">{selectedInvoice.branch.name}</h2>
                    <p className="text-muted-foreground">Your Health, Our Priority</p>
                    <div className="mt-4 space-y-1 text-sm">
                      <p><strong>Invoice Number:</strong> {selectedInvoice.invoiceNumber}</p>
                      <p><strong>Date:</strong> {selectedInvoice.saleDate ? formatDate(selectedInvoice.saleDate) : formatDate(selectedInvoice.createdAt)}</p>
                      <p><strong>Cashier:</strong> {selectedInvoice.user.name}</p>
                      <p><strong>Branch:</strong> {selectedInvoice.branch.name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-primary">
                      PKR {selectedInvoice.totalAmount.toFixed(2)}
                    </p>
                    <div className="mt-2">
                      {getStatusBadge(selectedInvoice.status)}
                    </div>
                  </div>
                </div>

                {/* Customer Info */}
                <div className="border-b pb-4">
                  <h3 className="font-semibold mb-2">Customer Information</h3>
                  {selectedInvoice.customer && (selectedInvoice.customer.name || selectedInvoice.customer.phone) ? (
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p><strong>Name:</strong> {selectedInvoice.customer.name}</p>
                        <p><strong>Phone:</strong> {selectedInvoice.customer.phone || 'N/A'}</p>
                      </div>
                      <div>
                        <p><strong>Email:</strong> {selectedInvoice.customer.email || 'N/A'}</p>
                        <p><strong>Address:</strong> {selectedInvoice.customer.address || 'N/A'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      <p><strong>Customer Type:</strong> Walk-in Customer</p>
                      <p><strong>No customer details available</strong></p>
                    </div>
                  )}
                </div>

                {/* Items */}
                <div className="space-y-3">
                  <h3 className="font-semibold">Items Purchased</h3>
                  {selectedInvoice.items.map((item) => (
                    <div key={item.id} className="flex justify-between items-center py-2 border-b border-dashed">
                      <div className="flex-1">
                        <p className="font-medium">{item.product.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.quantity} {item.product.unitType} × PKR {item.unitPrice.toFixed(2)}
                          {item.batchNumber && ` • Batch: ${item.batchNumber}`}
                          {item.expiryDate && ` • Exp: ${new Date(item.expiryDate).toLocaleDateString()}`}
                        </p>
                      </div>
                      <p className="font-semibold">PKR {item.totalPrice.toFixed(2)}</p>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>PKR {selectedInvoice.subtotal.toFixed(2)}</span>
                  </div>
                  {((selectedInvoice.discountPercentage && selectedInvoice.discountPercentage > 0) || selectedInvoice.discountAmount > 0) && (
                    <div className="flex justify-between text-green-600">
                      <span>
                        {selectedInvoice.discountPercentage && selectedInvoice.discountPercentage > 0
                          ? `Discount (${selectedInvoice.discountPercentage}%):`
                          : 'Discount:'
                        }
                      </span>
                      <span>
                        -PKR {selectedInvoice.discountPercentage && selectedInvoice.discountPercentage > 0
                          ? (selectedInvoice.subtotal * selectedInvoice.discountPercentage / 100).toFixed(2)
                          : selectedInvoice.discountAmount.toFixed(2)
                        }
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span className="text-primary">PKR {selectedInvoice.totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                {/* Payment Info */}
                <div className="border-t pt-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p><strong>Payment Method:</strong> {selectedInvoice.paymentMethod}</p>
                      <p><strong>Status:</strong> {selectedInvoice.paymentStatus}</p>
                    </div>
                    <div>
                      <p><strong>Receipt Number:</strong> {selectedInvoice.receipts?.[0]?.receiptNumber || selectedInvoice.invoiceNumber || 'N/A'}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Refund Dialog */}
        <Dialog open={isRefundDialogOpen} onOpenChange={setIsRefundDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="flex flex-col gap-3 text-[22px] font-extrabold tracking-tight text-[#0a1128] sm:flex-row sm:items-center sm:justify-between">
                <span>Refund — {selectedInvoice?.invoiceNumber}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-[10px] border border-[rgba(15,23,60,0.06)] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95 disabled:opacity-50"
                  onClick={createRefund}
                  disabled={isRefunding}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {isRefunding ? "Processing…" : "Process refund"}
                </Button>
              </DialogTitle>
              <DialogDescription className="text-[13px] text-[#8c95b0]">
                Select quantities to return to stock. Completed invoices only.
              </DialogDescription>
            </DialogHeader>

            {selectedInvoice && (
              <div className="space-y-6">
                {/* Refund Reason */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Refund Reason</label>
                  <Input
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Enter reason for refund..."
                  />
                </div>

                {/* Items to Refund */}
                <div className="space-y-4">
                  <h3 className="font-semibold">Items to Refund</h3>
                  <div className="text-sm text-muted-foreground">
                    Debug: {refundItems.length} items loaded
                  </div>
                  <div className="space-y-3">
                    {refundItems.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <p>No items found in this invoice.</p>
                        <p className="text-sm">Invoice ID: {selectedInvoice?.id}</p>
                        <p className="text-sm">Items in invoice: {selectedInvoice?.items?.length || 0}</p>
                        <p className="text-sm">Debug: {refundItems.length} items loaded</p>
                        <div className="text-xs text-muted-foreground mt-2">
                          <p>Invoice structure: {JSON.stringify(selectedInvoice?.items?.slice(0, 1), null, 2)}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            // Try to reload the invoice data
                            console.log('Reloading invoice data...');
                            if (selectedInvoice) {
                              openRefundDialog(selectedInvoice);
                            }
                          }}
                          className="mt-2"
                        >
                          Retry Loading Items
                        </Button>
                      </div>
                    ) : (
                      refundItems.map((item, index) => (
                        <div key={item.productId} className="border rounded-lg p-4 space-y-3">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <h4 className="font-medium">{item.productName}</h4>
                              <p className="text-sm text-muted-foreground">
                                Unit Price: PKR {item.unitPrice.toFixed(2)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-muted-foreground">
                                Max: {item.maxQuantity} units
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Quantity to Refund</label>
                              <Input
                                type="number"
                                min="0"
                                max={item.maxQuantity}
                                value={item.quantity}
                                onChange={(e) => handleRefundItemChange(index, 'quantity', parseInt(e.target.value) || 0)}
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Reason</label>
                              <Input
                                value={item.reason}
                                onChange={(e) => handleRefundItemChange(index, 'reason', e.target.value)}
                                placeholder="Reason for this item..."
                              />
                            </div>
                          </div>

                          <div className="flex justify-between items-center pt-2 border-t">
                            <span className="text-sm text-muted-foreground">
                              Total Refund Amount:
                            </span>
                            <span className="font-medium">
                              PKR {(item.quantity * item.unitPrice).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Refund Summary */}
                <div className="border-t pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold">Total Refund Amount:</span>
                    <span className="text-xl font-bold text-orange-600">
                      PKR {refundItems.reduce((total, item) => total + (item.quantity * item.unitPrice), 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Invoice Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="flex items-center gap-2 text-[22px] font-extrabold tracking-tight text-[#0a1128]">
                <Edit className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
                Edit invoice — {editingInvoice?.invoiceNumber}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-[#8c95b0]">Adjust discount, date, and payment status.</DialogDescription>
            </DialogHeader>

            {editingInvoice && (
              <div className="space-y-6">
                {/* Invoice Info */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h3 className="font-semibold mb-2">Invoice Information</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Customer:</span>
                      <span className="ml-2 font-medium">
                        {editingInvoice.customer?.name || 'Walk-in Customer'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Items:</span>
                      <span className="ml-2 font-medium">{editingInvoice.items.length} item(s)</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Subtotal:</span>
                      <span className="ml-2 font-medium">PKR {editingInvoice.subtotal.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Current Total:</span>
                      <span className="ml-2 font-medium text-[#0c2c8a]">PKR {editingInvoice.totalAmount.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Edit Form */}
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Discount Percentage</label>
                      <div className="flex items-center space-x-2">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={editFormData.discountPercentage}
                          onChange={(e) => setEditFormData({
                            ...editFormData,
                            discountPercentage: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0))
                          })}
                          className="flex-1"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                      {editFormData.discountPercentage > 0 && (
                        <p className="text-xs text-green-600">
                          Discount Amount: -PKR {((editingInvoice.subtotal * editFormData.discountPercentage) / 100).toFixed(2)}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Sale Date</label>
                      <Input
                        type="date"
                        value={editFormData.saleDate}
                        onChange={(e) => setEditFormData({
                          ...editFormData,
                          saleDate: e.target.value
                        })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Payment Status</label>
                    <Select
                      value={editFormData.paymentStatus}
                      onValueChange={(value) => setEditFormData({
                        ...editFormData,
                        paymentStatus: value
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select payment status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="COMPLETED">
                          <div className="flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            <span>Paid (Completed)</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="PENDING">
                          <div className="flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                            <span>Unpaid (Pending)</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {editFormData.paymentStatus === 'COMPLETED'
                        ? 'Invoice will be marked as paid and completed'
                        : 'Invoice will be marked as unpaid/pending'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Notes (Optional)</label>
                    <Input
                      value={editFormData.notes}
                      onChange={(e) => setEditFormData({
                        ...editFormData,
                        notes: e.target.value
                      })}
                      placeholder="Add any notes about this invoice..."
                    />
                  </div>
                </div>

                {/* New Totals Preview */}
                {editFormData.discountPercentage !== (editingInvoice.discountPercentage || 0) && (
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <h4 className="font-semibold text-blue-800 mb-2">New Totals Preview</h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>Subtotal:</span>
                        <span>PKR {editingInvoice.subtotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-green-600">
                        <span>Discount ({editFormData.discountPercentage}%):</span>
                        <span>-PKR {((editingInvoice.subtotal * editFormData.discountPercentage) / 100).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-semibold border-t pt-1">
                        <span>New Total:</span>
                        <span className="text-blue-600">
                          PKR {(editingInvoice.subtotal - (editingInvoice.subtotal * editFormData.discountPercentage / 100)).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex justify-end space-x-3 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={() => setIsEditDialogOpen(false)}
                  >
                    <X className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                  <Button
                    onClick={handleEditSave}
                    disabled={isEditing}
                    className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {isEditing ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Invoices;
