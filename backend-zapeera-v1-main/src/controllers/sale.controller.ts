// CRITICAL: Import database initialization FIRST to ensure DATABASE_URL is set
import '../config/database.init';

import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { CreateSaleData, SaleResponse, PaymentStatus } from '../models/sale.model';
import { AuthRequest, buildBranchWhereClause, getUserRole } from '../middleware/auth.middleware';
import { notifySaleChange } from '../routes/sse.routes';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import { isMissingTableError } from '../utils/membership-bridge.util';
import { createNotification } from './notification.controller';
import Joi from 'joi';

// Validation schemas
const createSaleSchema = Joi.object({
  customerId: Joi.string().allow(null),
  branchId: Joi.string().required(),
  items: Joi.array().items(
    Joi.object({
      productId: Joi.string().required(),
      quantity: Joi.number().min(1).required(),
      saleType: Joi.string().valid('UNIT', 'BOX', 'unit', 'box').optional(),
      unitsDeducted: Joi.number().min(1).optional(),
      unitsPerBox: Joi.number().min(1).optional(),
      unitPrice: Joi.number().positive().required(),
      batchId: Joi.string().allow(null, ''), // Link to specific batch
      batchNumber: Joi.string().allow(''), // Keep for backward compatibility
      expiryDate: Joi.string().allow(''),
      discountPercentage: Joi.number().min(0).max(100).optional(), // Item-level discount
      discountAmount: Joi.number().min(0).optional(), // Item-level discount amount
      totalPrice: Joi.number().min(0).optional() // Item total after discount
    })
  ).min(1).required(),
  paymentMethod: Joi.string().valid('CASH', 'CARD', 'MOBILE', 'BANK_TRANSFER').required(),
  paymentStatus: Joi.string().valid('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED').optional(),
  discountAmount: Joi.number().min(0).default(0),
  discountPercentage: Joi.number().min(0).max(100).default(0),
  paidAmount: Joi.number().min(0).default(0), // Amount paid by customer
  returnedAmount: Joi.number().min(0).default(0), // Amount returned/refunded
  saleDate: Joi.date().optional()
});

const isMissingMembershipColumnError = (error: any): boolean => {
  const message = String(error?.message || '').toLowerCase();
  return (
    isMissingTableError(error) ||
    message.includes('membershipId') ||
    message.includes('no such column') ||
    message.includes('unknown column')
  );
};

export const getSales = async (req: AuthRequest, res: Response) => {
  try {
    // 🔄 PULL LATEST FROM LIVE DATABASE FIRST (skip in PostgreSQL mode or if connection pool is exhausted)
    // In PostgreSQL mode, data is already in PostgreSQL, so no sync needed
    const isPostgreSQLMode = process.env.USE_POSTGRESQL === 'true';
    if (!isPostgreSQLMode) {
      try {
        // Use timeout to prevent hanging on sync operations
        await Promise.race([
          Promise.all([
            pullLatestFromLive('sale').catch(err => {
              console.log('[Sync] Pull sales failed:', err.message);
              return null;
            }),
            pullLatestFromLive('saleItem').catch(err => {
              console.log('[Sync] Pull saleItems failed:', err.message);
              return null;
            })
          ]),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 1000))
        ]).catch(err => {
          if (err.message !== 'Sync timeout') {
            console.log('[Sync] Sync operation failed, continuing without sync:', err.message);
          }
        });
      } catch (syncError: any) {
        console.log('[Sync] Skipping sync due to error:', syncError.message);
        // Continue without sync - data might already be up to date
      }
    } else {
      console.log('[Sync] ⏭️  PostgreSQL mode - No pull needed (data already in PostgreSQL)');
    }

    const prisma = await getPrisma();
    const {
      page = 1,
      limit = 10,
      startDate = '',
      endDate = '',
      branchId = '',
      customerId = '',
      paymentMethod = ''
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    // Build where clause with data isolation
    const where: any = buildBranchWhereClause(req, {});

    // Additional branch filter only if not already filtered by buildBranchWhereClause
    const userRole = getUserRole(req);
    if (branchId && userRole !== 'MANAGER') {
      where.branchId = branchId;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (paymentMethod) {
      where.paymentMethod = paymentMethod;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        // Add 23:59:59 to end date to include the entire day
        const endDateWithTime = new Date(endDate as string);
        endDateWithTime.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDateWithTime;
      }
    }

    let sales: any[];
    let total: number;
    
    try {
      [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        skip,
        take,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              totalPurchases: true,
              loyaltyPoints: true,
              isVIP: true,
              lastVisit: true
            }
          },
          user: {
            select: {
              id: true,
              name: true,
              username: true
            }
          },
          branch: {
            select: {
              id: true,
              name: true
            }
          },
          items: {
              select: {
                id: true,
                saleId: true,
                productId: true,
                batchId: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
                unitsDeducted: true,
                unitsPerBox: true,
                saleType: true,
                batchNumber: true,
                expiryDate: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                  }
                }
              }
            },
            receipts: {
              select: {
                receiptNumber: true,
                printedAt: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.sale.count({ where })
      ]);
    } catch (error: any) {
      console.error('❌ Error fetching sales:', error);
      console.error('❌ Error code:', error?.code);
      console.error('❌ Error message:', error?.message);
      console.error('❌ Where clause:', JSON.stringify(where, null, 2));
      
      // If error is related to connection pool, return empty result instead of crashing
      if (error?.code === 'P2037' || error?.message?.includes('connection slots') || error?.message?.includes('connection pool')) {
        console.error('⚠️ Database connection pool exhausted, returning empty result');
        return res.json({
          success: true,
          data: {
            sales: [],
            pagination: {
              page: Number(page),
              limit: Number(limit),
              total: 0,
              pages: 0
            }
          }
        });
      }
      
      // If error is related to batch or reportReason, try without batch relation
      if (error?.message?.includes('reportReason') || error?.message?.includes('batch')) {
        console.log('⚠️ Retrying sales query without batch relations...');
        [sales, total] = await Promise.all([
          prisma.sale.findMany({
            where,
            skip,
            take,
            include: {
              customer: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  totalPurchases: true,
                  loyaltyPoints: true,
                  isVIP: true,
                  lastVisit: true
                }
              },
              user: {
                select: {
                  id: true,
                  name: true,
                  username: true
                }
              },
              branch: {
                select: {
                  id: true,
                  name: true
                }
              },
              items: {
                select: {
                  id: true,
                  saleId: true,
                  productId: true,
                  batchId: true,
                  quantity: true,
                  unitPrice: true,
                  totalPrice: true,
                  unitsDeducted: true,
                  unitsPerBox: true,
                  saleType: true,
                  batchNumber: true,
                  expiryDate: true,
              product: {
                select: {
                  id: true,
                  name: true,
                }
              }
            }
          },
          receipts: {
            select: {
              receiptNumber: true,
              printedAt: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.sale.count({ where })
    ]);
      } else {
        throw error;
      }
    }

    return res.json({
      success: true,
      data: {
        sales,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Get sales error:', error);
    console.error('❌ Error details:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack?.substring(0, 500)
    });
    
    // If connection pool error, return empty result instead of crashing
    if (error?.code === 'P2037' || error?.message?.includes('connection slots') || error?.message?.includes('connection pool')) {
      console.error('⚠️ Database connection pool exhausted, returning empty result');
      return res.json({
        success: true,
        data: {
          sales: [],
          pagination: {
            page: Number(req.query.page) || 1,
            limit: Number(req.query.limit) || 10,
            total: 0,
            pages: 0
          }
        }
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
};

export const getSale = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            username: true
          }
        },
        branch: {
          select: {
            id: true,
            name: true,
          }
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                barcode: true
              }
            }
          }
        },
        receipts: {
          select: {
            id: true,
            receiptNumber: true,
            printedAt: true
          }
        }
      }
    });

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: 'Sale not found'
      });
    }

    return res.json({
      success: true,
      data: sale
    });
  } catch (error) {
    console.error('Get sale error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getSaleByReceiptNumber = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { receiptNumber } = req.params;

    console.log('Looking up receipt number:', receiptNumber);

    // First, let's see what receipt numbers exist in the database
    const allReceipts = await prisma.receipt.findMany({
      select: {
        receiptNumber: true,
        saleId: true
      },
      take: 10
    });
    console.log('Available receipt numbers in database:', allReceipts);

    const sale = await prisma.sale.findFirst({
      where: {
        receipts: {
          some: {
            receiptNumber: receiptNumber
          }
        }
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            username: true
          }
        },
        branch: {
          select: {
            id: true,
            name: true,
          }
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                barcode: true
              }
            }
          }
        },
        receipts: {
          select: {
            id: true,
            receiptNumber: true,
            printedAt: true
          }
        }
      }
    });

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: `Sale not found for receipt number: ${receiptNumber}. Available receipts: ${allReceipts.map(r => r.receiptNumber).join(', ')}`
      });
    }

    return res.json({
      success: true,
      data: sale
    });
  } catch (error) {
    console.error('Get sale by receipt number error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getAvailableReceiptNumbers = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const receipts = await prisma.receipt.findMany({
      select: {
        id: true,
        receiptNumber: true,
        saleId: true,
        printedAt: true
      },
      orderBy: {
        printedAt: 'desc'
      },
      take: 50
    });

    return res.json({
      success: true,
      data: { receipts }
    });
  } catch (error) {
    console.error('Get available receipt numbers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const createSale = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    console.log('Sale creation request body:', req.body);
    const { error } = createSaleSchema.validate(req.body);
    if (error) {
      console.log('Sale validation error:', error.details);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const saleData: CreateSaleData = req.body;
    const userId = (req as any).user.id;

    // Get tax rate from settings
    const currentAdminId = req.user?.createdBy || req.user?.id;
    let taxRate = 0; // Tax disabled - set to 0

    if (currentAdminId) {
      try {
        const taxSetting = await prisma.settings.findUnique({
          where: {
            createdBy_key: {
              createdBy: currentAdminId,
              key: 'defaultTax'
            }
          }
        });

        if (taxSetting) {
          taxRate = parseFloat(taxSetting.value);
        }
      } catch (error) {
        console.warn('Could not fetch tax rate from settings, using default:', error);
      }
    }

    // Calculate totals with item-level discounts
    // For each item: calculate subtotal, apply item discount, then sum
    const itemTotals = saleData.items.map(item => {
      // If totalPrice is provided (already includes item discount), use it directly
      if (item.totalPrice !== undefined && item.totalPrice >= 0) {
        return item.totalPrice;
      }

      // Otherwise, calculate from unitPrice and discounts
      const itemSubtotal = item.quantity * item.unitPrice;
      let itemDiscountAmount = 0;

      // Calculate item discount if provided
      if (item.discountPercentage && item.discountPercentage > 0) {
        itemDiscountAmount = itemSubtotal * (item.discountPercentage / 100);
      } else if (item.discountAmount && item.discountAmount > 0) {
        itemDiscountAmount = item.discountAmount;
      }

      return itemSubtotal - itemDiscountAmount;
    });

    const subtotal = itemTotals.reduce((sum, total) => sum + total, 0);
    const discountAmount = saleData.discountAmount || 0; // Global discount
    const subtotalAfterDiscount = subtotal - discountAmount;
    const taxAmount = subtotalAfterDiscount * (taxRate / 100); // Tax on discounted amount
    const totalAmount = subtotalAfterDiscount + taxAmount;

    // Use transaction to ensure data consistency
    // Wrap in try-catch to handle transaction errors gracefully
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
      // Use selected company/branch context if available, otherwise use the provided branchId
      let targetCompanyId: string;
      let targetBranchId: string;

      if (req.user?.selectedCompanyId && req.user?.selectedBranchId) {
        // Use selected company/branch context
        targetCompanyId = req.user.selectedCompanyId;
        targetBranchId = req.user.selectedBranchId;
        console.log('🏢 Using selected company/branch context for sale:', { targetCompanyId, targetBranchId });
      } else {
        // Fallback to provided branchId
        const branch = await tx.branch.findUnique({
          where: { id: saleData.branchId },
          select: { companyId: true }
        });

        if (!branch) {
          throw new Error('Branch not found');
        }

        targetCompanyId = branch.companyId;
        targetBranchId = saleData.branchId;
        console.log('🏢 Using provided branch context for sale:', { targetCompanyId, targetBranchId });
      }

      // Determine payment status and sale status
      const paymentStatus: PaymentStatus = (saleData.paymentStatus || 'COMPLETED') as PaymentStatus;
      const saleStatus = paymentStatus === 'COMPLETED' ? 'COMPLETED' : 'PENDING';

      // Calculate paidAmount and returnedAmount
      const paidAmount = saleData.paidAmount || (paymentStatus === 'COMPLETED' ? totalAmount : 0);
      const returnedAmount = saleData.returnedAmount || 0;

      // Generate invoice number with retry logic to handle race conditions
      const generateUniqueInvoiceNumber = async (attempt: number = 0): Promise<string> => {
        if (attempt > 10) {
          // After 10 attempts, use timestamp-based unique number
          const timestamp = Date.now().toString().slice(-8);
          return `INV-${timestamp}`;
        }

      // Get the last invoice number to increment, or start from 10000
      const lastSale = await tx.sale.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { invoiceNumber: true }
      });

        let baseNumber: number;
      if (lastSale?.invoiceNumber) {
        // Extract number from last invoice (format: INV-XXXXX)
        const match = lastSale.invoiceNumber.match(/INV-(\d+)/);
        if (match) {
            baseNumber = parseInt(match[1], 10);
        } else {
            // Fallback: use random number
            baseNumber = Math.floor(Math.random() * 90000) + 10000;
        }
      } else {
        // First invoice: start from 10000
          baseNumber = 10000;
        }

        // Add attempt offset to handle concurrent requests
        const nextNumber = ((baseNumber + attempt) % 99999) || 10000;
        const invoiceNumber = `INV-${String(nextNumber).padStart(5, '0')}`;

        // Check if invoice number already exists (race condition check)
        const existingSale = await tx.sale.findUnique({
          where: { invoiceNumber: invoiceNumber },
          select: { id: true }
        });

        if (existingSale) {
          // Invoice number exists, retry with incremented attempt
          return generateUniqueInvoiceNumber(attempt + 1);
        }

        return invoiceNumber;
      };

      const invoiceNumber = await generateUniqueInvoiceNumber();

      // Create sale
      let sale;
      try {
        sale = await tx.sale.create({
        data: {
          invoiceNumber: invoiceNumber,
          customerId: saleData.customerId,
          userId: userId,
          branchId: targetBranchId,
          companyId: targetCompanyId,
          createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id',
          subtotal,
          taxAmount,
          discountAmount: discountAmount,
          discountPercentage: saleData.discountPercentage || 0,
          totalAmount,
          paidAmount: paidAmount,
          returnedAmount: returnedAmount,
          paymentMethod: saleData.paymentMethod,
          paymentStatus: paymentStatus,
          status: saleStatus,
          saleDate: saleData.saleDate ? new Date(saleData.saleDate) : undefined
        }
      });
      } catch (error: any) {
        // If unique constraint error, retry with new invoice number
        if (error.code === 'P2002' && error.meta?.target?.includes('invoiceNumber')) {
          console.log('⚠️ Invoice number collision detected, retrying with new number...');
          const newInvoiceNumber = await generateUniqueInvoiceNumber(1);
          sale = await tx.sale.create({
            data: {
              invoiceNumber: newInvoiceNumber,
              customerId: saleData.customerId,
              userId: userId,
              branchId: targetBranchId,
              companyId: targetCompanyId,
              createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id',
              subtotal,
              taxAmount,
              discountAmount: discountAmount,
              discountPercentage: saleData.discountPercentage || 0,
              totalAmount,
              paidAmount: paidAmount,
              returnedAmount: returnedAmount,
              paymentMethod: saleData.paymentMethod,
              paymentStatus: paymentStatus,
              status: saleStatus,
              saleDate: saleData.saleDate ? new Date(saleData.saleDate) : undefined
            }
          });
        } else {
          throw error;
        }
      }

      const actorMembershipId = req.membership?.id ? String(req.membership.id) : null;
      if (actorMembershipId) {
        try {
          await tx.$executeRaw`
            UPDATE sales
            SET "membershipId" = ${actorMembershipId},
                "updatedAt" = CURRENT_TIMESTAMP,
                "syncStatus" = 'PENDING'
            WHERE id = ${sale.id}
          `;
        } catch (membershipColumnError: any) {
          if (!isMissingMembershipColumnError(membershipColumnError)) {
            throw membershipColumnError;
          }
          console.warn('[Sales] membership_id write skipped (schema not ready):', membershipColumnError?.message || membershipColumnError);
        }
      }

      // Create sale items and update stock
      const saleItems = [];
      for (const item of saleData.items) {
        const normalizedSaleType = (item.saleType || 'UNIT').toString().toUpperCase();
        const unitsPerBox = item.unitsPerBox && item.unitsPerBox > 0 ? item.unitsPerBox : 1;
        const unitsRequired = item.unitsDeducted && item.unitsDeducted > 0
          ? item.unitsDeducted
          : (normalizedSaleType === 'BOX' ? item.quantity * unitsPerBox : item.quantity);

        // Check product availability
        console.log(`Looking for product with ID: ${item.productId}`);
        const product = await tx.product.findUnique({
          where: { id: item.productId }
        });

        if (!product) {
          // Get all products to see what IDs exist
          const allProducts = await tx.product.findMany({
            select: { id: true, name: true }
          });
          console.log('Available products:', allProducts);
          throw new Error(`Product with ID ${item.productId} not found`);
        }

        // Check stock availability through batches
        // Use explicit select to avoid reportReason column issues
        const availableBatches = await tx.batch.findMany({
          where: {
            productId: item.productId,
            branchId: targetBranchId,
            quantity: { gt: 0 },
            isActive: true
          },
          orderBy: { expireDate: 'asc' }, // FIFO - First In, First Out
          select: {
            id: true,
            productId: true,
            branchId: true,
            batchNo: true,
            quantity: true,
            expireDate: true,
            productionDate: true,
            sellingPrice: true,
            purchasePrice: true,
            isActive: true,
            isReported: true,
            createdAt: true,
            updatedAt: true
          }
        });

        const totalAvailableStock = availableBatches.reduce((sum: number, batch: any) => sum + batch.quantity, 0);

        if (totalAvailableStock < unitsRequired) {
          throw new Error(`Insufficient stock for ${product.name}. Available: ${totalAvailableStock}, Required: ${unitsRequired}`);
        }

        // Handle batch tracking (require a batch, fallback to FIFO if missing)
        // Use explicit select to avoid reportReason column issues
        let selectedBatch = null as any;
        if (item.batchId) {
          selectedBatch = await tx.batch.findFirst({
            where: {
              id: item.batchId,
              productId: item.productId,
              branchId: targetBranchId,
              isActive: true
            },
            select: {
              id: true,
              productId: true,
              branchId: true,
              batchNo: true,
              quantity: true,
              expireDate: true,
              productionDate: true,
              sellingPrice: true,
              purchasePrice: true,
              isActive: true,
              isReported: true,
              createdAt: true,
              updatedAt: true
            }
          });
          if (!selectedBatch) {
            throw new Error(`Selected batch not found for ${product.name}.`);
          }
          if (selectedBatch.quantity < unitsRequired) {
            throw new Error(`Insufficient stock in selected batch ${selectedBatch.batchNo}. Available: ${selectedBatch.quantity}, Required: ${unitsRequired}`);
          }
        } else if (item.batchNumber) {
          selectedBatch = await tx.batch.findFirst({
            where: {
              batchNo: item.batchNumber,
              productId: item.productId,
              branchId: targetBranchId,
              quantity: {
                gte: unitsRequired
              },
              isActive: true
            },
            orderBy: { expireDate: 'asc' }, // FIFO - First In, First Out
            select: {
              id: true,
              productId: true,
              branchId: true,
              batchNo: true,
              quantity: true,
              expireDate: true,
              productionDate: true,
              sellingPrice: true,
              purchasePrice: true,
              isActive: true,
              isReported: true,
              createdAt: true,
              updatedAt: true
            }
          });
          if (!selectedBatch) {
            throw new Error(`Batch ${item.batchNumber} not available with sufficient stock for ${product.name}. Required: ${unitsRequired} units.`);
          }
        } else {
          selectedBatch = await tx.batch.findFirst({
            where: {
              productId: item.productId,
              branchId: targetBranchId,
              quantity: {
                gte: unitsRequired
              },
              isActive: true
            },
            orderBy: { expireDate: 'asc' }, // FIFO - First In, First Out
            select: {
              id: true,
              productId: true,
              branchId: true,
              batchNo: true,
              quantity: true,
              expireDate: true,
              productionDate: true,
              sellingPrice: true,
              purchasePrice: true,
              isActive: true,
              isReported: true,
              createdAt: true,
              updatedAt: true
            }
          });
          if (!selectedBatch) {
            throw new Error(`No batch available with sufficient stock for ${product.name}. Required: ${unitsRequired} units.`);
          }
        }

        // Update batch quantity
        // Use raw SQL directly to avoid reportReason column issues
        await tx.$executeRawUnsafe(
          `UPDATE batches 
           SET quantity = quantity - ${unitsRequired},
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE id = '${selectedBatch.id}'`
        );

        // Create sale item
        // CRITICAL FIX: Use provided totalPrice if available (for pack/piece calculations)
        // Otherwise calculate: item.quantity * item.unitPrice
        // When pack is selected: quantity is in pieces (e.g., 12), unitPrice is price per pack
        // So we must use the provided totalPrice to avoid incorrect calculation
        const calculatedTotalPrice = item.totalPrice !== undefined && item.totalPrice !== null
          ? item.totalPrice
          : item.quantity * item.unitPrice;

        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: item.productId,
            batchId: selectedBatch.id,
            createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id',
            quantity: item.quantity, // Boxes or units (as entered)
            unitsDeducted: unitsRequired,
            unitsPerBox: unitsPerBox,
            saleType: normalizedSaleType,
            unitPrice: item.unitPrice, // Price per unit or per box (as sent)
            totalPrice: calculatedTotalPrice, // Use provided totalPrice for correct box/unit calculation
            batchNumber: item.batchNumber || selectedBatch.batchNo,
            expiryDate: (() => {
              if (!item.expiryDate || item.expiryDate === 'Invalid Date') return null;
              const date = new Date(item.expiryDate);
              return isNaN(date.getTime()) ? null : date;
            })()
          }
        });

        saleItems.push(saleItem);

        // Update product stock
        // Stock is now managed through batches, no need to update product stock directly

        // Create stock movement
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'OUT',
            quantity: unitsRequired,
            reason: 'Sale',
            reference: sale.id,
            createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id'
          }
        });
      }

      // Update customer stats if customer exists
      if (saleData.customerId) {
        await tx.customer.update({
          where: { id: saleData.customerId },
          data: {
            totalPurchases: {
              increment: totalAmount
            },
            loyaltyPoints: {
              increment: Math.floor(totalAmount / 100) // 1 point per 100 PKR
            },
            lastVisit: new Date()
          }
        });
      }

      // Generate receipt number - Short format: RCN-XXXXX (4-5 digits)
      // Get the last receipt number to increment, or start from 1
      const lastReceipt = await tx.receipt.findFirst({
        orderBy: { id: 'desc' }, // Use id for ordering since createdAt might not be available
        select: { receiptNumber: true }
      });

      let receiptNumber: string;
      if (lastReceipt?.receiptNumber) {
        // Extract number from last receipt (format: RCN-XXXXX)
        const match = lastReceipt.receiptNumber.match(/RCN-(\d+)/);
        if (match) {
          const lastNumber = parseInt(match[1], 10);
          const nextNumber = (lastNumber + 1) % 99999; // Wrap around at 99999
          receiptNumber = `RCN-${String(nextNumber).padStart(5, '0')}`;
        } else {
          // Fallback: generate random 4-5 digit number
          receiptNumber = `RCN-${String(Math.floor(Math.random() * 90000) + 10000)}`;
        }
      } else {
        // First receipt: start from 10000
        receiptNumber = `RCN-10000`;
      }

      // Create receipt
      const receipt = await tx.receipt.create({
        data: {
          saleId: sale.id,
          userId: userId,
          branchId: saleData.branchId,
          createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id',
          receiptNumber
        }
      });

      return { sale, saleItems, receipt };
      }, {
        timeout: 60000 // 60 seconds timeout for long-running transactions
        // Note: SQLite only supports Serializable isolation level, so we omit isolationLevel
      });
    } catch (error: any) {
      // Handle transaction errors specifically
      if (error.code === 'P2028') {
        console.error('❌ Transaction timeout or connection lost:', error.message);
        return res.status(500).json({
          success: false,
          message: 'Transaction failed due to connection timeout. Please try again.',
          error: 'TRANSACTION_TIMEOUT'
        });
      }
      // Re-throw other errors to be handled by outer catch
      throw error;
    }

    // Fetch complete sale data with relations
    const completeSale = await prisma.sale.findUnique({
      where: { id: result.sale.id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            totalPurchases: true,
            loyaltyPoints: true,
            isVIP: true,
            lastVisit: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            username: true
          }
        },
        branch: {
          select: {
            id: true,
            name: true,
          }
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                barcode: true
              }
            }
          }
        },
        receipts: {
          select: {
            id: true,
            receiptNumber: true,
            printedAt: true
          }
        }
      }
    });

    if (!completeSale) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch complete sale data'
      });
    }

    console.log('Complete sale data:', completeSale);
    console.log('Customer in sale:', completeSale.customer);

    // Send real-time notification to all users of the same admin
    const createdBy = req.user?.createdBy || req.user?.id;
    if (createdBy) {
      notifySaleChange(createdBy, 'created', completeSale);
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('sale', 'create', completeSale).catch(err => {
      console.error('[Sync] Sale create sync failed:', err.message);
    });

    // Create notification for the sale
    createNotification({
      userId: createdBy || userId,
      businessId: createdBy || userId,
      type: 'sale_created',
      title: 'New Sale Recorded',
      body: `Sale #${completeSale.invoiceNumber || completeSale.id?.slice(-8)} recorded for Rs. ${completeSale.totalAmount || 0}`,
      actionUrl: `/business/${createdBy}/sales`,
      metadata: { saleId: completeSale.id, amount: completeSale.totalAmount },
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      data: {
        ...completeSale,
        receiptNumber: result.receipt.receiptNumber
      }
    });
  } catch (error) {
    console.error('Create sale error:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    });
  }
};

export const updateSale = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { discountPercentage, saleDate, notes, paymentStatus } = req.body;

    console.log('Update sale request:', { id, discountPercentage, saleDate, notes, paymentStatus });

    // Validate input
    if (discountPercentage !== undefined && (discountPercentage < 0 || discountPercentage > 100)) {
      return res.status(400).json({
        success: false,
        message: 'Discount percentage must be between 0 and 100'
      });
    }

    // Validate payment status if provided
    if (paymentStatus !== undefined && !['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'].includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment status. Must be PENDING, COMPLETED, FAILED, or REFUNDED'
      });
    }

    // Get the existing sale
    const existingSale = await prisma.sale.findUnique({
      where: { id },
      include: {
        items: true,
        customer: true,
        user: true,
        branch: true,
        company: true
      }
    });

    if (!existingSale) {
      return res.status(404).json({
        success: false,
        message: 'Sale not found'
      });
    }

    const userRole = getUserRole(req);

    // Check if user has permission to update this sale
    const canUpdate = userRole === 'OWNER' ||
      (userRole === 'MANAGER' && existingSale.userId === req.user?.id) ||
      (userRole === 'CASHIER' && existingSale.userId === req.user?.id);

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this sale'
      });
    }

    // Calculate new totals if discount percentage changed
    let newDiscountAmount = existingSale.discountAmount;
    let newTaxAmount = existingSale.taxAmount;
    let newTotalAmount = existingSale.totalAmount;

    if (discountPercentage !== undefined && discountPercentage !== existingSale.discountPercentage) {
      newDiscountAmount = (existingSale.subtotal * discountPercentage) / 100;
      const subtotalAfterDiscount = existingSale.subtotal - newDiscountAmount;
      newTaxAmount = subtotalAfterDiscount * 0; // Tax disabled - 0%
      newTotalAmount = subtotalAfterDiscount + newTaxAmount;
    }

    // Determine new payment status and sale status
    const newPaymentStatus: PaymentStatus = (paymentStatus || existingSale.paymentStatus) as PaymentStatus;
    const newSaleStatus = newPaymentStatus === 'COMPLETED' ? 'COMPLETED' :
      newPaymentStatus === 'PENDING' ? 'PENDING' :
        existingSale.status;

    // Update the sale
    const updatedSale = await prisma.sale.update({
      where: { id },
      data: {
        discountPercentage: discountPercentage !== undefined ? discountPercentage : existingSale.discountPercentage,
        discountAmount: newDiscountAmount,
        taxAmount: newTaxAmount,
        totalAmount: newTotalAmount,
        paymentStatus: newPaymentStatus,
        status: newSaleStatus,
        saleDate: saleDate ? new Date(saleDate) : existingSale.saleDate,
        updatedAt: new Date()
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        customer: true,
        user: true,
        branch: true,
        company: true,
        receipts: true
      }
    });

    // Convert BigInt values to strings for JSON serialization
    const serializedSale = {
      ...updatedSale,
      id: updatedSale.id.toString(),
      userId: updatedSale.userId.toString(),
      branchId: updatedSale.branchId.toString(),
      companyId: updatedSale.companyId.toString(),
      customerId: updatedSale.customerId?.toString() || null,
      subtotal: Number(updatedSale.subtotal),
      taxAmount: Number(updatedSale.taxAmount),
      discountAmount: Number(updatedSale.discountAmount),
      discountPercentage: updatedSale.discountPercentage ? Number(updatedSale.discountPercentage) : null,
      totalAmount: Number(updatedSale.totalAmount),
      paidAmount: Number(updatedSale.paidAmount || 0),
      returnedAmount: Number(updatedSale.returnedAmount || 0),
      createdAt: updatedSale.createdAt.toISOString(),
      updatedAt: updatedSale.updatedAt.toISOString(),
      saleDate: updatedSale.saleDate?.toISOString() || null,
      items: updatedSale.items.map((item: any) => ({
        ...item,
        id: item.id.toString(),
        saleId: item.saleId.toString(),
        productId: item.productId.toString(),
        batchId: item.batchId?.toString() || null,
        createdBy: item.createdBy?.toString() || null,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
        product: {
          ...item.product,
          id: item.product.id.toString(),
          branchId: item.product.branchId.toString(),
          companyId: item.product.companyId.toString(),
          categoryId: item.product.categoryId?.toString() || null,
          createdBy: item.product.createdBy?.toString() || null,
          // costPrice, sellingPrice, and stock are now managed through batches
          minStock: Number(item.product.minStock),
          maxStock: Number(item.product.maxStock),
          createdAt: item.product.createdAt.toISOString(),
          updatedAt: item.product.updatedAt.toISOString()
        }
      })),
      customer: updatedSale.customer ? {
        ...updatedSale.customer,
        id: updatedSale.customer.id.toString(),
        branchId: updatedSale.customer.branchId.toString(),
        companyId: updatedSale.customer.companyId.toString(),
        createdBy: updatedSale.customer.createdBy?.toString() || null,
        totalPurchases: Number(updatedSale.customer.totalPurchases),
        loyaltyPoints: Number(updatedSale.customer.loyaltyPoints),
        createdAt: updatedSale.customer.createdAt.toISOString(),
        updatedAt: updatedSale.customer.updatedAt.toISOString()
      } : null,
      user: {
        ...updatedSale.user,
        id: updatedSale.user.id.toString(),
        branchId: updatedSale.branchId?.toString() || null,
        companyId: updatedSale.companyId?.toString() || null,
        createdBy: updatedSale.user.createdBy?.toString() || null,
        createdAt: updatedSale.user.createdAt.toISOString(),
        updatedAt: updatedSale.user.updatedAt.toISOString()
      },
      branch: {
        ...updatedSale.branch,
        id: updatedSale.branch.id.toString(),
        companyId: updatedSale.branch.companyId.toString(),
        createdBy: updatedSale.branch.createdBy?.toString() || null,
        createdAt: updatedSale.branch.createdAt.toISOString(),
        updatedAt: updatedSale.branch.updatedAt.toISOString()
      },
      company: {
        ...updatedSale.company,
        id: updatedSale.company.id.toString(),
        createdBy: updatedSale.company.createdBy?.toString() || null,
        createdAt: updatedSale.company.createdAt.toISOString(),
        updatedAt: updatedSale.company.updatedAt.toISOString()
      },
      receipts: updatedSale.receipts.map((receipt: any) => ({
        ...receipt,
        id: receipt.id.toString(),
        saleId: receipt.saleId.toString(),
        printedAt: receipt.printedAt?.toISOString() || null
      }))
    };

    // Notify about the update
    const createdBy = req.user?.createdBy || req.user?.id;
    if (createdBy) {
      notifySaleChange(createdBy, 'updated', serializedSale);
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('sale', 'update', updatedSale).catch(err => {
      console.error('[Sync] Sale update sync failed:', err.message);
    });

    return res.json({
      success: true,
      data: serializedSale
    });

  } catch (error) {
    console.error('Update sale error:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    });
  }
};

export const deleteSale = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Get the existing sale
    const existingSale = await prisma.sale.findUnique({
      where: { id },
      include: {
        items: true,
        customer: true,
        user: true,
        branch: true,
        company: true,
        receipts: true
      }
    });

    if (!existingSale) {
      return res.status(404).json({
        success: false,
        message: 'Sale not found'
      });
    }

    const userRole = getUserRole(req);

    // Check if user has permission to delete this sale
    const canDelete = userRole === 'OWNER' ||
      (userRole === 'MANAGER' && existingSale.userId === req.user?.id) ||
      (userRole === 'CASHIER' && existingSale.userId === req.user?.id);

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this sale'
      });
    }

    // Use transaction to ensure data consistency
    await prisma.$transaction(async (tx: any) => {
      // Delete sale items first (foreign key constraint)
      await tx.saleItem.deleteMany({
        where: { saleId: id }
      });

      // Delete receipts
      await tx.receipt.deleteMany({
        where: { saleId: id }
      });

      // Restore stock from batches if sale was completed
      if (existingSale.status === 'COMPLETED') {
        for (const item of existingSale.items) {
          if (item.batchId) {
            // Restore quantity to batch
            // Update batch quantity - use raw SQL directly to avoid reportReason column issues
            await tx.$executeRawUnsafe(
              `UPDATE batches 
               SET quantity = quantity + ${item.quantity},
                   "updatedAt" = CURRENT_TIMESTAMP
               WHERE id = '${item.batchId}'`
            );

            // Create stock movement for restoration
            await tx.stockMovement.create({
              data: {
                productId: item.productId,
                type: 'IN',
                quantity: item.quantity,
                reason: 'Sale Deletion - Stock Restored',
                reference: id,
                createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id'
              }
            });
          }
        }

        // Update customer stats if customer exists
        if (existingSale.customerId) {
          await tx.customer.update({
            where: { id: existingSale.customerId },
            data: {
              totalPurchases: {
                decrement: existingSale.totalAmount
              },
              loyaltyPoints: {
                decrement: Math.floor(existingSale.totalAmount / 100) // 1 point per 100 PKR
              }
            }
          });
        }
      }

      // Delete the sale
      await tx.sale.delete({
        where: { id }
      });
    }, {
      timeout: 60000 // 60 seconds timeout for long-running transactions
      // Note: SQLite only supports Serializable isolation level, so we omit isolationLevel
    });

    // Send real-time notification
    const createdBy = req.user?.createdBy || req.user?.id;
    if (createdBy) {
      notifySaleChange(createdBy, 'deleted', existingSale);
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('sale', 'delete', existingSale).catch(err => {
      console.error('[Sync] Sale delete sync failed:', err.message);
    });

    return res.json({
      success: true,
      message: 'Sale deleted successfully'
    });
  } catch (error) {
    console.error('Delete sale error:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    });
  }
};
