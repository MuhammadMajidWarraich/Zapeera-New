import React, { useRef, useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, ScanBarcode, Loader2, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import ProductCard from './ProductCard';
import { apiService } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type { ProductVariantLite } from '@/utils/variants';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  unitType: string;
  requiresPrescription?: boolean;
  unitsPerPack?: number;
  unitsPerBox?: number;
  // Product variants (Wave C6): the ACTIVE variant matrix.
  variants?: ProductVariantLite[];
}

interface Batch {
  id: string;
  batchNo: string;
  quantity: number;
  sellingPrice: number;
  variantId?: string | null;
  unitsPerBox?: number;
  totalBoxes?: number;
  expireDate?: string;
  expiryStatus?: 'GOOD' | 'WARNING' | 'CRITICAL' | 'EXPIRED';
  daysUntilExpiry?: number;
}

interface ProductSearchSectionProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filteredProducts: Product[];
  isLoading: boolean;
  productBatches: Record<string, Batch[]>;
  selectedBatches: Record<string, string>;
  loadingBatches: Record<string, boolean>;
  requiresBranchSelection: boolean;
  getSelectedBatch: (productId: string) => Batch | null;
  onSelectBatch: (productId: string, batchId: string) => void;
  onAddToCart: (product: Product, quantity: number, unitType: string) => void;
  // Product variants (Wave C6, main rail only): the batches to
  // DISPLAY for a product (its selected variant's pool), the
  // effective variant id per product, and the chip callback. The
  // modal rail omits all three and keeps the legacy display.
  getBatchesForProduct?: (productId: string) => Batch[];
  getEffectiveVariantId?: (product: Product) => string | null;
  onSelectVariant?: (productId: string, variantId: string | null) => void;
  /** Callback when a barcode is scanned and not found */
  onUnknownBarcode?: (barcode: string) => void;
  /** Callback when a barcode is found - adds product directly */
  onBarcodeFound?: (product: any, batch?: any) => void;
  /** Use on full-width split layouts so the list grows with the column */
  layout?: 'default' | 'split';
  className?: string;
}

const zapeeraCard =
  'relative overflow-hidden rounded-[20px] border border-[rgba(15,23,60,0.08)] bg-white shadow-[0_2px_16px_rgba(15,23,60,0.04)]';

function ListPlaceholder({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Search;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
      <div
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1a52c5]/12 to-[#28c2ce]/10"
        aria-hidden
      >
        <Icon className="h-6 w-6 text-[#1a52c5]/75" strokeWidth={1.75} />
      </div>
      <p className="text-sm font-semibold tracking-tight text-[#0a1128]">{title}</p>
      <p className="mt-1 max-w-[300px] text-[13px] leading-relaxed text-[#8c95b0]">{subtitle}</p>
    </div>
  );
}

const ProductSearchSection: React.FC<ProductSearchSectionProps> = ({
  searchQuery,
  onSearchChange,
  filteredProducts,
  isLoading,
  productBatches,
  selectedBatches,
  loadingBatches,
  requiresBranchSelection,
  getSelectedBatch,
  onSelectBatch,
  onAddToCart,
  getBatchesForProduct,
  getEffectiveVariantId,
  onSelectVariant,
  onUnknownBarcode,
  onBarcodeFound,
  layout = 'default',
  className,
}) => {
  const isSplit = layout === 'split';
  const inputRef = useRef<HTMLInputElement>(null);
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const [isLookingUp, setIsLookingUp] = useState(false);

  // Auto-focus the search input
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Handle barcode scanner input (Enter key triggers lookup)
  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = Date.now();
    const timeSinceLastKey = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;

    // If typing slowly, clear scanner buffer (user input, not scanner)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (timeSinceLastKey > 200) {
        bufferRef.current = '';
      }
      bufferRef.current += e.key;
    }

    // Enter key = submit barcode scan
    if (e.key === 'Enter') {
      e.preventDefault();
      const barcode = bufferRef.current.trim();
      bufferRef.current = '';

      if (!barcode) return;

      // Check if it looks like a barcode (mostly digits, or matches known formats)
      const isBarcodeLike = /^\d{8,14}$/.test(barcode) || /^[A-Z]{2,4}\d{4,}$/.test(barcode);

      if (isBarcodeLike || barcode.length > 6) {
        // Likely a barcode scan - do a lookup
        setIsLookingUp(true);
        try {
          const response = await apiService.lookupBarcode(barcode);
          if (response.success && response.data?.product) {
            onBarcodeFound?.(response.data.product, response.data.batch);
            onSearchChange('');
            toast({ title: 'Product found', description: `${response.data.product.name} added to cart` });
          } else {
            onUnknownBarcode?.(barcode);
          }
        } catch {
          onUnknownBarcode?.(barcode);
        } finally {
          setIsLookingUp(false);
        }
      }
    }
  };

  return (
    <Card
      className={cn(
        zapeeraCard,
        isSplit && 'flex min-h-0 flex-1 flex-col',
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.65]"
        style={{
          background:
            'radial-gradient(circle at 92% 8%, rgba(26,82,197,0.06) 0%, transparent 42%), radial-gradient(circle at 8% 88%, rgba(40,194,206,0.05) 0%, transparent 45%)',
        }}
        aria-hidden
      />
      <CardContent
        className={cn(
          'relative z-[1] p-5 sm:p-6',
          isSplit && 'flex min-h-0 flex-1 flex-col',
        )}
      >
        <div className="mb-4 flex shrink-0 items-start gap-3 sm:items-center">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-[#1a52c5]/14 to-[#28c2ce]/12">
            <ScanBarcode className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-bold tracking-tight text-[#0a1128]">
              Scan or Search
            </h3>
            <p className="mt-0.5 text-sm text-[#8c95b0]">
              Scan barcode or type to search by name, barcode, or SKU
            </p>
          </div>
        </div>

        <div className="relative mb-4 shrink-0">
          {isLookingUp ? (
            <Loader2 className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 animate-spin text-[#1a52c5]" />
          ) : (
            <ScanBarcode
              className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8c95b0]"
              strokeWidth={2}
            />
          )}
          <Input
            ref={inputRef}
            placeholder="Scan barcode or search products..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={requiresBranchSelection || isLookingUp}
            autoFocus
            className={cn(
              'h-[52px] rounded-[12px] border-[rgba(15,23,60,0.1)] bg-[#f4f6fa] pl-11 pr-11 text-[15px] text-[#0a1128] placeholder:text-[#8c95b0]/80 font-mono',
              'transition-[border-color,box-shadow] focus-visible:border-[#1a52c5]/35 focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-[#1a52c5]/15',
            )}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8c95b0]">
            Enter ↵
          </div>
        </div>

        <div
          className={cn(
            'space-y-3 overflow-y-auto p-0.5',
            isSplit ? 'min-h-0 flex-1' : 'max-h-80',
          )}
        >
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#8c95b0]">
              <div
                className="mb-3 h-10 w-10 animate-spin rounded-full border-2 border-[rgba(26,82,197,0.15)] border-t-[#1a52c5]"
                aria-hidden
              />
              <p className="text-sm font-medium text-[#4a5578]">Loading products…</p>
            </div>
          ) : searchQuery.trim() && Array.isArray(filteredProducts) && filteredProducts.length > 0 ? (
            filteredProducts.map((product) => {
              const allBatches = productBatches[product.id] || [];
              const batches = getBatchesForProduct ? getBatchesForProduct(product.id) : allBatches;
              const selectedBatch = getSelectedBatch(product.id);
              const isLoadingBatch = !!loadingBatches[product.id] && batches.length === 0;
              const variants = product.variants || [];
              const effectiveVariantId = getEffectiveVariantId ? getEffectiveVariantId(product) : null;
              const selectedVariant = variants.find(v => v.id === effectiveVariantId) || null;
              // The "Standard" (base pool) chip only makes sense
              // when base stock actually exists for this product.
              const hasBaseStock = variants.length > 0 && allBatches.some(b => !b.variantId && b.quantity > 0);

              return (
                <ProductCard
                  key={product.id}
                  product={product}
                  batches={batches}
                  selectedBatch={selectedBatch}
                  isLoadingBatch={isLoadingBatch}
                  requiresBranchSelection={requiresBranchSelection}
                  onSelectBatch={(batchId) => onSelectBatch(product.id, batchId)}
                  onAddToCart={(quantity, unitType) => onAddToCart(product, quantity, unitType)}
                  variants={variants}
                  selectedVariant={selectedVariant}
                  hasBaseStock={hasBaseStock}
                  onSelectVariant={onSelectVariant ? (variantId) => onSelectVariant(product.id, variantId) : undefined}
                />
              );
            })
          ) : searchQuery.trim() ? (
            <ListPlaceholder
              icon={Search}
              title="No products found"
              subtitle="Try another keyword or check spelling."
            />
          ) : !searchQuery.trim() ? (
            requiresBranchSelection ? (
              <ListPlaceholder
                icon={Building2}
                title="Select a branch to start"
                subtitle="Choose the branch above — products and stock for that branch will appear here."
              />
            ) : (
              <ListPlaceholder
                icon={ScanBarcode}
                title="Ready to scan"
                subtitle="Point your barcode scanner at a product, or type to search by name, barcode, or SKU."
              />
            )
          ) : (
            <ListPlaceholder
              icon={Search}
              title="No products found"
              subtitle="Try a different search term."
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ProductSearchSection;
