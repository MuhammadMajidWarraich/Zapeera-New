


export interface CreateProductData {
    name: string;
    description?: string;
    formula?: string; // New field for product composition
    sku: string;
    categoryId: string;
    categoryName?: string; // For bulk import - category name when categoryId doesn't exist
    supplierId?: string; // Optional - supplier is assigned at batch level
    taxClassId?: string | null; // Wave B5
    pctCode?: string | null; // Wave B7 - PCT/HS code (digits-only), null = FBR fallback
    branchId: string;
    barcode?: string;
    additionalBarcodes?: string[]; // Multiple barcodes per product
    barcodeType?: string; // CODE128, EAN13, EAN8, UPC_A, UPC_E, CODE39, QR
    isGenerated?: boolean; // true if barcode was auto-generated
    requiresPrescription: boolean;
    isControlled?: boolean; // Gap item 2 - scheduled/controlled medicine flag
    controlledSchedule?: string | null; // Gap item 2 - schedule/category label
    // Temporary fields for backward compatibility (will be removed when frontend is updated)
    costPrice?: number;
    sellingPrice?: number;
    stock?: number;
    minStock?: number;
    maxStock?: bigint;
    reorderLevel?: number | null; // Wave C3 - opt-in reorder point; null = no reorder suggestions
    reorderQuantity?: number | null; // Wave C3 - fixed reorder qty; null = derive from reorderLevel
    unitsPerPack?: number;
    unitsPerStrip?: number | null; // Wave C2 - tablets per strip; null = not sold by the strip
  }

  export interface UpdateProductData {
    name?: string;
    description?: string;
    formula?: string; // New field for product composition
    sku?: string;
    categoryId?: string;
    supplierId?: string;
    taxClassId?: string | null; // Wave B5
    pctCode?: string | null; // Wave B7
    branchId?: string;
    barcode?: string;
    additionalBarcodes?: string[];
    barcodeType?: string;
    isGenerated?: boolean;
    requiresPrescription?: boolean;
    isControlled?: boolean; // Gap item 2
    controlledSchedule?: string | null; // Gap item 2
    isActive?: boolean;
    // Temporary fields for backward compatibility (will be removed when frontend is updated)
    costPrice?: number;
    sellingPrice?: number;
    stock?: number;
    minStock?: number;
    maxStock?: bigint;
    reorderLevel?: number | null; // Wave C3
    reorderQuantity?: number | null; // Wave C3
    unitsPerPack?: number;
    unitsPerStrip?: number | null; // Wave C2 - tablets per strip; null = not sold by the strip
  }

  export interface StockMovementData {
    productId: string;
    type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'RETURN';
    quantity: number;
    reason?: string;
    reference?: string;
    createdBy?: string;
  }