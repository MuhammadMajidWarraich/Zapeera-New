// Enums removed - using string types for SQLite compatibility
// Wave B1: JAZZCASH and EASYPAISA are first-class tender methods
// (MOBILE stays for backward compatibility), and 'MIXED' is the stored
// headline paymentMethod of a sale split across several tenders — it is
// never a tender itself, so it is not part of SalePaymentMethod.
export type SalePaymentMethod = 'CASH' | 'CARD' | 'JAZZCASH' | 'EASYPAISA' | 'BANK_TRANSFER' | 'MOBILE';
export type PaymentMethod = SalePaymentMethod | 'MIXED';

export interface SalePaymentData {
  method: SalePaymentMethod | string;
  amount: number;
  reference?: string | null;
}
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
export type SaleStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';

export interface CreateSaleData {
  customerId?: string;
  userId: string;
  branchId: string;
  items: SaleItemData[];
  paymentMethod: PaymentMethod | string;
  paymentStatus?: PaymentStatus | string;
  payments?: SalePaymentData[]; // Split-tender allocations (Wave B1)
  discountAmount?: number;
  discountPercentage?: number;
  paidAmount?: number; // Amount paid by customer
  returnedAmount?: number; // Amount returned/refunded
  saleDate?: string;
}

export interface SaleItemData {
  productId: string;
  quantity: number;
  saleType?: 'UNIT' | 'BOX' | string;
  unitsDeducted?: number;
  unitsPerBox?: number;
  unitPrice: number;
  batchId?: string; // Link to specific batch
  batchNumber?: string; // Keep for backward compatibility
  expiryDate?: string;
  discountPercentage?: number; // Item-level discount percentage
  discountAmount?: number; // Item-level discount amount
  totalPrice?: number; // Item total price after discount (optional, will be calculated if not provided)
}

export interface SaleResponse {
  id: string;
  invoiceNumber?: string; // Short 4-5 digit invoice number
  customer?: {
    id: string;
    name: string;
    phone: string;
  };
  items: Array<{
    id: string;
    product: {
      id: string;
      name: string;
    };
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    batchNumber?: string;
    expiryDate?: string;
  }>;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  discountPercentage?: number;
  totalAmount: number;
  paidAmount?: number; // Amount paid by customer
  returnedAmount?: number; // Amount returned/refunded
  paymentMethod: PaymentMethod | string;
  payments?: SalePaymentData[]; // Split-tender allocations (Wave B1)
  paymentStatus: PaymentStatus | string;
  status: SaleStatus | string;
  saleDate?: string;
  createdAt: string;
  receiptNumber?: string;
}