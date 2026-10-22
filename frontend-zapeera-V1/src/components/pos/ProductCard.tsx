import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Package, Plus, Minus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import BatchSelectionTable from './BatchSelectionTable';
import { breakdownStock, isStructured, levelPriceFromUnitPrice } from '@/utils/units';
import { variantUnitPrice, type ProductVariantLite } from '@/utils/variants';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  unitType: string;
  requiresPrescription?: boolean;
  unitsPerPack?: number;
  unitsPerBox?: number;
  unitsPerStrip?: number | null; // Wave C2 - tablets per strip
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

interface ProductCardProps {
  product: Product;
  batches: Batch[];
  selectedBatch: Batch | null;
  isLoadingBatch: boolean;
  requiresBranchSelection: boolean;
  onSelectBatch: (batchId: string) => void;
  onAddToCart: (quantity: number, unitType: string) => void;
  // Product variants (Wave C6): the ACTIVE matrix + the variant
  // currently chosen on this card. `batches` is already the chosen
  // variant's pool (the parent filters); the chips only switch the
  // selection. hasBaseStock offers the "Standard" base-pool chip.
  variants?: ProductVariantLite[];
  selectedVariant?: ProductVariantLite | null;
  hasBaseStock?: boolean;
  onSelectVariant?: (variantId: string | null) => void;
}

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  batches,
  selectedBatch,
  isLoadingBatch,
  requiresBranchSelection,
  onSelectBatch,
  onAddToCart,
  variants,
  selectedVariant,
  hasBaseStock,
  onSelectVariant,
}) => {
  const [selectedUnitType, setSelectedUnitType] = useState<string>('unit');
  const [quantity, setQuantity] = useState<number>(1);

  const computedUnitsFromBatch =
    selectedBatch?.totalBoxes && selectedBatch?.quantity
      ? Math.round(selectedBatch.quantity / selectedBatch.totalBoxes)
      : 0;
  const unitsPerBox =
    selectedBatch?.unitsPerBox ||
    product.unitsPerBox ||
    product.unitsPerPack ||
    computedUnitsFromBatch ||
    1;
  // Wave C2: pack structure for strip selling + stock breakdowns.
  const structure = { unitsPerPack: unitsPerBox, unitsPerStrip: product.unitsPerStrip ?? null };
  const unitsPerStrip = product.unitsPerStrip && product.unitsPerStrip > 1 ? product.unitsPerStrip : null;
  const maxQuantity =
    selectedUnitType === 'box'
      ? Math.max(1, Math.floor((selectedBatch?.quantity || product.stock) / unitsPerBox))
      : selectedUnitType === 'strip' && unitsPerStrip
        ? Math.max(1, Math.floor((selectedBatch?.quantity || product.stock) / unitsPerStrip))
        : selectedBatch?.quantity || product.stock;

  const handleAddClick = (unitType: string) => {
    if (quantity > 0) {
      onAddToCart(quantity, unitType);
      setQuantity(1);
    }
  };

  // Product variants (Wave C6): the displayed unit price is the
  // selected batch's price + the chosen variant's delta.
  const displayUnitPrice = selectedBatch
    ? variantUnitPrice(Number(selectedBatch.sellingPrice || 0), selectedVariant?.priceDelta)
    : 0;
  const variantList = variants || [];

  const addDisabled = batches.length === 0 || isLoadingBatch || !selectedBatch;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[18px] border border-[rgba(15,23,60,0.08)] bg-white',
        'shadow-[0_2px_14px_rgba(15,23,60,0.05)]',
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          background:
            'radial-gradient(circle at 100% 0%, rgba(26,82,197,0.05) 0%, transparent 45%), radial-gradient(circle at 0% 100%, rgba(40,194,206,0.04) 0%, transparent 42%)',
        }}
        aria-hidden
      />
      <div className="relative z-[1] space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-[#1a52c5]/14 to-[#28c2ce]/12">
              <Package className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-[17px] font-bold leading-snug tracking-tight text-[#0a1128]">
                  {product.name}
                </h4>
                {product.requiresPrescription && (
                  <Badge
                    variant="outline"
                    className="rounded-lg border-amber-200/90 bg-amber-50/80 text-[10px] font-bold uppercase tracking-wide text-amber-800"
                  >
                    Rx
                  </Badge>
                )}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-[#8c95b0]">
                <span className="font-medium text-[#4a5578]">
                  Stock: {selectedBatch?.quantity ?? product.stock} units
                  {isStructured(structure) ? (
                    <span className="text-[#8c95b0]"> ({breakdownStock(selectedBatch?.quantity ?? product.stock, structure).text})</span>
                  ) : null}
                </span>
                {selectedBatch?.expireDate && (
                  <span
                    className={cn(
                      'ml-1 inline-flex items-center rounded-full px-2 py-px text-[11px] font-bold',
                      selectedBatch.expiryStatus === 'CRITICAL'
                        ? 'bg-red-500/10 text-red-600'
                        : selectedBatch.expiryStatus === 'WARNING'
                          ? 'bg-amber-500/10 text-amber-600'
                          : 'bg-slate-500/10 text-slate-500',
                    )}
                  >
                    Exp {new Date(selectedBatch.expireDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    {selectedBatch.daysUntilExpiry !== undefined && selectedBatch.daysUntilExpiry <= 30
                      ? ` • ${selectedBatch.daysUntilExpiry}d left`
                      : ''}
                  </span>
                )}
                {unitsPerBox > 1 ? (
                  <>
                    <span className="mx-1.5 text-[rgba(15,23,60,0.15)]">|</span>
                    <span>Box: {unitsPerBox} units</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 sm:items-center lg:shrink-0">
            {selectedBatch && (
              <div className="mr-1 text-right">
                <p className="text-[17px] font-extrabold leading-tight tabular-nums text-[#0a1128]">
                  PKR {displayUnitPrice.toFixed(2)}
                </p>
                <p className="text-[11px] font-medium leading-tight text-[#8c95b0]">
                  per unit{unitsPerBox > 1 ? ` • PKR ${(displayUnitPrice * unitsPerBox).toFixed(2)} / box` : ''}{unitsPerStrip ? ` • PKR ${levelPriceFromUnitPrice(displayUnitPrice, 'STRIP', structure).toFixed(2)} / strip` : ''}
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Label
                htmlFor={`qty-${product.id}`}
                className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-[#8c95b0]"
              >
                Qty
              </Label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-10 w-8 rounded-[10px] border-[rgba(15,23,60,0.1)] p-0 hover:bg-[#f4f6fa]"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  aria-label="Decrease quantity"
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <Input
                  id={`qty-${product.id}`}
                  type="number"
                  min={1}
                  max={maxQuantity}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(
                      Math.max(1, Math.min(maxQuantity, parseInt(e.target.value, 10) || 1)),
                    )
                  }
                  className="h-10 w-[3.75rem] rounded-[10px] border-[rgba(15,23,60,0.1)] bg-[#f4f6fa] text-center text-sm font-bold tabular-nums text-[#0a1128] focus-visible:border-[#1a52c5]/35 focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-[#1a52c5]/12"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-10 w-8 rounded-[10px] border-[rgba(15,23,60,0.1)] p-0 hover:bg-[#f4f6fa]"
                  onClick={() => setQuantity(Math.min(maxQuantity, quantity + 1))}
                  aria-label="Increase quantity"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div
              className="inline-flex rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-[#f4f6fa] p-1"
              role="group"
              aria-label="Sell by unit, strip or box"
            >
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  'h-8 rounded-[8px] px-3 text-xs font-semibold transition-all',
                  selectedUnitType === 'unit'
                    ? 'bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)] hover:text-white'
                    : 'text-[#4a5578] hover:bg-white/80 hover:text-[#0a1128]',
                )}
                onClick={() => setSelectedUnitType('unit')}
              >
                Unit
              </Button>
              {unitsPerStrip ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  title={`Sell by strip of ${unitsPerStrip} units`}
                  className={cn(
                    'h-8 rounded-[8px] px-3 text-xs font-semibold transition-all',
                    selectedUnitType === 'strip'
                      ? 'bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)] hover:text-white'
                      : 'text-[#4a5578] hover:bg-white/80 hover:text-[#0a1128]',
                  )}
                  onClick={() => setSelectedUnitType('strip')}
                >
                  Strip
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                title={
                  unitsPerBox <= 1
                    ? 'Box size not set; defaulting to 1 unit'
                    : 'Sell by box'
                }
                className={cn(
                  'h-8 rounded-[8px] px-3 text-xs font-semibold transition-all',
                  selectedUnitType === 'box'
                    ? 'bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)] hover:text-white'
                    : 'text-[#4a5578] hover:bg-white/80 hover:text-[#0a1128]',
                )}
                onClick={() => setSelectedUnitType('box')}
              >
                Box
              </Button>
            </div>

            <Button
              size="sm"
              className={cn(
                'h-10 gap-1.5 rounded-[10px] px-5 text-sm font-semibold shadow-[0_4px_14px_rgba(26,82,197,0.22)] transition-all',
                addDisabled
                  ? 'cursor-not-allowed bg-[#b8c5e0] text-white opacity-70 shadow-none hover:bg-[#b8c5e0]'
                  : 'bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white hover:-translate-y-0.5 hover:from-[#1746b0] hover:to-[#24b5c0] hover:shadow-[0_6px_20px_rgba(26,82,197,0.32)]',
              )}
              onClick={() => {
                if (addDisabled) return;
                handleAddClick(selectedUnitType);
              }}
              disabled={addDisabled}
            >
              {isLoadingBatch ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 stroke-[2.5]" aria-hidden />
                  Add
                </>
              )}
            </Button>
          </div>
        </div>

        {variantList.length > 0 && onSelectVariant && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Choose variant">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8c95b0]">Variant</span>
            {variantList.map((variant) => {
              const isChosen = selectedVariant?.id === variant.id;
              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => onSelectVariant(variant.id)}
                  aria-pressed={isChosen}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                    isChosen
                      ? 'border-transparent bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)]'
                      : 'border-[rgba(15,23,60,0.12)] bg-white text-[#4a5578] hover:border-[#1a52c5]/30',
                  )}
                >
                  {variant.name}
                  {variant.priceDelta ? (
                    <span className="ml-1 opacity-80">
                      {variant.priceDelta > 0 ? '+' : '−'}PKR {Math.abs(variant.priceDelta).toFixed(0)}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {hasBaseStock && (
              <button
                type="button"
                onClick={() => onSelectVariant(null)}
                aria-pressed={!selectedVariant}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                  !selectedVariant
                    ? 'border-transparent bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)]'
                    : 'border-[rgba(15,23,60,0.12)] bg-white text-[#4a5578] hover:border-[#1a52c5]/30',
                )}
              >
                Standard
              </button>
            )}
          </div>
        )}

        <BatchSelectionTable
          batches={batches}
          selectedBatchId={selectedBatch?.id}
          onSelectBatch={onSelectBatch}
          isLoading={isLoadingBatch}
          requiresBranchSelection={requiresBranchSelection}
        />
      </div>
    </div>
  );
};

export default ProductCard;
