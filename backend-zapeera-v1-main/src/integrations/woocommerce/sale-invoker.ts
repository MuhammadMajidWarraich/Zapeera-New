// ─── Invoke the existing sale engine in-process (feature/integration-woocommerce)
// Imported WooCommerce orders become Zapeera sales through the SAME
// createSale path a POS sale uses — never a parallel writer. This is
// the codebase's own precedent: appointment.controller.ts and
// folio.controller.ts "lend" createSale a synthetic request and capture
// its response (their invokeCreateSale). The imported sale therefore
// gets, for free and byte-identically: server-computed totals, the
// FEFO batch deduction (with the atomic decrement guard), stock
// movements, receipts, customer stats + loyalty, khata SALE_DUE rows,
// tax lines, promotions evaluation and the FBR outbox enqueue.
//
// There is no logged-in cashier on an import/webhook, so the actor is
// the business owner (Business.createdBy, else the earliest ACTIVE
// membership) — resolved by resolveSaleActor() in handler.ts and passed
// in here. The synthetic request pins selectedCompanyId /
// selectedBranchId to the bound branch so stock and the invoice land
// exactly where the store is bound.

import { createSale } from '../../controllers/sale.controller';

export interface SaleActor {
  /** ZapeeraUser id recorded as the sale's cashier (Sale.userId). */
  userId: string;
  /** Membership id stamped on the sale (Sale.membershipId), when known. */
  membershipId: string | null;
}

export interface InvokedSaleResult {
  status: number;
  body: any;
}

/**
 * Run createSale for a composed payload and capture its response.
 * The caller's payload is NOT mutated; the synthetic request borrows
 * no shared state (a fresh object is built per call).
 */
export async function invokeCreateSale(
  actor: SaleActor,
  businessId: string,
  branchId: string,
  payload: Record<string, unknown>
): Promise<InvokedSaleResult> {
  let status = 500;
  let body: any = null;
  const captureRes: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json(responseBody: any) {
      body = responseBody;
      return this;
    }
  };
  const syntheticReq: any = {
    body: { ...payload, branchId },
    user: {
      id: actor.userId,
      createdBy: actor.userId,
      selectedCompanyId: businessId,
      selectedBranchId: branchId
    },
    membership: actor.membershipId
      ? { id: actor.membershipId, business_id: businessId }
      : undefined,
    headers: { 'x-company-id': businessId }
  };
  await createSale(syntheticReq, captureRes);
  return { status, body };
}
