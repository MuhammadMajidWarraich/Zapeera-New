import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  ShoppingCart,
  Package,
  AlertTriangle,
  Loader2,
  Info,
} from "lucide-react";
import { apiService, fetchAllPaged } from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Wave C3 — Auto-reorder suggestions.
// Products opt in via a Reorder Level (set on the product form in
// Inventory). When live stock (non-expired batches, base units) falls to
// or below that level, the product appears here, grouped by the supplier
// of its most recent batch, with a suggested quantity (the product's
// fixed Reorder Quantity, or 2 x level - stock). "Create purchase order"
// posts a REAL purchase through the standard purchase flow: Zapeera
// purchases have no draft/receive state (status is a payment status), so
// the order lands the stock immediately and stays PENDING (unpaid).

interface ReorderLine {
  productId: string;
  productName: string;
  sku: string;
  branchId: string;
  currentStock: number;
  reorderLevel: number;
  reorderQuantity: number | null;
  suggestedQty: number;
  lastCost: number | null;
  unitsPerPack: number;
  unitsPerStrip: number | null;
}

interface ReorderGroup {
  supplier: {
    id: string;
    name: string;
    contactPerson?: string;
    phone?: string;
  } | null;
  lines: ReorderLine[];
  totalEstimatedCost: number;
}

interface SupplierOption {
  id: string;
  name: string;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);

const groupKey = (group: ReorderGroup) =>
  group.supplier ? group.supplier.id : "__unassigned__";

const ReorderSuggestions: React.FC = () => {
  const [groups, setGroups] = useState<ReorderGroup[]>([]);
  const [participating, setParticipating] = useState(0);
  const [loading, setLoading] = useState(true);
  // Editable quantities per product (base units).
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  // Supplier chosen for the unassigned group.
  const [unassignedSupplierId, setUnassignedSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiService.getReorderSuggestions();
      if (response.success && response.data) {
        setGroups(response.data.groups || []);
        setParticipating(response.data.participatingProducts || 0);
        const qty: Record<string, number> = {};
        (response.data.groups || []).forEach((g) =>
          g.lines.forEach((l) => {
            qty[l.productId] = l.suggestedQty;
          })
        );
        setQuantities(qty);
      } else {
        toast({
          title: "Failed to load suggestions",
          description: response.message || "Could not load reorder suggestions.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Load reorder suggestions error:", err);
      toast({
        title: "Failed to load suggestions",
        description: "Could not load reorder suggestions.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSuppliers = useCallback(async () => {
    try {
      // H3 truncation family (2026-10-28): suppliers past the first
      // 200 were missing from the reorder picker.
      const suppliers = await fetchAllPaged(
        (page, limit) => apiService.getSuppliers({ page, limit }),
        (data: any) => data.suppliers || []
      );
      setSuppliers(suppliers.map((s: any) => ({ id: s.id, name: s.name })));
    } catch (err) {
      console.error("Load suppliers error:", err);
    }
  }, []);

  useEffect(() => {
    loadSuggestions();
    loadSuppliers();
  }, [loadSuggestions, loadSuppliers]);

  const totals = useMemo(() => {
    let products = 0;
    let units = 0;
    groups.forEach((g) =>
      g.lines.forEach((l) => {
        products += 1;
        units += quantities[l.productId] ?? l.suggestedQty;
      })
    );
    return { products, units };
  }, [groups, quantities]);

  const handleCreateOrder = async (group: ReorderGroup) => {
    const supplierId = group.supplier?.id || unassignedSupplierId;
    if (!supplierId) {
      toast({
        title: "Choose a supplier",
        description: "These products have no purchase history — pick a supplier before creating the order.",
        variant: "destructive",
      });
      return;
    }
    const lines = group.lines
      .map((l) => ({
        productId: l.productId,
        quantity: Math.max(1, Math.floor(quantities[l.productId] ?? l.suggestedQty)),
      }))
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) return;

    try {
      setCreatingKey(groupKey(group));
      const response = await apiService.createPurchaseFromSuggestions({
        supplierId,
        lines,
      });
      if (response.success) {
        toast({
          title: "Purchase order created",
          description: `Order for ${lines.length} product(s) created — stock received, payment Pending. See it under Purchases.`,
        });
        await loadSuggestions();
      } else {
        toast({
          title: "Could not create order",
          description: response.message || "The purchase order was not created.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Create order from suggestions error:", err);
      toast({
        title: "Could not create order",
        description: "The purchase order was not created.",
        variant: "destructive",
      });
    } finally {
      setCreatingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading reorder suggestions...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center">
            <RefreshCw className="w-8 h-8 mr-3 text-blue-600" />
            Reorder Suggestions
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Products at or below their reorder level, grouped by supplier.
            Quantities are in base units (tablets / pieces).
          </p>
        </div>
        <Button variant="outline" onClick={loadSuggestions}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800 mb-6">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Creating an order posts a real purchase: the stock is received
          immediately and the purchase stays <strong>Pending</strong> (unpaid)
          until you record payment under Purchases. Pack-structured products
          are ordered in whole packs (rounded up).
        </span>
      </div>

      {participating === 0 ? (
        <Card className="bg-white border-0 shadow-soft">
          <CardContent className="py-16 text-center">
            <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No products have a reorder level yet
            </h3>
            <p className="text-gray-500 max-w-xl mx-auto">
              Reorder suggestions only watch products you opt in. Open a
              product in <strong>Inventory</strong>, set its{" "}
              <strong>Reorder Level</strong> (and optionally a fixed{" "}
              <strong>Reorder Quantity</strong>), and it will appear here
              whenever its stock falls to that level.
            </p>
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card className="bg-white border-0 shadow-soft">
          <CardContent className="py-16 text-center">
            <Package className="w-16 h-16 text-green-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Nothing to reorder
            </h3>
            <p className="text-gray-500">
              All {participating} watched product(s) are stocked above their
              reorder levels.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <Card className="bg-white border-0 shadow-soft">
              <CardContent className="p-6">
                <p className="text-sm font-medium text-gray-600">Products to Reorder</p>
                <p className="text-2xl font-bold text-gray-900">{totals.products}</p>
              </CardContent>
            </Card>
            <Card className="bg-white border-0 shadow-soft">
              <CardContent className="p-6">
                <p className="text-sm font-medium text-gray-600">Total Units Suggested</p>
                <p className="text-2xl font-bold text-gray-900">{totals.units}</p>
              </CardContent>
            </Card>
            <Card className="bg-white border-0 shadow-soft">
              <CardContent className="p-6">
                <p className="text-sm font-medium text-gray-600">Supplier Groups</p>
                <p className="text-2xl font-bold text-gray-900">{groups.length}</p>
              </CardContent>
            </Card>
          </div>

          {groups.map((group) => {
            const key = groupKey(group);
            const groupUnits = group.lines.reduce(
              (sum, l) => sum + (quantities[l.productId] ?? l.suggestedQty),
              0
            );
            return (
              <Card key={key} className="bg-white border-0 shadow-soft mb-6">
                <CardHeader>
                  <CardTitle className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <span className="flex items-center">
                      <ShoppingCart className="w-5 h-5 mr-2 text-blue-600" />
                      {group.supplier ? (
                        <>
                          {group.supplier.name}
                          {group.supplier.phone && (
                            <span className="text-sm font-normal text-gray-500 ml-2">
                              {group.supplier.phone}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="flex items-center">
                          No supplier history
                          <Badge variant="secondary" className="ml-2">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            Unassigned
                          </Badge>
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-sm font-normal text-gray-500">
                        {group.lines.length} product(s) · {groupUnits} units ·
                        est. {formatCurrency(group.totalEstimatedCost)}
                      </span>
                      {!group.supplier && (
                        <Select
                          value={unassignedSupplierId}
                          onValueChange={setUnassignedSupplierId}
                        >
                          <SelectTrigger className="w-52">
                            <SelectValue placeholder="Choose supplier" />
                          </SelectTrigger>
                          <SelectContent>
                            {suppliers.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Button
                        onClick={() => handleCreateOrder(group)}
                        disabled={creatingKey === key}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        {creatingKey === key ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <ShoppingCart className="w-4 h-4 mr-2" />
                        )}
                        Create purchase order
                      </Button>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 px-3 font-medium text-gray-600">Product</th>
                          <th className="text-left py-2 px-3 font-medium text-gray-600">SKU</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Stock</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Reorder Level</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Last Cost</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Order Qty (units)</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Est. Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.lines.map((line) => {
                          const qty = quantities[line.productId] ?? line.suggestedQty;
                          return (
                            <tr key={line.productId} className="border-b border-gray-100">
                              <td className="py-2 px-3 font-medium text-gray-900">
                                {line.productName}
                                {line.unitsPerPack > 1 && (
                                  <span className="text-gray-500 font-normal">
                                    {" "}
                                    (pack of {line.unitsPerPack})
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3">
                                <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                                  {line.sku}
                                </code>
                              </td>
                              <td className="py-2 px-3 text-right text-red-600 font-medium">
                                {line.currentStock}
                              </td>
                              <td className="py-2 px-3 text-right">{line.reorderLevel}</td>
                              <td className="py-2 px-3 text-right">
                                {line.lastCost != null
                                  ? formatCurrency(line.lastCost)
                                  : "—"}
                              </td>
                              <td className="py-2 px-3 text-right">
                                <Input
                                  type="number"
                                  min={1}
                                  value={qty}
                                  onChange={(e) =>
                                    setQuantities((prev) => ({
                                      ...prev,
                                      [line.productId]: Number(e.target.value) || 0,
                                    }))
                                  }
                                  className="w-24 ml-auto text-right"
                                />
                              </td>
                              <td className="py-2 px-3 text-right">
                                {line.lastCost != null
                                  ? formatCurrency(line.lastCost * qty)
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
};

export default ReorderSuggestions;
