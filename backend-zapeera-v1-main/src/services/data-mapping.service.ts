import { PrismaClient } from '@prisma/client';
import { ExtractedData } from './ocr.service';

const prisma = new PrismaClient();

export interface MappedData {
  product: {
    id?: string;
    name?: string;
    sku?: string;
    categoryId?: string;
    supplierId?: string;
    branchId: string;
    companyId: string;
    createNew?: boolean;
  };
  category: {
    id?: string;
    name?: string;
    createNew?: boolean;
  };
  manufacturer: {
    id?: string;
    name?: string;
    createNew?: boolean;
  };
  batch: {
    batchNo?: string;
    productId?: string;
    quantity?: number;
    purchasePrice?: number;
    expireDate?: string;
    shelfId?: string;
    supplierId?: string;
    createNew?: boolean;
  };
  shelf: {
    id?: string;
    name?: string;
    createNew?: boolean;
  };
  supplier: {
    id?: string;
    name?: string;
    createNew?: boolean;
  };
}

export class DataMappingService {
  /**
   * Map extracted OCR data to database entities
   */
  static async mapExtractedData(
    extractedData: ExtractedData,
    branchId: string,
    companyId: string
  ): Promise<MappedData> {
    const result: MappedData = {
      product: { branchId, companyId },
      category: {},
      manufacturer: {},
      batch: {},
      shelf: {},
      supplier: {},
    };

    // Map Product
    if (extractedData.productName) {
      const existingProduct = await prisma.product.findFirst({
        where: {
          branchId,
          companyId,
          name: { contains: extractedData.productName },
        },
      });

      if (existingProduct) {
        result.product.id = existingProduct.id;
        result.product.name = existingProduct.name;
        result.product.sku = existingProduct.sku;
        result.product.categoryId = existingProduct.categoryId;
        result.product.supplierId = existingProduct.supplierId ?? undefined;
      } else {
        result.product.name = extractedData.productName;
        result.product.createNew = true;
      }
    }

    // Map Category
    if (extractedData.category) {
      const existingCategory = await prisma.category.findFirst({
        where: {
          branchId,
          companyId,
          name: { contains: extractedData.category },
        },
      });

      if (existingCategory) {
        result.category.id = existingCategory.id;
        result.category.name = existingCategory.name;
      } else {
        result.category.name = extractedData.category;
        result.category.createNew = true;
      }
    }

    // Map Manufacturer
    if (extractedData.manufacturer) {
      const existingManufacturer = await prisma.manufacturer.findFirst({
        where: {
          branchId,
          companyId,
          name: { contains: extractedData.manufacturer },
        },
      });

      if (existingManufacturer) {
        result.manufacturer.id = existingManufacturer.id;
        result.manufacturer.name = existingManufacturer.name;
      } else {
        result.manufacturer.name = extractedData.manufacturer;
        result.manufacturer.createNew = true;
      }
    }

    // Map Supplier
    if (extractedData.supplier) {
      const existingSupplier = await prisma.supplier.findFirst({
        where: {
          branchId,
          companyId,
          name: { contains: extractedData.supplier },
        },
      });

      if (existingSupplier) {
        result.supplier.id = existingSupplier.id;
        result.supplier.name = existingSupplier.name;
      } else {
        result.supplier.name = extractedData.supplier;
        result.supplier.createNew = true;
      }
    }

    // Map Shelf
    if (extractedData.shelf) {
      const existingShelf = await prisma.shelf.findFirst({
        where: {
          branchId,
          companyId,
          name: { contains: extractedData.shelf },
        },
      });

      if (existingShelf) {
        result.shelf.id = existingShelf.id;
        result.shelf.name = existingShelf.name;
      } else {
        result.shelf.name = extractedData.shelf;
        result.shelf.createNew = true;
      }
    }

    // Map Batch
    if (extractedData.batchNo) {
      result.batch.batchNo = extractedData.batchNo;
      result.batch.quantity = extractedData.quantity || 0;
      result.batch.purchasePrice = extractedData.price || 0;
      result.batch.expireDate = extractedData.expiryDate ? new Date(extractedData.expiryDate).toISOString() : undefined;
      result.batch.createNew = true;
    }

    return result;
  }

  /**
   * Save mapped data to database
   */
  static async saveMappedData(
    mappedData: MappedData,
    createdBy: string
  ): Promise<{ success: boolean; errors: string[]; data: any }> {
    const errors: string[] = [];
    const savedData: any = {};

    try {
      // Create Category if needed
      if (mappedData.category.createNew && mappedData.category.name) {
        const category = await prisma.category.create({
          data: {
            name: mappedData.category.name,
            branchId: mappedData.product.branchId,
            companyId: mappedData.product.companyId,
            createdBy,
          },
        });
        savedData.category = category;
        mappedData.product.categoryId = category.id;
      }

      // Create Manufacturer if needed
      if (mappedData.manufacturer.createNew && mappedData.manufacturer.name) {
        const manufacturer = await prisma.manufacturer.create({
          data: {
            name: mappedData.manufacturer.name,
            branchId: mappedData.product.branchId,
            companyId: mappedData.product.companyId,
            createdBy,
          },
        });
        savedData.manufacturer = manufacturer;
      }

      // Create Supplier if needed
      if (mappedData.supplier.createNew && mappedData.supplier.name) {
        const supplier = await prisma.supplier.create({
          data: {
            name: mappedData.supplier.name,
            contactPerson: 'Unknown',
            phone: '000-000-0000',
            branchId: mappedData.product.branchId,
            companyId: mappedData.product.companyId,
            createdBy,
          },
        });
        savedData.supplier = supplier;
        mappedData.batch.supplierId = supplier.id;
      } else if (mappedData.supplier.id) {
        mappedData.batch.supplierId = mappedData.supplier.id;
      }

      // Create Shelf if needed
      if (mappedData.shelf.createNew && mappedData.shelf.name) {
        const shelf = await prisma.shelf.create({
          data: {
            name: mappedData.shelf.name,
            branchId: mappedData.product.branchId,
            companyId: mappedData.product.companyId,
            createdBy,
          },
        });
        savedData.shelf = shelf;
        mappedData.batch.shelfId = shelf.id;
      } else if (mappedData.shelf.id) {
        mappedData.batch.shelfId = mappedData.shelf.id;
      }

      // Create Product if needed
      if (mappedData.product.createNew && mappedData.product.name) {
        // Create a default category if none exists
        let categoryId = mappedData.product.categoryId;
        if (!categoryId) {
          const defaultCategory = await prisma.category.findFirst({
            where: { branchId: mappedData.product.branchId, companyId: mappedData.product.companyId }
          });
          if (!defaultCategory) {
            const newCategory = await prisma.category.create({
              data: {
                name: 'General',
                branchId: mappedData.product.branchId,
                companyId: mappedData.product.companyId,
                createdBy,
              },
            });
            categoryId = newCategory.id;
            savedData.category = newCategory;
          } else {
            categoryId = defaultCategory.id;
          }
        }

        const product = await prisma.product.create({
          data: {
            name: mappedData.product.name,
            sku: `SKU-${Date.now()}`,
            categoryId: categoryId,
            supplierId: mappedData.product.supplierId,
            branchId: mappedData.product.branchId,
            companyId: mappedData.product.companyId,
            createdBy,
          },
        });
        savedData.product = product;
        mappedData.batch.productId = product.id;
      } else if (mappedData.product.id) {
        mappedData.batch.productId = mappedData.product.id;
      }

      // Create Batch
      if (mappedData.batch.batchNo && mappedData.batch.productId) {
        const batch = await prisma.batch.create({
          data: {
            batchNo: mappedData.batch.batchNo,
            productId: mappedData.batch.productId,
            branchId: mappedData.product.branchId,
            companyId: mappedData.product.companyId,
            quantity: mappedData.batch.quantity || 0,
            purchasePrice: mappedData.batch.purchasePrice || 0,
            sellingPrice: mappedData.batch.purchasePrice || 0, // Default to purchase price
            expireDate: mappedData.batch.expireDate ? new Date(mappedData.batch.expireDate) : undefined,
            shelfId: mappedData.batch.shelfId,
            supplierId: mappedData.batch.supplierId,
            createdBy,
          },
        });
        savedData.batch = batch;
      }

      return { success: true, errors, data: savedData };
    } catch (error) {
      console.error('Error saving mapped data:', error);
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return { success: false, errors, data: savedData };
    }
  }
}
