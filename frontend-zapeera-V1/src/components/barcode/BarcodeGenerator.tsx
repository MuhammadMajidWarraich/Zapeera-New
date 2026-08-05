/**
 * BarcodeGenerator - Dialog for generating and assigning barcodes to products
 */

import React, { useState, useCallback } from 'react';
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
import { BARCODE_FORMAT_OPTIONS, BarcodeType, validateBarcodeFormat } from '../../lib/barcode-utils';
import { apiService } from '../../services/api';
import { toast } from 'sonner';
import { Wand2, RefreshCw, Check } from 'lucide-react';

interface BarcodeGeneratorProps {
  open: boolean;
  onClose: () => void;
  onGenerate: (barcode: string, type: BarcodeType) => void;
  currentBarcode?: string;
  currentType?: BarcodeType;
  productName?: string;
  /** If true, this is for creating a new product */
  isNewProduct?: boolean;
}

export function BarcodeGenerator({
  open,
  onClose,
  onGenerate,
  currentBarcode,
  currentType = 'CODE128',
  productName,
  isNewProduct = false,
}: BarcodeGeneratorProps) {
  const [barcode, setBarcode] = useState(currentBarcode || '');
  const [barcodeType, setBarcodeType] = useState<BarcodeType>(currentType);
  const [prefix, setPrefix] = useState('ZP');
  const [manualEntry, setManualEntry] = useState(!currentBarcode);
  const [isGenerating, setIsGenerating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const response = await apiService.generateBarcode({
        prefix,
        type: barcodeType,
      });

      if (response.success && response.data?.barcode) {
        setBarcode(response.data.barcode);
        setManualEntry(false);
        setValidationError(null);
        toast.success('Barcode generated');
      } else {
        toast.error('Failed to generate barcode');
      }
    } catch (error: any) {
      toast.error('Failed to generate barcode');
    } finally {
      setIsGenerating(false);
    }
  }, [prefix, barcodeType]);

  const handleManualChange = (value: string) => {
    setBarcode(value);
    setManualEntry(true);
    if (value) {
      const result = validateBarcodeFormat(value, barcodeType);
      setValidationError(result.valid ? null : result.message || 'Invalid barcode');
    } else {
      setValidationError(null);
    }
  };

  const handleConfirm = () => {
    if (!barcode) {
      toast.error('Please enter or generate a barcode');
      return;
    }

    const validation = validateBarcodeFormat(barcode, barcodeType);
    if (!validation.valid) {
      toast.error(validation.message || 'Invalid barcode');
      return;
    }

    onGenerate(barcode, barcodeType);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isNewProduct ? 'Generate Barcode' : 'Update Barcode'}
          </DialogTitle>
          <DialogDescription>
            {productName
              ? `Generate a barcode for "${productName}"`
              : 'Generate or enter a barcode'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Barcode Type */}
          <div className="space-y-2">
            <Label>Barcode Format</Label>
            <Select
              value={barcodeType}
              onValueChange={(v) => setBarcodeType(v as BarcodeType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BARCODE_FORMAT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Auto-generate section */}
          <div className="space-y-2">
            <Label>Prefix</Label>
            <div className="flex gap-2">
              <Input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                placeholder="e.g., MED, RET, ZP"
                maxLength={5}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={handleGenerate}
                disabled={isGenerating}
                className="gap-2"
              >
                {isGenerating ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                Generate
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Prefix is prepended to the auto-generated number
            </p>
          </div>

          {/* Manual entry */}
          <div className="space-y-2">
            <Label>Barcode Value</Label>
            <Input
              value={barcode}
              onChange={(e) => handleManualChange(e.target.value)}
              placeholder="Enter barcode manually or use Generate"
              className={`font-mono ${validationError ? 'border-red-500' : ''}`}
            />
            {validationError && (
              <p className="text-xs text-red-500">{validationError}</p>
            )}
          </div>

          {/* Preview */}
          {barcode && (
            <div className="flex justify-center p-4 bg-muted/30 rounded-lg">
              <BarcodePreview
                value={barcode}
                format={barcodeType}
                height={60}
                showValue={true}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!barcode || !!validationError}>
            <Check className="h-4 w-4 mr-2" />
            {isNewProduct ? 'Use Barcode' : 'Save Barcode'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BarcodeGenerator;
