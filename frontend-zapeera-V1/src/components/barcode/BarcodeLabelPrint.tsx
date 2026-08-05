/**
 * BarcodeLabelPrint - Print barcode labels
 * Supports single/multiple labels, various paper sizes
 */

import React, { useState, useRef, useCallback } from 'react';
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
import { Checkbox } from '../ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { renderBarcodeToSVG, LABEL_SIZE_OPTIONS, LabelSize } from '../../lib/barcode-utils';
import { Printer, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface BarcodeLabel {
  barcode: string;
  name: string;
  price?: number;
  sku?: string;
  batchNo?: string;
  expiryDate?: string;
  quantity?: number;
}

interface BarcodeLabelPrintProps {
  open: boolean;
  onClose: () => void;
  /** Single label mode */
  barcode?: string;
  productName?: string;
  price?: number;
  sku?: string;
  batchNo?: string;
  expiryDate?: string;
  /** Multi-label mode */
  labels?: BarcodeLabel[];
}

export function BarcodeLabelPrint({
  open,
  onClose,
  barcode,
  productName,
  price,
  sku,
  batchNo,
  expiryDate,
  labels = [],
}: BarcodeLabelPrintProps) {
  const [quantity, setQuantity] = useState(1);
  const [labelSize, setLabelSize] = useState<LabelSize>('medium');
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showSku, setShowSku] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [showExpiry, setShowExpiry] = useState(false);
  const [showBarcodeText, setShowBarcodeText] = useState(true);
  const printRef = useRef<HTMLDivElement>(null);

  const sizeConfig = LABEL_SIZE_OPTIONS.find((s) => s.value === labelSize) || LABEL_SIZE_OPTIONS[1];

  const handlePrint = useCallback(() => {
    if (!printRef.current) return;

    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      toast.error('Please allow popups to print');
      return;
    }

    const items = labels.length > 0
      ? labels.flatMap((l) => Array(l.quantity || 1).fill(l))
      : Array(quantity).fill({
          barcode: barcode || '',
          name: productName || '',
          price,
          sku,
          batchNo,
          expiryDate,
        });

    const labelWidthMM = sizeConfig.width;
    const labelHeightMM = sizeConfig.height;

    let barcodeElements = '';
    items.forEach((item, idx) => {
      barcodeElements += `
        <div class="label" style="width:${labelWidthMM}mm;height:${labelHeightMM}mm;">
          ${showName ? `<div class="name">${item.name}</div>` : ''}
          <svg class="barcode-svg" id="barcode-${idx}"></svg>
          ${showBarcodeText ? `<div class="barcode-text">${item.barcode}</div>` : ''}
          ${showPrice && item.price ? `<div class="price">Rs. ${item.price.toFixed(2)}</div>` : ''}
          ${showSku && item.sku ? `<div class="meta">SKU: ${item.sku}</div>` : ''}
          ${showBatch && item.batchNo ? `<div class="meta">Batch: ${item.batchNo}</div>` : ''}
          ${showExpiry && item.expiryDate ? `<div class="meta">Exp: ${item.expiryDate}</div>` : ''}
        </div>
      `;
    });

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Barcode Labels</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; }
          .label-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 2mm;
            padding: 5mm;
          }
          .label {
            border: 0.5px solid #ccc;
            padding: 2mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            page-break-inside: avoid;
            overflow: hidden;
          }
          .name {
            font-size: 7pt;
            font-weight: bold;
            text-align: center;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-bottom: 1mm;
          }
          .barcode-svg { max-width: 100%; height: auto; }
          .barcode-text {
            font-size: 6pt;
            font-family: monospace;
            margin-top: 0.5mm;
          }
          .price {
            font-size: 7pt;
            font-weight: bold;
            margin-top: 0.5mm;
          }
          .meta {
            font-size: 5pt;
            color: #666;
          }
          @media print {
            .label-grid { gap: 2mm; }
          }
        </style>
      </head>
      <body>
        <div class="label-grid">${barcodeElements}</div>
        <script>
          document.querySelectorAll('[id^="barcode-"]').forEach((svg, idx) => {
            const barcodes = ${JSON.stringify(items.map((i) => i.barcode))};
            try {
              JsBarcode(svg, barcodes[idx], {
                format: 'CODE128',
                width: 1.5,
                height: 25,
                displayValue: false,
                margin: 0,
              });
            } catch(e) {
              const safeText = String(barcodes[idx] || '').replace(/[<>&"']/g, '');
              svg.innerHTML = '<text x="2" y="15" font-size="8">' + safeText + '</text>';
            }
          });
          window.onload = () => { window.print(); window.close(); };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }, [
    barcode, productName, price, sku, batchNo, expiryDate,
    labels, quantity, labelSize, sizeConfig,
    showName, showPrice, showSku, showBatch, showExpiry, showBarcodeText,
  ]);

  const items = labels.length > 0
    ? labels
    : [{
        barcode: barcode || '',
        name: productName || '',
        price,
        sku,
        batchNo,
        expiryDate,
        quantity,
      }];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Print Barcode Labels</DialogTitle>
          <DialogDescription>
            Configure and print barcode labels
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Label Size */}
          <div className="space-y-2">
            <Label>Label Size</Label>
            <Select value={labelSize} onValueChange={(v) => setLabelSize(v as LabelSize)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LABEL_SIZE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity (single mode) */}
          {labels.length === 0 && (
            <div className="space-y-2">
              <Label>Quantity</Label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <Input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  max={100}
                  className="w-20 text-center"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQuantity(Math.min(100, quantity + 1))}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}

          {/* Content options */}
          <div className="space-y-2">
            <Label>Show on Label</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { checked: showName, onChange: setShowName, label: 'Product Name' },
                { checked: showPrice, onChange: setShowPrice, label: 'Price' },
                { checked: showSku, onChange: setShowSku, label: 'SKU' },
                { checked: showBatch, onChange: setShowBatch, label: 'Batch Number' },
                { checked: showExpiry, onChange: setShowExpiry, label: 'Expiry Date' },
                { checked: showBarcodeText, onChange: setShowBarcodeText, label: 'Barcode Text' },
              ].map(({ checked, onChange, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => onChange(!!v)}
                    id={label}
                  />
                  <label htmlFor={label} className="text-sm cursor-pointer">{label}</label>
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="border rounded-lg p-4 bg-white">
            <div ref={printRef} className="flex flex-wrap gap-2 justify-center">
              {items.slice(0, 4).map((item, idx) => (
                <div
                  key={idx}
                  className="border border-gray-200 p-2 flex flex-col items-center"
                  style={{
                    width: `${sizeConfig.width}mm`,
                    minHeight: `${sizeConfig.height}mm`,
                  }}
                >
                  <svg
                    ref={(el) => {
                      if (el && item.barcode) {
                        renderBarcodeToSVG(el, item.barcode, {
                          format: 'CODE128',
                          width: 1.5,
                          height: 25,
                          displayValue: false,
                          fontSize: 8,
                        });
                      }
                    }}
                    className="max-w-full"
                  />
                  <div className="text-[8px] font-mono mt-1">{item.barcode}</div>
                  {showName && item.name && (
                    <div className="text-[7px] font-bold text-center truncate max-w-full">
                      {item.name}
                    </div>
                  )}
                  {showPrice && item.price && (
                    <div className="text-[8px] font-bold">Rs. {item.price.toFixed(2)}</div>
                  )}
                </div>
              ))}
              {items.length > 4 && (
                <div className="text-xs text-muted-foreground self-center">
                  +{items.length - 4} more labels
                </div>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            {items.length} label{items.length !== 1 ? 's' : ''} will be printed
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handlePrint} className="gap-2">
            <Printer className="h-4 w-4" />
            Print Labels
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BarcodeLabelPrint;
