// ─── Google Sheets provider — Zapeera → sheet row mapping ─────────────
// Pure functions (no I/O): one header row + one row per record, per
// entity. EVERY row starts with the Branch column — exports are
// per-business AND per-branch, and when the merchant exports all
// branches the column is what keeps branches from mixing silently.
// Dates are written as ISO date strings (yyyy-mm-dd) so Sheets parses
// them as dates under valueInputOption=USER_ENTERED; money is written
// as numbers (PKR), never as formatted strings.
// The final column on every row is "Exported At" (ISO timestamp of the
// run) so a repeated export — which APPENDS a fresh snapshot — can be
// told apart from the previous run's rows.

export type SheetRow = Array<string | number>;

export const SALES_HEADERS = [
  'Branch',
  'Invoice No',
  'Date',
  'Customer',
  'Customer Phone',
  'Subtotal (PKR)',
  'Discount (PKR)',
  'Tax (PKR)',
  'Total (PKR)',
  'Paid (PKR)',
  'Payment Method',
  'Payment Status',
  'Status',
  'Exported At'
] as const;

export const STOCK_HEADERS = [
  'Branch',
  'Product',
  'SKU',
  'Barcode',
  'Category',
  'Current Qty',
  'Min Stock',
  'Reorder Level',
  'Selling Price (PKR)',
  'Low Stock',
  'Exported At'
] as const;

export const CUSTOMER_HEADERS = [
  'Branch',
  'Name',
  'Phone',
  'Email',
  'Address',
  'Total Purchases (PKR)',
  'Loyalty Points',
  'VIP',
  'Last Visit',
  'Created',
  'Exported At'
] as const;

export const KHATA_HEADERS = [
  'Branch',
  'Customer',
  'Customer Phone',
  'Entry Type',
  'Amount (PKR)',
  'Running Balance (PKR)',
  'Method',
  'Reference',
  'Note',
  'Date',
  'Exported At'
] as const;

function isoDate(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function mapSaleRow(
  branchName: string,
  sale: any,
  exportedAt: string
): SheetRow {
  return [
    branchName,
    str(sale.invoiceNumber),
    isoDate(sale.saleDate ?? sale.createdAt),
    str(sale.customer?.name),
    str(sale.customer?.phone),
    num(sale.subtotal),
    num(sale.discountAmount),
    num(sale.taxAmount),
    num(sale.totalAmount),
    num(sale.paidAmount),
    str(sale.paymentMethod),
    str(sale.paymentStatus),
    str(sale.status),
    exportedAt
  ];
}

export function mapStockRow(
  branchName: string,
  product: any,
  quantity: number,
  sellingPrice: number,
  exportedAt: string
): SheetRow {
  const minStock = num(product.minStock);
  return [
    branchName,
    str(product.name),
    str(product.sku),
    str(product.barcode),
    str(product.category?.name),
    quantity,
    minStock,
    product.reorderLevel === null || product.reorderLevel === undefined ? '' : num(product.reorderLevel),
    sellingPrice,
    quantity <= minStock ? 'Yes' : 'No',
    exportedAt
  ];
}

export function mapCustomerRow(branchName: string, customer: any, exportedAt: string): SheetRow {
  return [
    branchName,
    str(customer.name),
    str(customer.phone),
    str(customer.email),
    str(customer.address),
    num(customer.totalPurchases),
    num(customer.loyaltyPoints),
    customer.isVIP ? 'Yes' : 'No',
    isoDate(customer.lastVisit),
    isoDate(customer.createdAt),
    exportedAt
  ];
}

export function mapKhataRow(
  branchName: string,
  entry: any,
  runningBalance: number,
  exportedAt: string
): SheetRow {
  return [
    branchName,
    str(entry.customer?.name),
    str(entry.customer?.phone),
    str(entry.type),
    num(entry.amount),
    runningBalance,
    str(entry.method),
    str(entry.reference),
    str(entry.note),
    isoDate(entry.createdAt),
    exportedAt
  ];
}
