/**
 * BarcodePreview - Displays a rendered barcode image
 * Supports Code128, EAN-13, UPC-A, etc.
 */

import React, { useEffect, useRef } from 'react';
import { renderBarcodeToSVG, BarcodeType, formatBarcodeForDisplay } from '../../lib/barcode-utils';
import { Badge } from '../ui/badge';
import { Copy, Printer, Check } from 'lucide-react';
import { copyBarcodeToClipboard } from '../../lib/barcode-utils';
import { toast } from 'sonner';

interface BarcodePreviewProps {
  value: string;
  format?: BarcodeType;
  width?: number;
  height?: number;
  showValue?: boolean;
  showLabel?: boolean;
  showCopyButton?: boolean;
  showPrintButton?: boolean;
  compact?: boolean;
  className?: string;
  onPrint?: () => void;
}

export function BarcodePreview({
  value,
  format = 'CODE128',
  width = 2,
  height = 50,
  showValue = true,
  showLabel = true,
  showCopyButton = true,
  showPrintButton = false,
  compact = false,
  className = '',
  onPrint,
}: BarcodePreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [copied, setCopied] = React.useState(false);

  useEffect(() => {
    if (svgRef.current && value) {
      // Clear previous content
      while (svgRef.current.firstChild) {
        svgRef.current.removeChild(svgRef.current.firstChild);
      }
      renderBarcodeToSVG(svgRef.current, value, {
        format,
        width: compact ? 1 : width,
        height: compact ? 30 : height,
        displayValue: showValue,
        fontSize: compact ? 10 : 14,
      });
    }
  }, [value, format, width, height, showValue, compact]);

  const handleCopy = async () => {
    const success = await copyBarcodeToClipboard(value);
    if (success) {
      setCopied(true);
      toast.success('Barcode copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!value) {
    return (
      <div className={`text-muted-foreground text-sm italic ${className}`}>
        No barcode
      </div>
    );
  }

  return (
    <div className={`inline-flex flex-col items-center gap-1 ${className}`}>
      <div className="bg-white rounded border p-2">
        <svg ref={svgRef} />
      </div>

      {showLabel && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{formatBarcodeForDisplay(value)}</span>
          {showCopyButton && (
            <button
              onClick={handleCopy}
              className="p-1 hover:bg-muted rounded transition-colors"
              title="Copy barcode"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          )}
          {showPrintButton && onPrint && (
            <button
              onClick={onPrint}
              className="p-1 hover:bg-muted rounded transition-colors"
              title="Print barcode"
            >
              <Printer className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * BarcodeBadge - Small inline barcode display
 */
export function BarcodeBadge({
  value,
  format = 'CODE128',
  onClick,
}: {
  value: string;
  format?: BarcodeType;
  onClick?: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      while (svgRef.current.firstChild) {
        svgRef.current.removeChild(svgRef.current.firstChild);
      }
      renderBarcodeToSVG(svgRef.current, value, {
        format,
        width: 1,
        height: 20,
        displayValue: false,
      });
    }
  }, [value, format]);

  if (!value) return null;

  return (
    <Badge
      variant="outline"
      className={`font-mono text-xs cursor-pointer hover:bg-muted ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <svg ref={svgRef} className="h-4 w-auto" />
      <span className="ml-1">{value}</span>
    </Badge>
  );
}

export default BarcodePreview;
