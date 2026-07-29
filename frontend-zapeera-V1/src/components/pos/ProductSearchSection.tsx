import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, ScanSearch } from 'lucide-react';
import { cn } from '@/lib/utils';
import ProductCard from './ProductCard';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  unitType: string;
  requiresPrescription?: boolean;
  unitsPerPack?: number;
  unitsPerBox?: number;
}

interface Batch {
  id: string;
  batchNo: string;
  quantity: number;
  sellingPrice: number;
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
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center sm:py-12">
      <div
        className="mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-gradient-to-br from-[#1a52c5]/12 to-[#28c2ce]/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
        aria-hidden
      >
        <Icon className="h-8 w-8 text-[#1a52c5]/75" strokeWidth={1.75} />
      </div>
      <p className="text-[15px] font-semibold tracking-tight text-[#0a1128]">{title}</p>
      <p className="mt-1.5 max-w-[260px] text-sm leading-relaxed text-[#8c95b0]">{subtitle}</p>
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
  layout = 'default',
  className,
}) => {
  const isSplit = layout === 'split';

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
            <ScanSearch className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-bold tracking-tight text-[#0a1128]">
              Search &amp; add products
            </h3>
            <p className="mt-0.5 text-sm text-[#8c95b0]">
              Find items by name, barcode, or SKU
            </p>
          </div>
        </div>

        <div className="relative mb-4 shrink-0">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8c95b0]"
            strokeWidth={2}
          />
          <Input
            placeholder="Search for products…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={requiresBranchSelection}
            className={cn(
              'h-12 rounded-[12px] border-[rgba(15,23,60,0.1)] bg-[#f4f6fa] pl-11 text-[15px] text-[#0a1128] placeholder:text-[#8c95b0]/80',
              'transition-[border-color,box-shadow] focus-visible:border-[#1a52c5]/35 focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-[#1a52c5]/15',
            )}
          />
        </div>

        <div
          className={cn(
            'space-y-2 overflow-y-auto rounded-[14px] border border-[rgba(15,23,60,0.07)] bg-gradient-to-b from-[#fcfdff] to-[#f4f6fa] p-3 sm:p-4',
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
              const batches = productBatches[product.id] || [];
              const selectedBatch = getSelectedBatch(product.id);
              const isLoadingBatch = !!loadingBatches[product.id] && batches.length === 0;

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
            <ListPlaceholder
              icon={Search}
              title="Start typing to search"
              subtitle="Medicines appear here as you type. Use barcode or SKU for quick lookup."
            />
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
