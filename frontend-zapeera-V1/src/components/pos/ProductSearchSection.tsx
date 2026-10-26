import React, { useRef, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, ScanBarcode, Building2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import ProductCard from './ProductCard';
import PosProductCard from './PosProductCard';
import { BurstTracker } from '@/lib/barcode-scan';
import { Kbd } from '@/components/ui/kbd';
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
  /**
   * A burst of machine-speed keystrokes ending in Enter (a wedge
   * scan typed into this input) is reported here; the parent owns
   * resolution + cart add. The parent's global wedge listener
   * normally consumes scans in the capture phase first — this path
   * covers the surfaces where that listener is suspended.
   */
  onScanSubmit?: (barcode: string) => void;
  /** Barcode scanning switch for this business (default true). */
  scanningEnabled?: boolean;
  /** Hide the strip-selling option on product cards (L-10 fix, 2026-10-26):
   *  strip selling only applies to product-selling business types.
   *  Defaults to shown, so existing usages are unaffected. */
  showStripOption?: boolean;
  /** Use on full-width split layouts so the list grows with the column */
  layout?: 'default' | 'split';
  className?: string;
  // POS redesign (split layout only): the business's real product
  // categories as filter pills above the grid.
  categories?: Array<{ id: string; name: string }>;
  activeCategoryId?: string | null;
  onSelectCategory?: (categoryId: string | null) => void;
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
  onScanSubmit,
  scanningEnabled = true,
  showStripOption = true,
  layout = 'default',
  className,
  categories,
  activeCategoryId,
  onSelectCategory,
}) => {
  const isSplit = layout === 'split';
  const inputRef = useRef<HTMLInputElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  // Pills fade (2026-10-26): at rest the last pill was half-cut at the
  // viewport edge. The row scrolls; a fade on the right edge marks the
  // cut as scroll affordance, and it lifts at max scroll so the last
  // pill (with its pr-4 end padding) lands crisp and fully visible.
  const [pillsCanScrollRight, setPillsCanScrollRight] = useState(false);
  const updatePillsFade = () => {
    const el = pillsRef.current;
    if (!el) return;
    setPillsCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  };
  useEffect(updatePillsFade, [categories]);
  const burstTrackerRef = useRef<BurstTracker | null>(null);
  if (!burstTrackerRef.current) {
    burstTrackerRef.current = new BurstTracker();
  }

  // Keyboard navigation of search results (revised map, 2026-10-26):
  // ↑/↓ move a highlighted row; Enter adds the highlighted product
  // instead of always the first. The ring only shows while a query
  // is typed (in browse mode Enter does nothing).
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery]);
  const resultCount = filteredProducts.length;
  useEffect(() => {
    setHighlightedIndex((i) => Math.min(i, Math.max(0, resultCount - 1)));
  }, [resultCount]);

  // Auto-focus the search input
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Barcode input discipline: only a machine-speed burst ending in
  // Enter counts as a scan (BurstTracker). The previous handler ran a
  // lookup for ANY long word typed here and claimed "added to cart"
  // through callbacks the POS never wired — both are gone; the
  // parent resolves scans and reports the truth.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const tracker = burstTrackerRef.current!;
    const now = e.timeStamp || performance.now();

    if (e.key === 'Enter') {
      // Ctrl+Enter belongs to the register (Proceed to Payment), not
      // to the search box — let it bubble to the POS listener.
      if (e.ctrlKey || e.metaKey) {
        return;
      }
      const code = tracker.pushEnter(now);
      if (code && scanningEnabled && onScanSubmit) {
        e.preventDefault();
        onScanSubmit(code);
        return;
      }
      // Plain Enter (typed query, not a scanner burst): add the
      // HIGHLIGHTED product — the keyboard path to a sale without
      // the mouse. The query is cleared so the next item can be
      // typed straight away.
      if (searchQuery.trim() && filteredProducts.length > 0) {
        e.preventDefault();
        const idx = Math.min(highlightedIndex, filteredProducts.length - 1);
        const target = filteredProducts[Math.max(0, idx)];
        onAddToCart(target, 1, target.unitType);
        onSearchChange('');
      }
      return;
    }
    // ↑/↓ navigate the search results (revised map). preventDefault
    // keeps the text cursor from moving inside the input.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (filteredProducts.length === 0) return;
      e.preventDefault();
      setHighlightedIndex((i) =>
        e.key === 'ArrowDown'
          ? Math.min(i + 1, filteredProducts.length - 1)
          : Math.max(i - 1, 0),
      );
      return;
    }
    if (e.key === 'Escape') {
      tracker.invalidate();
      if (searchQuery) {
        onSearchChange('');
      } else {
        inputRef.current?.blur();
      }
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      tracker.pushChar(e.key, now);
    } else if (!['Shift', 'CapsLock', 'Alt', 'Control', 'Meta'].includes(e.key)) {
      tracker.invalidate();
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
          isSplit && 'flex min-h-0 min-w-0 flex-1 flex-col',
        )}
      >
        {!isSplit && (
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
        )}

        <div className="relative mb-4 shrink-0">
          <ScanBarcode
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8c95b0]"
            strokeWidth={2}
          />
          <Input
            ref={inputRef}
            id={isSplit ? 'pos-search-input' : undefined}
            placeholder={isSplit ? 'Search by brand, generic, or category…' : 'Scan barcode or search products...'}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={requiresBranchSelection}
            autoFocus
            className={cn(
              'border-[rgba(15,23,60,0.1)] bg-[#f4f6fa] pl-11 text-[#0a1128] placeholder:text-[#8c95b0]/80 font-mono',
              'transition-[border-color,box-shadow] focus-visible:border-[#1a52c5]/35 focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-[#1a52c5]/15',
              isSplit ? 'h-14 rounded-2xl pr-14 text-[15px]' : 'h-[52px] rounded-[12px] pr-11 text-[15px]',
            )}
          />
          {/* "Enter ↵" hint (2026-10-26): hidden below sm — at 360px the
              placeholder measured 653px against 192px of visible width,
              so the hint sat on top of it ("gEnter"). The hint returns
              at sm+ where pr-14 keeps it clear of the text. */}
          {isSplit && searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-[#8c95b0] transition-colors hover:bg-[#eef1f7] hover:text-[#0a1128]"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <div className="absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 text-xs text-[#8c95b0] sm:flex">
              <Kbd>F2</Kbd>
              Enter ↵
            </div>
          )}
        </div>

        {/* Category pills (split layout): the business's real product
            categories; "All Products" clears the filter. */}
        {isSplit && categories && categories.length > 0 && (
          <div
            ref={pillsRef}
            onScroll={updatePillsFade}
            style={pillsCanScrollRight ? { maskImage: 'linear-gradient(to right, black 88%, transparent 99%)', WebkitMaskImage: 'linear-gradient(to right, black 88%, transparent 99%)' } : undefined}
            className="mb-4 flex shrink-0 snap-x snap-proximity items-center gap-2 overflow-x-auto pb-1 pr-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group" aria-label="Filter by category">
            <button
              type="button"
              onClick={() => onSelectCategory?.(null)}
              aria-pressed={!activeCategoryId}
              className={cn(
                'snap-start whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-semibold transition-all',
                !activeCategoryId
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-[#eef1f7] text-[#4a5578] hover:bg-[#e2e8f4]',
              )}
            >
              All Products
            </button>
            {categories.map((category) => {
              const isActive = activeCategoryId === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => onSelectCategory?.(isActive ? null : category.id)}
                  aria-pressed={isActive}
                  className={cn(
                    'snap-start whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-semibold transition-all',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-[#eef1f7] text-[#4a5578] hover:bg-[#e2e8f4]',
                  )}
                >
                  {category.name}
                </button>
              );
            })}
          </div>
        )}

        <div
          className={cn(
            'overflow-y-auto p-0.5',
            isSplit
              ? 'grid min-h-0 min-w-0 flex-1 grid-cols-1 content-start gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
              : 'max-h-80 space-y-3',
          )}
        >
          {isLoading ? (
            <div className="col-span-full flex flex-col items-center justify-center py-12 text-[#8c95b0]">
              <div
                className="mb-3 h-10 w-10 animate-spin rounded-full border-2 border-[rgba(26,82,197,0.15)] border-t-[#1a52c5]"
                aria-hidden
              />
              <p className="text-sm font-medium text-[#4a5578]">Loading products…</p>
            </div>
          ) : requiresBranchSelection ? (
            <div className="col-span-full">
              <ListPlaceholder
                icon={Building2}
                title="Select a branch to start"
                subtitle="Choose the branch above — products and stock for that branch will appear here."
              />
            </div>
          ) : Array.isArray(filteredProducts) && filteredProducts.length > 0 ? (
            filteredProducts.map((product, index) => {
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

              const sharedProps = {
                product,
                batches,
                selectedBatch,
                isLoadingBatch,
                requiresBranchSelection,
                onSelectBatch: (batchId: string) => onSelectBatch(product.id, batchId),
                variants,
                selectedVariant,
                hasBaseStock,
                showStripOption,
                onSelectVariant: onSelectVariant ? (variantId: string | null) => onSelectVariant(product.id, variantId) : undefined,
              };

              const highlighted =
                searchQuery.trim() !== '' && index === highlightedIndex;
              const card = isSplit ? (
                <PosProductCard
                  {...sharedProps}
                  onAddToCart={(quantity, unitType) => onAddToCart(product, quantity, unitType)}
                />
              ) : (
                <ProductCard
                  {...sharedProps}
                  onAddToCart={(quantity, unitType) => onAddToCart(product, quantity, unitType)}
                />
              );
              return (
                <div
                  key={product.id}
                  className={
                    highlighted
                      ? 'rounded-2xl ring-2 ring-[#1a52c5] ring-offset-1'
                      : undefined
                  }
                >
                  {card}
                </div>
              );
            })
          ) : searchQuery.trim() ? (
            <div className="col-span-full">
              <ListPlaceholder
                icon={Search}
                title="No products found"
                subtitle="Try another keyword or check spelling."
              />
            </div>
          ) : activeCategoryId ? (
            <div className="col-span-full">
              <ListPlaceholder
                icon={Search}
                title="No products in this category"
                subtitle="Nothing in the loaded catalog matches this category. Try All Products or a search."
              />
            </div>
          ) : isSplit ? (
            <div className="col-span-full">
              <ListPlaceholder
                icon={ScanBarcode}
                title="No products to show"
                subtitle="Products stocked at this branch will appear here. Scan a barcode or search by name, barcode, or SKU."
              />
            </div>
          ) : (
            <ListPlaceholder
              icon={ScanBarcode}
              title="Ready to scan"
              subtitle="Point your barcode scanner at a product, or type to search by name, barcode, or SKU."
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ProductSearchSection;
