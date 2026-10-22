/**
 * UnknownBarcodeDialog — shown when a POS scan finds no product.
 *
 * Offers the two honest ways forward:
 *  - Assign the scanned code to an existing product (as its primary
 *    barcode when it has none, otherwise appended to its additional
 *    barcodes) via the barcode API — then the caller re-resolves the
 *    code and the sale continues.
 *  - Create a new product with this barcode prefilled (the caller
 *    only passes `onCreateProduct` for roles that may create
 *    products, so the action is absent for cashiers).
 *
 * This component previously existed as dead code with no consumers
 * and a broken search-envelope read; it is now wired into the POS
 * scan flow.
 */

import React, { useEffect, useState } from 'react';
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
import { BarcodePreview } from './BarcodePreview';
import { apiService } from '../../services/api';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, ScanBarcode, Search, X } from 'lucide-react';

interface UnknownBarcodeDialogProps {
  open: boolean;
  onClose: () => void;
  barcode: string;
  /** Present only when the signed-in role may create products. */
  onCreateProduct?: (barcode: string) => void;
  /** Called after the code was assigned to an existing product. */
  onAssigned?: (product: any) => void;
}

export function UnknownBarcodeDialog({
  open,
  onClose,
  barcode,
  onCreateProduct,
  onAssigned,
}: UnknownBarcodeDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');

  useEffect(() => {
    if (open) {
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);
      setSelectedProduct(null);
      setAssignError('');
    }
  }, [open, barcode]);

  const handleSearch = async () => {
    const term = searchQuery.trim();
    if (!term) return;
    setIsSearching(true);
    setAssignError('');
    try {
      const response = await apiService.getProducts({ search: term, limit: 10 });
      const list = (response as any)?.data?.products ?? (response as any)?.data ?? [];
      setSearchResults(Array.isArray(list) ? list : []);
      setHasSearched(true);
    } catch {
      toast({
        title: 'Search failed',
        description: 'Could not search products. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedProduct) return;
    setIsAssigning(true);
    setAssignError('');
    try {
      const current = await apiService.getProductBarcodes(selectedProduct.id);
      const data = (current as any)?.data ?? {};
      const existingAdditional: string[] = Array.isArray(data.additionalBarcodes)
        ? data.additionalBarcodes
        : [];
      if (!data.barcode) {
        // No primary barcode yet — the scanned code becomes it.
        await apiService.updateProductBarcodes(selectedProduct.id, { barcode });
      } else if (data.barcode !== barcode && !existingAdditional.includes(barcode)) {
        await apiService.updateProductBarcodes(selectedProduct.id, {
          additionalBarcodes: [...existingAdditional, barcode],
        });
      }
      toast({
        title: 'Barcode assigned',
        description: `${barcode} now belongs to ${selectedProduct.name}.`,
      });
      onAssigned?.(selectedProduct);
      onClose();
    } catch (error: any) {
      setAssignError(
        error?.message ||
          'Could not assign this barcode. It may already belong to another product.'
      );
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5" />
            Unknown Barcode
          </DialogTitle>
          <DialogDescription>
            No product found for barcode <span className="font-mono font-semibold">{barcode}</span>.
            {onCreateProduct
              ? ' Assign it to an existing product, or create the product with this barcode.'
              : ' Assign it to an existing product.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-center rounded-lg bg-muted/30 p-4">
            <BarcodePreview value={barcode} height={50} showCopyButton={false} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unknown-barcode-search">Assign to an existing product</Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSearch();
              }}
            >
              <Input
                id="unknown-barcode-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, SKU, or barcode…"
                className="flex-1"
              />
              <Button type="submit" variant="outline" disabled={isSearching}>
                {isSearching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </form>
          </div>

          {hasSearched && searchResults.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No products match that search.
            </p>
          )}

          {searchResults.length > 0 && (
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {searchResults.map((product) => (
                <button
                  type="button"
                  key={product.id}
                  onClick={() => setSelectedProduct(product)}
                  className={`w-full rounded-lg border p-2 text-left transition-colors ${
                    selectedProduct?.id === product.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="text-sm font-medium">{product.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {product.sku ? `SKU: ${product.sku}` : ''}
                    {product.barcode ? ` · Barcode: ${product.barcode}` : ' · No barcode yet'}
                  </div>
                </button>
              ))}
            </div>
          )}

          {assignError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {assignError}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          {selectedProduct && (
            <Button onClick={handleAssign} disabled={isAssigning} className="w-full sm:w-auto">
              {isAssigning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Assign &amp; add to sale
            </Button>
          )}
          {onCreateProduct && (
            <Button
              variant={selectedProduct ? 'outline' : 'default'}
              onClick={() => {
                onCreateProduct(barcode);
                onClose();
              }}
              className="w-full sm:w-auto"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create new product
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default UnknownBarcodeDialog;
