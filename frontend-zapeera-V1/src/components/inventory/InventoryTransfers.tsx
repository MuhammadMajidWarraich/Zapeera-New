import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Truck,
  MapPin,
  Calendar,
  AlertCircle,
  CheckCircle,
  Eye,
  XCircle,
  Trash2
} from "lucide-react";
import { apiService, StockTransferRecord } from "@/services/api";

// Inter-branch transfers (Roadmap A9): this page is backed by the real
// /transfers API. Creating a transfer records a PENDING request (stock is
// validated but NOT moved); stock only moves when the transfer is
// completed (received) — the backend decrements the source batches and
// credits matching batches at the destination branch.

interface BranchOption {
  id: string;
  name: string;
  address?: string;
}

interface PickerBatch {
  id: string;
  batchNo: string;
  available: number;
  expireDate?: string;
}

interface DraftItem {
  productId: string;
  productName: string;
  sourceBatchId: string;
  batchNo: string;
  available: number;
  quantity: number;
}

// The ApiService request helper returns the response envelope's data in
// slightly different shapes per endpoint; read both defensively.
const unwrapList = (res: any, key: string): any[] => {
  if (Array.isArray(res?.data?.[key])) return res.data[key];
  if (Array.isArray(res?.[key])) return res[key];
  if (Array.isArray(res?.data)) return res.data;
  return [];
};

const batchAvailable = (b: any): number =>
  Number(b?.quantity ?? b?.stockQuantity ?? b?.totalStock ?? 0) || 0;

const InventoryTransfers = () => {
  const [transfers, setTransfers] = useState<StockTransferRecord[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTransfer, setSelectedTransfer] = useState<StockTransferRecord | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const itemsPerPage = 10;

  // Confirm dialog (complete / cancel)
  const [confirmAction, setConfirmAction] = useState<{
    kind: "complete" | "cancel";
    transfer: StockTransferRecord;
  } | null>(null);

  // Create form state
  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [notes, setNotes] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);

  // Item picker state
  const [pickerProductId, setPickerProductId] = useState("");
  const [pickerBatches, setPickerBatches] = useState<PickerBatch[]>([]);
  const [pickerBatchId, setPickerBatchId] = useState("");
  const [pickerQty, setPickerQty] = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);

  const loadTransfers = useCallback(async () => {
    try {
      setLoading(true);
      const res: any = await apiService.getTransfers({
        page: currentPage,
        limit: itemsPerPage,
        status: statusFilter !== "all" ? statusFilter : undefined,
      });
      const list: StockTransferRecord[] = Array.isArray(res?.data) ? res.data : [];
      setTransfers(list);
      const pagination = res?.pagination;
      if (pagination) {
        setTotalPages(Math.max(1, pagination.pages || 1));
        setTotalCount(pagination.total || list.length);
      } else {
        setTotalPages(1);
        setTotalCount(list.length);
      }
    } catch (error: any) {
      console.error("Error loading transfers:", error);
      toast.error("Failed to load transfers", {
        description: error?.message || "Please try again.",
      });
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [currentPage, statusFilter]);

  const loadBranches = useCallback(async () => {
    try {
      const res: any = await apiService.getBranches();
      setBranches(unwrapList(res, "branches"));
    } catch (error) {
      console.error("Error loading branches:", error);
      setBranches([]);
    }
  }, []);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  // Load products for the picker when the source branch changes
  useEffect(() => {
    if (!isCreateOpen || !fromBranchId) {
      setProducts([]);
      return;
    }
    (async () => {
      try {
        const res: any = await apiService.getProducts({
          page: 1,
          limit: 200,
          branchId: fromBranchId,
        });
        setProducts(unwrapList(res, "products"));
      } catch (error) {
        console.error("Error loading products:", error);
        setProducts([]);
      }
    })();
  }, [isCreateOpen, fromBranchId]);

  // Load batches for the picked product at the source branch
  useEffect(() => {
    setPickerBatches([]);
    setPickerBatchId("");
    if (!pickerProductId || !fromBranchId) return;
    (async () => {
      try {
        setPickerLoading(true);
        const res: any = await apiService.getBatches({
          productId: pickerProductId,
          branchId: fromBranchId,
          limit: 100,
        });
        const batches = unwrapList(res, "batches")
          .map((b: any) => ({
            id: b.id,
            batchNo: b.batchNo,
            available: batchAvailable(b),
            expireDate: b.expireDate,
          }))
          .filter((b: PickerBatch) => b.available > 0);
        setPickerBatches(batches);
      } catch (error) {
        console.error("Error loading batches:", error);
        setPickerBatches([]);
      } finally {
        setPickerLoading(false);
      }
    })();
  }, [pickerProductId, fromBranchId]);

  const addDraftItem = () => {
    const product = products.find((p) => p.id === pickerProductId);
    const batch = pickerBatches.find((b) => b.id === pickerBatchId);
    const quantity = parseInt(pickerQty, 10);

    if (!product || !batch) {
      toast.error("Missing Information", {
        description: "Please select a product and a batch",
      });
      return;
    }
    if (!quantity || quantity <= 0) {
      toast.error("Invalid Quantity", {
        description: "Quantity must be greater than 0",
      });
      return;
    }
    if (quantity > batch.available) {
      toast.error("Insufficient Stock", {
        description: `Only ${batch.available} available in batch ${batch.batchNo}`,
      });
      return;
    }
    if (draftItems.some((item) => item.sourceBatchId === batch.id)) {
      toast.error("Duplicate Batch", {
        description: "This batch is already added to the transfer",
      });
      return;
    }

    setDraftItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        sourceBatchId: batch.id,
        batchNo: batch.batchNo,
        available: batch.available,
        quantity,
      },
    ]);
    setPickerProductId("");
    setPickerBatchId("");
    setPickerQty("");
  };

  const removeDraftItem = (sourceBatchId: string) => {
    setDraftItems((prev) => prev.filter((item) => item.sourceBatchId !== sourceBatchId));
  };

  const resetCreateForm = () => {
    setFromBranchId("");
    setToBranchId("");
    setNotes("");
    setDraftItems([]);
    setPickerProductId("");
    setPickerBatchId("");
    setPickerQty("");
  };

  const createTransfer = async () => {
    if (!fromBranchId || !toBranchId) {
      toast.error("Missing Branch Selection", {
        description: "Please select both source and destination branches",
      });
      return;
    }
    if (fromBranchId === toBranchId) {
      toast.error("Invalid Branch Selection", {
        description: "Source and destination branches cannot be the same",
      });
      return;
    }
    if (draftItems.length === 0) {
      toast.error("Empty Transfer", {
        description: "Please add at least one item to transfer",
      });
      return;
    }

    try {
      setSubmitting(true);
      await apiService.createTransfer({
        fromBranchId,
        toBranchId,
        notes: notes || undefined,
        items: draftItems.map((item) => ({
          productId: item.productId,
          sourceBatchId: item.sourceBatchId,
          quantity: item.quantity,
        })),
      });
      toast.success("Transfer Created", {
        description: "Transfer request created. Stock moves when it is completed (received).",
      });
      setIsCreateOpen(false);
      resetCreateForm();
      setCurrentPage(1);
      await loadTransfers();
    } catch (error: any) {
      console.error("Error creating transfer:", error);
      toast.error("Transfer Failed", {
        description: error?.message || "Failed to create transfer. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const runConfirmAction = async () => {
    if (!confirmAction) return;
    const { kind, transfer } = confirmAction;
    try {
      setSubmitting(true);
      if (kind === "complete") {
        await apiService.completeTransfer(transfer.id);
        toast.success("Transfer Completed", {
          description: `Stock for ${transfer.transferNumber} moved to ${transfer.toBranch.name}.`,
        });
      } else {
        await apiService.cancelTransfer(transfer.id);
        toast.success("Transfer Cancelled", {
          description: `${transfer.transferNumber} was cancelled. No stock was moved.`,
        });
      }
      setConfirmAction(null);
      setIsDetailsOpen(false);
      await loadTransfers();
    } catch (error: any) {
      console.error(`Error trying to ${kind} transfer:`, error);
      toast.error(kind === "complete" ? "Could Not Complete Transfer" : "Could Not Cancel Transfer", {
        description: error?.message || "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>;
      case "COMPLETED":
        return <Badge className="bg-green-100 text-green-800">Completed</Badge>;
      case "CANCELLED":
        return <Badge className="bg-red-100 text-red-800">Cancelled</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const visibleTransfers = transfers.filter((transfer) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      transfer.transferNumber.toLowerCase().includes(q) ||
      transfer.fromBranch?.name.toLowerCase().includes(q) ||
      transfer.toBranch?.name.toLowerCase().includes(q)
    );
  });

  const totalUnits = (transfer: StockTransferRecord) =>
    transfer.items.reduce((sum, item) => sum + item.quantity, 0);

  if (loading && transfers.length === 0) {
    return (
      <div className="p-6 bg-background min-h-screen">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading transfers...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-background min-h-screen">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-primary">Inventory Transfers</h1>
            <p className="text-muted-foreground">
              Move stock between branches. Stock moves when a transfer is completed (received).
            </p>
          </div>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Transfer
          </Button>
        </div>

        {/* Search and Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search transfers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center text-sm text-muted-foreground">
                <Filter className="w-4 h-4 mr-2" />
                {totalCount} transfer(s) found
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transfers List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Truck className="w-5 h-5 text-primary" />
              <span>Transfer Requests</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {visibleTransfers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Truck className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No transfers found</p>
                <p className="text-xs">Create a new transfer to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {visibleTransfers.map((transfer) => (
                  <div key={transfer.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <div>
                          <h3 className="font-semibold text-lg">{transfer.transferNumber}</h3>
                          <p className="text-sm text-muted-foreground">
                            {transfer.fromBranch?.name} → {transfer.toBranch?.name}
                          </p>
                        </div>
                        {getStatusBadge(transfer.status)}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary">{totalUnits(transfer)} units</p>
                        <p className="text-sm text-muted-foreground">
                          {transfer.items.length} item(s)
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                      <div className="flex items-center space-x-2 text-sm">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span>{formatDate(transfer.createdAt)}</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <span>From: {transfer.fromBranch?.name}</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        <span>To: {transfer.toBranch?.name}</span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex space-x-2 pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedTransfer(transfer);
                          setIsDetailsOpen(true);
                        }}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </Button>
                      {transfer.status === "PENDING" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmAction({ kind: "complete", transfer })}
                            className="text-green-600 border-green-600 hover:bg-green-50"
                          >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Complete (Receive)
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmAction({ kind: "cancel", transfer })}
                            className="text-red-600 border-red-600 hover:bg-red-50"
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6">
                <p className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages} · {totalCount} transfer(s)
                </p>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Create Transfer Dialog */}
        <Dialog open={isCreateOpen} onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open) resetCreateForm();
        }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Inventory Transfer</DialogTitle>
            </DialogHeader>

            <div className="space-y-6">
              {/* Branch Selection */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fromBranch">From Branch</Label>
                  <Select
                    value={fromBranchId}
                    onValueChange={(value) => {
                      setFromBranchId(value);
                      setDraftItems([]);
                      setPickerProductId("");
                      setPickerBatchId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select source branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="toBranch">To Branch</Label>
                  <Select value={toBranchId} onValueChange={setToBranchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select destination branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches
                        .filter((branch) => branch.id !== fromBranchId)
                        .map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Add Items */}
              <div className="space-y-4">
                <Label>Add Items to Transfer</Label>
                {!fromBranchId ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-lg p-3">
                    <AlertCircle className="w-4 h-4" />
                    Select a source branch first — batches are picked from its stock.
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-4">
                    <Select value={pickerProductId} onValueChange={setPickerProductId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select product" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={pickerBatchId}
                      onValueChange={setPickerBatchId}
                      disabled={!pickerProductId || pickerLoading}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={pickerLoading ? "Loading batches..." : "Select batch"} />
                      </SelectTrigger>
                      <SelectContent>
                        {pickerBatches.map((batch) => (
                          <SelectItem key={batch.id} value={batch.id}>
                            {batch.batchNo} — {batch.available} available
                            {batch.expireDate ? ` · exp ${new Date(batch.expireDate).toLocaleDateString()}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      placeholder="Quantity"
                      value={pickerQty}
                      onChange={(e) => setPickerQty(e.target.value)}
                    />
                    <Button onClick={addDraftItem}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Item
                    </Button>
                  </div>
                )}
                {pickerProductId && !pickerLoading && pickerBatches.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No batches with available stock for this product at the source branch.
                  </p>
                )}
              </div>

              {/* Selected Items */}
              {draftItems.length > 0 && (
                <div className="space-y-2">
                  <Label>Selected Items</Label>
                  <div className="border rounded-lg p-4 max-h-40 overflow-y-auto">
                    {draftItems.map((item) => (
                      <div key={item.sourceBatchId} className="flex items-center justify-between py-2 border-b last:border-b-0">
                        <div>
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-sm text-muted-foreground">
                            Batch {item.batchNo} · {item.quantity} units (Available: {item.available})
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => removeDraftItem(item.sourceBatchId)}
                          className="text-red-600 border-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Add any notes about this transfer..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Creating a transfer does not move stock yet. Stock is decremented at the source and
                credited at the destination when the transfer is completed (received).
              </p>
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createTransfer} disabled={submitting}>
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Transfer"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Transfer Details Dialog */}
        <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Transfer Details - {selectedTransfer?.transferNumber}</DialogTitle>
            </DialogHeader>

            {selectedTransfer && (
              <div className="space-y-6">
                {/* Transfer Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold mb-2">Transfer Information</h3>
                    <div className="space-y-1 text-sm">
                      <p><strong>Transfer Number:</strong> {selectedTransfer.transferNumber}</p>
                      <p><strong>Status:</strong> {selectedTransfer.status}</p>
                      <p><strong>Created:</strong> {formatDate(selectedTransfer.createdAt)}</p>
                      {selectedTransfer.completedAt && (
                        <p><strong>Completed:</strong> {formatDate(selectedTransfer.completedAt)}</p>
                      )}
                      {selectedTransfer.cancelledAt && (
                        <p><strong>Cancelled:</strong> {formatDate(selectedTransfer.cancelledAt)}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Branch Information</h3>
                    <div className="space-y-1 text-sm">
                      <p><strong>From:</strong> {selectedTransfer.fromBranch?.name}</p>
                      <p className="text-muted-foreground">{selectedTransfer.fromBranch?.address}</p>
                      <p><strong>To:</strong> {selectedTransfer.toBranch?.name}</p>
                      <p className="text-muted-foreground">{selectedTransfer.toBranch?.address}</p>
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div className="space-y-3">
                  <h3 className="font-semibold">Items</h3>
                  <div className="border rounded-lg">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left py-3 px-4 font-medium">Product</th>
                            <th className="text-left py-3 px-4 font-medium">Source Batch</th>
                            <th className="text-left py-3 px-4 font-medium">Quantity</th>
                            <th className="text-left py-3 px-4 font-medium">Received Into</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedTransfer.items.map((item) => (
                            <tr key={item.id} className="border-t">
                              <td className="py-3 px-4">{item.product?.name}</td>
                              <td className="py-3 px-4">{item.sourceBatch?.batchNo}</td>
                              <td className="py-3 px-4">{item.quantity}</td>
                              <td className="py-3 px-4">
                                {item.destBatch ? item.destBatch.batchNo : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div className="border-t pt-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Items</p>
                      <p className="text-lg font-semibold">{selectedTransfer.items.length}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Total Units</p>
                      <p className="text-lg font-semibold text-primary">{totalUnits(selectedTransfer)}</p>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                {selectedTransfer.notes && (
                  <div className="border-t pt-4">
                    <h3 className="font-semibold mb-2">Notes</h3>
                    <p className="text-sm bg-gray-50 p-3 rounded-md">{selectedTransfer.notes}</p>
                  </div>
                )}

                {/* Actions */}
                {selectedTransfer.status === "PENDING" && (
                  <div className="flex justify-end space-x-2 border-t pt-4">
                    <Button
                      variant="outline"
                      onClick={() => setConfirmAction({ kind: "cancel", transfer: selectedTransfer })}
                      className="text-red-600 border-red-600 hover:bg-red-50"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Cancel Transfer
                    </Button>
                    <Button
                      onClick={() => setConfirmAction({ kind: "complete", transfer: selectedTransfer })}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Complete (Receive)
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Confirm Action Dialog */}
        <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {confirmAction?.kind === "complete" ? "Complete Transfer?" : "Cancel Transfer?"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {confirmAction?.kind === "complete" ? (
                  <>
                    Receiving <strong>{confirmAction.transfer.transferNumber}</strong> will move{" "}
                    {totalUnits(confirmAction.transfer)} units from{" "}
                    {confirmAction.transfer.fromBranch?.name} to {confirmAction.transfer.toBranch?.name}.
                    This cannot be undone.
                  </>
                ) : (
                  <>
                    Cancel <strong>{confirmAction?.transfer.transferNumber}</strong>? No stock has
                    moved for this transfer, so nothing needs to be reversed.
                  </>
                )}
              </p>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={submitting}>
                  Go Back
                </Button>
                <Button
                  onClick={runConfirmAction}
                  disabled={submitting}
                  className={confirmAction?.kind === "complete" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
                >
                  {submitting ? "Working..." : confirmAction?.kind === "complete" ? "Complete Transfer" : "Cancel Transfer"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default InventoryTransfers;
