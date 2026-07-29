import { useState, useEffect } from "react";
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
  Package,
  ArrowRight,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Truck,
  MapPin,
  Calendar,
  User,
  AlertCircle,
  CheckCircle,
  Clock,
  Eye,
  Download,
  Printer
} from "lucide-react";

interface TransferItem {
  productId: string;
  productName: string;
  quantity: number;
  unitType: string;
  currentStock: number;
}

interface InventoryTransfer {
  id: string;
  transferNumber: string;
  fromBranchId: string;
  toBranchId: string;
  fromBranch: {
    id: string;
    name: string;
    address: string;
  };
  toBranch: {
    id: string;
    name: string;
    address: string;
  };
  items: TransferItem[];
  status: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  deliveredBy?: string;
  deliveredAt?: string;
  notes?: string;
  totalItems: number;
  totalValue: number;
}

const InventoryTransfers = () => {
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [filteredTransfers, setFilteredTransfers] = useState<InventoryTransfer[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTransfer, setSelectedTransfer] = useState<InventoryTransfer | null>(null);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  // Form states
  const [newTransfer, setNewTransfer] = useState({
    fromBranchId: "",
    toBranchId: "",
    notes: "",
    items: [] as TransferItem[]
  });

  const [newItem, setNewItem] = useState({
    productId: "",
    quantity: ""
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    filterTransfers();
  }, [transfers, searchQuery, statusFilter]);

  const loadData = async () => {
    try {
      setLoading(true);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Transfer caching disabled - will load from API
      setTransfers([]);

      // Products caching disabled

      // Mock branches data
      const mockBranches = [
        { id: "branch_001", name: "Main Branch", address: "123 Main Street, Lahore" },
        { id: "branch_002", name: "Gulberg Branch", address: "456 Gulberg, Lahore" },
        { id: "branch_003", name: "DHA Branch", address: "789 DHA Phase 5, Lahore" },
        { id: "branch_004", name: "Karachi Branch", address: "321 Clifton, Karachi" }
      ];
      setBranches(mockBranches);

    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterTransfers = () => {
    let filtered = [...transfers];

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(transfer =>
        transfer.transferNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        transfer.fromBranch.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        transfer.toBranch.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        transfer.requestedBy.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(transfer => transfer.status === statusFilter);
    }

    setFilteredTransfers(filtered);
    setCurrentPage(1);
  };

  const addItemToTransfer = () => {
    if (!newItem.productId || !newItem.quantity) {
      toast.error("Missing Information", {
        description: "Please select a product and enter quantity",
      });
      return;
    }

    const product = products.find(p => p.id === newItem.productId);
    if (!product) {
      toast.error("Product Not Found", {
        description: "Product not found",
      });
      return;
    }

    const quantity = parseInt(newItem.quantity);
    if (quantity <= 0) {
      toast.error("Invalid Quantity", {
        description: "Quantity must be greater than 0",
      });
      return;
    }

    if (quantity > product.stockQuantity) {
      toast.error("Insufficient Stock", {
        description: `Insufficient stock. Available: ${product.stockQuantity}`,
      });
      return;
    }

    const existingItem = newTransfer.items.find(item => item.productId === newItem.productId);
    if (existingItem) {
      toast.error("Duplicate Product", {
        description: "Product already added to transfer",
      });
      return;
    }

    const transferItem: TransferItem = {
      productId: product.id,
      productName: product.name,
      quantity: quantity,
      unitType: product.unitType,
      currentStock: product.stockQuantity
    };

    setNewTransfer({
      ...newTransfer,
      items: [...newTransfer.items, transferItem]
    });

    setNewItem({ productId: "", quantity: "" });
  };

  const removeItemFromTransfer = (productId: string) => {
    setNewTransfer({
      ...newTransfer,
      items: newTransfer.items.filter(item => item.productId !== productId)
    });
  };

  const createTransfer = async () => {
    if (!newTransfer.fromBranchId || !newTransfer.toBranchId) {
      toast.error("Missing Branch Selection", {
        description: "Please select both source and destination branches",
      });
      return;
    }

    if (newTransfer.items.length === 0) {
      toast.error("Empty Transfer", {
        description: "Please add at least one item to transfer",
      });
      return;
    }

    if (newTransfer.fromBranchId === newTransfer.toBranchId) {
      toast.error("Invalid Branch Selection", {
        description: "Source and destination branches cannot be the same",
      });
      return;
    }

    try {
      setLoading(true);

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      const fromBranch = branches.find(b => b.id === newTransfer.fromBranchId);
      const toBranch = branches.find(b => b.id === newTransfer.toBranchId);

      const totalValue = newTransfer.items.reduce((sum, item) => {
        const product = products.find(p => p.id === item.productId);
        return sum + (product ? product.sellingPrice * item.quantity : 0);
      }, 0);

      const newTransferData: InventoryTransfer = {
        id: `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        transferNumber: `TRF-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`,
        fromBranchId: newTransfer.fromBranchId,
        toBranchId: newTransfer.toBranchId,
        fromBranch: fromBranch!,
        toBranch: toBranch!,
        items: newTransfer.items,
        status: 'PENDING',
        requestedBy: "Current User",
        requestedAt: new Date().toISOString(),
        notes: newTransfer.notes,
        totalItems: newTransfer.items.length,
        totalValue: totalValue
      };

      // Transfer caching disabled
      setNewTransfer({ fromBranchId: "", toBranchId: "", notes: "", items: [] });
      setIsCreateDialogOpen(false);
      toast.success("Transfer Created", {
        description: "Transfer request created successfully!",
      });
    } catch (error) {
      console.error('Error creating transfer:', error);
      toast.error("Transfer Failed", {
        description: "Failed to create transfer. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateTransferStatus = (transferId: string, newStatus: string) => {
    const updatedTransfers = transfers.map(transfer =>
      transfer.id === transferId
        ? {
            ...transfer,
            status: newStatus as any,
            approvedAt: newStatus === 'IN_TRANSIT' ? new Date().toISOString() : transfer.approvedAt,
            deliveredAt: newStatus === 'DELIVERED' ? new Date().toISOString() : transfer.deliveredAt
          }
        : transfer
    );
    setTransfers(updatedTransfers);
    // Transfer caching disabled
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>;
      case "IN_TRANSIT":
        return <Badge className="bg-blue-100 text-blue-800">In Transit</Badge>;
      case "DELIVERED":
        return <Badge className="bg-green-100 text-green-800">Delivered</Badge>;
      case "CANCELLED":
        return <Badge className="bg-red-100 text-red-800">Cancelled</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
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

  const paginatedTransfers = filteredTransfers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredTransfers.length / itemsPerPage);

  if (loading) {
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
            <p className="text-muted-foreground">Manage inventory transfers between branches</p>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
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
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="IN_TRANSIT">In Transit</SelectItem>
                  <SelectItem value="DELIVERED">Delivered</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center text-sm text-muted-foreground">
                <Filter className="w-4 h-4 mr-2" />
                {filteredTransfers.length} transfer(s) found
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
            {paginatedTransfers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Truck className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No transfers found</p>
                <p className="text-xs">Create a new transfer to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {paginatedTransfers.map((transfer) => (
                  <div key={transfer.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <div>
                          <h3 className="font-semibold text-lg">{transfer.transferNumber}</h3>
                          <p className="text-sm text-muted-foreground">
                            {transfer.fromBranch.name} → {transfer.toBranch.name}
                          </p>
                        </div>
                        {getStatusBadge(transfer.status)}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary">
                          PKR {transfer.totalValue.toFixed(2)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {transfer.totalItems} item(s)
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                      <div className="flex items-center space-x-2 text-sm">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span>Requested by: {transfer.requestedBy}</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span>{formatDate(transfer.requestedAt)}</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <span>From: {transfer.fromBranch.name}</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        <span>To: {transfer.toBranch.name}</span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex space-x-2 pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedTransfer(transfer);
                          setIsTransferDialogOpen(true);
                        }}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </Button>
                      {transfer.status === 'PENDING' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateTransferStatus(transfer.id, 'IN_TRANSIT')}
                            className="text-blue-600 border-blue-600 hover:bg-blue-50"
                          >
                            <Truck className="w-4 h-4 mr-2" />
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateTransferStatus(transfer.id, 'CANCELLED')}
                            className="text-red-600 border-red-600 hover:bg-red-50"
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                      {transfer.status === 'IN_TRANSIT' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateTransferStatus(transfer.id, 'DELIVERED')}
                          className="text-green-600 border-green-600 hover:bg-green-50"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Mark Delivered
                        </Button>
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
                  Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredTransfers.length)} of {filteredTransfers.length} transfers
                </p>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
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
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Inventory Transfer</DialogTitle>
            </DialogHeader>

            <div className="space-y-6">
              {/* Branch Selection */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fromBranch">From Branch</Label>
                  <Select value={newTransfer.fromBranchId} onValueChange={(value) => setNewTransfer({...newTransfer, fromBranchId: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select source branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map(branch => (
                        <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="toBranch">To Branch</Label>
                  <Select value={newTransfer.toBranchId} onValueChange={(value) => setNewTransfer({...newTransfer, toBranchId: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select destination branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map(branch => (
                        <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Add Items */}
              <div className="space-y-4">
                <Label>Add Items to Transfer</Label>
                <div className="grid grid-cols-3 gap-4">
                  <Select value={newItem.productId} onValueChange={(value) => setNewItem({...newItem, productId: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map(product => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name} (Stock: {product.stockQuantity})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    placeholder="Quantity"
                    value={newItem.quantity}
                    onChange={(e) => setNewItem({...newItem, quantity: e.target.value})}
                  />
                  <Button onClick={addItemToTransfer}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Item
                  </Button>
                </div>
              </div>

              {/* Selected Items */}
              {newTransfer.items.length > 0 && (
                <div className="space-y-2">
                  <Label>Selected Items</Label>
                  <div className="border rounded-lg p-4 max-h-40 overflow-y-auto">
                    {newTransfer.items.map((item, index) => (
                      <div key={index} className="flex items-center justify-between py-2 border-b last:border-b-0">
                        <div>
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.quantity} {item.unitType} (Available: {item.currentStock})
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => removeItemFromTransfer(item.productId)}
                          className="text-red-600 border-red-600 hover:bg-red-50"
                        >
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
                  value={newTransfer.notes}
                  onChange={(e) => setNewTransfer({...newTransfer, notes: e.target.value})}
                  rows={3}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createTransfer} disabled={loading}>
                {loading ? (
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
        <Dialog open={isTransferDialogOpen} onOpenChange={setIsTransferDialogOpen}>
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
                      <p><strong>Requested By:</strong> {selectedTransfer.requestedBy}</p>
                      <p><strong>Requested At:</strong> {formatDate(selectedTransfer.requestedAt)}</p>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Branch Information</h3>
                    <div className="space-y-1 text-sm">
                      <p><strong>From:</strong> {selectedTransfer.fromBranch.name}</p>
                      <p className="text-muted-foreground">{selectedTransfer.fromBranch.address}</p>
                      <p><strong>To:</strong> {selectedTransfer.toBranch.name}</p>
                      <p className="text-muted-foreground">{selectedTransfer.toBranch.address}</p>
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div className="space-y-3">
                  <h3 className="font-semibold">Items to Transfer</h3>
                  <div className="border rounded-lg">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left py-3 px-4 font-medium">Product</th>
                            <th className="text-left py-3 px-4 font-medium">Quantity</th>
                            <th className="text-left py-3 px-4 font-medium">Unit</th>
                            <th className="text-left py-3 px-4 font-medium">Current Stock</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedTransfer.items.map((item, index) => (
                            <tr key={index} className="border-t">
                              <td className="py-3 px-4">{item.productName}</td>
                              <td className="py-3 px-4">{item.quantity}</td>
                              <td className="py-3 px-4">{item.unitType}</td>
                              <td className="py-3 px-4">{item.currentStock}</td>
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
                      <p className="text-lg font-semibold">{selectedTransfer.totalItems}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Total Value</p>
                      <p className="text-lg font-semibold text-primary">PKR {selectedTransfer.totalValue.toFixed(2)}</p>
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
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default InventoryTransfers;
