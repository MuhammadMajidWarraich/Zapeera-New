import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';

// Get inventory summary (stock levels by product)
export const getInventorySummary = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 10, search, categoryId, lowStock } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const headerBranchId = req.headers['x-branch-id'] as string | undefined;
    const headerCompanyId = req.headers['x-company-id'] as string | undefined;

    let branchId: string | undefined =
      req.branch_id || headerBranchId;
    let companyId: string | undefined =
      req.business_id || headerCompanyId;

    // Use multi-tenant context from middleware - no need for user fallbacks

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context required. Please ensure you have a business selected.',
      });
    }

    const where: any = {
      companyId,
      isActive: true,
    };

    if (branchId) {
      where.branchId = branchId;
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string } },
        { sku: { contains: search as string } },
        { barcode: { contains: search as string } },
        { formula: { contains: search as string } } // Search by formula/composition
      ];
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    // Note: lowStock filtering will be handled after fetching products with batch data

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          batches: {
            where: {
              isActive: true,
              quantity: {
                gt: 0,
              },
            },
            select: {
              id: true,
              batchNo: true,
              quantity: true,
              expireDate: true,
              purchasePrice: true,
              sellingPrice: true,
            },
            orderBy: { expireDate: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
        skip,
        take: Number(limit),
      }),
      prisma.product.count({ where }),
    ]);

    // Calculate batch totals and expiry warnings
    const inventoryData = products.map(product => {
      // Filter out expired batches for stock calculation
      const activeBatches = product.batches.filter(batch => {
        if (!batch.expireDate) return true; // Include batches without expiry date
        return new Date(batch.expireDate) > new Date(); // Only include non-expired batches
      });

      const totalBatchQuantity = activeBatches.reduce((sum, batch) => sum + batch.quantity, 0);
      const nearExpiryBatches = product.batches.filter(batch => {
        if (!batch.expireDate) return false;
        const daysUntilExpiry = Math.ceil((new Date(batch.expireDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        return daysUntilExpiry <= 30 && daysUntilExpiry > 0;
      });
      const expiredBatches = product.batches.filter(batch => {
        if (!batch.expireDate) return false;
        return new Date(batch.expireDate) < new Date();
      });

      return {
        ...product,
        stock: totalBatchQuantity, // Use only active (non-expired) batch quantities
        totalBatchQuantity,
        nearExpiryBatches: nearExpiryBatches.length,
        expiredBatches: expiredBatches.length,
        isLowStock: totalBatchQuantity <= product.minStock,
        stockStatus: totalBatchQuantity <= product.minStock ? 'LOW' :
                    totalBatchQuantity <= product.minStock * 2 ? 'MEDIUM' : 'GOOD',
      };
    });

    return res.json({
      success: true,
      data: inventoryData,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get inventory summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get inventory by batches
export const getInventoryByBatches = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 10, search, productId, nearExpiry, expired, branchId: queryBranchId } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const headerBranchId = req.headers['x-branch-id'] as string | undefined;
    const headerCompanyId = req.headers['x-company-id'] as string | undefined;

    // Priority: explicit middleware-resolved branch > query param > header
    let branchId: string | undefined =
      req.branch_id || (queryBranchId as string) || headerBranchId;
    let companyId: string | undefined =
      req.business_id || headerCompanyId;

    const userRole = getUserRole(req);

    console.log('🔍 getInventoryByBatches - Initial context:', {
      queryBranchId,
      branchId,
      companyId,
      userId: req.user?.id,
      role: userRole,
      createdBy: req.user?.createdBy
    });

    // Use multi-tenant context - no admin lookup needed

    // If we have branchId but no companyId, get companyId from the branch
    if (branchId && !companyId) {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { companyId: true }
      });
      if (branch?.companyId) {
        companyId = branch.companyId;
        console.log('🔍 Got companyId from branch:', companyId);
      }
    }

    // For OWNER/ADMIN, if still no branch, try to get from the product if productId is provided
    if (!branchId && productId && userRole === 'OWNER') {
      const product = await prisma.product.findUnique({
        where: { id: productId as string },
        select: { id: true, branchId: true, companyId: true }
      });
      if (product) {
        branchId = product.branchId;
        companyId = product.companyId;
        console.log('🔍 Got context from product:', { branchId, companyId });
      }
    }

    console.log('🔍 getInventoryByBatches - Final context:', { branchId, companyId, productId });

    // CRITICAL FIX: For POS, if productId is provided, don't require branchId/companyId
    // Fetch all batches for the product first, then filter by branch if provided
    // This ensures batches are visible even if branch context is not set
    const where: any = {
      isActive: true,
      quantity: {
        gt: 0,
      },
    };

    // CRITICAL FIX: Exclude reported batches - they should not be available for sale
    // Only exclude batches explicitly marked as reported (isReported = true)
    // Include batches with isReported = false or NULL
    where.isReported = {
      not: true,
    };

    // If productId is provided, filter by it (this is the main filter for POS)
    if (productId) {
      where.productId = productId;
    }

    // Apply branch/company filters if provided, but don't require them
    // This allows fetching batches even without branch selection
    if (branchId) {
      where.branchId = branchId;
    }
    if (companyId) {
      where.companyId = companyId;
    }

    if (search) {
      where.OR = [
        { batchNo: { contains: search as string } },
        { product: { name: { contains: search as string } } },
        { product: { sku: { contains: search as string } } },
        { product: { formula: { contains: search as string } } } // Search by product formula
      ];
    }

    if (nearExpiry === 'true') {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      where.expireDate = {
        lte: thirtyDaysFromNow,
        gte: new Date(),
      };
    }

    if (expired === 'true') {
      where.expireDate = {
        lt: new Date(),
      };
    }

    console.log('🔍 getInventoryByBatches - Where clause:', JSON.stringify(where, null, 2));

    const [batches, total] = await Promise.all([
      prisma.batch.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              barcode: true,
              minStock: true,
              unitsPerPack: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [
          { expireDate: 'asc' },
          { createdAt: 'asc' },
        ],
        skip,
        take: Number(limit),
      }),
      prisma.batch.count({ where }),
    ]);

    console.log('🔍 getInventoryByBatches - Found batches:', batches.length, 'out of', total, 'total');
    if (batches.length > 0) {
      console.log('🔍 getInventoryByBatches - Sample batch:', {
        id: batches[0].id,
        batchNo: batches[0].batchNo,
        productId: batches[0].productId,
        branchId: batches[0].branchId,
        companyId: batches[0].companyId,
        quantity: batches[0].quantity,
        isReported: batches[0].isReported
      });
    } else {
      console.log('🔍 getInventoryByBatches - ⚠️ No batches found with filters:', JSON.stringify(where, null, 2));
    }

    // Add expiry status to each batch
    const batchData = batches.map(batch => {
      let expiryStatus = 'GOOD';
      if (batch.expireDate) {
        const daysUntilExpiry = Math.ceil((new Date(batch.expireDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilExpiry < 0) {
          expiryStatus = 'EXPIRED';
        } else if (daysUntilExpiry <= 7) {
          expiryStatus = 'CRITICAL';
        } else if (daysUntilExpiry <= 30) {
          expiryStatus = 'WARNING';
        }
      }

      const totalBoxes = batch.totalBoxes || 0;
      const computedUnitsPerBox = totalBoxes > 0 && batch.quantity
        ? Math.round(batch.quantity / totalBoxes)
        : 0;
      const normalizedUnitsPerBox = batch.unitsPerBox && batch.unitsPerBox > 0
        ? batch.unitsPerBox
        : (computedUnitsPerBox || batch.product?.unitsPerPack || 0);

      return {
        ...batch,
        totalBoxes,
        unitsPerBox: normalizedUnitsPerBox,
        expiryStatus,
        daysUntilExpiry: batch.expireDate ?
          Math.ceil((new Date(batch.expireDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) :
          null,
      };
    });

    return res.json({
      success: true,
      data: batchData,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get inventory by batches error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get inventory reports
export const getInventoryReports = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    let branchId: string | undefined = req.branch_id;
    let companyId: string | undefined = req.business_id;

    // Use multi-tenant context from middleware

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context required. Please ensure you have a business selected.',
      });
    }

    // Get various inventory statistics
    const [
      totalProducts,
      lowStockProducts,
      nearExpiryBatches,
      expiredBatches,
      totalStockValue,
      categoryStats,
    ] = await Promise.all([
      // Total products
      prisma.product.count({
        where: {
          ...(branchId ? { branchId } : {}),
          companyId,
          isActive: true,
        },
      }),

      // Low stock products
      // Count low stock products by checking batch quantities
      (async () => {
        const products = await prisma.product.findMany({
          where: {
          ...(branchId ? { branchId } : {}),
          companyId,
          isActive: true,
          },
          include: {
            batches: {
              where: {
                isActive: true,
                quantity: { gt: 0 },
                OR: [
                  { expireDate: null },
                  { expireDate: { gt: new Date() } }
                ]
              },
              select: {
                quantity: true
              }
            }
          }
        });

        return products.filter(product => {
          const totalStock = product.batches.reduce((sum, batch) => sum + batch.quantity, 0);
          return totalStock <= product.minStock;
        }).length;
      })(),

      // Near expiry batches (within 30 days)
      prisma.batch.count({
        where: {
          ...(branchId ? { branchId } : {}),
          companyId,
          isActive: true,
          quantity: { gt: 0 },
          expireDate: {
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            gte: new Date(),
          },
        },
      }),

      // Expired batches
      prisma.batch.count({
        where: {
          ...(branchId ? { branchId } : {}),
          companyId,
          isActive: true,
          quantity: { gt: 0 },
          expireDate: {
            lt: new Date(),
          },
        },
      }),

      // Total stock value
      prisma.batch.aggregate({
        where: {
          ...(branchId ? { branchId } : {}),
          companyId,
          isActive: true,
          quantity: { gt: 0 },
        },
        _sum: {
          quantity: true,
        },
      }),

      // Category statistics
      prisma.product.groupBy({
        by: ['categoryId'],
        where: {
          ...(branchId ? { branchId } : {}),
          companyId,
          isActive: true,
        },
        _count: {
          id: true,
        },
        _sum: {
          minStock: true,
        },
      }),
    ]);

    // Get category names
    const categoryIds = categoryStats.map(stat => stat.categoryId);
    const categories = await prisma.category.findMany({
      where: {
        id: { in: categoryIds },
      },
      select: {
        id: true,
        name: true,
        type: true,
      },
    });

    const categoryStatsWithNames = categoryStats.map(stat => {
      const category = categories.find(cat => cat.id === stat.categoryId);
      return {
        categoryId: stat.categoryId,
        categoryName: category?.name || 'Unknown',
        categoryType: category?.type || 'GENERAL',
        productCount: stat._count.id,
        totalStock: stat._sum.minStock || 0,
      };
    });

    return res.json({
      success: true,
      data: {
        totalProducts,
        lowStockProducts,
        nearExpiryBatches,
        expiredBatches,
        totalStockValue: totalStockValue._sum.quantity || 0,
        categoryStats: categoryStatsWithNames,
      },
    });
  } catch (error) {
    console.error('Get inventory reports error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
