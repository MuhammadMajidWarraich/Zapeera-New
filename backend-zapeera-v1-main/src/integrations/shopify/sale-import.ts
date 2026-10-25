// ─── Shopify integration — sale import adapter (feature/integration-shopify)
// Imported Shopify orders become Zapeera sales through the EXISTING
// createSale handler (src/controllers/sale.controller.ts) — NOT a
// parallel sales writer. Calling it in-process with a synthesized
// request means an imported order gets exactly what a POS sale gets:
// server-computed totals, the FEFO batch path (batches ordered by
// expireDate, one batch per line, atomic decrement), stock movements,
// receipts, khata postings, loyalty, tax lines and FBR enqueue. The
// channel tag (Sale.channel / externalOrderId) rides in the same
// transaction — see the channelTag block in sale.controller.ts.
//
// The real handler is loaded with a LAZY dynamic import so this module
// stays light (sale.controller pulls in the DB init, SSE routes, FBR
// and sync helpers) and so tests can inject a fake SaleCreationFn
// instead of touching a database. The default function is used in
// production; sync-core passes it in, tests inject a stub.
export interface ImportedSaleLineInput {
  productId: string;
  variantId?: string | null;
  /** Base units (Zapeera sale lines store base units). */
  quantity: number;
  /** Per-base-unit price (PKR). Must be > 0 (createSale Joi rule). */
  unitPrice: number;
}

export interface ImportedSaleInput {
  businessId: string;
  branchId: string;
  /** The business owner (Business.createdBy) — the sale's cashier/actor. */
  actorUserId: string;
  customerId?: string | null;
  items: ImportedSaleLineInput[];
  paymentMethod: string;
  paymentStatus: 'PENDING' | 'COMPLETED' | 'REFUNDED';
  paidAmount: number;
  returnedAmount: number;
  discountAmount: number;
  /** ISO date of the Shopify order (keeps reporting dates truthful). */
  saleDate?: string;
  channel: 'shopify';
  externalOrderId: string;
}

export interface CreatedSale {
  id: string;
  invoiceNumber?: string | null;
  totalAmount: number;
}

/** Error from the existing sale path (carries its HTTP status). */
export class SaleImportError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'SaleImportError';
    this.statusCode = statusCode;
  }
}

export type SaleCreationFn = (input: ImportedSaleInput) => Promise<CreatedSale>;

/**
 * The production sale creator: synthesize the request createSale
 * expects and capture its response. createSale always answers with
 * exactly one res.status().json() — a 201 with the sale, or a 4xx/5xx
 * with { success: false, message }.
 */
export const createSaleThroughExistingPath: SaleCreationFn = async (
  input: ImportedSaleInput
): Promise<CreatedSale> => {
  const { createSale } = await import('../../controllers/sale.controller');

  const req: any = {
    body: {
      customerId: input.customerId ?? null,
      branchId: input.branchId,
      items: input.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice
      })),
      paymentMethod: input.paymentMethod,
      paymentStatus: input.paymentStatus,
      paidAmount: input.paidAmount,
      returnedAmount: input.returnedAmount,
      discountAmount: input.discountAmount,
      saleDate: input.saleDate,
      channel: input.channel,
      externalOrderId: input.externalOrderId
    },
    user: {
      id: input.actorUserId,
      createdBy: input.actorUserId,
      selectedCompanyId: input.businessId,
      selectedBranchId: input.branchId
    },
    membership: { id: null, business_id: input.businessId },
    headers: {}
  };

  const answer = await new Promise<{ status: number; payload: any }>((resolve) => {
    const res: any = {
      status(code: number) {
        (res as any)._status = code;
        return res;
      },
      json(payload: any) {
        resolve({ status: (res as any)._status ?? 200, payload });
        return res;
      }
    };
    // createSale catches its own errors and answers 4xx/5xx; a throw
    // here would only mean the handler itself is broken.
    createSale(req, res).catch((error: unknown) => {
      resolve({
        status: 500,
        payload: {
          success: false,
          message: error instanceof Error ? error.message : 'Sale creation failed.'
        }
      });
    });
  });

  if (answer.status < 200 || answer.status >= 300 || answer.payload?.success === false) {
    throw new SaleImportError(
      `shopify: the sale could not be created (${answer.payload?.message ?? `HTTP ${answer.status}`})`,
      answer.status
    );
  }
  const sale = answer.payload?.data;
  if (!sale?.id) {
    throw new SaleImportError('shopify: the sale was created but its id was not returned.');
  }
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber ?? null,
    totalAmount: Number(sale.totalAmount ?? 0)
  };
};
