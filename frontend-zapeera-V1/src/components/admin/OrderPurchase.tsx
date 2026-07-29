import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  ShoppingCart,
  Download,
  Search,
  Package,
  AlertTriangle,
  RefreshCw,
  Plus,
  RotateCcw,
  FileText,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { useNavigate } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface Batch {
  id: string;
  batchNo: string;
  productId: string;
  productName: string;
  productSku: string;
  category: string;
  supplier: string;
  branch: {
    id: string;
    name: string;
  };
  currentStock: number;
  totalProductStock: number;
  minStock: number;
  maxStock: number;
  unitPrice: number;
  expireDate?: string;
  productionDate?: string;
  orderQuantity: number;
  isLowStock: boolean;
  isCritical: boolean;
  isNearExpiry: boolean;
  isExpired: boolean;
  reason: string;
}

interface Branch {
  id: string;
  name: string;
}

const OrderPurchase = () => {
  const { user: currentUser } = useAuth();
  const { selectedCompanyId, selectedBranchId, selectedBranch, getMembershipRole } = useAdmin();
  const navigate = useNavigate();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(false); // Don't show loading initially
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [stockFilter, setStockFilter] = useState("all"); // all, low, critical, nearExpiry, expired
  const [showRestockDialog, setShowRestockDialog] = useState(false);
  const [showNewBatchDialog, setShowNewBatchDialog] = useState(false);
  const [selectedBatchForRestock, setSelectedBatchForRestock] = useState<Batch | null>(null);
  const [restockQuantity, setRestockQuantity] = useState(0);
  const [showCreateOrderDialog, setShowCreateOrderDialog] = useState(false);
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set());
  // Store order quantities in dialog (not in main table)
  const [dialogOrderQuantities, setDialogOrderQuantities] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const sfInput = cn(
    "h-11 w-full rounded-[10px] border-[1.5px] border-black/[0.07] bg-[#f0f2f7] pl-10 pr-3.5 text-sm text-[#0a1128] shadow-none transition-all",
    "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:ring-[4px] focus-visible:ring-[rgba(26,82,197,0.06)]",
  );
  const filterSelect = cn(
    "h-11 min-w-[140px] rounded-[10px] border-[1.5px] border-black/[0.08] bg-white text-[14px] text-[#0a1128] shadow-none",
    "focus:ring-4 focus:ring-[rgba(26,82,197,0.08)] focus:ring-offset-0",
  );

  const orderStats = useMemo(
    () => ({
      total: batches.length,
      low: batches.filter((b) => b.isLowStock).length,
      nearExpiry: batches.filter((b) => b.isNearExpiry).length,
      expired: batches.filter((b) => b.isExpired).length,
      critical: batches.filter((b) => b.isCritical).length,
    }),
    [batches],
  );

  // Set default branch for managers and cashiers
  useEffect(() => {
    // This effect is no longer needed since we removed local branch selector
    // Branch filtering is now handled by global selectedBranchId from AdminContext
  }, []);

  // Load data on component mount and when filters change
  useEffect(() => {
    loadBatches();
    loadBranches();
  }, [selectedBranchId, stockFilter, selectedCompanyId, searchTerm]);

  // Load batches when search term changes (with debounce)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      loadBatches();
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchTerm, selectedBranchId, stockFilter, selectedCompanyId]);

  // Reset pagination when filters/data change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBranch, stockFilter, searchTerm, batches.length, pageSize]);

  const totalPages = Math.max(1, Math.ceil(batches.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedBatches = batches.slice((safePage - 1) * pageSize, safePage * pageSize);

  const loadBatches = async () => {
    try {
      // Don't show loading - load in background
      setError("");

      // Use global selectedBranchId from AdminContext
      // Determine which branch to filter by based on user role and selection
      let branchIdToUse = undefined;

      // Get the role in the context of the current selected company
      const membershipRole = getMembershipRole();
      const effectiveRole = membershipRole || String(currentUser?.role || '').toUpperCase();
      const role = String(effectiveRole || '').toUpperCase();

      if (role === 'OWNER') {
        // Admin users use selected branch from global context (from header dropdown)
        // When selectedBranchId is set, filter by that branch
        // When null (All branches selected), pass undefined to get batches from all branches
        if (selectedBranchId) {
          branchIdToUse = selectedBranchId;
          console.log('Admin selected specific branch for order purchase:', selectedBranch?.name);
        } else {
          // All branches selected — pass undefined so backend returns all branches
          branchIdToUse = undefined;
          console.log('Admin viewing all branches for order purchase');
        }
      } else {
        // Regular users (MANAGER/CASHIER) use their assigned branch
        branchIdToUse = currentUser?.branchId;
        
        // If no single branchId, check membership.branchIds array
        if (!branchIdToUse && Array.isArray(currentUser?.membership?.branchIds) && currentUser.membership.branchIds.length > 0) {
          branchIdToUse = String(currentUser.membership.branchIds[0]);
        }
        
        // If still no branch, check if a branch is selected in the context
        if (!branchIdToUse && selectedBranchId) {
          branchIdToUse = selectedBranchId;
        }
        
        if (!branchIdToUse) {
          setError('No branch assigned to your account');
          return;
        }
        console.log('Regular user branch for order purchase:', branchIdToUse);
      }

      console.log('Loading low stock batches with params:', {
        page: 1,
        limit: 200,
        branchId: branchIdToUse,
        companyId: selectedCompanyId,
        search: searchTerm,
        userRole: currentUser?.role,
        userBranchId: currentUser?.branchId,
        selectedBranchId: selectedBranchId
      });

      const response = await apiService.getLowStockBatches({
        page: 1,
        limit: 200,
        branchId: branchIdToUse,
        companyId: selectedCompanyId,
        search: searchTerm
      });

      console.log('API response:', response);

      if (response.success && response.data?.batches) {
        let batchesData = response.data.batches;

        console.log('Mapped batches data:', batchesData);

        // Filter batches based on stock level
        if (stockFilter === "low") {
          batchesData = batchesData.filter((batch: Batch) => batch.isLowStock);
        } else if (stockFilter === "critical") {
          batchesData = batchesData.filter((batch: Batch) => batch.isCritical);
        } else if (stockFilter === "nearExpiry") {
          batchesData = batchesData.filter((batch: Batch) => batch.isNearExpiry);
        } else if (stockFilter === "expired") {
          batchesData = batchesData.filter((batch: Batch) => batch.isExpired);
        }
        // "all" shows all batches requiring attention

        console.log('Filtered batches data:', batchesData);

        setBatches(batchesData);
      } else {
        setError(response.message || "Failed to load batches");
      }
    } catch (err: any) {
      console.error("Error loading batches:", err);
      setError(err?.message || "Failed to load batches");
      // Don't set loading - silent fail in background
    }
  };

  const loadBranches = async () => {
    try {
      const response = await apiService.getBranches();
      if (response.success && response.data) {
        let branchesData = Array.isArray(response.data) ? response.data : response.data.branches;

        // Get the role in the context of the current selected company
        const membershipRole = getMembershipRole();
        const effectiveRole = membershipRole || String(currentUser?.role || '').toUpperCase();
        const role = String(effectiveRole || '').toUpperCase();

        // Filter branches based on user role
        if (role === 'MANAGER' || role === 'CASHIER') {
          // Managers and Cashiers should only see their assigned branch
          branchesData = branchesData.filter((branch: any) =>
            branch.id === currentUser?.branchId
          );
        }
        // Owner and Admin can see all branches

        setBranches(branchesData.map((branch: any) => ({
          id: branch.id,
          name: branch.name
        })));
      }
    } catch (err) {
      console.error("Error loading branches:", err);
    }
  };

  const handleSearch = () => {
    // Search is handled by useEffect with debounce
  };

  const handleFilterChange = () => {
    // Filter changes are handled by useEffect
  };

  // Removed handleOrderQuantityChange - order quantities are now managed in dialog

  const handleRestockBatch = (batch: Batch) => {
    setSelectedBatchForRestock(batch);
    setRestockQuantity(0);
    setShowRestockDialog(true);
  };

  const confirmRestock = async () => {
    if (!selectedBatchForRestock || restockQuantity <= 0) return;

    try {
      setIsLoading(true);
      const response = await apiService.restockBatch(selectedBatchForRestock.id, {
        quantity: restockQuantity,
        notes: `Restocked ${restockQuantity} units for batch ${selectedBatchForRestock.batchNo}`
      });

      if (response.success) {
        // Update the batch in the local state
        setBatches(prevBatches =>
          prevBatches.map(batch =>
            batch.id === selectedBatchForRestock.id
              ? { ...batch, currentStock: batch.currentStock + restockQuantity }
              : batch
          )
        );
        setShowRestockDialog(false);
        setSelectedBatchForRestock(null);
        setRestockQuantity(0);
        // Reload batches to get updated data
        await loadBatches();
      } else {
        setError(response.message || 'Failed to restock batch');
      }
    } catch (err) {
      console.error('Error restocking batch:', err);
      setError('Failed to restock batch');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddNewBatch = () => {
    setShowNewBatchDialog(true);
  };

  // Add new batch for the same product - navigates to Batches page with product info
  const handleAddBatchForProduct = (batch: Batch) => {
    // Store the product info in sessionStorage so Batches page can pre-fill the form
    sessionStorage.setItem('prefillBatchProduct', JSON.stringify({
      productId: batch.productId,
      productName: batch.productName,
      supplier: batch.supplier,
      branchId: batch.branch.id,
      branchName: batch.branch.name,
      unitPrice: batch.unitPrice,
      minStock: batch.minStock,
    }));
    // Navigate to Batches page using React Router
    navigate('/batches?addNew=true');
  };

  const getStockStatus = (batch: Batch) => {
    if (batch.isExpired) {
      return { status: "Expired", color: "destructive" };
    } else if (batch.isCritical) {
      return { status: "Out of Stock", color: "destructive" };
    } else if (batch.isNearExpiry) {
      return { status: "Near Expiry", color: "secondary" };
    } else if (batch.isLowStock) {
      return { status: "Low Stock", color: "destructive" };
    } else {
      return { status: "Normal", color: "default" };
    }
  };

  const statusPill = (batch: Batch) => {
    const s = getStockStatus(batch);
    const pill =
      s.status === "Expired" || s.status === "Out of Stock"
        ? "border-red-200 bg-red-50 text-red-800"
        : s.status === "Low Stock"
          ? "border-orange-200 bg-orange-50 text-orange-800"
          : s.status === "Near Expiry"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-emerald-200 bg-emerald-50 text-emerald-800";
    return (
      <span
        className={cn(
          "inline-flex rounded-md px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
          pill,
        )}
      >
        {s.status}
      </span>
    );
  };

  const calculateOrderQuantity = (batch: Batch) => {
    // Calculate suggested quantity based on stock levels
    // Suggested = maxStock - currentStock (but not less than 0)
    const suggested = Math.max(0, batch.maxStock - batch.currentStock);
    return suggested;
  };

  const downloadOrderList = () => {
    if (batches.length === 0) return;
    const orderData = batches.map(batch => ({
      "Batch No": batch.batchNo,
      "Product Name": batch.productName,
      "SKU": batch.productSku,
      "Current Stock": batch.currentStock,
      "Total Product Stock": batch.totalProductStock,
      "Min Stock": batch.minStock,
      "Max Stock": batch.maxStock,
      "Unit Price": batch.unitPrice,
      "Suggested Order Qty": calculateOrderQuantity(batch),
      "Total Value": (calculateOrderQuantity(batch) * batch.unitPrice).toFixed(2),
      "Category": batch.category,
      "Branch": batch.branch.name,
      "Supplier": batch.supplier,
      "Expiry Date": batch.expireDate || "N/A",
      "Production Date": batch.productionDate || "N/A",
      "Issue Reason": batch.reason,
      "Status": getStockStatus(batch).status
    }));

    // Convert to CSV
    const headers = Object.keys(orderData[0]);
    const csvContent = [
      headers.join(","),
      ...orderData.map(row =>
        headers.map(header => `"${row[header]}"`).join(",")
      )
    ].join("\n");

    // Create and download file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `batch_order_purchase_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Calculate total order value from dialog quantities
  const totalOrderValue = batches.reduce((sum, batch) => {
    const qty = dialogOrderQuantities[batch.id] || 0;
    return sum + (qty * batch.unitPrice);
  }, 0);

  // Calculate total order items from dialog quantities
  const totalOrderItems = batches.reduce((sum, batch) => {
    return sum + (dialogOrderQuantities[batch.id] || 0);
  }, 0);

  // Get batches that have order quantity set in dialog
  const batchesWithOrderQty = batches.filter(batch => {
    const qty = dialogOrderQuantities[batch.id] || 0;
    return qty > 0;
  });

  const handleSelectBatch = (batchId: string) => {
    setSelectedBatches(prev => {
      const newSet = new Set(prev);
      if (newSet.has(batchId)) {
        newSet.delete(batchId);
      } else {
        newSet.add(batchId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedBatches.size === batchesWithOrderQty.length) {
      setSelectedBatches(new Set());
    } else {
      // Only select batches that have order quantity > 0
      const batchesToSelect = batches.filter(batch => {
        const qty = dialogOrderQuantities[batch.id] || 0;
        return qty > 0;
      });
      setSelectedBatches(new Set(batchesToSelect.map(b => b.id)));
    }
  };

  const handleDownloadPDF = () => {
    if (selectedBatches.size === 0) {
      return;
    }

    const selectedBatchesData = batches.filter(batch =>
      selectedBatches.has(batch.id) && (dialogOrderQuantities[batch.id] || 0) > 0
    );

    // Create PDF
    const doc = new jsPDF();

    // Add title
    doc.setFontSize(16);
    doc.text("Purchase Order", 14, 20);
    doc.setFontSize(10);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, 30);
    doc.text(`Total Items: ${selectedBatchesData.length}`, 14, 36);

    // Prepare table data
    const tableData = selectedBatchesData.map(batch => [
      batch.productName,
      (dialogOrderQuantities[batch.id] || 0).toString(),
      batch.branch.name
    ]);

    // Add table using autoTable function (v5.x API)
    autoTable(doc, {
      head: [['Product Name', 'Order Qty', 'Branch Name']],
      body: tableData,
      startY: 45,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [12, 44, 138] }, // Blue color matching theme
      alternateRowStyles: { fillColor: [245, 247, 250] }
    });

    // Save PDF
    doc.save(`purchase_order_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const handleOpenCreateOrderDialog = () => {
    setSelectedBatches(new Set());
    // Initialize dialog order quantities from existing batch orderQuantity values
    const initialQuantities: Record<string, number> = {};
    batches.forEach(batch => {
      initialQuantities[batch.id] = batch.orderQuantity || 0;
    });
    setDialogOrderQuantities(initialQuantities);
    setShowCreateOrderDialog(true);
  };

  const handleDialogOrderQuantityChange = (batchId: string, quantity: number) => {
    setDialogOrderQuantities(prev => ({
      ...prev,
      [batchId]: Math.max(0, quantity)
    }));
  };

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
            <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">Batch order purchase</h1>
            <p className="text-sm text-[#8c95b0]">
              Low stock, near expiry, and batches needing reorder
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={handleOpenCreateOrderDialog}
              disabled={batches.length === 0}
              className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-[18px] py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(26,82,197,0.35)] disabled:opacity-50"
            >
              <FileText className="mr-2 h-4 w-4" strokeWidth={2} />
              Create purchase order
            </Button>
            <Button
              type="button"
              onClick={() => void downloadOrderList()}
              disabled={batches.length === 0}
              variant="outline"
              className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-[18px] py-2.5 text-sm font-semibold text-[#4a5578] hover:bg-white disabled:opacity-50"
            >
              <Download className="mr-2 h-4 w-4" strokeWidth={2} />
              Download CSV
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-[22px] border border-red-200 bg-white px-6 py-4 text-sm text-red-600">{error}</div>
        ) : null}

        <div className="zv3-animate-fadeUp zv3-delay-1 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <Label htmlFor="op-search" className="mb-2 block text-xs font-semibold text-[#8c95b0]">
                Search
              </Label>
              <Input
                id="op-search"
                placeholder="Product, SKU, batch no., category…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={filterSelect}
              />
            </div>
            <div className="w-full min-w-[160px] sm:w-auto">
              <Label className="mb-2 block text-xs font-semibold text-[#8c95b0]">Stock issue</Label>
              <Select value={stockFilter} onValueChange={setStockFilter}>
                <SelectTrigger className={cn(filterSelect, "w-full sm:w-[200px]")}>
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All issues</SelectItem>
                  <SelectItem value="low">Low stock</SelectItem>
                  <SelectItem value="critical">Out of stock</SelectItem>
                  <SelectItem value="nearExpiry">Near expiry</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="zv3-animate-fadeUp zv3-delay-3">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <Package className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              <span className="text-[17px] font-bold text-[#0a1128]">Batches to reorder</span>
              <span className="text-sm font-medium text-[#8c95b0]">({batches.length})</span>
            </div>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]">
            <div className="overflow-x-auto">
              {batches.length === 0 ? (
                <div className="flex flex-col items-center px-8 py-16 text-center">
                  <Package className="mb-3 h-12 w-12 text-[#8c95b0]" strokeWidth={2} />
                  <p className="text-sm font-semibold text-[#0a1128]">No batches match your filters</p>
                  <p className="mt-1 text-sm text-[#8c95b0]">Try another branch, search term, or stock filter.</p>
                </div>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                      <th className="px-5 py-3.5 pl-8 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Batch &amp; product
                      </th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Stock</th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Pricing</th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Status</th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Branch</th>
                      <th className="px-5 py-3.5 pr-8 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedBatches.map((batch) => (
                      <tr
                        key={batch.id}
                        className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                      >
                        <td className="px-5 py-4 pl-8 align-top">
                          <div className="font-semibold text-[#0a1128]">{batch.productName}</div>
                          <div className="text-[13px] text-[#8c95b0]">Batch {batch.batchNo}</div>
                          <div className="text-[13px] text-[#4a5578]">{batch.category}</div>
                          <div className="mt-1 text-[12px] font-medium text-[#1a52c5]">{batch.reason}</div>
                        </td>
                        <td className="px-5 py-4 align-top text-[13px] text-[#4a5578]">
                          <div>
                            <span className="text-[#8c95b0]">Current</span>{" "}
                            <span className="font-semibold text-[#0a1128]">{batch.currentStock}</span>
                          </div>
                          <div className="mt-1">
                            <span className="text-[#8c95b0]">Product total</span> {batch.totalProductStock}
                          </div>
                          <div className="mt-1">
                            Min {batch.minStock} · Max {batch.maxStock}
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="font-semibold text-[#0a1128]">Rs. {batch.unitPrice.toFixed(2)}</div>
                          <div className="text-[12px] text-[#8c95b0]">per unit</div>
                        </td>
                        <td className="px-5 py-4 align-middle">{statusPill(batch)}</td>
                        <td className="px-5 py-4 align-middle text-[13px] text-[#4a5578]">{batch.branch.name}</td>
                        <td className="px-5 py-4 pr-8 text-right align-middle">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleAddBatchForProduct(batch)}
                              className="h-8 rounded-[8px] border border-[rgba(15,23,60,0.08)] px-2.5 text-xs font-semibold text-[#1a52c5] hover:bg-[#f0f2f7]"
                              title="Add new batch for this product"
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
                              Add batch
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleRestockBatch(batch)}
                              className="h-8 rounded-[8px] bg-gradient-to-br from-[#ea580c] to-[#c2410c] px-2.5 text-xs font-semibold text-white shadow-sm hover:opacity-95"
                            >
                              <RotateCcw className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
                              Restock
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {batches.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4 border-t border-[rgba(15,23,60,0.06)]">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-[#8c95b0]">
                    Showing {Math.min((safePage - 1) * pageSize + 1, batches.length)} to {Math.min(safePage * pageSize, batches.length)} of {batches.length} batches
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-[#8c95b0]">Per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="h-[32px] rounded-lg border border-[rgba(15,23,60,0.06)] bg-white px-2 text-sm font-semibold text-[#0a1128] outline-none focus:ring-2 focus:ring-[rgba(26,82,197,0.15)]"
                    >
                      <option value="10">10</option>
                      <option value="20">20</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(safePage - 1)}
                    disabled={safePage === 1}
                    className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
                  >
                    Previous
                  </button>
                  <span className="text-sm font-semibold text-[#0a1128]">Page {safePage} of {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(safePage + 1)}
                    disabled={safePage === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Restock Dialog */}
      <Dialog open={showRestockDialog} onOpenChange={setShowRestockDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Restock Batch</DialogTitle>
            <DialogDescription>
              Add more units to this batch inventory.
            </DialogDescription>
          </DialogHeader>
          {selectedBatchForRestock && (
            <div className="space-y-4 py-4">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                  <RotateCcw className="w-6 h-6 text-orange-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">{selectedBatchForRestock.productName}</h3>
                  <p className="text-sm text-gray-500">Batch: {selectedBatchForRestock.batchNo}</p>
                  <p className="text-sm text-gray-500">Current Stock: {selectedBatchForRestock.currentStock}</p>
                </div>
              </div>
              <div>
                <Label htmlFor="restock-quantity">Quantity to Add</Label>
                <Input
                  id="restock-quantity"
                  type="number"
                  min="1"
                  value={restockQuantity}
                  onChange={(e) => setRestockQuantity(parseInt(e.target.value) || 0)}
                  placeholder="Enter quantity to add"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRestockDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={confirmRestock}
              disabled={restockQuantity <= 0 || isLoading}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {isLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
              Restock Batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add New Batch Dialog */}
      <Dialog open={showNewBatchDialog} onOpenChange={setShowNewBatchDialog}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Batch</DialogTitle>
            <DialogDescription>
              Create a new batch for inventory management.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-center py-8">
              <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">New Batch Creation</h3>
              <p className="text-gray-500 mb-4">
                This feature will redirect you to the batch management page where you can create a new batch.
              </p>
              <Button
                onClick={() => {
                  setShowNewBatchDialog(false);
                  // Navigate to batch management page
                  navigate("/batches");
                }}
                className="bg-green-600 hover:bg-green-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Go to Batch Management
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewBatchDialog(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Purchase Order Dialog */}
      <Dialog open={showCreateOrderDialog} onOpenChange={setShowCreateOrderDialog}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <FileText className="w-5 h-5 text-blue-600" />
              <span>Create Purchase Order</span>
            </DialogTitle>
            <DialogDescription>
              Select batches and set order quantities for each batch.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {batches.length === 0 ? (
              <div className="text-center py-8">
                <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Batches Available</h3>
                <p className="text-gray-500">
                  No batches found matching your criteria.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="select-all"
                      checked={selectedBatches.size === batchesWithOrderQty.length && batchesWithOrderQty.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                    <Label htmlFor="select-all" className="cursor-pointer">
                      Select All with Qty ({selectedBatches.size} selected)
                    </Label>
                  </div>
                  <Button
                    onClick={handleDownloadPDF}
                    disabled={selectedBatches.size === 0 || batchesWithOrderQty.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download PDF
                  </Button>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="w-12"></TableHead>
                        <TableHead className="font-semibold">Product Name</TableHead>
                        <TableHead className="font-semibold">Stock Info</TableHead>
                        <TableHead className="font-semibold">Pricing</TableHead>
                        <TableHead className="font-semibold text-center">Order Qty</TableHead>
                        <TableHead className="font-semibold text-right">Total Value</TableHead>
                        <TableHead className="font-semibold">Branch Name</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batches.map((batch) => {
                        const orderQty = dialogOrderQuantities[batch.id] || 0;
                        const totalValue = orderQty * batch.unitPrice;
                        return (
                          <TableRow key={batch.id} className="hover:bg-gray-50">
                            <TableCell>
                              <Checkbox
                                checked={selectedBatches.has(batch.id)}
                                onCheckedChange={() => handleSelectBatch(batch.id)}
                                disabled={orderQty === 0}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              <div>
                                <div>{batch.productName}</div>
                                <div className="text-xs text-gray-500">SKU: {batch.productSku}</div>
                                <div className="text-xs text-gray-500">Batch: {batch.batchNo}</div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <div>Current: <span className="font-medium">{batch.currentStock}</span></div>
                                <div>Min: <span className="font-medium">{batch.minStock}</span> | Max: <span className="font-medium">{batch.maxStock}</span></div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <div className="font-medium">Rs. {batch.unitPrice.toFixed(2)}</div>
                                <div className="text-gray-500">per unit</div>
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <Input
                                type="number"
                                min="0"
                                value={orderQty}
                                onChange={(e) => handleDialogOrderQuantityChange(batch.id, parseInt(e.target.value) || 0)}
                                className="w-24 text-center font-medium"
                                placeholder="0"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className={`font-semibold ${totalValue > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                Rs. {totalValue.toFixed(2)}
                              </div>
                            </TableCell>
                            <TableCell>{batch.branch.name}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateOrderDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OrderPurchase;
