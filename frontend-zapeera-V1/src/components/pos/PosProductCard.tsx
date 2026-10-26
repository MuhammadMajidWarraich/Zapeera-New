import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Minus, Loader2, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { breakdownStock, isStructured, levelPriceFromUnitPrice, KG_GRAMS_PER_KG, formatKgFromGrams, isWeightUnitType } from '@/utils/units';
import { variantUnitPrice, type ProductVariantLite } from '@/utils/variants';

// POS redesign (Muhammad's reference layout): compact catalog card for
// the register grid. The face of the card is the fast path — status
// badge, stock, name, formula, price and a one-tap add that sells the
// FEFO batch at the default level, exactly like the legacy card's Add.
// Everything the legacy row card offered (batch choice, variants,
// unit/strip/box levels, quantity) lives in the expandable details
// area, wired to the very same callbacks — no capability is lost.

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  unitType: string;
  formula?: string;
  requiresPrescription?: boolean;
  unitsPerPack?: number;
  unitsPerBox?: number;
  unitsPerStrip?: number | null;
  minStock?: number;
  reorderLevel?: number | null;
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

interface PosProductCardProps {
  product: Product;
  batches: Batch[];
  selectedBatch: Batch | null;
  isLoadingBatch: boolean;
  requiresBranchSelection: boolean;
  onSelectBatch: (batchId: string) => void;
  onAddToCart: (quantity: number, unitType: string) => void;
  // Loose / by-weight selling (Stage 1): the KG level button,
  // decimal KG qty and per-kg prices render only when the business
  // type allows weight selling (the parent gates on businessType).
  isWeightSellingAllowed?: boolean;
  variants?: ProductVariantLite[];
  selectedVariant?: ProductVariantLite | null;
  hasBaseStock?: boolean;
  onSelectVariant?: (variantId: string | null) => void;
  /** Hide the Strip sell-by button (L-10 fix, 2026-10-26). Defaults to shown. */
  showStripOption?: boolean;
}

const PosProductCard: React.FC<PosProductCardProps> = ({
  product,
  batches,
  selectedBatch,
  isLoadingBatch,
  requiresBranchSelection,
  onSelectBatch,
  onAddToCart,
  isWeightSellingAllowed,
  variants,
  selectedVariant,
  hasBaseStock,
  onSelectVariant,
  showStripOption = true,
}) => {
  // Loose / by-weight selling (Stage 1): a KG product sells by the
  // kilo only (the pack IS the kilo, 1000 g). The card is keyed by
  // product.id, so the lazy initial level is safe per product.
  const isWeight = isWeightSellingAllowed === true && isWeightUnitType(product.unitType);
  const [selectedUnitType, setSelectedUnitType] = useState<string>(() => (isWeight ? 'kg' : 'unit'));
  const [quantity, setQuantity] = useState<number>(1);
  const [expanded, setExpanded] = useState(false);

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
  const structure = { unitsPerPack: unitsPerBox, unitsPerStrip: product.unitsPerStrip ?? null, unitType: product.unitType };
  const unitsPerStrip = product.unitsPerStrip && product.unitsPerStrip > 1 ? product.unitsPerStrip : null;
  const stockOnHand = selectedBatch?.quantity ?? product.stock;
  const maxQuantity =
    isWeight
      ? Math.max(0.1, stockOnHand / KG_GRAMS_PER_KG)
      : selectedUnitType === 'box'
        ? Math.max(1, Math.floor((selectedBatch?.quantity || product.stock) / unitsPerBox))
        : selectedUnitType === 'strip' && unitsPerStrip
          ? Math.max(1, Math.floor((selectedBatch?.quantity || product.stock) / unitsPerStrip))
          : selectedBatch?.quantity || product.stock;

  const displayUnitPrice = selectedBatch
    ? variantUnitPrice(Number(selectedBatch.sellingPrice || 0), selectedVariant?.priceDelta)
    : 0;

  const addDisabled = batches.length === 0 || isLoadingBatch || !selectedBatch || stockOnHand <= 0;

  // Status badge: stock truth first (out / low), mirroring the
  // reference card's badge slot. Low = at or under the product's
  // reorder level (or min stock), falling back to 10 units.
  const lowThreshold = product.reorderLevel ?? (product.minStock && product.minStock > 1 ? product.minStock : 10);
  const stockBadge =
    stockOnHand <= 0
      ? { label: 'Out of Stock', cls: 'border-rose-200 bg-rose-50 text-rose-700' }
      : stockOnHand <= lowThreshold
        ? { label: 'Low Stock', cls: 'border-amber-200 bg-amber-50 text-amber-800' }
        : { label: 'In Stock', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' };

  const validBatches = batches.filter((batch) => {
    if (batch.expiryStatus === 'EXPIRED') return false;
    if (batch.daysUntilExpiry !== undefined && batch.daysUntilExpiry <= 0) return false;
    if (batch.expireDate && new Date(batch.expireDate) < new Date()) return false;
    return batch.quantity > 0;
  });

  const handleQuickAdd = () => {
    if (addDisabled) return;
    onAddToCart(quantity, selectedUnitType);
    // Loose / by-weight selling (Stage 1): a kilo add resets to
    // 1 kg (the card's quantity state is in kg for KG products).
    setQuantity(1);
  };

  return (
    <div
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.12)] bg-white p-3.5 shadow-[0_1px_4px_rgba(15,23,60,0.05)] transition-all',
        !addDisabled && 'cursor-pointer hover:border-primary/40 hover:shadow-[0_6px_20px_rgba(15,23,60,0.09)]',
      )}
      onClick={handleQuickAdd}
      role="button"
      aria-label={`Add ${product.name} to sale`}
    >
      {/* Badge row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold', stockBadge.cls)}>
            {stockBadge.label}
          </span>
          {product.requiresPrescription && (
            <Badge variant="outline" className="rounded-full border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-800">
              Rx Required
            </Badge>
          )}
        </div>
        <span className="shrink-0 font-mono text-[11px] font-semibold text-[#8c95b0]">
          Stock: {isWeight ? formatKgFromGrams(stockOnHand) : stockOnHand}
        </span>
      </div>

      {/* Name / formula / form chip */}
      <h4 className="mt-2 line-clamp-2 text-sm font-bold leading-snug text-[#0a1128] group-hover:text-primary">
        {product.name}
        {selectedVariant ? <span className="text-primary"> — {selectedVariant.name}</span> : null}
      </h4>
      {product.formula ? (
        <p className="mt-0.5 line-clamp-1 text-xs italic text-[#8c95b0]">{product.formula}</p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-md bg-[#f4f6fa] px-2 py-0.5 text-[11px] font-medium text-[#4a5578]">
          {isWeight ? 'kg' : (product.unitType || 'unit')}
          {!isWeight && unitsPerBox > 1 ? ` • Box of ${unitsPerBox}` : ''}
        </span>
        {selectedBatch?.expireDate && (
          <span
            className={cn(
              'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold',
              selectedBatch.expiryStatus === 'CRITICAL'
                ? 'bg-red-500/10 text-red-600'
                : selectedBatch.expiryStatus === 'WARNING'
                  ? 'bg-amber-500/10 text-amber-600'
                  : 'bg-[#f4f6fa] text-[#4a5578]',
            )}
          >
            Exp {new Date(selectedBatch.expireDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
          </span>
        )}
        {isStructured(structure) && stockOnHand > 0 ? (
          <span className="inline-flex items-center rounded-md bg-[#f4f6fa] px-2 py-0.5 text-[11px] font-medium text-[#4a5578]">
            {breakdownStock(stockOnHand, structure).text}
          </span>
        ) : null}
      </div>

      {/* Price + add */}
      <div className="mt-3 flex items-end justify-between gap-2 border-t border-[rgba(15,23,60,0.06)] pt-2.5">
        <div className="min-w-0">
          {selectedBatch ? (
            <>
              <p className="font-mono text-[15px] font-bold leading-tight tabular-nums text-[#0a1128]">
                PKR {isWeight ? (displayUnitPrice * KG_GRAMS_PER_KG).toFixed(2) : displayUnitPrice.toFixed(2)}
              </p>
              <p className="truncate text-[11px] leading-tight text-[#8c95b0]">
                {isWeight
                  ? `PKR ${(displayUnitPrice * KG_GRAMS_PER_KG).toFixed(2)} / kg`
                  : <>per unit{unitsPerBox > 1 ? ` • PKR ${(displayUnitPrice * unitsPerBox).toFixed(2)} / box` : ''}{unitsPerStrip ? ` • PKR ${levelPriceFromUnitPrice(displayUnitPrice, 'STRIP', structure).toFixed(2)} / strip` : ''}</>}
              </p>
            </>
          ) : (
            <p className="text-xs font-medium text-[#8c95b0]">{isLoadingBatch ? 'Loading batches…' : 'No batch available'}</p>
          )}
        </div>
        <span
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-full transition-all',
            addDisabled
              ? 'bg-[#eef1f7] text-[#b8c5e0]'
              : 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground',
          )}
          aria-hidden
        >
          {isLoadingBatch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 stroke-[2.5]" />}
        </span>
      </div>

      {/* Details toggle — batch / variant / level / quantity */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        aria-expanded={expanded}
        className="mt-2 inline-flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-[11px] font-bold text-primary hover:underline"
      >
        {expanded ? 'Hide options' : 'Batch, level & qty'}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="mt-2 min-w-0 space-y-3 border-t border-dashed border-[rgba(15,23,60,0.1)] pt-3" onClick={(e) => e.stopPropagation()}>
          {/* Variants */}
          {(variants || []).length > 0 && onSelectVariant && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Choose variant">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8c95b0]">Variant</span>
              {(variants || []).map((variant) => {
                const isChosen = selectedVariant?.id === variant.id;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => onSelectVariant(variant.id)}
                    aria-pressed={isChosen}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all',
                      isChosen
                        ? 'border-transparent bg-primary text-primary-foreground'
                        : 'border-[rgba(15,23,60,0.12)] bg-white text-[#4a5578] hover:border-primary/30',
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
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all',
                    !selectedVariant
                      ? 'border-transparent bg-primary text-primary-foreground'
                      : 'border-[rgba(15,23,60,0.12)] bg-white text-[#4a5578] hover:border-primary/30',
                  )}
                >
                  Standard
                </button>
              )}
            </div>
          )}

          {/* Batches (FEFO list — the selected batch defaults to the
              nearest expiry with stock, as before) */}
          {isLoadingBatch ? (
            <p className="flex items-center gap-2 text-xs font-medium text-[#4a5578]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Loading batches…
            </p>
          ) : validBatches.length > 0 ? (
            <div className="space-y-1" role="group" aria-label="Select batch">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8c95b0]">Batch (FEFO first)</p>
              {validBatches.map((batch) => {
                const isSelected = selectedBatch?.id === batch.id;
                return (
                  <button
                    key={batch.id}
                    type="button"
                    onClick={() => onSelectBatch(batch.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                      isSelected
                        ? 'border-primary/40 bg-primary/10'
                        : 'border-[rgba(15,23,60,0.08)] bg-[#f8f9fc] hover:border-primary/25',
                    )}
                  >
                    <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full border', isSelected ? 'border-transparent bg-primary text-primary-foreground' : 'border-[rgba(15,23,60,0.25)] text-transparent')}>
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="min-w-0 truncate font-bold text-[#0a1128]">{batch.batchNo}</span>
                    <span className="shrink-0 tabular-nums text-[#4a5578]">Qty {isWeight ? formatKgFromGrams(batch.quantity) : batch.quantity}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-[#4a5578]">
                      {batch.expireDate ? new Date(batch.expireDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                    </span>
                    <span className="shrink-0 font-bold tabular-nums text-[#0a1128]">PKR {isWeight ? (batch.sellingPrice * KG_GRAMS_PER_KG).toFixed(2) : batch.sellingPrice.toFixed(2)}{isWeight ? ' / kg' : ''}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-[rgba(15,23,60,0.12)] bg-[#f8f9fc] px-3 py-2 text-center text-xs font-medium text-[#8c95b0]">
              {requiresBranchSelection ? 'Select a branch first to load batches.' : 'No batches available for this product.'}
            </p>
          )}

          {/* Level + quantity + add */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-[#f4f6fa] p-1" role="group" aria-label="Sell by unit, strip or box">
              {isWeight ? (
                // Loose / by-weight selling (Stage 1): a kilo product
                // has one level only (KG).
                <button type="button" onClick={() => setSelectedUnitType('kg')} className={cn('h-7 rounded-[7px] px-2.5 text-[11px] font-semibold transition-all', selectedUnitType === 'kg' ? 'bg-primary text-primary-foreground shadow' : 'text-[#4a5578] hover:bg-white')}>
                  KG
                </button>
              ) : (
                <>
              <button type="button" onClick={() => setSelectedUnitType('unit')} className={cn('h-7 rounded-[7px] px-2.5 text-[11px] font-semibold transition-all', selectedUnitType === 'unit' ? 'bg-primary text-primary-foreground shadow' : 'text-[#4a5578] hover:bg-white')}>
                Unit
              </button>
              {unitsPerStrip && showStripOption ? (
                <button type="button" onClick={() => setSelectedUnitType('strip')} className={cn('h-7 rounded-[7px] px-2.5 text-[11px] font-semibold transition-all', selectedUnitType === 'strip' ? 'bg-primary text-primary-foreground shadow' : 'text-[#4a5578] hover:bg-white')}>
                  Strip
                </button>
              ) : null}
              <button type="button" onClick={() => setSelectedUnitType('box')} className={cn('h-7 rounded-[7px] px-2.5 text-[11px] font-semibold transition-all', selectedUnitType === 'box' ? 'bg-primary text-primary-foreground shadow' : 'text-[#4a5578] hover:bg-white')}>
                Box
              </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="sm" className="h-8 w-7 rounded-[8px] p-0" onClick={() => isWeight ? setQuantity(Math.max(0.1, Math.round((quantity - 0.1) * 10) / 10)) : setQuantity(Math.max(1, quantity - 1))} aria-label="Decrease quantity">
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Input
                type="number"
                min={isWeight ? 0.1 : 1}
                step={isWeight ? 0.1 : 1}
                max={maxQuantity}
                value={quantity}
                onChange={(e) => isWeight
                  ? setQuantity(Math.max(0.1, Math.min(maxQuantity, Math.round((parseFloat(e.target.value) || 0.1) * 1000) / 1000)))
                  : setQuantity(Math.max(1, Math.min(maxQuantity, parseInt(e.target.value, 10) || 1)))}
                className="h-8 w-16 rounded-[8px] text-center text-xs font-bold tabular-nums"
                aria-label={isWeight ? "Weight in kilograms" : "Quantity"}
              />
              <Button type="button" variant="outline" size="sm" className="h-8 w-7 rounded-[8px] p-0" onClick={() => isWeight ? setQuantity(Math.min(maxQuantity, Math.round((quantity + 0.1) * 10) / 10)) : setQuantity(Math.min(maxQuantity, quantity + 1))} aria-label="Increase quantity">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={addDisabled}
              onClick={handleQuickAdd}
              className="ml-auto h-8 rounded-[8px] px-3 text-xs font-bold"
            >
              <Plus className="mr-1 h-3.5 w-3.5 stroke-[2.5]" /> Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PosProductCard;
