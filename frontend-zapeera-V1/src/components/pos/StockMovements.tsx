import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DateRangeFilter from "@/components/ui/DateRangeFilter";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  Package,
  Search,
  Filter,
  Download,
  Printer,
  Eye,
  Calendar,
  User,
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Building2
} from "lucide-react";

interface StockMovement {
  id: string;
  type: string;
  quantity: number;
  reason?: string;
  reference?: string;
  createdAt: string;
  product: {
    id: string;
    name: string;
    sku?: string;
    unitType: string;
    branch: {
      id: string;
      name: string;
    };
  };
  createdBy?: string;
}

const StockMovements = () => {
  const { user } = useAuth();
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [filteredMovements, setFilteredMovements] = useState<StockMovement[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedMovement, setSelectedMovement] = useState<StockMovement | null>(null);
  const [isMovementDialogOpen, setIsMovementDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);

  useEffect(() => {
    loadStockMovements();
  }, []);

  const loadStockMovements = useCallback(async () => {
    try {
      setLoading(true);

      console.log('🔍 Loading stock movements with date filter:', { startDate, endDate });
      const response = await apiService.getStockMovements({
        page: currentPage,
        limit: itemsPerPage,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        branchId: user?.membership?.branchIds?.[0] || user?.branchId || ""
      });

      if (response.success && response.data?.stockMovements) {
        setStockMovements(response.data.stockMovements);
      } else {
        setStockMovements([]);
      }
    } catch (error) {
      console.error('Error loading stock movements:', error);
      setStockMovements([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, currentPage, itemsPerPage]);

  useEffect(() => {
    filterMovements();
  }, [stockMovements, searchQuery, typeFilter]);

  useEffect(() => {
    loadStockMovements();
  }, [loadStockMovements]);

  const filterMovements = () => {
    let filtered = [...stockMovements];

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(movement =>
        movement.product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        movement.product.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        movement.reason?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        movement.reference?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        movement.createdBy?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Type filter
    if (typeFilter !== "all") {
      filtered = filtered.filter(movement => movement.type === typeFilter);
    }

    setFilteredMovements(filtered);
    setCurrentPage(1);
  };

  const getMovementIcon = (type: string) => {
    switch (type) {
      case "IN":
        return <ArrowUp className="w-4 h-4 text-green-600" />;
      case "OUT":
        return <ArrowDown className="w-4 h-4 text-red-600" />;
      case "RETURN":
        return <RotateCcw className="w-4 h-4 text-blue-600" />;
      case "ADJUSTMENT":
        return <Package className="w-4 h-4 text-orange-600" />;
      default:
        return <Package className="w-4 h-4 text-gray-600" />;
    }
  };

  const getMovementBadge = (type: string) => {
    switch (type) {
      case "IN":
        return <Badge className="bg-green-100 text-green-800">Stock In</Badge>;
      case "OUT":
        return <Badge className="bg-red-100 text-red-800">Stock Out</Badge>;
      case "RETURN":
        return <Badge className="bg-blue-100 text-blue-800">Return</Badge>;
      case "ADJUSTMENT":
        return <Badge className="bg-orange-100 text-orange-800">Adjustment</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
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

  const paginatedMovements = filteredMovements.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredMovements.length / itemsPerPage);

  const viewMovement = (movement: StockMovement) => {
    setSelectedMovement(movement);
    setIsMovementDialogOpen(true);
  };

  const printMovement = (movement: StockMovement) => {
    toast.success("Printing", {
      description: `Printing stock movement: ${movement.id}`,
    });
  };

  const downloadMovement = (movement: StockMovement) => {
    toast.success("Downloading", {
      description: `Downloading stock movement: ${movement.id}`,
    });
  };

  if (loading) {
    return (
      <div className="p-6 bg-background min-h-screen">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading stock movements...</p>
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
            <h1 className="text-3xl font-bold text-primary">Stock Movements</h1>
            <p className="text-muted-foreground">Track all inventory movements and transactions</p>
          </div>
          <Button onClick={loadStockMovements} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Date Range Filter */}
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onClear={() => {
            setStartDate("");
            setEndDate("");
          }}
        />

        {/* Search and Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by product name, SKU, reason, or user..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Type Filter */}
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by movement type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="IN">Stock In</SelectItem>
                  <SelectItem value="OUT">Stock Out</SelectItem>
                  <SelectItem value="RETURN">Return</SelectItem>
                  <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
                </SelectContent>
              </Select>

              {/* Results Count */}
              <div className="flex items-center text-sm text-muted-foreground">
                <Filter className="w-4 h-4 mr-2" />
                {filteredMovements.length} movement(s) found
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stock Movements List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Package className="w-5 h-5 text-primary" />
              <span>Stock Movements</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {paginatedMovements.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No stock movements found</p>
                <p className="text-xs">Try adjusting your search or filters</p>
              </div>
            ) : (
              <div className="space-y-4">
                {paginatedMovements.map((movement) => (
                  <div key={movement.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <div>
                          <h3 className="font-semibold text-lg">{movement.product.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {movement.product.sku && `SKU: ${movement.product.sku}`}
                          </p>
                        </div>
                        {getMovementBadge(movement.type)}
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-bold ${movement.type === 'IN' ? 'text-green-600' : 'text-red-600'}`}>
                          {movement.type === 'IN' ? '+' : '-'}{movement.quantity} {movement.product.unitType}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(movement.createdAt)}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                      <div className="flex items-center space-x-2 text-sm">
                        {getMovementIcon(movement.type)}
                        <span className="capitalize">{movement.type.toLowerCase()}</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span>{movement.createdBy || 'System'}</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        <span>{movement.product.branch.name}</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span>{movement.reference || 'N/A'}</span>
                      </div>
                    </div>

                    {/* Reason */}
                    {movement.reason && (
                      <div className="mb-3">
                        <p className="text-sm font-medium mb-1">Reason:</p>
                        <p className="text-sm text-muted-foreground bg-gray-50 p-2 rounded">
                          {movement.reason}
                        </p>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex space-x-2 pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => viewMovement(movement)}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => printMovement(movement)}
                      >
                        <Printer className="w-4 h-4 mr-2" />
                        Print
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadMovement(movement)}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6">
                <p className="text-sm text-muted-foreground">
                  Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredMovements.length)} of {filteredMovements.length} movements
                </p>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Movement Details Dialog */}
        <Dialog open={isMovementDialogOpen} onOpenChange={setIsMovementDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>Stock Movement Details</span>
                <div className="flex space-x-2">
                  <Button variant="outline" size="sm" onClick={() => selectedMovement && printMovement(selectedMovement)}>
                    <Printer className="w-4 h-4 mr-2" />
                    Print
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => selectedMovement && downloadMovement(selectedMovement)}>
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </div>
              </DialogTitle>
            </DialogHeader>

            {selectedMovement && (
              <div className="space-y-6">
                {/* Movement Header */}
                <div className="flex justify-between items-start border-b pb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-primary">Stock Movement</h2>
                    <p className="text-muted-foreground">Movement ID: {selectedMovement.id}</p>
                    <div className="mt-4 space-y-1 text-sm">
                      <p><strong>Date:</strong> {formatDate(selectedMovement.createdAt)}</p>
                      <p><strong>Type:</strong> {getMovementBadge(selectedMovement.type)}</p>
                      <p><strong>Reference:</strong> {selectedMovement.reference || 'N/A'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-2xl font-bold ${selectedMovement.type === 'IN' ? 'text-green-600' : 'text-red-600'}`}>
                      {selectedMovement.type === 'IN' ? '+' : '-'}{selectedMovement.quantity} {selectedMovement.product.unitType}
                    </p>
                  </div>
                </div>

                {/* Product Info */}
                <div className="border-b pb-4">
                  <h3 className="font-semibold mb-2">Product Information</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p><strong>Name:</strong> {selectedMovement.product.name}</p>
                      <p><strong>SKU:</strong> {selectedMovement.product.sku || 'N/A'}</p>
                    </div>
                    <div>
                      <p><strong>Unit Type:</strong> {selectedMovement.product.unitType}</p>
                      <p><strong>Branch:</strong> {selectedMovement.product.branch.name}</p>
                    </div>
                  </div>
                </div>

                {/* Movement Details */}
                <div className="border-b pb-4">
                  <h3 className="font-semibold mb-2">Movement Details</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p><strong>Quantity:</strong> {selectedMovement.quantity} {selectedMovement.product.unitType}</p>
                      <p><strong>Type:</strong> {selectedMovement.type}</p>
                    </div>
                    <div>
                      <p><strong>Created By:</strong> {selectedMovement.createdBy || 'System'}</p>
                    </div>
                  </div>
                </div>

                {/* Reason */}
                {selectedMovement.reason && (
                  <div className="border-b pb-4">
                    <h3 className="font-semibold mb-2">Reason</h3>
                    <p className="text-sm bg-gray-50 p-3 rounded-md border">
                      {selectedMovement.reason}
                    </p>
                  </div>
                )}

                {/* Footer */}
                <div className="border-t pt-4 text-center text-xs text-muted-foreground">
                  <p>Stock movement recorded on {formatDate(selectedMovement.createdAt)}</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default StockMovements;
