import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Pill, Download, Loader2, CheckCircle2 } from "lucide-react";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Wave C3 — "Import from medicine catalog" dialog.
// Shows the curated DRAP-era starter catalog of common Pakistani-pharmacy
// medicines served by GET /products/master-catalog. Entries the business
// already stocks are disabled and marked; importing creates the selected
// products (generic/salt lands in the product's formula field) and
// reports created / skipped counts back from the server.

interface CatalogEntry {
  index: number;
  id: string;
  brandName: string;
  genericName: string;
  strength: string;
  form: string;
  packSize: number;
  unitsPerStrip: number | null;
  manufacturer: string;
  category: string;
  requiresPrescription: boolean;
  productName: string;
  alreadyExists: boolean;
}

interface MedicineCatalogImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

const MedicineCatalogImport: React.FC<MedicineCatalogImportProps> = ({
  open,
  onOpenChange,
  onImported,
}) => {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [rxFilter, setRxFilter] = useState("all"); // all | rx | otc
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    failed: number;
  } | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiService.getMedicineMasterCatalog();
      if (response.success && response.data) {
        setEntries(response.data.entries || []);
      } else {
        toast({
          title: "Failed to load catalog",
          description: response.message || "Could not load the medicine catalog.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Load medicine catalog error:", err);
      toast({
        title: "Failed to load catalog",
        description: "Could not load the medicine catalog.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setResult(null);
      setSelected(new Set());
      setSearch("");
      setCategoryFilter("all");
      setRxFilter("all");
      loadCatalog();
    }
  }, [open, loadCatalog]);

  const categories = useMemo(
    () => Array.from(new Set(entries.map((e) => e.category))).sort(),
    [entries]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (rxFilter === "rx" && !e.requiresPrescription) return false;
      if (rxFilter === "otc" && e.requiresPrescription) return false;
      if (!q) return true;
      return (
        e.brandName.toLowerCase().includes(q) ||
        e.genericName.toLowerCase().includes(q) ||
        e.manufacturer.toLowerCase().includes(q) ||
        e.productName.toLowerCase().includes(q)
      );
    });
  }, [entries, search, categoryFilter, rxFilter]);

  const selectableFiltered = useMemo(
    () => filtered.filter((e) => !e.alreadyExists),
    [filtered]
  );

  const allFilteredSelected =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((e) => selected.has(e.id));

  const toggleEntry = (entry: CatalogEntry, checked: boolean) => {
    if (entry.alreadyExists) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(entry.id);
      else next.delete(entry.id);
      return next;
    });
  };

  const toggleSelectAllFiltered = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      selectableFiltered.forEach((e) => {
        if (checked) next.add(e.id);
        else next.delete(e.id);
      });
      return next;
    });
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    try {
      setImporting(true);
      const response = await apiService.importMedicineMaster(
        Array.from(selected)
      );
      if (response.success && response.data) {
        const { created, skipped, failed } = response.data;
        setResult({
          created: created.length,
          skipped: skipped.length,
          failed: failed.length,
        });
        toast({
          title: "Import complete",
          description: `${created.length} medicines added, ${skipped.length} skipped (already in stock list), ${failed.length} failed.`,
        });
        // Refresh existence flags so imported rows become disabled.
        await loadCatalog();
        setSelected(new Set());
        if (created.length > 0 && onImported) onImported();
      } else {
        toast({
          title: "Import failed",
          description: response.message || "The catalog import did not complete.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Import medicine catalog error:", err);
      toast({
        title: "Import failed",
        description: "The catalog import did not complete.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Pill className="w-5 h-5 text-blue-600" />
            <span>Import from Medicine Catalog</span>
          </DialogTitle>
          <DialogDescription>
            Common medicines sold in Pakistani pharmacies. Select the ones you
            stock — products are created with their generic (salt), pack size
            and prescription flag. Items already in your product list are
            marked and cannot be imported twice.
          </DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search brand, generic (salt) or manufacturer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="md:w-48">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={rxFilter} onValueChange={setRxFilter}>
            <SelectTrigger className="md:w-40">
              <SelectValue placeholder="Rx / OTC" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Rx + OTC</SelectItem>
              <SelectItem value="rx">Prescription (Rx)</SelectItem>
              <SelectItem value="otc">OTC</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {result && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
            <CheckCircle2 className="w-4 h-4" />
            <span>
              Imported <strong>{result.created}</strong> medicines ·{" "}
              {result.skipped} skipped · {result.failed} failed. Set prices by
              receiving a purchase or adding batches.
            </span>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-y-auto border rounded-md">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <span className="ml-2 text-gray-600">Loading catalog...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              No medicines match the current filters.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="border-b">
                  <th className="py-2 px-3 w-10">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={(checked) =>
                        toggleSelectAllFiltered(checked === true)
                      }
                      aria-label="Select all filtered"
                    />
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Medicine</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Generic (Salt)</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Pack</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Manufacturer</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Category</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Type</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr
                    key={entry.id}
                    className={`border-b border-gray-100 ${
                      entry.alreadyExists ? "opacity-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="py-2 px-3">
                      <Checkbox
                        checked={selected.has(entry.id)}
                        disabled={entry.alreadyExists}
                        onCheckedChange={(checked) =>
                          toggleEntry(entry, checked === true)
                        }
                        aria-label={`Select ${entry.productName}`}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <span className="font-medium text-gray-900">
                        {entry.productName}
                      </span>
                      {entry.alreadyExists && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          In your products
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 px-3 text-gray-600">{entry.genericName}</td>
                    <td className="py-2 px-3 text-gray-600">
                      {entry.packSize}
                      {entry.unitsPerStrip
                        ? ` (${entry.unitsPerStrip}/strip)`
                        : ""}
                    </td>
                    <td className="py-2 px-3 text-gray-600">{entry.manufacturer}</td>
                    <td className="py-2 px-3">
                      <Badge variant="outline">{entry.category}</Badge>
                    </td>
                    <td className="py-2 px-3">
                      {entry.requiresPrescription ? (
                        <Badge variant="destructive" className="text-xs">Rx</Badge>
                      ) : (
                        <Badge variant="default" className="text-xs">OTC</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-gray-500">
            {filtered.length} shown · {selected.size} selected
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={importing}
            >
              Close
            </Button>
            <Button
              onClick={handleImport}
              disabled={importing || selected.size === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Import {selected.size > 0 ? `(${selected.size})` : ""} Medicines
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MedicineCatalogImport;
