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
  loyaltyPointsToRedeem?: number; // Loyalty redemption (Wave B3): points to spend on this sale
  couponCode?: string | null; // Promotions (Wave B4): the ONLY promotion input a client may send — the engine resolves the discount server-side
  prescriptionId?: string | null; // Prescriptions (Wave C1): register record this sale dispenses against; required at the POS for requiresPrescription items when enforcement is on
  folioId?: string | null; // Hotel pack (Wave C5): charge-to-room — the OPEN folio this sale's total is posted to as a SERVICE folio charge; the sale itself is stored unpaid with paymentMethod 'FOLIO'
  salespersonId?: string | null; // Salesperson attribution (Wave C6): the staff member credited with the sale when not the cashier; commissions read salespersonId ?? userId
  creditLimitOverride?: boolean; // Credit limit (gap item 7): explicit owner/manager flag allowing this one credit sale to exceed the customer's credit limit
  channel?: string | null; // Online store (Wave C5 — gap item 5) + gift cards / eWallet + kiosk (Wave C9 — gap item 9) + sales-channel imports (Shopify/Daraz/WooCommerce): POS (default, all history) | ONLINE_STORE (customer order from the branch storefront) | KIOSK (in-store self-ordering order, pay at counter) | 'shopify' | 'daraz' | 'woocommerce' (imported vendor order)
  deliveryAddress?: string | null; // Online store: delivery address for ONLINE_STORE sales
  deliveryPhone?: string | null; // Online store: customer phone for ONLINE_STORE sales
  deliveryNotes?: string | null; // Online store: delivery/pickup notes for ONLINE_STORE sales
  // Sales-channel import tag: the vendor's order id. Written inside the
  // sale transaction so the tag and the sale can never disagree; the
  // (companyId, channel, externalOrderId) unique index makes a
  // re-imported order collide instead of duplicating. Absent (null) on
  // every POS/manual sale.
  externalOrderId?: string | null;
  discountAmount?: number;
  discountPercentage?: number;
  paidAmount?: number; // Amount paid by customer
  returnedAmount?: number; // Amount returned/refunded
  saleDate?: string;
}

export interface SaleItemData {
  productId: string;
  quantity: number;
  // Unit engine (Wave C2): the selling level `quantity` is expressed
  // in (PACK | STRIP | UNIT). Absent = the historical UNIT/BOX
  // contract (voice/desktop/legacy clients). When present, the
  // server resolves the factor from the product and stores quantity
  // as BASE units — see src/utils/unit.util.ts.
  unitLevel?: 'PACK' | 'STRIP' | 'UNIT' | string;
  saleType?: 'UNIT' | 'BOX' | string;
  unitsDeducted?: number;
  unitsPerBox?: number;
  unitPrice: number;
  // Product variants (Wave C6): the variant this line sells. When
  // present, stock is drawn only from that variant's batches and the
  // line stores the variantName snapshot (see sale.controller).
  variantId?: string | null;
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
  // Loyalty (Wave B3): stored redemption/earn facts for this sale,
  // plus the response-friendly aliases the create handler adds.
  loyaltyPointsRedeemed?: number | null;
  loyaltyDiscount?: number | null;
  loyaltyPointsEarned?: number | null;
  pointsRedeemed?: number;
  pointsEarned?: number;
  paymentStatus: PaymentStatus | string;
  status: SaleStatus | string;
  saleDate?: string;
  createdAt: string;
  receiptNumber?: string;
}