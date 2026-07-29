import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import DateRangeFilter from "@/components/ui/DateRangeFilter";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  RotateCcw,
  Search,
  Filter,
  Download,
  Printer,
  Eye,
  Calendar,
  User,
  AlertCircle,
  Package,
  Pill,
  Droplets,
  Syringe,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Receipt,
  Wallet,
} from "lucide-react";

interface RefundedItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unitType: string;
}

interface RefundRecord {
  id: string;
  originalInvoiceId: string;
  originalInvoiceNumber: string;
  receiptNumber: string;
  refundAmount: number;
  refundReason: string;
  refundedAt: string;
  refundedBy: string;
  items: RefundedItem[];
  customer?: {
    id: string;
    name: string;
    phone: string;
    email?: string;
    address?: string;
  };
}

const Refunds = () => {
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch, selectedCompanyId } = useAdmin();

  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [filteredRefunds, setFilteredRefunds] = useState<RefundRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedRefund, setSelectedRefund] = useState<RefundRecord | null>(null);
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false); // Don't show loading initially
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [receiptNumber, setReceiptNumber] = useState("");
  const [isSearchingReceipt, setIsSearchingReceipt] = useState(false);
  const [foundInvoice, setFoundInvoice] = useState<any>(null);
  const [isCreateRefundDialogOpen, setIsCreateRefundDialogOpen] = useState(false);
  const [createRefundReason, setCreateRefundReason] = useState("");

  // Load refunds on mount
  useEffect(() => {
    // Load fresh data
    setTimeout(() => {
      loadRefunds();
    }, 0);

    // Listen for new refunds
    const handleRefundCreated = (event: CustomEvent) => {
      console.log('🔄 Refund created event received, refreshing refunds list');
      loadRefunds(true); // Force refresh when new refund is created
    };

    // Real-time data synchronization
    const handleRefundChanged = (event: CustomEvent) => {
      console.log('🔄 Real-time refund change received:', event.detail);
      const { action, refund } = event.detail;

      if (action === 'created') {
        // Add new refund to the list
        const transformedRefund = {
          id: refund.id,
          originalInvoiceId: refund.originalSaleId,
          originalInvoiceNumber: refund.originalSale?.receipts?.[0]?.receiptNumber || refund.originalSale?.id || 'N/A',
          receiptNumber: refund.originalSale?.receipts?.[0]?.receiptNumber || refund.originalSale?.id || 'N/A',
          refundAmount: parseFloat(String(refund.refundAmount)) || 0,
          refundReason: refund.refundReason,
          refundedAt: refund.createdAt || new Date().toISOString(),
          refundedBy: refund.refundedByUser?.name || 'Unknown',
          items: refund.items?.map((item: any) => ({
            productId: item.productId,
            productName: item.product?.name || 'Unknown',
            quantity: item.quantity,
            unitPrice: parseFloat(String(item.unitPrice)) || 0,
            totalPrice: parseFloat(String(item.unitPrice)) * item.quantity,
            unitType: item.product?.unitType || 'pcs',
            reason: item.reason
          })) || [],
          customer: refund.originalSale?.customer ? {
            id: refund.originalSale.customer.id,
            name: refund.originalSale.customer.name,
            phone: refund.originalSale.customer.phone
          } : undefined
        };

        setRefunds(prev => [transformedRefund, ...prev]);
      } else if (action === 'updated') {
        // Update existing refund
        setRefunds(prev => prev.map(r => r.id === refund.id ? {
          ...r,
          refundAmount: parseFloat(String(refund.refundAmount)) || 0,
          refundReason: refund.refundReason
        } : r));
      } else if (action === 'deleted') {
        // Remove refund from the list
        setRefunds(prev => prev.filter(r => r.id !== refund.id));
      }
    };

    window.addEventListener('invoiceRefunded', handleRefundCreated as EventListener);
    window.addEventListener('refundCreated', handleRefundCreated as EventListener);
    window.addEventListener('refundChanged', handleRefundChanged as EventListener);

    return () => {
      window.removeEventListener('invoiceRefunded', handleRefundCreated as EventListener);
      window.removeEventListener('refundCreated', handleRefundCreated as EventListener);
      window.removeEventListener('refundChanged', handleRefundChanged as EventListener);
    };
  }, []);

  const loadRefunds = useCallback(async (forceRefresh: boolean = false) => {
    try {
      console.log('🔄 Loading refunds...');

      // Check if user is loaded
      if (!user) {
        console.log('⚠️ User not loaded yet, skipping refunds load');
        setLoading(false);
        return;
      }

      // Try to load from API with date filtering
      console.log('🔍 Loading refunds with date filter:', { startDate, endDate });
      console.log('🔍 User context:', {
        id: user?.id,
        role: user?.role,
        adminId: user?.adminId,
        branchId: user?.branchId
      });

      try {
        // Determine which refunds to load based on user role and selected branch
        const params: any = {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        };

        if (user?.role === 'OWNER') {
          // Admin users can see refunds from selected branch or all branches
          if (selectedBranchId) {
            params.branchId = selectedBranchId;
            console.log('Admin selected specific branch for refunds:', selectedBranch?.name);
          } else {
            console.log('Admin viewing all branches - loading all refunds');
          }
        } else {
          // For non-owner users (MANAGER, CASHIER), get branch from branchId or membership.branchIds
          let branchId = user?.membership?.branchIds?.[0] || user?.branchId;
          
          // If no single branchId, check membership.branchIds array
          if (!branchId && Array.isArray(user?.membership?.branchIds) && user.membership.branchIds.length > 0) {
            // Use the first branch from membership if no specific branch selected
            branchId = String(user.membership.branchIds[0]);
          }
          
          // If still no branch, check if a branch is selected in the context
          if (!branchId && selectedBranchId) {
            branchId = selectedBranchId;
          }
          
          params.branchId = branchId;
          console.log('Regular user branch for refunds:', branchId);
        }

        const response = await apiService.getRefunds(params);
        console.log('🔍 API Response:', response);
        if (response.success && response.data) {
          console.log('🔍 Refunds data from API:', response.data.refunds);
          console.log('🔍 Number of refunds received:', response.data.refunds?.length || 0);
          response.data.refunds?.forEach((refund: any, index: number) => {
            console.log(`Refund ${index + 1}: Created by ${refund.refundedByUser?.username} (${refund.refundedByUser?.role}) - Amount: ${refund.refundAmount}`);
          });

          // Transform API data to match frontend format
          const transformedRefunds = response.data.refunds.map((refund: any) => {
            try {
              console.log('🔍 Processing refund:', refund.id);

            // Handle Prisma Decimal type for refundAmount
            console.log('🔍 Raw refund amount:', refund.refundAmount, 'Type:', typeof refund.refundAmount, 'Constructor:', refund.refundAmount?.constructor?.name);
            const refundAmount = refund.refundAmount?.toString ? refund.refundAmount.toString() : String(refund.refundAmount);
            const parsedAmount = parseFloat(refundAmount);
            console.log('🔍 Refund amount conversion:', {
              raw: refund.refundAmount,
              string: refundAmount,
              parsed: parsedAmount,
              isNaN: isNaN(parsedAmount),
              final: isNaN(parsedAmount) ? 0 : parsedAmount
            });
            console.log('🔍 Refund ID:', refund.id, 'Original Sale ID:', refund.originalSaleId);

            // Handle Date object for refundedAt with proper validation
            let refundedAt;
            try {
              if (refund.createdAt) {
                // Handle both string and Date object
                const dateStr = typeof refund.createdAt === 'string' ? refund.createdAt : refund.createdAt.toString();
                const date = new Date(dateStr);
                if (isNaN(date.getTime())) {
                  console.warn('⚠️ Invalid date for refund:', refund.id, 'Date:', refund.createdAt);
                  refundedAt = new Date().toISOString();
                } else {
                  refundedAt = date.toISOString();
                }
              } else {
                refundedAt = new Date().toISOString();
              }
            } catch (dateError) {
              console.warn('⚠️ Date conversion error for refund:', refund.id, dateError);
              refundedAt = new Date().toISOString();
            }
            console.log('🔍 Refunded at:', refund.createdAt, 'Formatted:', refundedAt);

            return {
              id: refund.id,
              originalInvoiceId: refund.originalSaleId,
              originalInvoiceNumber: refund.originalSale?.invoiceNumber || refund.originalSale?.receipts?.[0]?.receiptNumber || refund.originalSale?.id || 'N/A',
              receiptNumber: refund.originalSale?.receipts?.[0]?.receiptNumber || refund.originalSale?.invoiceNumber || refund.originalSale?.id || 'N/A',
              refundAmount: isNaN(parsedAmount) ? 0 : parsedAmount,
              refundReason: refund.refundReason || 'No reason provided',
              refundedAt: refundedAt,
              refundedBy: refund.refundedByUser?.name || 'Unknown',
              items: refund.items?.map((item: any) => {
                // Handle Prisma Decimal types for prices
                const unitPriceStr = item.unitPrice?.toString ? item.unitPrice.toString() : String(item.unitPrice);
                const unitPrice = parseFloat(unitPriceStr) || 0;
                const quantity = parseInt(item.quantity) || 0;
                const totalPrice = unitPrice * quantity;

                console.log('🔍 Item price:', item.unitPrice, 'String:', unitPriceStr, 'Parsed:', unitPrice, 'Quantity:', quantity, 'Total:', totalPrice);

                return {
                  productId: item.productId,
                  productName: item.product?.name || 'Unknown Product',
                  quantity: quantity,
                  unitPrice: unitPrice,
                  totalPrice: totalPrice,
                  unitType: item.product?.unitType || 'units',
                  reason: item.reason || 'No reason provided'
                };
              }) || [],
              customer: refund.originalSale?.customer ? {
                id: refund.originalSale.customer.id,
                name: refund.originalSale.customer.name,
                phone: refund.originalSale.customer.phone,
                email: refund.originalSale.customer.email,
                address: refund.originalSale.customer.address
              } : undefined
            };

            console.log('🔍 Final refund object:', {
              id: refund.id,
              refundAmount: isNaN(parsedAmount) ? 0 : parsedAmount,
              receiptNumber: refund.originalSale?.receipts?.[0]?.receiptNumber || refund.originalSale?.id || 'N/A'
            });
            } catch (error) {
              console.error('❌ Error processing refund:', refund.id, error);
              // Return a fallback refund object
              return {
                id: refund.id || 'unknown',
                originalInvoiceId: refund.originalSaleId || 'unknown',
                originalInvoiceNumber: 'N/A',
                receiptNumber: 'N/A',
                refundAmount: 0,
                refundReason: refund.refundReason || 'No reason provided',
                refundedAt: new Date().toISOString(),
                refundedBy: 'Unknown',
                items: [],
                customer: undefined
              };
            }
          });

          console.log('🔍 Final transformed refunds:', transformedRefunds.map(r => ({ id: r.id, amount: r.refundAmount, receiptNumber: r.receiptNumber })));
          setRefunds(transformedRefunds);
          console.log('✅ Refunds loaded successfully, count:', transformedRefunds.length);
          return;
        }
      } catch (apiError) {
        console.error('❌ API call failed:', apiError);
        setRefunds([]);
      }
    } catch (error) {
      console.error('Error loading refunds:', error);
      setRefunds([]);
      // Don't set loading - silent fail in background
    } finally {
      setLoading(false);
    }
  }, [user, selectedBranchId, selectedBranch, startDate, endDate, selectedCompanyId]);

  useEffect(() => {
    filterRefunds();
  }, [refunds, searchQuery, startDate, endDate]);

  useEffect(() => {
    if (user) {
      // Load fresh data when branch changes
      loadRefunds(false).catch(console.error);
    }
  }, [user, selectedBranchId, selectedCompanyId]);

  const filterRefunds = () => {
    console.log('🔍 Filtering refunds...');
    console.log('Total refunds before filtering:', refunds.length);

    let filtered = [...refunds];

    // Date range filter (client-side on loaded data)
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate + 'T00:00:00').getTime() : 0;
      const end = endDate ? new Date(endDate + 'T23:59:59').getTime() : Infinity;
      filtered = filtered.filter((refund) => {
        const refundedTime = new Date(refund.refundedAt).getTime();
        return refundedTime >= start && refundedTime <= end;
      });
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(refund =>
        refund.receiptNumber.toLowerCase().includes(q) ||
        refund.originalInvoiceNumber.toLowerCase().includes(q) ||
        refund.customer?.name.toLowerCase().includes(q) ||
        refund.customer?.phone.includes(q) ||
        refund.refundReason.toLowerCase().includes(q)
      );
    }

    console.log('Filtered refunds count:', filtered.length);
    console.log('Filtered refunds:', filtered.map(refund => ({ id: refund.id, createdBy: refund.refundedBy, amount: refund.refundAmount })));

    setFilteredRefunds(filtered);
    setCurrentPage(1);
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

  const formatDate = (dateString: string) => {
    console.log('🔍 formatDate called with:', dateString, 'Type:', typeof dateString);

    if (!dateString) {
      console.log('🔍 No dateString provided, returning Invalid Date');
      return 'Invalid Date';
    }

    const date = new Date(dateString);
    console.log('🔍 Date object created:', date, 'isNaN:', isNaN(date.getTime()));

    if (isNaN(date.getTime())) {
      console.log('🔍 Invalid date, returning Invalid Date');
      return 'Invalid Date';
    }

    const formatted = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    console.log('🔍 Formatted date:', formatted);
    return formatted;
  };

  const paginatedRefunds = filteredRefunds.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const totalPages = Math.ceil(filteredRefunds.length / pageSize);

  const viewRefund = (refund: RefundRecord) => {
    setSelectedRefund(refund);
    setIsRefundDialogOpen(true);
  };

  const printRefund = (refund: RefundRecord) => {
    toast({
      title: "Printing",
      description: `Printing refund record: ${refund.receiptNumber}`,
      variant: "success",
    });
  };

  const downloadRefund = (refund: RefundRecord) => {
    toast({
      title: "Downloading",
      description: `Downloading refund record: ${refund.receiptNumber}`,
      variant: "success",
    });
  };

  const refundStats = useMemo(() => {
    const totalAmount = filteredRefunds.reduce((s, r) => s + (typeof r.refundAmount === "number" && !isNaN(r.refundAmount) ? r.refundAmount : 0), 0);
    const lineItems = filteredRefunds.reduce((s, r) => s + (r.items?.length || 0), 0);
    return { count: filteredRefunds.length, totalAmount, lineItems };
  }, [filteredRefunds]);

  const handleLookupInvoice = async () => {
    if (!receiptNumber.trim()) {
      toast({ title: "Error", description: "Please enter an invoice number", variant: "destructive" });
      return;
    }
    try {
      setIsSearchingReceipt(true);
      const response = await apiService.getSales({
        limit: 1000,
        companyId: selectedCompanyId || '',
      });
      if (response.success && response.data?.sales) {
        const searchNum = receiptNumber.trim().toUpperCase();
        const invoice = response.data.sales.find((sale: any) => {
          const invNum = sale.invoiceNumber || sale.id;
          return invNum && (
            invNum.toUpperCase() === searchNum ||
            invNum.toUpperCase().includes(searchNum) ||
            sale.id.toLowerCase() === searchNum.toLowerCase()
          );
        });
        if (invoice) {
          setFoundInvoice(invoice);
        } else {
          toast({ title: "Invoice Not Found", description: `Invoice "${receiptNumber}" not found.`, variant: "destructive" });
          setFoundInvoice(null);
        }
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to search for invoice.", variant: "destructive" });
    } finally {
      setIsSearchingReceipt(false);
    }
  };

  const handleProcessRefund = async () => {
    if (!receiptNumber.trim()) {
      toast({ title: "Error", description: "Please enter an invoice number", variant: "destructive" });
      return;
    }
    if (!createRefundReason.trim()) {
      toast({ title: "Error", description: "Please enter a refund reason", variant: "destructive" });
      return;
    }
    if (!foundInvoice) {
      toast({ title: "Error", description: "Please find the invoice first", variant: "destructive" });
      return;
    }

    try {
      const itemsToRefund = foundInvoice.items.map((item: any) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitsDeducted: item.unitsDeducted || item.quantity,
        unitPrice: item.unitPrice,
        reason: createRefundReason || "Customer requested refund",
        batchId: item.batchId || null,
        saleItemId: item.id || null
      }));

      const refundData = {
        invoiceNumber: foundInvoice.invoiceNumber || receiptNumber.trim(),
        originalSaleId: foundInvoice.id,
        refundReason: createRefundReason || "Customer requested refund",
        items: itemsToRefund,
        refundedBy: user?.id || ""
      };

      const refundResponse = await apiService.createRefund(refundData);

      if (refundResponse.success) {
        toast({
          title: "Refund Processed Successfully",
          description: `Invoice: ${receiptNumber}\nAmount: PKR ${foundInvoice.totalAmount.toFixed(2)}`,
        });
        setReceiptNumber("");
        setCreateRefundReason("");
        setFoundInvoice(null);
        setIsCreateRefundDialogOpen(false);
        loadRefunds(true);
      } else {
        const errorMessage = refundResponse.message || "Failed to process refund.";
        const isAlreadyRefunded = errorMessage.toLowerCase().includes('already refunded') || (refundResponse as any)?.error === 'ALREADY_REFUNDED';
        toast({ title: isAlreadyRefunded ? "Already Refunded" : "Error", description: errorMessage, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Error processing refund.", variant: "destructive" });
    }
  };

  const rfSearchInput =
    "h-11 w-full rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] pl-10 pr-3 text-sm text-[#0a1128] placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-[4px] focus-visible:ring-[rgba(26,82,197,0.06)]";

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
            <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">Refunds & returns</h1>
            <p className="text-sm text-[#8c95b0]">
              Refunded sales and inventory returns
              {selectedBranch?.name ? (
                <>
                  {" "}
                  • <b className="font-semibold text-[#4a5578]">{selectedBranch.name}</b>
                </>
              ) : null}
            </p>
          </div>
          <Button
            onClick={() => setIsCreateRefundDialogOpen(true)}
            className="h-10 gap-2 rounded-[10px] bg-red-600 px-[18px] text-sm font-semibold text-white shadow-none hover:bg-red-700"
          >
            <RotateCcw className="h-[18px] w-[18px]" />
            Create/process new refund
          </Button>
        </div>

        <div className="zv3-animate-fadeUp zv3-delay-1 flex flex-col gap-5 lg:flex-row lg:items-stretch">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onClear={() => {
              setStartDate("");
              setEndDate("");
            }}
            className="zv3-animate-fadeUp zv3-delay-1 flex-1 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white shadow-none h-full"
          />

          <div className="zv3-animate-fadeUp zv3-delay-2 flex w-full flex-col gap-3 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-5 py-5 lg:max-w-md h-full">
            <p className="text-xs font-semibold text-[#8c95b0]">Search</p>
            <div className="flex items-center gap-3">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]" strokeWidth={2} />
                <Input
                  placeholder="Receipt, invoice, customer, or reason…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={rfSearchInput}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2 text-sm text-[#8c95b0]">
                <Filter className="h-4 w-4" strokeWidth={2} />
              </div>
            </div>
          </div>
        </div>

        <div className="zv3-animate-fadeUp zv3-delay-3">
          <div className="mb-4 flex items-center gap-2.5">
            <RotateCcw className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
            <span className="text-[17px] font-bold text-[#0a1128]">Refunded invoices</span>
            <span className="text-sm font-medium text-[#8c95b0]">({filteredRefunds.length})</span>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
            {paginatedRefunds.length === 0 ? (
              <div className="px-8 py-16 text-center">
                <div className="mx-auto mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[rgba(26,82,197,0.06)]">
                  <RotateCcw className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
                </div>
                <p className="text-sm font-bold text-[#0a1128]">No refunds found</p>
                <p className="mt-1 text-sm text-[#8c95b0]">Try another date range or search.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                      {["Receipt #", "Invoice", "Date", "Customer", "Refunded by", "Items", "Amount", "Reason", "Actions"].map((h) => (
                        <th
                          key={h}
                          className={cn(
                            "px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]",
                            h === "Actions" && "pr-6 text-right",
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRefunds.map((refund) => (
                      <tr
                        key={refund.id}
                        className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                      >
                        <td className="px-4 py-3.5 pl-6 align-middle font-semibold text-[#0a1128]">{refund.receiptNumber}</td>
                        <td className="px-4 py-3.5 align-middle text-[13px] text-[#4a5578]">{refund.originalInvoiceNumber}</td>
                        <td className="whitespace-nowrap px-4 py-3.5 align-middle text-[13px] text-[#4a5578]">{formatDate(refund.refundedAt)}</td>
                        <td className="max-w-[140px] truncate px-4 py-3.5 align-middle text-[13px] text-[#4a5578]">
                          {refund.customer?.name || "Walk-in Customer"}
                        </td>
                        <td className="max-w-[120px] truncate px-4 py-3.5 align-middle text-[13px] text-[#4a5578]">{refund.refundedBy}</td>
                        <td className="px-4 py-3.5 align-middle text-[13px] text-[#4a5578]">{refund.items.length} item(s)</td>
                        <td className="px-4 py-3.5 align-middle text-[13px] font-bold text-red-600">
                          -PKR {isNaN(refund.refundAmount) ? "0.00" : refund.refundAmount.toFixed(2)}
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3.5 align-middle text-[13px] text-[#4a5578]" title={refund.refundReason}>
                          {refund.refundReason}
                        </td>
                        <td className="px-4 py-3.5 pr-6 text-right align-middle">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              title="View"
                              onClick={() => viewRefund(refund)}
                              className="grid h-8 w-8 place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] text-[#8c95b0] hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                            >
                              <Eye className="h-3.5 w-3.5" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              title="Print"
                              onClick={() => printRefund(refund)}
                              className="grid h-8 w-8 place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] text-[#8c95b0] hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                            >
                              <Printer className="h-3.5 w-3.5" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              title="Download"
                              onClick={() => downloadRefund(refund)}
                              className="grid h-8 w-8 place-items-center rounded-lg border border-[rgba(15,23,60,0.06)] text-[#8c95b0] hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                            >
                              <Download className="h-3.5 w-3.5" strokeWidth={2} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {paginatedRefunds.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4 border-t border-[rgba(15,23,60,0.06)]">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-[#8c95b0]">
                    Showing {Math.min((currentPage - 1) * pageSize + 1, filteredRefunds.length)} to {Math.min(currentPage * pageSize, filteredRefunds.length)} of {filteredRefunds.length} refunds
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
            )}
          </div>
        </div>

        {/* Refund Details Dialog */}
        <Dialog open={isRefundDialogOpen} onOpenChange={setIsRefundDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="flex flex-col gap-3 text-[22px] font-extrabold tracking-tight text-[#0a1128] sm:flex-row sm:items-center sm:justify-between">
                <span>Refund {selectedRefund?.receiptNumber}</span>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="rounded-[10px] border border-[rgba(15,23,60,0.06)]" onClick={() => selectedRefund && printRefund(selectedRefund)}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-[10px] border border-[rgba(15,23,60,0.06)]" onClick={() => selectedRefund && downloadRefund(selectedRefund)}>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </div>
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
                Items returned to stock and payment reversal summary.
              </DialogDescription>
            </DialogHeader>

            {selectedRefund && (
              <div className="space-y-6">
                {/* Refund Header */}
                <div className="flex justify-between items-start border-b pb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-primary">Zapeera</h2>
                    <p className="text-muted-foreground">Refund Receipt</p>
                    <div className="mt-4 space-y-1 text-sm">
                      <p><strong>Refund ID:</strong> {selectedRefund.id}</p>
                      <p><strong>Receipt Number:</strong> {selectedRefund.receiptNumber}</p>
                      <p><strong>Original Invoice:</strong> {selectedRefund.originalInvoiceNumber}</p>
                      <p><strong>Refund Date:</strong> {formatDate(selectedRefund.refundedAt)}</p>
                      <p><strong>Refunded By:</strong> {selectedRefund.refundedBy}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-red-600">
                      -PKR {isNaN(selectedRefund.refundAmount) ? '0.00' : selectedRefund.refundAmount.toFixed(2)}
                    </p>
                    <Badge className="bg-red-100 text-red-800 mt-2">Refunded</Badge>
                  </div>
                </div>

                {/* Customer Info */}
                {selectedRefund.customer && (
                  <div className="border-b pb-4">
                    <h3 className="font-semibold mb-2">Customer Information</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p><strong>Name:</strong> {selectedRefund.customer.name}</p>
                        <p><strong>Phone:</strong> {selectedRefund.customer.phone}</p>
                      </div>
                      <div>
                        <p><strong>Email:</strong> {selectedRefund.customer.email || 'N/A'}</p>
                        <p><strong>Address:</strong> {selectedRefund.customer.address || 'N/A'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Refund Reason */}
                <div className="border-b pb-4">
                  <h3 className="font-semibold mb-2">Refund Reason</h3>
                  <p className="text-sm bg-red-50 p-3 rounded-md border border-red-200">
                    {selectedRefund.refundReason}
                  </p>
                </div>

                {/* Refunded Items */}
                <div className="space-y-3">
                  <h3 className="font-semibold">Refunded Items</h3>
                  {selectedRefund.items.map((item, index) => (
                    <div key={index} className="flex justify-between items-center py-2 border-b border-dashed">
                      <div className="flex-1">
                        <p className="font-medium">{item.productName}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.quantity} {item.unitType} × PKR {isNaN(item.unitPrice) ? '0.00' : item.unitPrice.toFixed(2)}
                        </p>
                      </div>
                      <p className="font-semibold text-red-600">-PKR {isNaN(item.totalPrice) ? '0.00' : item.totalPrice.toFixed(2)}</p>
                    </div>
                  ))}
                </div>

                {/* Refund Summary */}
                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total Refund Amount:</span>
                    <span className="text-red-600">-PKR {isNaN(selectedRefund.refundAmount) ? '0.00' : selectedRefund.refundAmount.toFixed(2)}</span>
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t pt-4 text-center text-xs text-muted-foreground">
                  <p>This is a refund receipt. Items have been returned to inventory.</p>
                  <p>Generated on {formatDate(selectedRefund.refundedAt)}</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Create Refund Dialog */}
        <Dialog
          open={isCreateRefundDialogOpen}
          onOpenChange={(open) => {
            setIsCreateRefundDialogOpen(open);
            if (!open) {
              setReceiptNumber("");
              setCreateRefundReason("");
              setFoundInvoice(null);
            }
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
            <DialogHeader className="space-y-2 pr-10 text-left">
              <DialogTitle className="flex items-center gap-2 text-[22px] font-extrabold tracking-tight text-[#0a1128]">
                <AlertCircle className="h-6 w-6 text-red-600" />
                Create/process new refund
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
                Search for an invoice and process a full refund with stock return.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              {/* Invoice Lookup */}
              <div className="space-y-3">
                <h3 className="text-[15px] font-bold text-[#0a1128]">Invoice Lookup</h3>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Enter invoice number"
                    value={receiptNumber}
                    onChange={(e) => setReceiptNumber(e.target.value)}
                    className="h-11 flex-1 rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] text-sm text-[#0a1128] placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.06)]"
                  />
                  <Button
                    onClick={handleLookupInvoice}
                    disabled={isSearchingReceipt}
                    className="h-11 rounded-[10px] bg-[#1a52c5] px-4 text-sm font-semibold text-white shadow-none hover:bg-[#1440a0]"
                  >
                    {isSearchingReceipt ? "Loading…" : "Show Invoice"}
                  </Button>
                </div>
              </div>

              {/* Found Invoice */}
              {foundInvoice && (
                <div className="space-y-3">
                  <h3 className="text-[15px] font-bold text-[#0a1128]">Found Invoice</h3>
                  <Card className="rounded-[16px] border border-[rgba(15,23,60,0.06)] bg-[#f8f9fb]">
                    <CardContent className="space-y-4 p-5">
                      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                        <div>
                          <p className="text-sm font-semibold text-[#0a1128]">
                            Receipt: {foundInvoice.receipts?.[0]?.receiptNumber || foundInvoice.invoiceNumber || foundInvoice.id}
                          </p>
                          <p className="text-[13px] text-[#8c95b0]">
                            Date: {new Date(foundInvoice.createdAt).toLocaleDateString()} {new Date(foundInvoice.createdAt).toLocaleTimeString()}
                          </p>
                          <p className="text-[13px] text-[#8c95b0]">
                            Cashier: {foundInvoice.user?.name || "N/A"}
                          </p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="text-lg font-extrabold text-[#1a52c5]">
                            PKR {foundInvoice.totalAmount?.toFixed?.(2) || "0.00"}
                          </p>
                          <p className="text-xs text-[#8c95b0]">
                            {foundInvoice.paymentMethod} • {foundInvoice.paymentStatus}
                          </p>
                        </div>
                      </div>

                      {foundInvoice.customer && (
                        <div className="border-t border-[rgba(15,23,60,0.06)] pt-3">
                          <p className="mb-1 text-xs font-semibold text-[#8c95b0]">Customer</p>
                          <p className="text-sm text-[#0a1128]">{foundInvoice.customer.name} — {foundInvoice.customer.phone}</p>
                        </div>
                      )}

                      <div className="border-t border-[rgba(15,23,60,0.06)] pt-3">
                        <p className="mb-2 text-xs font-semibold text-[#8c95b0]">Items</p>
                        <div className="space-y-2">
                          {foundInvoice.items?.map((item: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between rounded-[10px] border border-[rgba(15,23,60,0.06)] bg-white px-3 py-2">
                              <div>
                                <p className="text-sm font-medium text-[#0a1128]">{item.product?.name || "Product"}</p>
                                <p className="text-xs text-[#8c95b0]">
                                  {item.quantity} {item.product?.unitType || "units"} × PKR {item.unitPrice?.toFixed?.(2) || "0.00"}
                                </p>
                              </div>
                              <p className="text-sm font-semibold text-[#0a1128]">PKR {item.totalPrice?.toFixed?.(2) || "0.00"}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="border-t border-[rgba(15,23,60,0.06)] pt-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-[#8c95b0]">Subtotal:</span>
                          <span className="font-medium text-[#0a1128]">PKR {foundInvoice.subtotal?.toFixed?.(2) || "0.00"}</span>
                        </div>
                        {foundInvoice.discountAmount > 0 && (
                          <div className="flex justify-between text-sm text-green-600">
                            <span>Discount:</span>
                            <span>-PKR {foundInvoice.discountAmount?.toFixed?.(2) || "0.00"}</span>
                          </div>
                        )}
                        <div className="flex justify-between border-t border-[rgba(15,23,60,0.06)] pt-2 text-base font-bold text-[#0a1128]">
                          <span>Total:</span>
                          <span>PKR {foundInvoice.totalAmount?.toFixed?.(2) || "0.00"}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Refund Reason */}
              {foundInvoice && (
                <div className="space-y-2">
                  <Label htmlFor="refundReason" className="text-sm font-semibold text-[#0a1128]">
                    Refund Reason <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="refundReason"
                    placeholder="Enter reason for refund"
                    value={createRefundReason}
                    onChange={(e) => setCreateRefundReason(e.target.value)}
                    className="h-11 rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] text-sm text-[#0a1128] placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.06)]"
                  />
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 border-t border-[rgba(15,23,60,0.06)] pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsCreateRefundDialogOpen(false);
                    setReceiptNumber("");
                    setCreateRefundReason("");
                    setFoundInvoice(null);
                  }}
                  className="h-10 rounded-[10px] border border-[rgba(15,23,60,0.08)] px-4 text-sm font-semibold text-[#4a5578] hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                >
                  Cancel
                </Button>
                {foundInvoice && (
                  <Button
                    onClick={handleProcessRefund}
                    disabled={!createRefundReason.trim()}
                    className="h-10 gap-2 rounded-[10px] bg-red-600 px-4 text-sm font-semibold text-white shadow-none hover:bg-red-700 disabled:opacity-50"
                  >
                    <AlertCircle className="h-4 w-4" />
                    Process Refund
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Refunds;