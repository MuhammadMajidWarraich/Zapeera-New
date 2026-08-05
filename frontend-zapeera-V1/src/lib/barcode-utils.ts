/**
 * Barcode Utility Functions
 * Handles barcode generation, rendering, and validation on the frontend
 */

import JsBarcode from 'jsbarcode';

export type BarcodeType = 'CODE128' | 'EAN13' | 'EAN8' | 'UPC_A' | 'UPC_E' | 'CODE39' | 'QR';

export interface BarcodeGenerateOptions {
  prefix?: string;
  length?: number;
  type?: BarcodeType;
}

/**
 * Render a barcode to an SVG element
 */
export function renderBarcodeToSVG(
  svgElement: SVGSVGElement,
  value: string,
  options: {
    format?: BarcodeType;
    width?: number;
    height?: number;
    displayValue?: boolean;
    fontSize?: number;
    textMargin?: number;
    margin?: number;
  } = {}
): void {
  if (!svgElement || !value) return;

  try {
    JsBarcode(svgElement, value, {
      format: options.format || 'CODE128',
      width: options.width || 2,
      height: options.height || 60,
      displayValue: options.displayValue !== false,
      fontSize: options.fontSize || 14,
      textMargin: options.textMargin || 2,
      margin: options.margin || 10,
      background: '#ffffff',
      lineColor: '#000000',
    });
  } catch (err) {
    console.error('Barcode render error:', err);
    // Fallback: render as text
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '10');
    text.setAttribute('y', '30');
    text.setAttribute('font-size', '14');
    text.textContent = value;
    svgElement.appendChild(text);
  }
}

/**
 * Render a barcode to a Canvas element
 */
export function renderBarcodeToCanvas(
  canvasElement: HTMLCanvasElement,
  value: string,
  options: {
    format?: BarcodeType;
    width?: number;
    height?: number;
    displayValue?: boolean;
    fontSize?: number;
  } = {}
): void {
  if (!canvasElement || !value) return;

  try {
    JsBarcode(canvasElement, value, {
      format: options.format || 'CODE128',
      width: options.width || 2,
      height: options.height || 60,
      displayValue: options.displayValue !== false,
      fontSize: options.fontSize || 14,
      background: '#ffffff',
      lineColor: '#000000',
    });
  } catch (err) {
    console.error('Barcode render error:', err);
  }
}

/**
 * Generate a barcode data URL from a value
 */
export function generateBarcodeDataURL(
  value: string,
  options: {
    format?: BarcodeType;
    width?: number;
    height?: number;
    displayValue?: boolean;
  } = {}
): Promise<string> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, value, {
        format: options.format || 'CODE128',
        width: options.width || 2,
        height: options.height || 60,
        displayValue: options.displayValue !== false,
        fontSize: options.fontSize || 14,
        background: '#ffffff',
        lineColor: '#000000',
      });
      resolve(canvas.toDataURL('image/png'));
    } catch {
      resolve('');
    }
  });
}

/**
 * Validate barcode format on the frontend
 */
export function validateBarcodeFormat(
  barcode: string,
  type: BarcodeType = 'CODE128'
): { valid: boolean; message?: string } {
  if (!barcode || barcode.trim().length === 0) {
    return { valid: false, message: 'Barcode cannot be empty' };
  }

  if (/\s/.test(barcode)) {
    return { valid: false, message: 'Barcode cannot contain spaces' };
  }

  const patterns: Record<BarcodeType, RegExp> = {
    CODE128: /^[A-Za-z0-9\-\.\ \$\/\+\%]{1,48}$/,
    EAN13: /^\d{13}$/,
    EAN8: /^\d{8}$/,
    UPC_A: /^\d{12}$/,
    UPC_E: /^\d{6,8}$/,
    CODE39: /^[A-Z0-9\-\.\ \$\/\+\%]{1,48}$/,
    QR: /^.{1,2000}$/,
  };

  const pattern = patterns[type];
  if (!pattern) {
    return { valid: false, message: `Unsupported barcode type: ${type}` };
  }

  if (!pattern.test(barcode)) {
    return { valid: false, message: `Invalid ${type} format` };
  }

  return { valid: true };
}

/**
 * Generate a barcode prefix from business type
 */
export function getBusinessTypePrefix(businessType?: string): string {
  const prefixes: Record<string, string> = {
    pharmacy: 'MED',
    restaurant: 'FNB',
    clothing: 'CLT',
    retail: 'RET',
    grocery: 'GRO',
    electronics: 'ELC',
    hardware: 'HW',
    default: 'ZP',
  };

  return prefixes[businessType?.toLowerCase() || ''] || prefixes.default;
}

/**
 * Format barcode for display (add spaces for readability)
 */
export function formatBarcodeForDisplay(barcode: string): string {
  if (!barcode) return '';
  // Add spaces every 4 characters for readability
  return barcode.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Copy barcode to clipboard
 */
export async function copyBarcodeToClipboard(barcode: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(barcode);
    return true;
  } catch {
    // Fallback
    const textArea = document.createElement('textarea');
    textArea.value = barcode;
    document.body.appendChild(textArea);
    textArea.select();
    const result = document.execCommand('copy');
    document.body.removeChild(textArea);
    return result;
  }
}

/**
 * Barcode format options for UI select
 */
export const BARCODE_FORMAT_OPTIONS: { value: BarcodeType; label: string }[] = [
  { value: 'CODE128', label: 'Code 128 (Default)' },
  { value: 'EAN13', label: 'EAN-13 (13 digits)' },
  { value: 'EAN8', label: 'EAN-8 (8 digits)' },
  { value: 'UPC_A', label: 'UPC-A (12 digits)' },
  { value: 'UPC_E', label: 'UPC-E (6-8 digits)' },
  { value: 'CODE39', label: 'Code 39' },
];

/**
 * Label size options for printing
 */
export const LABEL_SIZE_OPTIONS = [
  { value: 'small', label: 'Small (38x25mm)', width: 38, height: 25, cols: 4, rows: 10 },
  { value: 'medium', label: 'Medium (50x30mm)', width: 50, height: 30, cols: 3, rows: 8 },
  { value: 'large', label: 'Large (70x40mm)', width: 70, height: 40, cols: 2, rows: 6 },
  { value: 'custom', label: 'Custom', width: 50, height: 30, cols: 3, rows: 8 },
] as const;

export type LabelSize = typeof LABEL_SIZE_OPTIONS[number]['value'];
