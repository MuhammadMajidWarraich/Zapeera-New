import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Layers, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface BatchSelectionTableProps {
  batches: Batch[];
  selectedBatchId: string | undefined;
  onSelectBatch: (batchId: string) => void;
  isLoading?: boolean;
  requiresBranchSelection?: boolean;
}

const BatchSelectionTable: React.FC<BatchSelectionTableProps> = ({
  batches,
  selectedBatchId,
  onSelectBatch,
  isLoading = false,
  requiresBranchSelection = false,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-[12px] border border-[rgba(15,23,60,0.08)] bg-gradient-to-r from-[#f8f9fc] to-[#f4f6fa] px-4 py-3.5 text-sm text-[#4a5578]">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#1a52c5]" aria-hidden />
        <span className="font-medium">Loading batches…</span>
      </div>
    );
  }

  const validBatches = batches.filter((batch) => {
    if (batch.expiryStatus === 'EXPIRED') return false;
    if (batch.daysUntilExpiry !== undefined && batch.daysUntilExpiry <= 0) return false;
    if (batch.expireDate) {
      const expireDate = new Date(batch.expireDate);
      if (expireDate < new Date()) return false;
    }
    return true;
  });

  if (validBatches.length > 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-[#1a52c5]/12 to-[#28c2ce]/10">
            <Layers className="h-4 w-4 text-[#1a52c5]" strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-[#0a1128]">Select batch</p>
            <p className="text-xs text-[#8c95b0]">Choose a lot to sell from</p>
          </div>
        </div>
        <div className="overflow-hidden rounded-[14px] border border-[rgba(15,23,60,0.08)] bg-gradient-to-b from-[#fcfdff] to-[#f4f6fa]">
          <Table>
            <TableHeader>
              <TableRow className="border-[rgba(15,23,60,0.06)] bg-[#eef1f7]/90 hover:bg-[#eef1f7]/90">
                <TableHead className="w-11 py-3">
                  <span className="sr-only">Select</span>
                </TableHead>
                <TableHead className="py-3 text-[11px] font-bold uppercase tracking-wider text-[#8c95b0]">
                  Batch no
                </TableHead>
                <TableHead className="py-3 text-[11px] font-bold uppercase tracking-wider text-[#8c95b0]">
                  Qty
                </TableHead>
                <TableHead className="py-3 text-[11px] font-bold uppercase tracking-wider text-[#8c95b0]">
                  Expiry
                </TableHead>
                <TableHead className="py-3 text-[11px] font-bold uppercase tracking-wider text-[#8c95b0]">
                  Days left
                </TableHead>
                <TableHead className="py-3 text-right text-[11px] font-bold uppercase tracking-wider text-[#8c95b0]">
                  Price
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {validBatches.map((batch) => {
                const expiryDate = batch.expireDate
                  ? new Date(batch.expireDate).toLocaleDateString('en-US', {
                      month: 'numeric',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : '—';
                const statusColor =
                  batch.expiryStatus === 'CRITICAL'
                    ? 'font-semibold text-red-600'
                    : batch.expiryStatus === 'WARNING'
                      ? 'font-semibold text-orange-600'
                      : batch.expiryStatus === 'EXPIRED'
                        ? 'text-[#8c95b0]'
                        : 'font-medium text-emerald-600';
                const isSelected = selectedBatchId === batch.id;
                const isLowStock = batch.quantity <= 10;

                return (
                  <TableRow
                    key={batch.id}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectBatch(batch.id);
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-[rgba(15,23,60,0.05)] transition-colors',
                      isSelected
                        ? 'bg-[#1a52c5]/[0.08] hover:bg-[#1a52c5]/[0.1]'
                        : 'bg-white/40 hover:bg-[#1a52c5]/[0.04]',
                    )}
                    onClick={() => onSelectBatch(batch.id)}
                  >
                    <TableCell className="w-11 py-2.5">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onSelectBatch(batch.id)}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          'h-4 w-4 rounded-[6px] border-[rgba(15,23,60,0.2)]',
                          'data-[state=checked]:border-transparent data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-[#1a52c5] data-[state=checked]:to-[#28c2ce] data-[state=checked]:text-white',
                        )}
                      />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span className="font-semibold text-[#0a1128]">{batch.batchNo}</span>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span
                        className={cn(
                          'tabular-nums text-sm',
                          isLowStock ? 'font-semibold text-orange-600' : 'text-[#4a5578]',
                        )}
                      >
                        {batch.quantity}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5 text-sm tabular-nums text-[#4a5578]">
                      {expiryDate}
                    </TableCell>
                    <TableCell className="py-2.5 text-sm">
                      {batch.daysUntilExpiry !== undefined && batch.daysUntilExpiry > 0 ? (
                        <span className={statusColor}>{batch.daysUntilExpiry} days</span>
                      ) : batch.expireDate ? (
                        <span className="font-semibold text-red-600">Expired</span>
                      ) : (
                        <span className="text-[#8c95b0]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5 text-right">
                      <span className="text-sm font-bold tabular-nums text-[#0a1128]">
                        PKR {batch.sellingPrice.toFixed(2)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  if (requiresBranchSelection) {
    return (
      <div className="rounded-[12px] border border-amber-200/80 bg-gradient-to-r from-amber-50/90 to-[#fffaf0] px-3.5 py-3 text-xs font-semibold text-amber-900">
        Select a branch first to load batches.
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-dashed border-[rgba(15,23,60,0.12)] bg-[#f8f9fc]/80 px-3.5 py-3 text-center text-xs font-medium text-[#8c95b0]">
      No batches available for this product.
    </div>
  );
};

export default BatchSelectionTable;
