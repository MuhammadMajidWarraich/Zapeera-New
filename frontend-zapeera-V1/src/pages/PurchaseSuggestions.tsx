import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Gap Item 4 — Persisted purchase suggestions.
// Generate scans live stock (FEFO sellable basis) and writes PENDING
// proposal rows grouped by supplier — it NEVER orders anything. Only an
// explicit Approve creates a purchase (real purchase, stock lands,
// status Pending/unpaid, exactly like the C3 one-click order). Reject
// discards the proposal. PENDING suggestions older than 7 days expire
// automatically on the next generate.

type SuggestionStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

interface SuggestionLine {
  id: string;
  productId: string;
  currentStock: number;
  sellableStock: number;
  expiringStock: number;
  reorderLevel: number | null;
  minStock: number;
  suggestedQty: number;
  unitCost: number | null;
  reason: string;
  note: string | null;
  product: { id: string; name: string; sku: string; unitsPerPack: number; unitsPerStrip: number | null };
}

interface Suggestion {
  id: string;
  supplierId: string | null;
  status: SuggestionStatus;
  reason: string | null;
  createdAt: string;
  purchaseId: string | null;
  supplier: { id: string; name: string; contactPerson?: string; phone?: string } | null;
  lines: SuggestionLine[];
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);

const reasonLabel: Record<string, string> = {
  BELOW_REORDER_LEVEL: "Below reorder level",
  BELOW_MIN_STOCK: "Below min stock",
  EXPIRING_STOCK: "Expiring stock",
};

const statusBadge: Record<SuggestionStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending approval", className: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Approved — ordered", className: "bg-green-100 text-green-800" },
  REJECTED: { label: "Rejected", className: "bg-red-100 text-red-800" },
  EXPIRED: { label: "Expired", className: "bg-gray-100 text-gray-600" },
};

const PurchaseSuggestions: React.FC = () => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiService.getPurchaseSuggestions({
        status: statusFilter === "ALL" ? undefined : statusFilter,
        limit: 50,
      });
      if (response.success && response.data) {
        setSuggestions(response.data.suggestions || []);
        setTotal(response.data.total || 0);
      } else {
        toast({
          title: "Failed to load suggestions",
          description: response.message || "Could not load purchase suggestions.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Load purchase suggestions error:", err);
      toast({
        title: "Failed to load suggestions",
        description: "Could not load purchase suggestions.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      const response = await apiService.generatePurchaseSuggestions();
      if (response.success && response.data) {
        toast({
          title: "Suggestions generated",
          description: `${response.data.totals.suggestions} proposal(s), ${response.data.totals.lines} product line(s). Nothing was ordered — approve a proposal to create a purchase.`,
        });
        setStatusFilter("PENDING");
        await loadSuggestions();
      } else {
        toast({
          title: "Could not generate suggestions",
          description: response.message || "Generation failed.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Generate purchase suggestions error:", err);
      toast({
        title: "Could not generate suggestions",
        description: "Generation failed.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleApprove = async (s: Suggestion) => {
    try {
      setBusyId(s.id);
      const response = await apiService.approvePurchaseSuggestion(s.id);
      if (response.success) {
        toast({
          title: "Purchase order created",
          description: `Order created from the suggestion — stock received, payment Pending. See it under Purchases.`,
        });
        await loadSuggestions();
      } else {
        toast({
          title: "Could not approve",
          description: response.message || "The purchase was not created.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Approve purchase suggestion error:", err);
      toast({
        title: "Could not approve",
        description: "The purchase was not created.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (s: Suggestion) => {
    try {
      setBusyId(s.id);
      const response = await apiService.rejectPurchaseSuggestion(s.id);
      if (response.success) {
        toast({ title: "Suggestion rejected", description: "The proposal was discarded. Nothing was ordered." });
        await loadSuggestions();
      } else {
        toast({
          title: "Could not reject",
          description: response.message || "The suggestion was not rejected.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Reject purchase suggestion error:", err);
      toast({
        title: "Could not reject",
        description: "The suggestion was not rejected.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading purchase suggestions...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center">
            <ShoppingCart className="w-8 h-8 mr-3 text-blue-600" />
            Purchase Suggestions
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Auto-purchase proposals from live stock. Generating never orders
            anything — only an explicit approval creates a purchase.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="EXPIRED">Expired</SelectItem>
              <SelectItem value="ALL">All</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={loadSuggestions}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={handleGenerate} disabled={generating} className="bg-blue-600 hover:bg-blue-700 text-white">
            {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Generate suggestions
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800 mb-6">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Approving creates a <strong>real purchase</strong>: stock is received
          immediately and the purchase stays <strong>Pending</strong> (unpaid)
          until you record payment under Purchases. Suggestions expire after
          7 days — stock moves daily, so regenerate for a fresh picture.
        </span>
      </div>

      {suggestions.length === 0 ? (
        <Card className="bg-white border-0 shadow-soft">
          <CardContent className="py-16 text-center">
            <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {statusFilter === "PENDING" ? "No pending proposals" : "No suggestions with this status"}
            </h3>
            <p className="text-gray-500 max-w-xl mx-auto">
              Click <strong>Generate suggestions</strong> to scan live stock
              (reorder levels, min stock, and stock expiring within 30 days)
              and build fresh proposals per supplier.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-4">
            Showing {suggestions.length} of {total} suggestion(s)
          </p>
          {suggestions.map((s) => {
            const estCost = s.lines.reduce(
              (sum, l) => sum + (l.unitCost != null ? l.suggestedQty * l.unitCost : 0),
              0
            );
            const badge = statusBadge[s.status];
            return (
              <Card key={s.id} className="bg-white border-0 shadow-soft mb-6">
                <CardHeader>
                  <CardTitle className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <span className="flex items-center flex-wrap gap-2">
                      <ShoppingCart className="w-5 h-5 mr-1 text-blue-600" />
                      {s.supplier ? (
                        <>
                          {s.supplier.name}
                          {s.supplier.phone && (
                            <span className="text-sm font-normal text-gray-500">{s.supplier.phone}</span>
                          )}
                        </>
                      ) : (
                        <span className="flex items-center">
                          No supplier assigned
                          <Badge variant="secondary" className="ml-2">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            Unassigned
                          </Badge>
                        </span>
                      )}
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-sm font-normal text-gray-500">
                        {s.lines.length} product(s) · est. {formatCurrency(estCost)} ·{" "}
                        {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                      {s.status === "PENDING" && (
                        <>
                          <Button
                            onClick={() => handleApprove(s)}
                            disabled={busyId === s.id || !s.supplierId}
                            title={!s.supplierId ? "No supplier assigned — cannot approve" : "Approve and create the purchase order"}
                            className="bg-green-600 hover:bg-green-700 text-white"
                          >
                            {busyId === s.id ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                            )}
                            Approve &amp; order
                          </Button>
                          <Button variant="outline" onClick={() => handleReject(s)} disabled={busyId === s.id}>
                            <XCircle className="w-4 h-4 mr-2" />
                            Reject
                          </Button>
                        </>
                      )}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 px-3 font-medium text-gray-600">Product</th>
                          <th className="text-left py-2 px-3 font-medium text-gray-600">Reason</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Sellable Stock</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Expiring ≤30d</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Last Cost</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Suggested Qty</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Est. Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.lines.map((line) => (
                          <tr key={line.id} className="border-b border-gray-100">
                            <td className="py-2 px-3 font-medium text-gray-900">
                              {line.product.name}
                              <span className="text-gray-500 font-normal"> ({line.product.sku})</span>
                              {line.note && (
                                <div className="text-xs text-gray-500 font-normal">{line.note}</div>
                              )}
                            </td>
                            <td className="py-2 px-3">{reasonLabel[line.reason] || line.reason}</td>
                            <td className="py-2 px-3 text-right text-red-600 font-medium">{line.sellableStock}</td>
                            <td className="py-2 px-3 text-right">{line.expiringStock > 0 ? line.expiringStock : "—"}</td>
                            <td className="py-2 px-3 text-right">
                              {line.unitCost != null ? formatCurrency(line.unitCost) : "—"}
                            </td>
                            <td className="py-2 px-3 text-right font-medium">{line.suggestedQty}</td>
                            <td className="py-2 px-3 text-right">
                              {line.unitCost != null ? formatCurrency(line.unitCost * line.suggestedQty) : "—"}
                            </td>
                          </tr>
                        ))}
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

export default PurchaseSuggestions;
