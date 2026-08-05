/**
 * UnknownBarcodeDialog - Shown when POS scans an unknown barcode
 * Options: Search, Create Product, Cancel
 */

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { BarcodePreview } from './BarcodePreview';
import { apiService } from '../../services/api';
import { toast } from 'sonner';
import { Search, Plus, X, ScanBarcode } from 'lucide-react';

interface UnknownBarcodeDialogProps {
  open: boolean;
  onClose: () => void;
  barcode: string;
  onSearch?: (query: string) => void;
  onCreate?: (barcode: string) => void;
  onSelectProduct?: (product: any) => void;
}

export function UnknownBarcodeDialog({
  open,
  onClose,
  barcode,
  onSearch,
  onCreate,
  onSelectProduct,
}: UnknownBarcodeDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const response = await apiService.getProducts({
        search: searchQuery.trim(),
        limit: 10,
      });

      if (response.success && response.data) {
        setSearchResults(response.data);
      }
    } catch (error) {
      toast.error('Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAssign = () => {
    if (selectedProduct && onSelectProduct) {
      onSelectProduct(selectedProduct);
      onClose();
    }
  };

  const handleCreate = () => {
    if (onCreate) {
      onCreate(barcode);
      onClose();
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSearch) {
      onSearch(searchQuery);
      onClose();
    } else {
      handleSearch();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5" />
            Unknown Barcode
          </DialogTitle>
          <DialogDescription>
            The barcode "{barcode}" was not found in your inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scanned barcode preview */}
          <div className="flex justify-center p-4 bg-muted/30 rounded-lg">
            <BarcodePreview value={barcode} height={50} />
          </div>

          {/* Search existing products */}
          <div className="space-y-2">
            <Label>Search Existing Products</Label>
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, SKU, or barcode..."
                className="flex-1"
              />
              <Button type="submit" variant="outline" disabled={isSearching}>
                <Search className="h-4 w-4" />
              </Button>
            </form>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              <Label>Select a Product to Assign Barcode</Label>
              {searchResults.map((product) => (
                <div
                  key={product.id}
                  className={`p-2 border rounded-lg cursor-pointer transition-colors ${
                    selectedProduct?.id === product.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedProduct(product)}
                >
                  <div className="font-medium text-sm">{product.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {product.sku && `SKU: ${product.sku}`}
                    {product.barcode && ` | Barcode: ${product.barcode}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>

          {selectedProduct && (
            <Button onClick={handleAssign} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              Assign to {selectedProduct.name}
            </Button>
          )}

          <Button onClick={handleCreate} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Create New Product
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default UnknownBarcodeDialog;
