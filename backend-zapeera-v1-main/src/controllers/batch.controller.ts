import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { createSearchConditions } from '../utils/query-helper';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import { getUserRole } from '../middleware/auth.middleware';
import Joi from 'joi';

// Helper function to serialize BigInt and Date values
const serializeBigInt = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();

  // Handle Date objects - check multiple ways Prisma might return dates
  if (obj instanceof Date) {
    return obj.toISOString();
  }

  // Check for Date-like objects (Prisma sometimes returns these)
  if (obj && typeof obj === 'object') {
    // Check if it has Date constructor name
    if (obj.constructor && obj.constructor.name === 'Date') {
      const dateValue = new Date(obj);
      if (!isNaN(dateValue.getTime())) {
        return dateValue.toISOString();
      }
    }
    // Check if object has date-like properties (timestamp, getTime, etc.)
    if (obj.getTime && typeof obj.getTime === 'function') {
      const dateValue = new Date(obj.getTime());
      if (!isNaN(dateValue.getTime())) {
        return dateValue.toISOString();
      }
    }
  }

  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object') {
    const serialized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      serialized[key] = serializeBigInt(value);
    }
    return serialized;
  }
  return obj;
};

// Validation schemas
const createBatchSchema = Joi.object({
  batchNo: Joi.string().required().messages({
    'string.empty': 'Batch number is required',
    'any.required': 'Batch number is required'
  }),
  productId: Joi.string().required().messages({
    'string.empty': 'Product selection is required',
    'any.required': 'Product selection is required'
  }),
  supplierId: Joi.string().required().messages({
    'string.empty': 'Supplier selection is required',
    'any.required': 'Supplier selection is required'
  }),
  supplierName: Joi.string().optional(),
  expireDate: Joi.date().required().messages({
    'date.base': 'Expiry date is required',
    'any.required': 'Expiry date is required'
  }),
  productionDate: Joi.date().required().messages({
    'date.base': 'Production date is required',
    'any.required': 'Production date is required'
  }),
  shelfId: Joi.string().required().messages({
    'string.empty': 'Shelf selection is required',
    'any.required': 'Shelf selection is required'
  }),
  shelfName: Joi.string().required().messages({
    'string.empty': 'Shelf name is required',
    'any.required': 'Shelf name is required'
  }),
  // Pricing and stock fields (mapped to existing database fields)
  purchasePrice: Joi.number().positive().required().messages({
    'number.positive': 'Purchase price must be positive',
    'any.required': 'Purchase price is required'
  }),
  sellingPrice: Joi.number().positive().required().messages({
    'number.positive': 'Selling price must be positive',
    'any.required': 'Selling price is required'
  }),
  quantity: Joi.number().positive().required().messages({
    'number.positive': 'Quantity must be positive',
    'any.required': 'Quantity is required'
  }),
  totalBoxes: Joi.number().min(0).required().messages({
    'number.min': 'Total boxes must be 0 or greater',
    'any.required': 'Total boxes is required'
  }),
  unitsPerBox: Joi.number().positive().required().messages({
    'number.positive': 'Units per box must be positive',
    'any.required': 'Units per box is required'
  })
});

const updateBatchSchema = Joi.object({
  batchNo: Joi.string().optional(),
  productId: Joi.string().optional(), // Allow productId for updates
  supplierId: Joi.string().optional(),
  supplierName: Joi.string().optional().allow(null), // Allow null values
  expireDate: Joi.date().optional(),
  productionDate: Joi.date().optional().messages({
    'date.base': 'Production date must be a valid date'
  }),
  shelfId: Joi.string().optional().allow('', null).messages({
    'string.empty': 'Shelf selection is required'
  }),
  shelfName: Joi.string().optional().allow('', null).messages({
    'string.empty': 'Shelf name is required'
  }),
  isActive: Joi.boolean().optional(),
  isReported: Joi.boolean().optional(),
  reportReason: Joi.string().allow('', null).optional(), // Reason for reporting the batch
  // Pricing and stock fields (mapped to existing database fields)
  purchasePrice: Joi.number().positive().optional(),
  sellingPrice: Joi.number().positive().optional(),
  quantity: Joi.number().positive().optional(),
  totalBoxes: Joi.number().min(0).optional().messages({
    'number.min': 'Total boxes must be 0 or greater'
  }),
  unitsPerBox: Joi.number().positive().optional().messages({
    'number.positive': 'Units per box must be positive'
  })
});

// Get low stock batches for order purchase
export const getLowStockBatches = async (req: any, res: Response) => {
  try {
    const prisma = await getPrisma();
    console.log('🔍 Get low stock batches request:', req.query);
    const { page = 1, limit = 50, search = '', branchId, companyId } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    // Determine the branch and company context based on user role and query params
    const userRole = getUserRole(req);
    // For OWNERs, only use explicitly-provided branchId or selectedBranchId.
    // Non-owner users can fallback to their assigned branchId.
    let targetBranchId = userRole === 'OWNER'
      ? (branchId || req.user?.selectedBranchId)
      : (branchId || req.user?.selectedBranchId || req.user?.branchId);
    let targetCompanyId = companyId || req.user?.selectedCompanyId || req.user?.companyId || req.business_id;

    // Only fallback to user's default branch/company for non-owner users.
    // OWNER users without an explicit branchId in the query should view all branches.
    if (userRole !== 'OWNER') {
      if (!targetBranchId) {
        targetBranchId = req.user?.branchId;
      }
      if (!targetCompanyId) {
        targetCompanyId = req.user?.companyId;
      }
    }

    // If we have branchId but no companyId, get companyId from the branch
    if (targetBranchId && !targetCompanyId) {
      const branch = await prisma.branch.findUnique({
        where: { id: targetBranchId },
        select: { companyId: true }
      });
      if (branch?.companyId) {
        targetCompanyId = branch.companyId;
        console.log('🔍 Got companyId from branch for low stock:', targetCompanyId);
      }
    }

    // For OWNER users without a specific branch selected,
    // they can view all branches data for the selected company
    if (!targetBranchId && userRole === 'OWNER') {
      // If no company either, we need at least a company context
      if (!targetCompanyId) {
        return res.status(400).json({
          success: false,
          message: 'Company context required. Please select a company first.'
        });
      }
      console.log('🔍 ADMIN/OWNER viewing all branches for company:', targetCompanyId);
    } else if (!targetBranchId || !targetCompanyId) {
      // For other roles (MANAGER/CASHIER), branch is required
      return res.status(400).json({
        success: false,
        message: 'Branch and company context required'
      });
    }

    // Build the where clause - branchId is optional for ADMIN/OWNER
    const productWhere: any = {
        companyId: targetCompanyId,
        isActive: true
    };

    if (targetBranchId) {
      productWhere.branchId = targetBranchId;
    }

    // Build batches where clause - branchId is optional for ADMIN/OWNER
    const batchesWhere: any = {
            companyId: targetCompanyId,
            isActive: true,
            quantity: { gt: 0 }
    };

    if (targetBranchId) {
      batchesWhere.branchId = targetBranchId;
    }

    // Get products with their batches and min stock requirements
    // Handle case where reportReason column might not exist
    let products;
    try {
      products = await prisma.product.findMany({
      where: productWhere,
      include: {
        batches: {
          where: batchesWhere,
          orderBy: { expireDate: 'asc' }
        },
        category: {
          select: {
            name: true
          }
        },
        supplier: {
          select: {
            name: true
          }
        },
        branch: {
          select: {
            name: true
          }
        }
      }
    });
    } catch (findError: any) {
      // If error is due to missing reportReason column, retry with explicit select
      if (findError?.message?.includes('reportReason') && findError?.message?.includes('does not exist')) {
        console.warn('⚠️ reportReason column missing. Fetching low stock batches without reportReason...');
        products = await prisma.product.findMany({
          where: productWhere,
          include: {
            batches: {
              where: batchesWhere,
              orderBy: { expireDate: 'asc' },
              select: {
                id: true,
                batchNo: true,
                productId: true,
                supplierId: true,
                supplierName: true,
                expireDate: true,
                productionDate: true,
                shelfId: true,
                shelfName: true,
                isActive: true,
                isReported: true,
                purchasePrice: true,
                sellingPrice: true,
                quantity: true,
                totalBoxes: true,
                unitsPerBox: true,
                branchId: true,
                companyId: true,
                createdBy: true,
                createdAt: true,
                updatedAt: true,
                // Explicitly exclude reportReason
              }
            },
            category: {
              select: {
                name: true
              }
            },
            supplier: {
              select: {
                name: true
              }
            },
            branch: {
              select: {
                name: true
              }
            }
          }
        }) as any;
      } else {
        throw findError; // Re-throw if it's a different error
      }
    }

    // Calculate low stock batches and batches requiring attention
    const batchesRequiringAttention = [];

    for (const product of products) {
      const totalStock = product.batches.reduce((sum: number, batch: any) => sum + batch.quantity, 0);

      // Check each batch individually for various conditions
      for (const batch of product.batches) {
        let shouldInclude = false;
        let reason = '';

        // Check if individual batch is low stock (less than 20% of min stock)
        const batchLowStockThreshold = product.minStock * 0.2;
        if (batch.quantity <= batchLowStockThreshold) {
          shouldInclude = true;
          reason = 'Low Stock Batch';
        }

        // Check if product total stock is low
        if (totalStock <= product.minStock) {
          shouldInclude = true;
          reason = reason ? `${reason}, Product Low Stock` : 'Product Low Stock';
        }

        // Check if batch is near expiry (within 30 days)
        if (batch.expireDate) {
          const daysUntilExpiry = Math.ceil((new Date(batch.expireDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
          if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
            shouldInclude = true;
            reason = reason ? `${reason}, Near Expiry` : 'Near Expiry';
          }
        }

        // Check if batch is expired
        if (batch.expireDate && new Date(batch.expireDate) < new Date()) {
          shouldInclude = true;
          reason = reason ? `${reason}, Expired` : 'Expired';
        }

        if (shouldInclude) {
          const suggestedOrderQty = Math.max(0, product.minStock * 2 - totalStock);

          batchesRequiringAttention.push({
            id: batch.id,
            batchNo: batch.batchNo,
            productId: product.id,
            productName: product.name,
            productSku: product.barcode || product.id,
            category: product.category?.name || 'Uncategorized',
            supplier: product.supplier?.name || 'Unknown Supplier',
            branch: {
              id: product.branchId,
              name: product.branch?.name || 'Unknown Branch'
            },
            currentStock: batch.quantity,
            totalProductStock: totalStock,
            minStock: product.minStock,
            maxStock: product.maxStock || product.minStock * 10,
            unitPrice: batch.sellingPrice,
            expireDate: batch.expireDate ? batch.expireDate.toISOString() : null,
            productionDate: batch.productionDate ? batch.productionDate.toISOString() : null,
            orderQuantity: suggestedOrderQty,
            isLowStock: batch.quantity <= batchLowStockThreshold || totalStock <= product.minStock,
            isCritical: batch.quantity <= (batchLowStockThreshold * 0.5) || totalStock <= (product.minStock * 0.5),
            isNearExpiry: batch.expireDate ? Math.ceil((new Date(batch.expireDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) <= 30 : false,
            isExpired: batch.expireDate ? new Date(batch.expireDate) < new Date() : false,
            reason: reason
          });
        }
      }
    }

    // Apply search filter
    let filteredBatches = batchesRequiringAttention;
    if (search) {
      filteredBatches = batchesRequiringAttention.filter(batch =>
        batch.productName.toLowerCase().includes(search.toLowerCase()) ||
        batch.productSku.toLowerCase().includes(search.toLowerCase()) ||
        batch.category.toLowerCase().includes(search.toLowerCase()) ||
        batch.batchNo.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Apply pagination
    const paginatedBatches = filteredBatches.slice(skip, skip + parseInt(limit as string));

    return res.json({
      success: true,
      data: {
        batches: serializeBigInt(paginatedBatches),
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: filteredBatches.length,
          pages: Math.ceil(filteredBatches.length / parseInt(limit as string))
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Get low stock batches error:', error);
    console.error('❌ Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack
    });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
};

// Get all batches
export const getBatches = async (req: any, res: Response) => {
  try {
    const prisma = await getPrisma();
    console.log('🔍 Get batches request:', req.query);
    console.log('🔍 User context:', { userId: req.user?.id, role: getUserRole(req), branchId: req.user?.branchId, companyId: req.user?.companyId });
    const { page = 1, limit = 50, search = '', isActive, isReported, productId } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    // Get context from headers (set by frontend) - consistent with other controllers
    const selectedCompanyId = req.headers['x-company-id'] as string;
    const selectedBranchId = req.headers['x-branch-id'] as string;
    const userBranchId = req.user?.branchId;
    const userCompanyId = req.user?.companyId;

    // Determine target branch/company
    const targetBranchId = selectedBranchId || userBranchId || null;
    // Company fallback chain: "All Branches" mode sends no X-Branch-ID, so fall back to
    // the middleware-resolved business context (X-Business-ID header → req.user.selectedCompanyId / req.business_id)
    let targetCompanyId = selectedCompanyId || userCompanyId ||
      req.business_id || req.membership?.business_id ||
      req.user?.selectedCompanyId || req.headers['x-business-id'] || null;

    console.log('🔍 getBatches:', { targetBranchId, targetCompanyId });

    // If we have branchId but no companyId, get companyId from the branch
    if (targetBranchId && !targetCompanyId) {
      const branch = await prisma.branch.findUnique({
        where: { id: targetBranchId },
        select: { companyId: true }
      });
      if (branch?.companyId) {
        targetCompanyId = branch.companyId;
        console.log('🔍 Got companyId from branch:', targetCompanyId);
      }
    }

    const where: any = {};

    // Apply branch and company filters
    if (targetBranchId) {
      where.branchId = targetBranchId;
    }
    if (targetCompanyId) {
      where.companyId = targetCompanyId;
    }

    // Temporarily remove user filtering to show all batches for the branch
    // TODO: Re-implement proper user filtering later
    // if (req.user?.role === 'OWNER' || req.user?.role === 'MANAGER' || req.user?.role === 'CASHIER') {
    //   if (req.user?.createdBy) {
    //     where.OR = [
    //       { createdBy: req.user.id },
    //       { createdBy: req.user.createdBy }
    //     ];
    //   } else {
    //     where.createdBy = req.user.id;
    //   }
    // }

    if (search) {
      // For nested product search, we need to handle it differently
      const searchTerm = search as string;
      const searchConditions = createSearchConditions(
        ['batchNo', 'supplierName', 'supplierInvoiceNo'],
        searchTerm
      );

      // Add product name and formula search
      if (searchConditions.OR) {
        searchConditions.OR.push(
          { product: { name: { contains: searchTerm } } },
          { product: { formula: { contains: searchTerm } } }
        );
        where.OR = searchConditions.OR;
      }
    }

    if (isActive !== undefined) {
      // Handle both string and boolean values
      where.isActive = isActive === 'true' || isActive === true || isActive === 1;
    }

    if (isReported !== undefined) {
      // Handle both string and boolean values
      where.isReported = isReported === 'true' || isReported === true || isReported === 1;
    }

    if (productId) {
      where.productId = productId;
    }

    console.log('🔍 Query where clause:', where);

    // Use explicit select from start to avoid reportReason column issues
    let batches: any[];
    let total: number;
    
    try {
      const [batchesResult, totalResult] = await Promise.all([
      prisma.batch.findMany({
        where,
          select: {
            id: true,
            batchNo: true,
            productId: true,
            branchId: true,
            companyId: true,
            supplierId: true,
            supplierName: true,
            barcode: true,
            totalBoxes: true,
            unitsPerBox: true,
            quantity: true,
            purchasePrice: true,
            sellingPrice: true,
            stockPurchasePrice: true,
            paidAmount: true,
            supplierOutstanding: true,
            supplierInvoiceNo: true,
            purchasingMethod: true,
            expireDate: true,
            productionDate: true,
            shelfId: true,
            shelfName: true,
            isActive: true,
            isReported: true,
            createdAt: true,
            updatedAt: true,
            createdBy: true,
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.batch.count({ where }),
    ]);
      
      // Assign results and add null reportReason to all batches
      batches = batchesResult.map((batch: any) => ({
        ...batch,
        reportReason: null,
      }));
      total = totalResult;
    } catch (queryError: any) {
      // If count fails due to reportReason, use raw SQL
      if (queryError?.message?.includes('reportReason') || queryError?.code === 'P2021') {
        console.error('⚠️ reportReason column missing. Using raw SQL for count...');
        
        try {
          batches = await prisma.batch.findMany({
            where,
            select: {
              id: true,
              batchNo: true,
              productId: true,
              branchId: true,
              companyId: true,
              supplierId: true,
              supplierName: true,
              barcode: true,
              totalBoxes: true,
              unitsPerBox: true,
              quantity: true,
              purchasePrice: true,
              sellingPrice: true,
              stockPurchasePrice: true,
              paidAmount: true,
              supplierOutstanding: true,
              supplierInvoiceNo: true,
              purchasingMethod: true,
              expireDate: true,
              productionDate: true,
              shelfId: true,
              shelfName: true,
              isActive: true,
              isReported: true,
              createdAt: true,
              updatedAt: true,
              createdBy: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
              supplier: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: parseInt(limit as string),
          });
          
          // Use raw SQL for count
          const countResult: any = await prisma.$executeRawUnsafe(
            `SELECT COUNT(*) as count FROM batches WHERE "isActive" = ${where.isActive === true ? 'true' : 'false'}${where.branchId ? ` AND "branchId" = '${where.branchId}'` : ''}${where.productId ? ` AND "productId" = '${where.productId}'` : ''}${where.isReported !== undefined ? ` AND "isReported" = ${where.isReported === true ? 'true' : 'false'}` : ''}`
          );
          
          if (Array.isArray(countResult) && countResult.length > 0) {
            total = Number(countResult[0].count || countResult[0]?.COUNT || 0);
          } else {
            total = batches.length;
          }
          
          // Add null reportReason
          batches = batches.map((batch: any) => ({
            ...batch,
            reportReason: null,
          }));
        } catch (fallbackError: any) {
          console.error('Error in fallback query:', fallbackError);
          throw queryError; // Re-throw original error
        }
      } else {
        throw queryError; // Re-throw if it's a different error
      }
    }

    console.log('🔍 Found batches:', batches.length);
    console.log('🔍 Total batches:', total);
    if (batches.length > 0) {
      console.log('🔍 First batch details:', {
        id: batches[0].id,
        batchNo: batches[0].batchNo,
        branchId: batches[0].branchId,
        createdBy: batches[0].createdBy
      });
    }

    return res.json({
      success: true,
      data: {
        batches: serializeBigInt(batches),
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total,
          pages: Math.ceil(total / parseInt(limit as string)),
        },
      },
    });
  } catch (error: any) {
    console.error('❌ Get batches error:', error);
    console.error('❌ Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack
    });
    
    // Check if error is due to missing reportReason column
    if (error?.message?.includes('reportReason') && error?.message?.includes('does not exist')) {
      console.error('⚠️ reportReason column missing. Please run migration:');
      console.error('   SQL: ALTER TABLE batches ADD COLUMN IF NOT EXISTS "reportReason" TEXT;');
      console.error('   Or run: npx prisma db push');
      
      // Try query without reportReason by using select to exclude it
      // Rebuild variables in catch block scope
      const prismaRetry = await getPrisma();
      const { page: pageRetry = 1, limit: limitRetry = 50, isActive: isActiveRetry, isReported: isReportedRetry, productId: productIdRetry } = req.query;
      const skipRetry = (parseInt(pageRetry as string) - 1) * parseInt(limitRetry as string);
      
      // Rebuild where clause
      const whereRetry: any = {};
      const targetBranchIdRetry = req.user?.selectedBranchId || req.user?.branchId;
      const targetCompanyIdRetry = req.user?.selectedCompanyId || req.user?.companyId;
      if (targetBranchIdRetry) whereRetry.branchId = targetBranchIdRetry;
      if (targetCompanyIdRetry) whereRetry.companyId = targetCompanyIdRetry;
      if (isActiveRetry !== undefined) whereRetry.isActive = isActiveRetry === 'true' || isActiveRetry === true || isActiveRetry === 1;
      if (isReportedRetry !== undefined) whereRetry.isReported = isReportedRetry === 'true' || isReportedRetry === true || isReportedRetry === 1;
      if (productIdRetry) whereRetry.productId = productIdRetry;
      
      try {
        const [batchesRetry, totalRetry] = await Promise.all([
          prismaRetry.batch.findMany({
            where: whereRetry,
            select: {
              id: true,
              batchNo: true,
              productId: true,
              branchId: true,
              companyId: true,
              supplierId: true,
              supplierName: true,
              barcode: true,
              totalBoxes: true,
              unitsPerBox: true,
              quantity: true,
              purchasePrice: true,
              sellingPrice: true,
              stockPurchasePrice: true,
              paidAmount: true,
              supplierOutstanding: true,
              supplierInvoiceNo: true,
              purchasingMethod: true,
              expireDate: true,
              productionDate: true,
              shelfId: true,
              shelfName: true,
              isActive: true,
              isReported: true,
              createdAt: true,
              updatedAt: true,
              createdBy: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
              supplier: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            skip: skipRetry,
            take: parseInt(limitRetry as string),
          }),
          prismaRetry.batch.count({ where: whereRetry }),
        ]);
        
        // Map batches and add null reportReason
        const mappedBatches = batchesRetry.map((batch: any) => ({
          ...batch,
          reportReason: null, // Add null for missing column
        }));
        
        return res.json({
          success: true,
          data: {
            batches: serializeBigInt(mappedBatches),
            pagination: {
              page: parseInt(pageRetry as string),
              limit: parseInt(limitRetry as string),
              total: totalRetry,
              pages: Math.ceil(totalRetry / parseInt(limitRetry as string)),
            },
          },
        });
      } catch (retryError: any) {
        console.error('❌ Retry query also failed:', retryError);
      }
    }
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
};

// Get batch by ID
export const getBatchById = async (req: any, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    return res.json({
      success: true,
      data: serializeBigInt(batch),
    });
  } catch (error) {
    console.error('Get batch by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Create new batch
export const createBatch = async (req: any, res: Response) => {
  try {
    const prisma = await getPrisma();
    console.log('🔍 Create batch request body:', req.body);
    const { error, value } = createBatchSchema.validate(req.body);
    if (error) {
      console.log('❌ Validation error:', error.details);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const batchData = value;
    let branchId: string | undefined = req.user?.selectedBranchId || req.user?.branchId;
    let companyId: string | undefined = req.user?.selectedCompanyId || req.user?.companyId;

    // Use multi-tenant context
    if (!branchId) branchId = req.branch_id;
    if (!companyId) companyId = req.business_id;

    // If still no branch/company, try to get from the product
    if (!branchId || !companyId) {
      const product = await prisma.product.findUnique({
        where: { id: batchData.productId },
        select: { branchId: true, companyId: true }
      });

      if (product) {
        branchId = branchId || product.branchId;
        companyId = companyId || product.companyId;
      }
    }

    if (!branchId || !companyId) {
      return res.status(400).json({
        success: false,
        message: 'Branch and company context required. Please ensure you have proper access permissions.',
      });
    }

    // Check if batch number already exists for this product and branch
    const existingBatch = await prisma.batch.findFirst({
      where: {
        batchNo: batchData.batchNo,
        productId: batchData.productId,
        branchId,
      },
    });

    if (existingBatch) {
      return res.status(400).json({
        success: false,
        message: 'Batch number already exists for this product',
      });
    }

    // Verify product exists
    const product = await prisma.product.findUnique({
      where: { id: batchData.productId },
    });

    if (!product) {
      return res.status(400).json({
        success: false,
        message: 'Product not found',
      });
    }

    // Map frontend field names to database field names
    const mappedData = {
      ...batchData,
      // Use pricing fields directly from validation
      purchasePrice: batchData.purchasePrice,
      sellingPrice: batchData.sellingPrice,
      totalBoxes: batchData.totalBoxes || 0,
      unitsPerBox: batchData.unitsPerBox || 1,
      quantity: batchData.quantity,
      branchId,
      companyId,
      createdBy: req.user?.id,
    };

    console.log('🔍 Mapped data for database:', mappedData);

    const batch = await prisma.batch.create({
      data: mappedData,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (batchData.unitsPerBox && batchData.unitsPerBox > 1) {
      await prisma.product.update({
        where: { id: batchData.productId },
        data: { unitsPerPack: batchData.unitsPerBox }
      });
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('batch', 'create', batch).catch(err => {
      console.error('[Sync] Batch create sync failed:', err.message);
    });

    return res.status(201).json({
      success: true,
      data: batch,
      message: 'Batch created successfully',
    });
  } catch (error: any) {
    console.error('❌ Create batch error:', error);
    console.error('❌ Error details:', {
      message: error?.message || 'Unknown error',
      stack: error?.stack || 'No stack trace',
      name: error?.name || 'Unknown error type'
    });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update batch
export const updateBatch = async (req: any, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    console.log('🔍 Update batch request body:', req.body);
    const { error, value } = updateBatchSchema.validate(req.body);
    if (error) {
      console.log('🔍 Validation error details:', error.details);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const batchData = value;

    // Check if batch exists
    // Handle case where reportReason column might not exist
    let existingBatch;
    try {
      existingBatch = await prisma.batch.findUnique({
      where: { id },
    });
    } catch (findError: any) {
      // If error is due to missing reportReason column, retry with explicit select
      if (findError?.message?.includes('reportReason') && findError?.message?.includes('does not exist')) {
        console.warn('⚠️ reportReason column missing. Fetching batch without reportReason...');
        existingBatch = await prisma.batch.findUnique({
          where: { id },
          select: {
            id: true,
            batchNo: true,
            productId: true,
            supplierId: true,
            supplierName: true,
            expireDate: true,
            productionDate: true,
            shelfId: true,
            shelfName: true,
            isActive: true,
            isReported: true,
            purchasePrice: true,
            sellingPrice: true,
            quantity: true,
            totalBoxes: true,
            unitsPerBox: true,
            branchId: true,
            companyId: true,
            createdBy: true,
            createdAt: true,
            updatedAt: true,
            // Explicitly exclude reportReason
          },
        }) as any;
      } else {
        throw findError; // Re-throw if it's a different error
      }
    }

    if (!existingBatch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    // If updating batch number, check for duplicates
    if (batchData.batchNo && batchData.batchNo !== existingBatch.batchNo) {
      let duplicateBatch;
      try {
        duplicateBatch = await prisma.batch.findFirst({
        where: {
          batchNo: batchData.batchNo,
          productId: existingBatch.productId,
          branchId: existingBatch.branchId,
          id: { not: id },
        },
      });
      } catch (findError: any) {
        // If error is due to missing reportReason column, retry with explicit select
        if (findError?.message?.includes('reportReason') && findError?.message?.includes('does not exist')) {
          duplicateBatch = await prisma.batch.findFirst({
            where: {
              batchNo: batchData.batchNo,
              productId: existingBatch.productId,
              branchId: existingBatch.branchId,
              id: { not: id },
            },
            select: {
              id: true,
              batchNo: true,
              // Only select what we need for duplicate check
            },
          }) as any;
        } else {
          throw findError; // Re-throw if it's a different error
        }
      }

      if (duplicateBatch) {
        return res.status(400).json({
          success: false,
          message: 'Batch number already exists for this product',
        });
      }
    }

    // Map frontend field names to database field names
    // Only include fields that are actually provided (not undefined)
    const mappedData: any = {};
    
    if (batchData.batchNo !== undefined) mappedData.batchNo = batchData.batchNo;
    if (batchData.productId !== undefined) mappedData.productId = batchData.productId;
    if (batchData.supplierId !== undefined) mappedData.supplierId = batchData.supplierId || null;
    if (batchData.supplierName !== undefined) mappedData.supplierName = batchData.supplierName || null;
    if (batchData.expireDate !== undefined) mappedData.expireDate = batchData.expireDate || null;
    if (batchData.productionDate !== undefined) mappedData.productionDate = batchData.productionDate || null;
    if (batchData.shelfId !== undefined) mappedData.shelfId = batchData.shelfId || null;
    if (batchData.shelfName !== undefined) mappedData.shelfName = batchData.shelfName || null;
    if (batchData.isActive !== undefined) mappedData.isActive = batchData.isActive;
    if (batchData.isReported !== undefined) mappedData.isReported = batchData.isReported;
    // Conditionally include reportReason only if column exists or if we're not trying to set it
    // We'll handle the missing column error in the catch block
    if (batchData.reportReason !== undefined) {
      // Try to include reportReason, but we'll catch the error if column doesn't exist
      mappedData.reportReason = batchData.reportReason || null;
    }
    if (batchData.purchasePrice !== undefined) mappedData.purchasePrice = batchData.purchasePrice;
    if (batchData.sellingPrice !== undefined) mappedData.sellingPrice = batchData.sellingPrice;
    if (batchData.quantity !== undefined) mappedData.quantity = batchData.quantity;
    if (batchData.totalBoxes !== undefined) mappedData.totalBoxes = batchData.totalBoxes;
    if (batchData.unitsPerBox !== undefined) mappedData.unitsPerBox = batchData.unitsPerBox;

    let batch;
    try {
      batch = await prisma.batch.update({
      where: { id },
      data: mappedData,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    } catch (updateError: any) {
      // Check if error is due to missing reportReason column
      if (updateError?.message?.includes('reportReason') && updateError?.message?.includes('does not exist')) {
        console.error('⚠️ reportReason column missing. Updating without reportReason...');
        
        // Remove reportReason from mappedData and retry
        const { reportReason, ...dataWithoutReportReason } = mappedData;
        
        batch = await prisma.batch.update({
          where: { id },
          data: dataWithoutReportReason,
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                barcode: true,
              },
            },
            supplier: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        
        // Add reportReason as null to the response (it will be stored elsewhere or user needs to run migration)
        batch = {
          ...batch,
          reportReason: batchData.reportReason || null,
        } as any;
        
        console.warn('⚠️ Batch updated without reportReason. Please run migration to add the column.');
      } else {
        throw updateError; // Re-throw if it's a different error
      }
    }

    if (batchData.unitsPerBox && batchData.unitsPerBox > 1) {
      await prisma.product.update({
        where: { id: existingBatch.productId },
        data: { unitsPerPack: batchData.unitsPerBox }
      });
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('batch', 'update', batch).catch(err => {
      console.error('[Sync] Batch update sync failed:', err.message);
    });

    return res.json({
      success: true,
      data: serializeBigInt(batch),
      message: 'Batch updated successfully',
    });
  } catch (error: any) {
    console.error('❌ Update batch error:', error);
    console.error('❌ Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack
    });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
};

// Restock batch
export const restockBatch = async (req: any, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { quantity, notes } = req.body;

    // Validate input
    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid quantity is required',
      });
    }

    // Check if batch exists
    const existingBatch = await prisma.batch.findUnique({
      where: { id },
    });

    if (!existingBatch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    // Update the batch stock quantity
    const updatedBatch = await prisma.batch.update({
      where: { id },
      data: {
        quantity: (existingBatch.quantity || 0) + quantity,
        updatedAt: new Date(),
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Log the restock activity (optional - you can add to an activity log table)
    console.log(`Batch ${existingBatch.batchNo} restocked with ${quantity} units. Notes: ${notes || 'No notes'}`);

    return res.json({
      success: true,
      data: {
        id: updatedBatch.id,
        batchNo: updatedBatch.batchNo,
        stockQuantity: updatedBatch.quantity,
        updatedAt: updatedBatch.updatedAt,
      },
      message: `Successfully added ${quantity} units to batch ${existingBatch.batchNo}`,
    });
  } catch (error) {
    console.error('Restock batch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete batch
export const deleteBatch = async (req: any, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const batch = await prisma.batch.findUnique({
      where: { id },
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    await prisma.batch.delete({
      where: { id },
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('batch', 'delete', { id }).catch(err => {
      console.error('[Sync] Batch delete sync failed:', err.message);
    });

    return res.json({
      success: true,
      message: 'Batch deleted successfully',
    });
  } catch (error) {
    console.error('Delete batch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get near expiry batches
export const getNearExpiryBatches = async (req: any, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { days = 30 } = req.query;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(days as string));
    expiryDate.setHours(23, 59, 59, 999); // End of the target day

    let whereClause: any = {
      isActive: true,
    };

    const userRole = getUserRole(req);

    // Determine the branch and company context based on user role
    let targetBranchId = req.user?.selectedBranchId || req.user?.branchId;
    let targetCompanyId = req.user?.selectedCompanyId || req.user?.companyId;

    // Ensure users only see their branch data
    if (true) {
      // Use the user's assigned branch if no specific branch is selected
      if (!targetBranchId) {
        targetBranchId = req.user?.branchId;
      }

      // Use the user's assigned company if no specific company is selected
      if (!targetCompanyId) {
        targetCompanyId = req.user?.companyId;
      }
    }

    // Apply branch and company filters
    if (targetBranchId) {
      whereClause.branchId = targetBranchId;
    }
    if (targetCompanyId) {
      whereClause.companyId = targetCompanyId;
    }

    // Add data isolation based on user role
    if (userRole === 'OWNER' || userRole === 'MANAGER' || userRole === 'CASHIER') {
      // For non-owner users, filter by their admin's data
      if (req.user?.createdBy) {
        whereClause.createdBy = req.user.createdBy;
      }
    }

    if (parseInt(days as string) === 0) {
      // For expired batches (days = 0), get batches that expired before today
      whereClause.expireDate = {
        lt: today,
      };
    } else {
      // For near expiry batches, get batches expiring between today and the target date
      whereClause.expireDate = {
        lte: expiryDate,
        gte: today,
      };
    }

    try {
    const batches = await prisma.batch.findMany({
      where: whereClause,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
      },
      orderBy: { expireDate: 'asc' },
    });

    return res.json({
      success: true,
      data: serializeBigInt(batches),
    });
    } catch (queryError: any) {
      // Check if error is due to missing reportReason column
      if (queryError?.message?.includes('reportReason') && queryError?.message?.includes('does not exist')) {
        console.error('⚠️ reportReason column missing. Using select to exclude it...');
        
        // Retry query with explicit select to exclude reportReason
        const batches = await prisma.batch.findMany({
          where: whereClause,
          select: {
            id: true,
            batchNo: true,
            productId: true,
            branchId: true,
            companyId: true,
            supplierId: true,
            supplierName: true,
            barcode: true,
            totalBoxes: true,
            unitsPerBox: true,
            quantity: true,
            purchasePrice: true,
            sellingPrice: true,
            stockPurchasePrice: true,
            paidAmount: true,
            supplierOutstanding: true,
            supplierInvoiceNo: true,
            purchasingMethod: true,
            expireDate: true,
            productionDate: true,
            shelfId: true,
            shelfName: true,
            isActive: true,
            isReported: true,
            // reportReason: true, // Exclude this temporarily
            createdAt: true,
            updatedAt: true,
            createdBy: true,
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
          },
          orderBy: { expireDate: 'asc' },
        });
        
        // Map batches and add null reportReason
        const mappedBatches = batches.map((batch: any) => ({
          ...batch,
          reportReason: null, // Add null for missing column
        }));
        
        return res.json({
          success: true,
          data: serializeBigInt(mappedBatches),
        });
      }
      throw queryError; // Re-throw if it's a different error
    }
  } catch (error: any) {
    console.error('❌ Get near expiry batches error:', error);
    console.error('❌ Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
    });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
};
