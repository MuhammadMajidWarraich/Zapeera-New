/**
 * Barcode Service - Enterprise-grade barcode management
 * Supports: EAN-13, EAN-8, UPC-A, UPC-E, Code 39, Code 128, QR Code
 */

import { getPrisma } from '../utils/db.util';

export type BarcodeType = 'CODE128' | 'EAN13' | 'EAN8' | 'UPC_A' | 'UPC_E' | 'CODE39' | 'QR';

export interface BarcodeLookupResult {
  found: boolean;
  product?: any;
  batch?: any;
  stock?: number;
  matchType?: 'primary' | 'additional' | 'sku' | 'name';
}

export interface GenerateBarcodeOptions {
  prefix?: string;
  length?: number;
  type?: BarcodeType;
  companyId: string;
  branchId?: string;
}

export interface BarcodeValidationResult {
  valid: boolean;
  format: BarcodeType;
  message?: string;
}

const BARCODE_PATTERNS: Record<BarcodeType, RegExp> = {
  CODE128: /^[A-Za-z0-9\-\.\ \$\/\+\%]{1,48}$/,
  EAN13: /^\d{13}$/,
  EAN8: /^\d{8}$/,
  UPC_A: /^\d{12}$/,
  UPC_E: /^\d{6,8}$/,
  CODE39: /^[A-Z0-9\-\.\ \$\/\+\%]{1,48}$/,
  QR: /^.{1,2000}$/,
};

export class BarcodeService {
  /**
   * Lookup a product by barcode, additional barcodes, SKU, or name
   */
  static async lookupByBarcode(
    barcode: string,
    companyId: string,
    branchId?: string
  ): Promise<BarcodeLookupResult> {
    const prisma = await getPrisma();
    const trimmed = barcode.trim();

    if (!trimmed) {
      return { found: false };
    }

    // 1. Primary barcode lookup (highest priority)
    const primaryMatch = await prisma.product.findFirst({
      where: {
        OR: [
          { barcode: trimmed },
        ],
        companyId,
        isActive: true,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        category: true,
        supplier: true,
        batches: {
          where: { isActive: true, quantity: { gt: 0 } },
          orderBy: { expireDate: 'asc' },
          take: 10,
        },
      },
    });

    if (primaryMatch) {
      const totalStock = primaryMatch.batches.reduce(
        (sum: number, b: any) => sum + b.quantity,
        0
      );
      // Select best batch (nearest expiry / FIFO)
      const bestBatch = primaryMatch.batches[0] || null;
      return {
        found: true,
        product: primaryMatch,
        batch: bestBatch,
        stock: totalStock,
        matchType: 'primary',
      };
    }

    // 2. Additional barcodes lookup (JSON array stored as string)
    const allProducts = await prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        additionalBarcodes: { not: null },
        ...(branchId ? { branchId } : {}),
      },
      include: {
        category: true,
        supplier: true,
        batches: {
          where: { isActive: true, quantity: { gt: 0 } },
          orderBy: { expireDate: 'asc' },
          take: 10,
        },
      },
    });

    for (const product of allProducts) {
      if (product.additionalBarcodes) {
        try {
          const additionalBarcodes = JSON.parse(product.additionalBarcodes);
          if (Array.isArray(additionalBarcodes) && additionalBarcodes.includes(trimmed)) {
            const totalStock = product.batches.reduce(
              (sum: number, b: any) => sum + b.quantity,
              0
            );
            const bestBatch = product.batches[0] || null;
            return {
              found: true,
              product,
              batch: bestBatch,
              stock: totalStock,
              matchType: 'additional',
            };
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // 3. SKU lookup
    const skuMatch = await prisma.product.findFirst({
      where: {
        sku: trimmed,
        companyId,
        isActive: true,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        category: true,
        supplier: true,
        batches: {
          where: { isActive: true, quantity: { gt: 0 } },
          orderBy: { expireDate: 'asc' },
          take: 10,
        },
      },
    });

    if (skuMatch) {
      const totalStock = skuMatch.batches.reduce(
        (sum: number, b: any) => sum + b.quantity,
        0
      );
      return {
        found: true,
        product: skuMatch,
        batch: skuMatch.batches[0] || null,
        stock: totalStock,
        matchType: 'sku',
      };
    }

    // 4. Name search (last resort)
    const nameMatch = await prisma.product.findFirst({
      where: {
        name: { contains: trimmed },
        companyId,
        isActive: true,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        category: true,
        supplier: true,
        batches: {
          where: { isActive: true, quantity: { gt: 0 } },
          orderBy: { expireDate: 'asc' },
          take: 10,
        },
      },
    });

    if (nameMatch) {
      const totalStock = nameMatch.batches.reduce(
        (sum: number, b: any) => sum + b.quantity,
        0
      );
      return {
        found: true,
        product: nameMatch,
        batch: nameMatch.batches[0] || null,
        stock: totalStock,
        matchType: 'name',
      };
    }

    return { found: false };
  }

  /**
   * Generate a unique barcode for a business
   */
  static async generateBarcode(options: GenerateBarcodeOptions): Promise<string> {
    const {
      prefix = 'ZP',
      length = 12,
      type = 'CODE128',
      companyId,
    } = options;

    const prisma = await getPrisma();

    // Get current count of products for this company to determine next sequence
    const count = await prisma.product.count({
      where: { companyId },
    });

    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const sequence = String(count + attempts + 1).padStart(6, '0');
      let candidate: string;

      switch (type) {
        case 'EAN13':
          candidate = BarcodeService.generateEAN13(prefix, sequence);
          break;
        case 'EAN8':
          candidate = BarcodeService.generateEAN8(sequence);
          break;
        case 'UPC_A':
          candidate = BarcodeService.generateUPCA(sequence);
          break;
        case 'CODE39':
        case 'CODE128':
        default:
          candidate = `${prefix}${sequence}`;
          break;
      }

      // Check uniqueness within business
      const exists = await prisma.product.findFirst({
        where: {
          OR: [
            { barcode: candidate },
          ],
          companyId,
        },
      });

      if (!exists) {
        return candidate;
      }

      attempts++;
    }

    // Fallback: timestamp-based
    return `${prefix}${Date.now().toString().slice(-length)}`;
  }

  /**
   * Generate EAN-13 with check digit
   */
  private static generateEAN13(prefix: string, sequence: string): string {
    const body = (prefix.replace(/\D/g, '').slice(0, 7) + sequence).slice(0, 12);
    const padded = body.padEnd(12, '0');
    const checkDigit = BarcodeService.calculateEANCheckDigit(padded);
    return padded + checkDigit;
  }

  /**
   * Generate EAN-8 with check digit
   */
  private static generateEAN8(sequence: string): string {
    const body = sequence.slice(0, 7).padEnd(7, '0');
    const checkDigit = BarcodeService.calculateEANCheckDigit(body);
    return body + checkDigit;
  }

  /**
   * Generate UPC-A with check digit
   */
  private static generateUPCA(sequence: string): string {
    const body = sequence.slice(0, 11).padEnd(11, '0');
    const checkDigit = BarcodeService.calculateEANCheckDigit(body);
    return body + checkDigit;
  }

  /**
   * Calculate EAN/UPC check digit (modulo 10)
   */
  private static calculateEANCheckDigit(body: string): string {
    let sum = 0;
    for (let i = 0; i < body.length; i++) {
      const digit = parseInt(body[i], 10);
      sum += i % 2 === 0 ? digit : digit * 3;
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    return String(checkDigit);
  }

  /**
   * Validate barcode format
   */
  static validateBarcode(barcode: string, type: BarcodeType = 'CODE128'): BarcodeValidationResult {
    if (!barcode || barcode.trim().length === 0) {
      return { valid: false, format: type, message: 'Barcode cannot be empty' };
    }

    if (/\s/.test(barcode)) {
      return { valid: false, format: type, message: 'Barcode cannot contain spaces' };
    }

    const pattern = BARCODE_PATTERNS[type];
    if (!pattern) {
      return { valid: false, format: type, message: `Unsupported barcode type: ${type}` };
    }

    if (!pattern.test(barcode)) {
      return {
        valid: false,
        format: type,
        message: `Invalid ${type} format. Expected pattern: ${pattern.source}`,
      };
    }

    // Validate check digit for numeric-only formats
    if (['EAN13', 'EAN8', 'UPC_A'].includes(type)) {
      const body = barcode.slice(0, -1);
      const checkDigit = barcode.slice(-1);
      const calculated = BarcodeService.calculateEANCheckDigit(body);
      if (checkDigit !== calculated) {
        return {
          valid: false,
          format: type,
          message: `Invalid check digit. Expected: ${calculated}, got: ${checkDigit}`,
        };
      }
    }

    return { valid: true, format: type };
  }

  /**
   * Check if a barcode is already in use within a business
   */
  static async isBarcodeUnique(
    barcode: string,
    companyId: string,
    excludeProductId?: string
  ): Promise<boolean> {
    const prisma = await getPrisma();
    const where: any = {
      OR: [{ barcode }],
      companyId,
    };

    if (excludeProductId) {
      where.id = { not: excludeProductId };
    }

    const existing = await prisma.product.findFirst({ where });
    return !existing;
  }

  /**
   * Get barcode statistics for a business
   */
  static async getBarcodeStats(companyId: string) {
    const prisma = await getPrisma();

    const totalProducts = await prisma.product.count({
      where: { companyId, isActive: true },
    });

    const withBarcode = await prisma.product.count({
      where: { companyId, isActive: true, barcode: { not: null } },
    });

    const generated = await prisma.product.count({
      where: { companyId, isActive: true, isGenerated: true },
    });

    return {
      totalProducts,
      withBarcode,
      withoutBarcode: totalProducts - withBarcode,
      generated,
      manual: withBarcode - generated,
      coveragePercent: totalProducts > 0
        ? Math.round((withBarcode / totalProducts) * 100)
        : 0,
    };
  }
}
