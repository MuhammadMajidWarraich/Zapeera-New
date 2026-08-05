/**
 * Barcode Controller - API endpoints for barcode management
 */

import { Request, Response } from 'express';
import { BarcodeService, BarcodeType, GenerateBarcodeOptions } from '../services/barcode.service';
import { getPrisma } from '../utils/db.util';

interface AuthRequest extends Request {
  user?: any;
  business_id?: string;
  branch_id?: string;
}

/**
 * POST /api/v1/barcodes/lookup
 * Fast barcode lookup for POS scanning
 * Body: { barcode: string }
 */
export const lookupBarcode = async (req: AuthRequest, res: Response) => {
  try {
    const { barcode } = req.body;
    if (!barcode) {
      return res.status(400).json({
        success: false,
        message: 'Barcode is required',
      });
    }

    const companyId =
      req.business_id || req.user?.selectedCompanyId || req.user?.createdBy || '';
    const branchId =
      req.branch_id || req.user?.selectedBranchId || undefined;

    const result = await BarcodeService.lookupByBarcode(barcode, companyId, branchId);

    if (!result.found) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
        barcode,
        suggestion: 'Create Product',
      });
    }

    return res.json({
      success: true,
      data: {
        product: result.product,
        batch: result.batch,
        stock: result.stock,
        matchType: result.matchType,
      },
    });
  } catch (error: any) {
    console.error('[Barcode] Lookup error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Barcode lookup failed',
    });
  }
};

/**
 * POST /api/v1/barcodes/generate
 * Generate a new barcode for a product
 * Body: { prefix?: string, length?: number, type?: BarcodeType }
 */
export const generateBarcode = async (req: AuthRequest, res: Response) => {
  try {
    const { prefix, length, type } = req.body;
    const companyId =
      req.business_id || req.user?.selectedCompanyId || req.user?.createdBy || '';

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Business context is required',
      });
    }

    const options: GenerateBarcodeOptions = {
      prefix: prefix || 'ZP',
      length: length || 12,
      type: (type as BarcodeType) || 'CODE128',
      companyId,
      branchId: req.branch_id || undefined,
    };

    const barcode = await BarcodeService.generateBarcode(options);

    return res.json({
      success: true,
      data: {
        barcode,
        type: options.type,
        prefix: options.prefix,
      },
    });
  } catch (error: any) {
    console.error('[Barcode] Generate error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate barcode',
    });
  }
};

/**
 * POST /api/v1/barcodes/validate
 * Validate a barcode format and uniqueness
 * Body: { barcode: string, type?: BarcodeType, excludeProductId?: string }
 */
export const validateBarcode = async (req: AuthRequest, res: Response) => {
  try {
    const { barcode, type, excludeProductId } = req.body;

    if (!barcode) {
      return res.status(400).json({
        success: false,
        message: 'Barcode is required',
      });
    }

    const formatValidation = BarcodeService.validateBarcode(
      barcode,
      (type as BarcodeType) || 'CODE128'
    );

    const companyId =
      req.business_id || req.user?.selectedCompanyId || req.user?.createdBy || '';

    const isUnique = companyId
      ? await BarcodeService.isBarcodeUnique(barcode, companyId, excludeProductId)
      : true;

    return res.json({
      success: true,
      data: {
        formatValid: formatValidation.valid,
        isUnique,
        valid: formatValidation.valid && isUnique,
        format: formatValidation.format,
        message: !formatValidation.valid
          ? formatValidation.message
          : !isUnique
            ? 'Barcode already exists in this business'
            : 'Barcode is valid and available',
      },
    });
  } catch (error: any) {
    console.error('[Barcode] Validate error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Validation failed',
    });
  }
};

/**
 * GET /api/v1/barcodes/stats
 * Get barcode statistics for the business
 */
export const getBarcodeStats = async (req: AuthRequest, res: Response) => {
  try {
    const companyId =
      req.business_id || req.user?.selectedCompanyId || req.user?.createdBy || '';

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Business context is required',
      });
    }

    const stats = await BarcodeService.getBarcodeStats(companyId);

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error('[Barcode] Stats error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to get barcode stats',
    });
  }
};

/**
 * GET /api/v1/barcodes/product/:productId
 * Get all barcodes for a product (primary + additional)
 */
export const getProductBarcodes = async (req: AuthRequest, res: Response) => {
  try {
    const { productId } = req.params;
    const prisma = await getPrisma();

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        barcode: true,
        additionalBarcodes: true,
        barcodeType: true,
        isGenerated: true,
        sku: true,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    let additionalBarcodes: string[] = [];
    if (product.additionalBarcodes) {
      try {
        additionalBarcodes = JSON.parse(product.additionalBarcodes);
      } catch {
        additionalBarcodes = [];
      }
    }

    return res.json({
      success: true,
      data: {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        primaryBarcode: product.barcode,
        additionalBarcodes,
        barcodeType: product.barcodeType || 'CODE128',
        isGenerated: product.isGenerated,
        allBarcodes: [
          ...(product.barcode ? [product.barcode] : []),
          ...additionalBarcodes,
        ],
      },
    });
  } catch (error: any) {
    console.error('[Barcode] Get product barcodes error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to get product barcodes',
    });
  }
};

/**
 * PUT /api/v1/barcodes/product/:productId
 * Update all barcodes for a product
 * Body: { barcode?: string, additionalBarcodes?: string[], barcodeType?: string }
 */
export const updateProductBarcodes = async (req: AuthRequest, res: Response) => {
  try {
    const { productId } = req.params;
    const { barcode, additionalBarcodes, barcodeType } = req.body;
    const prisma = await getPrisma();

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const companyId = req.business_id || req.user?.selectedCompanyId || product.companyId;

    // Validate primary barcode uniqueness
    if (barcode && barcode !== product.barcode) {
      const isUnique = await BarcodeService.isBarcodeUnique(barcode, companyId, productId);
      if (!isUnique) {
        return res.status(400).json({
          success: false,
          message: 'Primary barcode already exists in this business',
        });
      }
    }

    // Validate additional barcodes uniqueness
    if (additionalBarcodes) {
      for (const ab of additionalBarcodes) {
        if (ab !== barcode) {
          const isUnique = await BarcodeService.isBarcodeUnique(ab, companyId, productId);
          if (!isUnique) {
            return res.status(400).json({
              success: false,
              message: `Additional barcode '${ab}' already exists in this business`,
            });
          }
        }
      }
    }

    const updateData: any = {};
    if (barcode !== undefined) updateData.barcode = barcode || null;
    if (additionalBarcodes !== undefined) {
      updateData.additionalBarcodes = JSON.stringify(additionalBarcodes);
    }
    if (barcodeType !== undefined) updateData.barcodeType = barcodeType;

    await prisma.product.update({
      where: { id: productId },
      data: updateData,
    });

    return res.json({
      success: true,
      message: 'Product barcodes updated',
    });
  } catch (error: any) {
    console.error('[Barcode] Update product barcodes error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update product barcodes',
    });
  }
};
